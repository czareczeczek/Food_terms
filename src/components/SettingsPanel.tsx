import { Bell, Download, Upload, Sun, Moon, ShieldCheck, Sparkles, Cloud } from 'lucide-react';
import type { AppData, Settings } from '../core/model';
import type { useDrive } from '../hooks/useDrive';
import CloudPanel from './CloudPanel';

interface Props {
  data: AppData; mode: 'saved' | 'memory' | 'corrupt'; busy: boolean; drive: ReturnType<typeof useDrive>;
  permission: NotificationPermission | 'unsupported'; change: (patch: Partial<Settings>) => void; notifications: () => void;
  exportFile: () => void; importFile: () => void; demo: () => void; rawBackup: () => void; reset: () => void;
}
export default function SettingsPanel({ data, mode, busy, drive, permission, change, notifications, exportFile, importFile, demo, rawBackup, reset }: Props) {
  const prefs = data.settings;
  return <div className="settings-grid">
    <CloudPanel drive={drive} busy={busy} memoryOnly={mode === 'memory'} />
    <section className="setting-card"><span className="setting-icon"><Bell /></span><h2>Przypomnij mi wcześniej</h2><p>W przypomnieniach zobaczysz produkty po terminie i te, które zbliżają się do daty z opakowania.</p>
      <label className="field">Ile dni przed terminem?<select value={prefs.reminderDays} onChange={e => change({ reminderDays: Number(e.target.value) as Settings['reminderDays'] })}><option value={1}>1 dzień</option><option value={3}>3 dni</option><option value={7}>7 dni</option></select></label>
      <hr /><h3>Powiadomienia przeglądarki</h3><p className="help">Działają tylko przy otwartej i aktywnej aplikacji, po zgodzie i przy wsparciu przeglądarki. Nie wysyłamy ich po zamknięciu strony ani w tle. System może je wyciszyć.</p>
      <p className="help">{permission === 'unsupported' ? 'Ta przeglądarka nie udostępnia powiadomień.' : permission === 'denied' ? 'Zgoda jest zablokowana. Możesz ją zmienić w ustawieniach witryny w przeglądarce.' : prefs.notifications ? 'Powiadomienia w aplikacji są włączone.' : 'Powiadomienia są wyłączone.'}</p>
      <button className="btn secondary" disabled={!prefs.notifications && (permission === 'unsupported' || permission === 'denied')} onClick={notifications}><Bell />{prefs.notifications ? 'Wyłącz powiadomienia' : 'Włącz powiadomienia'}</button>
    </section>
    <section className="setting-card"><span className="setting-icon"><Sun /></span><h2>Twój wygodny motyw</h2><p>Wybierz wygląd na tym urządzeniu.</p><div className="theme-options"><button className={`btn secondary ${prefs.theme === 'light' ? 'selected' : ''}`} aria-pressed={prefs.theme === 'light'} onClick={() => change({ theme: 'light' })}><Sun />Jasny</button><button className={`btn secondary ${prefs.theme === 'dark' ? 'selected' : ''}`} aria-pressed={prefs.theme === 'dark'} onClick={() => change({ theme: 'dark' })}><Moon />Ciemny</button></div><hr /><h3>Jak czytać etykietę?</h3><p className="help"><strong>Należy spożyć do</strong> dotyczy bezpieczeństwa. Po tej dacie nie spożywaj produktu.</p><p className="help"><strong>Najlepiej spożyć przed</strong> dotyczy jakości. Sam upływ daty nie oznacza automatycznie, że produkt jest niebezpieczny. Sprawdź etykietę i warunki przechowywania.</p><p className="help">Data otwarcia jest Twoją notatką. Nie wyznaczamy bezpiecznego okresu po otwarciu.</p></section>
    <section className="setting-card"><span className="setting-icon"><ShieldCheck /></span><h2>Dane pod Twoją kontrolą</h2><p>Lista zapisuje się w tej przeglądarce. Bez połączenia z Dyskiem Google nie synchronizuje się między urządzeniami. Inny adres strony, port lub przeglądarka mają osobny zapis.</p><p className="help">Czyszczenie danych witryny i tryb prywatny mogą usunąć kopię lokalną. Regularnie eksportuj JSON. Plik obejmuje produkty, historię, wartości odżywcze i ustawienia. Import zastępuje je po potwierdzeniu.</p><div className="actions"><button className="btn secondary" onClick={exportFile}><Download />Eksportuj JSON</button><button className="btn secondary" onClick={importFile}><Upload />Importuj JSON</button></div><p className="help">Do Open Food Facts wysyłamy wyłącznie wybrany kod po naciśnięciu pobierania. Ręczne produkty i korekty pozostają w naszej aplikacji; nie publikujemy ich do publicznej bazy.</p>{mode === 'corrupt' && <div className="actions"><button className="btn secondary" onClick={rawBackup}>Pobierz nieczytelny zapis</button><button className="btn danger" onClick={reset}>Rozpocznij od nowa</button></div>}</section>
    <section className="setting-card"><span className="setting-icon"><Sparkles /></span><h2>Najpierw się rozejrzyj</h2><p>Możesz dobrowolnie dodać przykładowe produkty, żeby poznać statusy i filtry. Nie zastąpią Twoich danych.</p><button className="btn secondary" onClick={demo}><Sparkles />Wczytaj przykłady</button><p className="help"><Cloud /> Pierwsze uruchomienie zaczyna się pustą listą.</p></section>
  </div>;
}
