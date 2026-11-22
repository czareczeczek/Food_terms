import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Bell, ChevronRight, Download, History, Leaf, Moon, Package, Plus, Search, Settings, ShieldCheck, SlidersHorizontal, Sparkles, Sun, X } from 'lucide-react';
import { CATEGORIES, LOCATIONS, EMPTY_DATA, MAX_BYTES, createId, dateKey, daysLeft, expiryStatus, parseData } from './core/model';
import type { ExpiryStatus, Product } from './core/model';
import { PANTRY_KEY, usePantry } from './hooks/usePantry';
import type { SaveResult } from './hooks/usePantry';
import { useDrive } from './hooks/useDrive';
import Modal from './components/Modal';
import ProductEditor from './components/ProductEditor';
import ProductCard, { EXPIRY_LABELS, EXPIRY_ICONS } from './components/ProductCard';
import SettingsPanel from './components/SettingsPanel';
import { CloudConflict, CloudStrip } from './components/CloudPanel';

type Page = 'pantry' | 'reminders' | 'history' | 'settings';
type Confirm = { title: string; text: string; label: string; danger?: boolean; action: () => SaveResult | void };
const pages = [{ id: 'pantry', label: 'Spiżarnia', icon: Package }, { id: 'reminders', label: 'Przypomnienia', icon: Bell }, { id: 'history', label: 'Historia', icon: History }, { id: 'settings', label: 'Ustawienia', icon: Settings }] as const;
const number = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 6 });
function productsLabel(count: number) { return count === 1 ? 'produkt' : count % 10 >= 2 && count % 10 <= 4 && !(count % 100 >= 12 && count % 100 <= 14) ? 'produkty' : 'produktów'; }
function downloadJSON(text: string, name = `straznik-swiezosci-${dateKey()}.json`) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function App() {
  const pantry = usePantry();
  const { data } = pantry;
  const [page, setPage] = useState<Page>('pantry');
  const [now, setNow] = useState(new Date());
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [place, setPlace] = useState('');
  const [status, setStatus] = useState<ExpiryStatus | ''>('');
  const [sort, setSort] = useState('expiry');
  const [editor, setEditor] = useState<{ product?: Product; editing: boolean } | null>(null);
  const [partial, setPartial] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState('');
  const [partialError, setPartialError] = useState('');
  const [confirmation, setConfirmation] = useState<Confirm | null>(null);
  const [toast, setToast] = useState('');
  const [importError, setImportError] = useState('');
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => 'Notification' in window ? Notification.permission : 'unsupported');
  const inputFile = useRef<HTMLInputElement>(null);
  const sent = useRef(new Set<string>());
  const busy = Boolean(editor || partial || confirmation);
  const blocked = pantry.mode === 'corrupt' || (Boolean(pantry.error) && pantry.mode !== 'memory');
  const drive = useDrive({ products: data.products, getProducts: () => pantry.getData().products, applyRemote: products => pantry.save(current => ({ ...current, products })).ok, busy, blocked, memoryOnly: pantry.mode === 'memory' });
  const active = data.products.filter(product => product.state === 'active');
  const archive = data.products.filter(product => product.state !== 'active');
  const attention = active.filter(product => { const days = daysLeft(product.expiryDate, now); return days !== null && days <= data.settings.reminderDays; }).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

  useEffect(() => {
    const refresh = () => { setNow(new Date()); setPermission('Notification' in window ? Notification.permission : 'unsupported'); };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = data.settings.theme; }, [data.settings.theme]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 6000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (!data.settings.notifications || permission !== 'granted' || document.visibilityState !== 'visible' || !attention.length) return;
    const signature = `${dateKey(now)}:${attention.map(product => product.id).sort().join(',')}`;
    if (sent.current.has(signature)) return;
    sent.current.add(signature);
    try { new Notification('Strażnik świeżości', { body: `Sprawdź produkty wymagające uwagi: ${attention.slice(0, 3).map(product => product.name).join(', ')}. Razem: ${attention.length}.` }); }
    catch { setToast('Ta przeglądarka nie może wyświetlić powiadomienia. Przypomnienia na stronie nadal działają.'); }
  }, [attention, permission, now, data.settings.notifications]);

  function showResult(result: SaveResult, success?: string) { if (!result.ok) setToast(result.message); else if (success) setToast(success); return result; }
  function go(next: Page) { setPage(next); setSearch(''); setCategory(''); setPlace(''); setStatus(''); setSort(next === 'history' ? 'recent' : 'expiry'); }
  function exportFile() { downloadJSON(JSON.stringify(pantry.getData())); }
  function saveProduct(product: Product): SaveResult {
    const result = pantry.save(current => ({ ...current, products: current.products.some(item => item.id === product.id) ? current.products.map(item => item.id === product.id ? product : item) : [...current.products, product] }));
    if (result.ok) { setEditor(null); setToast(editor?.editing ? 'Zmiany zapisane.' : 'Produkt dodany do spiżarni.'); }
    return result;
  }
  function mark(product: Product, state: 'used' | 'discarded') { return showResult(pantry.save(current => ({ ...current, products: current.products.map(item => item.id === product.id ? { ...item, state, archivedAt: new Date().toISOString() } : item) })), state === 'used' ? 'Produkt zużyty. Mniej marnowania — dobry nawyk!' : 'Produkt oznaczony jako wyrzucony. Wpis znajdziesz w historii.'); }
  function remove(product: Product) { setConfirmation({ title: 'Usuń produkt', text: `Czy trwale usunąć „${product.name}”? Wpis zniknie także z historii. Nie będzie można go przywrócić.`, label: 'Usuń produkt', danger: true, action: () => pantry.save(current => ({ ...current, products: current.products.filter(item => item.id !== product.id) })) }); }
  function consumePart(event: FormEvent) {
    event.preventDefault(); setPartialError(''); if (!partial) return;
    const product = pantry.getData().products.find(item => item.id === partial.id && item.state === 'active');
    const used = Number(quantity);
    if (!product) { setPartialError('Produkt nie jest już na aktywnej liście.'); return; }
    if (!Number.isFinite(used) || used < 0.000001 || used > product.quantity || Number(used.toFixed(6)) !== used) { setPartialError('Podaj ilość większą od zera i nie większą niż dostępna, do 6 miejsc po przecinku.'); return; }
    const result = used === product.quantity ? mark(product, 'used') : pantry.save(current => ({ ...current, products: current.products.map(item => item.id === product.id ? { ...item, quantity: Number((item.quantity - used).toFixed(6)) } : item) }));
    if (result.ok) { setPartial(null); setToast('Zużycie zapisane.'); } else setPartialError(result.message);
  }
  async function importFile(file?: File) {
    setImportError(''); if (!file) return;
    try {
      if (file.size > MAX_BYTES) throw new Error('Plik jest za duży. Maksymalny rozmiar to 2 MB.');
      const imported = parseData(await file.text());
      setConfirmation({ title: 'Zastąpić dane?', text: `Import zawiera ${imported.products.length} wpisów. Zastąpi całą listę produktów, historię i ustawienia. Pobierz kopię JSON przed zmianą. Przy połączonym Dysku Google lista trafi również do synchronizacji.`, label: 'Zastąp i importuj', danger: true, action: () => pantry.save(imported, true) });
    } catch (error) { setImportError(error instanceof Error ? error.message : 'Nie udało się odczytać pliku.'); }
  }
  function loadDemo() {
    setConfirmation({ title: 'Dodać przykłady?', text: 'Dodamy sześć przykładowych produktów. Twoje obecne wpisy pozostaną zachowane. Przykłady możesz później usunąć.', label: 'Dodaj przykłady', action: () => {
      const date = (offset: number) => { const result = new Date(); result.setDate(result.getDate() + offset); return dateKey(result); };
      const entries = [
        { name: 'Jogurt naturalny', category: 'Nabiał', location: 'Lodówka', expiryDate: date(0), quantity: 2, unit: 'szt.' },
        { name: 'Świeży szpinak', category: 'Warzywa', location: 'Lodówka', expiryDate: date(2), quantity: 200, unit: 'g' },
        { name: 'Chleb żytni', category: 'Pieczywo', location: 'Szafka', expiryDate: date(-1), quantity: 1, unit: 'szt.' },
        { name: 'Napój owsiany', category: 'Napoje', location: 'Lodówka', expiryDate: date(5), quantity: 1, unit: 'l' },
        { name: 'Makaron pełnoziarnisty', category: 'Produkty suche', location: 'Szafka', expiryDate: date(90), quantity: 500, unit: 'g' },
        { name: 'Cytryny', category: 'Owoce', location: 'Spiżarnia', expiryDate: '', quantity: 3, unit: 'szt.' },
      ].map((item): Product => ({ ...item, id: createId(), dateLabel: item.category === 'Nabiał' || item.category === 'Warzywa' ? 'useBy' : 'bestBefore', openedDate: '', note: 'Produkt demonstracyjny', state: 'active', archivedAt: null }));
      return pantry.save(current => ({ ...current, products: [...current.products, ...entries] }));
    } });
  }
  async function toggleNotifications() {
    if (data.settings.notifications) { showResult(pantry.save(current => ({ ...current, settings: { ...current.settings, notifications: false } })), 'Powiadomienia wyłączone.'); return; }
    if (!('Notification' in window)) return;
    try {
      const choice = await Notification.requestPermission(); setPermission(choice);
      if (choice === 'granted') { sent.current.clear(); showResult(pantry.save(current => ({ ...current, settings: { ...current.settings, notifications: true } })), 'Powiadomienia włączone dla aktywnej strony.'); }
      else setToast('Nie udzielono zgody. Przypomnienia w aplikacji nadal są dostępne.');
    } catch { setToast('Nie udało się włączyć powiadomień w tej przeglądarce.'); }
  }
  const source = page === 'history' ? archive : page === 'reminders' ? attention : active;
  const filtered = source.filter(product => product.name.toLocaleLowerCase('pl').includes(search.trim().toLocaleLowerCase('pl')) && (!category || product.category === category) && (!place || product.location === place) && (!status || expiryStatus(product.expiryDate, now) === status)).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'pl') : sort === 'name-desc' ? b.name.localeCompare(a.name, 'pl') : sort === 'recent' ? (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '') : (a.expiryDate || '99999').localeCompare(b.expiryDate || '99999') || a.name.localeCompare(b.name, 'pl'));
  const hasFilter = Boolean(search || category || place || status);
  const heading = { pantry: 'Moja spiżarnia', reminders: 'Wymaga uwagi', history: 'Historia produktów', settings: 'Po Twojemu' }[page];

  return <div className="shell">
    <aside className="sidebar"><a href="#" className="brand" onClick={event => { event.preventDefault(); go('pantry'); }}><span className="brand-icon"><Leaf /></span><span className="brand-name">Strażnik<strong>świeżości<span>.</span></strong></span></a><p className="sidebar-caption">TWOJA DOMOWA SPIŻARNIA</p><nav className="nav" aria-label="Nawigacja główna">{pages.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined} onClick={() => go(item.id)}><item.icon /><span>{item.label}</span>{item.id === 'reminders' && attention.length > 0 && <span className="nav-count">{attention.length}</span>}</button>)}</nav><div className="sidebar-note"><span aria-hidden="true">🌱</span><h3>Mały krok.<br />Mniej marnowania.</h3><p>Zacznij od tego, co już masz. Dobry nawyk rośnie każdego dnia.</p><small><ShieldCheck />Twoja lista pod Twoją kontrolą.</small></div></aside>
    <main className="workspace"><div className="mobile-brand"><Leaf />Strażnik świeżości</div><header className="page-header"><div><p className="eyebrow">MNIEJ MARNOWANIA, WIĘCEJ DOBREGO</p><h1>{heading}<span>.</span></h1></div><div className="header-actions"><button className="icon-btn" aria-label={data.settings.theme === 'dark' ? 'Włącz jasny motyw' : 'Włącz ciemny motyw'} onClick={() => showResult(pantry.save(current => ({ ...current, settings: { ...current.settings, theme: current.settings.theme === 'dark' ? 'light' : 'dark' } })))}>{data.settings.theme === 'dark' ? <Sun /> : <Moon />}</button><button className="btn primary" onClick={() => setEditor({ editing: false })}><Plus />Dodaj produkt</button></div></header>
      <p className="intro">{page === 'pantry' ? 'Wiesz, co masz. Wiesz, co zużyć. Zrób miejsce na dobre nawyki.' : page === 'reminders' ? `Produkty po terminie i z datą w ciągu ${data.settings.reminderDays} dni. Zajrzyj na etykietę przed decyzją.` : page === 'history' ? 'Każdy zużyty produkt ma znaczenie. Wpisy możesz przywrócić do spiżarni.' : 'Ustaw przypomnienia, zadbaj o kopię i połącz swoje urządzenia.'}</p>
      {pantry.error && <div className={`alert ${pantry.mode === 'memory' ? 'warning' : 'error'}`} role="alert">{pantry.error}<button className="btn ghost" onClick={() => go('settings')}>Przejdź do ustawień</button></div>}
      {importError && <div className="alert error" role="alert">{importError}<button className="icon-btn" aria-label="Zamknij błąd importu" onClick={() => setImportError('')}><X /></button></div>}
      <CloudStrip drive={drive} busy={busy || blocked} /><CloudConflict drive={drive} localCount={data.products.length} busy={busy || blocked} backup={exportFile} />
      {page === 'pantry' && <><section className="stats-grid" aria-label="Podsumowanie terminów">{(Object.keys(EXPIRY_LABELS) as ExpiryStatus[]).map(key => { const Icon = EXPIRY_ICONS[key]; return <button className={`stat ${key} ${status === key ? 'selected' : ''}`} key={key} aria-pressed={status === key} onClick={() => setStatus(current => current === key ? '' : key)}><span className="stat-icon"><Icon /></span><strong className="stat-number">{active.filter(product => expiryStatus(product.expiryDate, now) === key).length}</strong><span className="stat-label">{EXPIRY_LABELS[key]}</span></button>; })}</section><section className="reminder-strip"><Bell /><div className="reminder-copy"><h2>{attention.length ? `${attention.length} ${productsLabel(attention.length)} ${productsLabel(attention.length) === 'produkty' ? 'wymagają' : 'wymaga'} uwagi` : 'Spokojnie, wszystko pod kontrolą'}</h2><p>{attention.length ? 'Zaplanuj najbliższy posiłek z tym, co już czeka w spiżarni.' : 'Tutaj przypomnimy Ci o produktach z najbliższymi datami.'}</p>{attention.length > 0 && <div className="reminder-tags">{attention.slice(0, 3).map(product => <button key={product.id} onClick={() => { go('reminders'); setSearch(product.name); }}>{product.name}<ChevronRight /></button>)}</div>}</div><button className="btn ghost" onClick={() => go(attention.length ? 'reminders' : 'settings')}>{attention.length ? 'Zobacz wszystkie' : 'Ustaw przypomnienia'}<ChevronRight /></button></section></>}
      {page === 'settings' ? <SettingsPanel data={data} mode={pantry.mode} busy={busy || blocked} drive={drive} permission={permission} change={patch => showResult(pantry.save(current => ({ ...current, settings: { ...current.settings, ...patch } })))} notifications={() => void toggleNotifications()} exportFile={exportFile} importFile={() => inputFile.current?.click()} demo={loadDemo} rawBackup={() => { try { downloadJSON(localStorage.getItem(PANTRY_KEY) ?? '', 'straznik-nieczytelny-zapis.json'); } catch { setToast('Brak dostępu do zapisu urządzenia.'); } }} reset={() => setConfirmation({ title: 'Rozpocząć od nowa?', text: 'Nieczytelny zapis zostanie zastąpiony pustą listą. Najpierw pobierz jego kopię. Jeśli Dysk jest połączony, pusta lista może zastąpić także zapis chmurowy.', label: 'Wyczyść i rozpocznij', danger: true, action: () => pantry.save(structuredClone(EMPTY_DATA), true) })} /> : <>
        <div className="section-title"><h2>{page === 'history' ? 'Zużyte i wyrzucone' : page === 'reminders' ? 'Sprawdź w pierwszej kolejności' : 'Twoje produkty'} <span className="pill">{source.length}</span></h2><span className="help">Mała lista, duża różnica</span></div>
        <div className="toolbar"><label className="search-field"><Search /><span className="sr-only">Szukaj produktu</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Szukaj produktu…" /></label><div className="filter-group"><label><span className="sr-only">Filtr kategorii</span><select value={category} onChange={event => setCategory(event.target.value)}><option value="">Wszystkie kategorie</option>{CATEGORIES.map(value => <option key={value}>{value}</option>)}</select></label><label><span className="sr-only">Filtr miejsca</span><select value={place} onChange={event => setPlace(event.target.value)}><option value="">Każde miejsce</option>{LOCATIONS.map(value => <option key={value}>{value}</option>)}</select></label><label><span className="sr-only">Filtr terminu</span><select value={status} onChange={event => setStatus(event.target.value as ExpiryStatus | '')}><option value="">Każdy termin</option>{Object.entries(EXPIRY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div></div>
        <div className="list-toolbar"><span aria-live="polite">{filtered.length} {productsLabel(filtered.length)}{hasFilter ? ` z ${source.length}` : ''}</span><label className="sort-field"><SlidersHorizontal /><span className="sr-only">Sortowanie produktów</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="expiry">Najbliższy termin</option><option value="name">Nazwa A–Z</option><option value="name-desc">Nazwa Z–A</option>{page === 'history' && <option value="recent">Ostatnio oznaczone</option>}</select></label></div>
        {!filtered.length ? <section className="empty-panel"><span className="empty-art">{hasFilter ? <Search /> : page === 'history' ? <History /> : <Leaf />}</span><p className="eyebrow">ZACZNIJ OD MAŁEGO KROKU</p><h2>{hasFilter ? 'Nie znaleziono produktów' : page === 'history' ? 'Tutaj zacznie się dobra historia' : page === 'reminders' ? 'Nic nie wymaga teraz uwagi' : 'Twoja spiżarnia czeka na pierwszy produkt'}</h2><p>{hasFilter ? 'Zmień wyszukiwanie lub filtry, aby zobaczyć więcej.' : page === 'history' ? 'Oznacz produkt jako zużyty lub wyrzucony. W każdej chwili możesz go przywrócić.' : page === 'reminders' ? 'Przypomnienia pojawią się zgodnie z wybranym progiem.' : 'Dodaj to, co masz w lodówce i szafkach. Pomożemy Ci pamiętać o terminach.'}</p><div className="empty-actions">{hasFilter ? <button className="btn secondary" onClick={() => { setSearch(''); setCategory(''); setPlace(''); setStatus(''); }}>Wyczyść filtry</button> : page === 'pantry' && <><button className="btn primary" onClick={() => setEditor({ editing: false })}><Plus />Dodaj pierwszy produkt</button><button className="btn ghost" onClick={loadDemo}><Sparkles />Wczytaj przykłady</button></>}</div></section> : <div className="product-grid">{filtered.map(product => <ProductCard key={product.id} product={product} today={now} edit={() => setEditor({ product, editing: true })} remove={() => remove(product)} use={() => mark(product, 'used')} discard={() => mark(product, 'discarded')} partial={() => { setPartial(product); setQuantity(''); setPartialError(''); }} copy={() => setEditor({ editing: false, product: { ...product, id: createId(), expiryDate: '', openedDate: '', state: 'active', archivedAt: null } })} restore={() => showResult(pantry.save(current => ({ ...current, products: current.products.map(item => item.id === product.id ? { ...item, state: 'active', archivedAt: null } : item) })), 'Produkt wrócił do spiżarni.')} />)}</div>}
      </>}
      <footer className="footer"><Leaf /><span>Każdy produkt ma znaczenie. Każdy dobry nawyk też.</span><small><ShieldCheck />{pantry.mode === 'memory' ? 'Pamięć karty' : 'Zapis lokalny'}{drive.connected ? ' · Dysk Google' : ''}</small></footer>
    </main>
    <input className="sr-only" tabIndex={-1} ref={inputFile} aria-label="Plik JSON do importu" type="file" accept=".json,application/json" onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ''; }} />
    {editor && <ProductEditor initial={editor.product} editing={editor.editing} save={saveProduct} close={() => setEditor(null)} />}
    {partial && <Modal title="Zużyj część" close={() => setPartial(null)}><form onSubmit={consumePart}><div className="modal-body"><p><strong>{partial.name}</strong> · dostępne: {number.format(partial.quantity)} {partial.unit}</p><label className="field">Zużyta ilość<input type="number" required min="0.000001" max={partial.quantity} step="0.000001" value={quantity} onChange={event => setQuantity(event.target.value)} /></label><p className="help">Pozostała ilość zostanie na liście. Zużycie całości przeniesie produkt do historii.</p>{partialError && <p className="alert error" role="alert">{partialError}</p>}</div><div className="modal-foot"><button type="button" className="btn secondary" onClick={() => setPartial(null)}>Anuluj</button><button type="submit" className="btn primary">Zapisz zużycie</button></div></form></Modal>}
    {confirmation && <Modal title={confirmation.title} close={() => setConfirmation(null)}><div className="modal-body"><p>{confirmation.text}</p>{confirmation.danger && <button className="btn ghost" onClick={exportFile}><Download />Eksportuj kopię JSON</button>}</div><div className="modal-foot"><button className="btn secondary" onClick={() => setConfirmation(null)}>Anuluj</button><button className={`btn ${confirmation.danger ? 'danger' : 'primary'}`} onClick={() => { const result = confirmation.action(); setConfirmation(null); if (result) showResult(result, 'Gotowe. Zmiany zapisane.'); }}>{confirmation.label}</button></div></Modal>}
    {toast && <div className="toast" role="status">{toast}<button className="icon-btn" aria-label="Zamknij komunikat" onClick={() => setToast('')}><X /></button></div>}
  </div>;
}
