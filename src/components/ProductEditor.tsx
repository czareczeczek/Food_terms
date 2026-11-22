import { useState } from 'react';
import type { FormEvent } from 'react';
import { Check } from 'lucide-react';
import { CATEGORIES, LOCATIONS, UNITS, DEFAULT_SETTINGS, createId, parseData } from '../core/model';
import type { Product } from '../core/model';
import type { SaveResult } from '../hooks/usePantry';
import Modal from './Modal';
import NutritionFields from './NutritionFields';

export default function ProductEditor({ initial, editing, save, close }: { initial?: Product; editing: boolean; save: (product: Product) => SaveResult; close: () => void }) {
  const [draft, setDraft] = useState<Product>(() => initial ?? { id: createId(), name: '', expiryDate: '', dateLabel: 'useBy', category: 'Inne', location: 'Lodówka', quantity: 1, unit: 'szt.', openedDate: '', note: '', state: 'active', archivedAt: null });
  const [error, setError] = useState('');
  function field<K extends keyof Product>(key: K, value: Product[K]) { setDraft(current => ({ ...current, [key]: value })); }
  function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    const next: Product = { ...draft, name: draft.name.trim(), note: draft.note.trim() };
    if (next.barcode) next.barcode = next.barcode.replace(/\s/g, '');
    if (!next.barcode) delete next.barcode;
    if (next.nutrition && [next.nutrition.kcal, next.nutrition.protein, next.nutrition.fat, next.nutrition.carbs].every(value => value === null)) delete next.nutrition;
    try {
      const validated = parseData(JSON.stringify({ version: 1, products: [next], settings: DEFAULT_SETTINGS })).products[0];
      const result = save(validated);
      if (!result.ok) setError(result.message);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Sprawdź dane produktu.'); }
  }
  return <Modal title={editing ? 'Edytuj produkt' : 'Nowy produkt'} close={close}><form onSubmit={submit}>
    <div className="modal-body"><p className="help">Każde opakowanie dodaj osobno. Wpisz informacje z etykiety — datę możesz uzupełnić później.</p><div className="form-grid">
      <label className="field span-two">Nazwa produktu <span aria-hidden="true">*</span><input required maxLength={200} value={draft.name} onChange={e => field('name', e.target.value)} placeholder="np. Jogurt naturalny" autoComplete="off" /></label>
      <label className="field">Termin z opakowania<input type="date" min="0001-01-01" max="9999-12-31" value={draft.expiryDate} onChange={e => field('expiryDate', e.target.value)} /></label>
      <label className="field">Rodzaj oznaczenia<select value={draft.dateLabel} onChange={e => field('dateLabel', e.target.value as Product['dateLabel'])}><option value="useBy">Należy spożyć do</option><option value="bestBefore">Najlepiej spożyć przed</option></select></label>
      <label className="field">Kategoria<select value={draft.category} onChange={e => field('category', e.target.value)}>{CATEGORIES.map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="field">Miejsce przechowywania<select value={draft.location} onChange={e => field('location', e.target.value)}>{LOCATIONS.map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="field">Ilość<input required type="number" min="0.000001" max="1000000000" step="0.000001" value={Number.isNaN(draft.quantity) ? '' : draft.quantity} onChange={e => field('quantity', e.target.valueAsNumber)} /></label>
      <label className="field">Jednostka<select value={draft.unit} onChange={e => field('unit', e.target.value)}>{UNITS.map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="field span-two">Data otwarcia<input type="date" min="0001-01-01" max="9999-12-31" value={draft.openedDate} onChange={e => field('openedDate', e.target.value)} /><span className="help">To Twoja notatka. Nie wyznaczamy bezpiecznego okresu po otwarciu. Sprawdź zalecenia producenta.</span></label>
      <label className="field span-two">Notatka<textarea maxLength={2000} rows={3} value={draft.note} onChange={e => field('note', e.target.value)} placeholder="np. Do sosu na jutrzejszy obiad" /></label>
    </div><NutritionFields barcode={draft.barcode ?? ''} nutrition={draft.nutrition} onBarcodeChange={value => field('barcode', value)} onNutritionChange={value => field('nutrition', value)} onName={name => setDraft(current => current.name.trim() ? current : { ...current, name })} />
    {error && <p className="alert error" role="alert">{error}</p>}</div>
    <div className="modal-foot"><button type="button" className="btn secondary" onClick={close}>Anuluj</button><button type="submit" className="btn primary"><Check />{editing ? 'Zapisz zmiany' : 'Zapisz produkt'}</button></div>
  </form></Modal>;
}
