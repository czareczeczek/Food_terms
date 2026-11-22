import { useEffect, useState } from 'react';
import { Cloud, Download, RefreshCw } from 'lucide-react';
import type { useDrive } from '../hooks/useDrive';

type Drive = ReturnType<typeof useDrive>;
const labels: Record<Drive['status'], string> = { unavailable: 'Zapis lokalny', off: 'Dysk niepołączony', connecting: 'Łączenie z Dyskiem…', synced: 'Lista zsynchronizowana', working: 'Synchronizowanie…', offline: 'Oczekiwanie na połączenie', conflict: 'Wybierz wersję listy', error: 'Synchronizacja wymaga uwagi' };
export function CloudStrip({ drive, busy }: { drive: Drive; busy: boolean }) {
  if (drive.status === 'unavailable') return null;
  return <div className={`cloud-strip ${drive.status}`}><Cloud /><span role="status">{labels[drive.status]}</span>{drive.connected && !drive.conflict && <button className="btn ghost" disabled={busy || drive.status === 'working' || drive.status === 'connecting'} onClick={() => void drive.refresh()}><RefreshCw />Synchronizuj teraz</button>}</div>;
}
export function CloudConflict({ drive, localCount, busy, backup }: { drive: Drive; localCount: number; busy: boolean; backup: () => void }) {
  const [choice, setChoice] = useState<'local' | 'cloud' | null>(null);
  useEffect(() => setChoice(null), [drive.conflict?.revision, drive.conflict?.accountKey]);
  if (!drive.conflict) return null;
  const disabled = busy || drive.status === 'working' || drive.status === 'connecting';
  return <section className="cloud-conflict" aria-label="Różne wersje listy"><h2>Dwie wersje Twojej spiżarni</h2><p>{drive.message}</p><div className="cloud-choices"><span>Urządzenie: <strong>{localCount}</strong></span><span>Dysk Google: <strong>{drive.conflict.products.length}</strong></span></div><p>Wybrana lista zastąpi drugą, łącznie z historią i wartościami odżywczymi. Najpierw możesz pobrać lokalną kopię.</p><button className="btn ghost" onClick={backup}><Download />Pobierz kopię JSON</button>
    {choice ? <div className="cloud-confirm"><p><strong>{choice === 'local' ? 'Zastąpić zapis na Dysku listą z tego urządzenia?' : 'Zastąpić listę urządzenia zapisem z Dysku?'}</strong></p><div className="actions"><button className="btn secondary" onClick={() => setChoice(null)}>Anuluj wybór</button><button className="btn primary" disabled={disabled} onClick={() => { void (choice === 'local' ? drive.chooseLocal() : drive.chooseCloud()); setChoice(null); }}>Potwierdź zastąpienie</button></div></div> : <div className="actions"><button className="btn secondary" disabled={disabled} onClick={() => setChoice('cloud')}>Użyj listy z Dysku</button><button className="btn secondary" disabled={disabled} onClick={() => setChoice('local')}>Zapisz listę na Dysku</button></div>}
  </section>;
}
export default function CloudPanel({ drive, busy, memoryOnly }: { drive: Drive; busy: boolean; memoryOnly: boolean }) {
  return <section className="setting-card cloud-panel"><div className="setting-icon"><Cloud /></div><h2>Jedna spiżarnia, dwa urządzenia</h2><p>Wersja Google Apps Script zapisuje produkty i historię na Twoim Dysku Google. Na telefonie i komputerze otwieraj ten sam adres aplikacji na tym samym koncie.</p><p className={`cloud-status ${drive.status}`} role="status">{labels[drive.status]}</p><p>{drive.message}</p>
    {memoryOnly && <p className="alert warning">Zapis przeglądarki jest zablokowany. Przed zamknięciem poczekaj na synchronizację lub pobierz JSON. Po ponownym otwarciu połącz Dysk jeszcze raz.</p>}
    {drive.lastSync && <p className="help">Ostatnia synchronizacja: {new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(drive.lastSync))}</p>}
    {drive.status === 'unavailable' ? <p className="help">Uruchom wariant Google zgodnie z instrukcją w paczce. Nie potrzebujesz osobnego hostingu ani klucza logowania. W zwykłej wersji zapis pozostaje na urządzeniu.</p> : <div className="actions">{drive.connected ? <><button className="btn primary" disabled={busy || drive.status === 'working' || drive.status === 'connecting' || Boolean(drive.conflict)} onClick={() => void drive.refresh()}><RefreshCw />Synchronizuj teraz</button><button className="btn secondary" onClick={drive.disconnect}>Odłącz Dysk</button></> : <button className="btn primary" disabled={busy || drive.status === 'connecting'} onClick={() => void drive.connect()}><Cloud />Połącz z Dyskiem Google</button>}</div>}
    <hr /><p className="help">Synchronizacja działa w otwartej, aktywnej aplikacji. Zmiany z innych urządzeń sprawdzamy co około 30 sekund. Różne wersje wymagają Twojego wyboru. Odłączenie zachowuje plik na Dysku.</p><p className="help">Plik jest w prywatnym obszarze aplikacji na Dysku. Motyw, próg przypomnień i powiadomienia pozostają ustawieniami urządzenia.</p>
  </section>;
}
