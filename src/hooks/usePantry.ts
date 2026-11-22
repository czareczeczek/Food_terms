import { useRef, useState } from 'react';
import { EMPTY_DATA, parseData } from '../core/model';
import type { AppData } from '../core/model';

export const PANTRY_KEY = 'straznik-swiezosci:v1';
type Mode = 'saved' | 'memory' | 'corrupt';
export type SaveResult = { ok: true } | { ok: false; message: string };
interface Store { data: AppData; raw: string | null; mode: Mode; error: string }
function initialStore(): Store {
  let raw: string | null;
  try { raw = localStorage.getItem(PANTRY_KEY); }
  catch { return { data: structuredClone(EMPTY_DATA), raw: null, mode: 'memory', error: 'Przeglądarka blokuje zapis lokalny. Zmiany pozostają w pamięci tej karty. Przed jej zamknięciem pobierz JSON lub zaczekaj na synchronizację Dysku Google.' }; }
  try { return { data: raw === null ? structuredClone(EMPTY_DATA) : parseData(raw), raw, mode: 'saved', error: '' }; }
  catch { return { data: structuredClone(EMPTY_DATA), raw, mode: 'corrupt', error: 'Zapis na urządzeniu jest nieczytelny. Wstrzymano nadpisywanie danych. W Ustawieniach pobierz jego kopię i odzyskaj dane przez import albo rozpocznij od nowa.' }; }
}

export function usePantry() {
  const [store, setStore] = useState(initialStore);
  const latest = useRef(store);
  function publish(next: Store) { latest.current = next; setStore(next); }
  function save(update: AppData | ((data: AppData) => AppData), recover = false): SaveResult {
    const before = latest.current;
    const fail = (message: string): SaveResult => { publish({ ...before, error: message }); return { ok: false, message }; };
    if (before.mode === 'corrupt' && !recover) return { ok: false, message: 'Najpierw odzyskaj nieczytelny zapis w Ustawieniach. Dotychczasowy plik pozostaje bez zmian.' };
    let data: AppData;
    let raw: string;
    try { data = parseData(JSON.stringify(typeof update === 'function' ? update(before.data) : update)); raw = JSON.stringify(data); }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'Nieprawidłowe dane. Sprawdź formularz.' }; }
    if (before.mode === 'memory') { publish({ ...before, data }); return { ok: true }; }
    try {
      if (localStorage.getItem(PANTRY_KEY) !== before.raw) return fail('Lista została zmieniona w innej karcie. Nie nadpisaliśmy jej. Pobierz lokalną kopię JSON i odśwież stronę.');
      localStorage.setItem(PANTRY_KEY, raw);
    } catch { return fail('Nie udało się zapisać zmian na urządzeniu. Sprawdź dostęp do pamięci przeglądarki i wolne miejsce. Wpisane dane pozostają w formularzu.'); }
    publish({ data, raw, mode: 'saved', error: '' });
    return { ok: true };
  }
  return { ...store, save, getData: () => latest.current.data };
}
