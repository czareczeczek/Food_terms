import { CalendarDays, Check, Clock, Copy, MapPin, Minus, Package, Pencil, ShieldCheck, Trash2, Undo2, TriangleAlert } from 'lucide-react';
import { daysLeft, displayDate, expiryStatus, dateKey } from '../core/model';
import type { Product } from '../core/model';
import NutritionView from './NutritionView';

export const EXPIRY_LABELS = {
  expired: 'Minął termin', today: 'Na dziś', soon: 'W ciągu 3 dni', week: 'Za 4–7 dni', later: 'Późniejszy termin', none: 'Bez daty',
};
export const EXPIRY_ICONS = { expired: TriangleAlert, today: CalendarDays, soon: Clock, week: CalendarDays, later: ShieldCheck, none: Package };
const emoji: Record<string, string> = { Nabiał: '🥛', 'Mięso i ryby': '🐟', Warzywa: '🥬', Owoce: '🍋', Pieczywo: '🥖', 'Produkty suche': '🌾', Mrożonki: '🧊', Napoje: '🧃', Inne: '🛒' };
const number = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 6 });
interface Props { product: Product; today: Date; edit: () => void; remove: () => void; use: () => void; discard: () => void; partial: () => void; copy: () => void; restore: () => void }
export default function ProductCard({ product, today, edit, remove, use, discard, partial, copy, restore }: Props) {
  const status = expiryStatus(product.expiryDate, today); const Icon = EXPIRY_ICONS[status]; const days = daysLeft(product.expiryDate, today);
  const remaining = days === null ? 'Uzupełnij datę z opakowania' : days < 0 ? `${-days} ${days === -1 ? 'dzień' : 'dni'} po terminie` : days === 0 ? 'Termin przypada dzisiaj' : days === 1 ? 'Termin jutro' : `Termin za ${days} dni`;
  return <article className={`product-card ${status}`} aria-label={product.name}>
    <div className="product-head"><span className="product-emoji" aria-hidden="true">{emoji[product.category] ?? '🛒'}</span><div className="product-name"><span className="product-kicker">{product.category}</span><h3>{product.name}</h3></div><div className="card-tools">{product.state === 'active' && <button className="icon-btn" aria-label={`Edytuj ${product.name}`} onClick={edit}><Pencil /></button>}<button className="icon-btn" aria-label={`Usuń ${product.name}`} onClick={remove}><Trash2 /></button></div></div>
    {product.state !== 'active' && <p className={`history-tag ${product.state}`}>{product.state === 'used' ? <Check /> : <Trash2 />}{product.state === 'used' ? 'Zużyty' : 'Wyrzucony'} · {displayDate(product.archivedAt ? dateKey(new Date(product.archivedAt)) : '')}</p>}
    <div className="expiry-info"><small>{product.dateLabel === 'useBy' ? 'Należy spożyć do' : 'Najlepiej spożyć przed'}</small><strong>{displayDate(product.expiryDate)}</strong><span className={`status-chip ${status}`}><Icon />{EXPIRY_LABELS[status]}</span><span className="date-caption">{remaining}</span></div>
    <div className="product-meta"><span className="meta-tag"><MapPin />{product.location}</span><span className="meta-tag"><Package />{number.format(product.quantity)} {product.unit}</span></div>
    {product.openedDate && <p className="product-note">Otwarto: {displayDate(product.openedDate)}</p>}{product.note && <p className="product-note">{product.note}</p>}
    {product.barcode && <p className="product-note">Kod: {product.barcode}</p>}
    {status === 'expired' && <p className="date-advice">{product.dateLabel === 'bestBefore' ? 'Data dotyczy jakości. Sam jej upływ nie oznacza automatycznie, że produkt jest niebezpieczny.' : 'Po terminie „należy spożyć do” nie spożywaj produktu. Przestrzegaj etykiety.'}</p>}
    <NutritionView product={product} />
    <div className="card-actions">{product.state === 'active' ? <><button className="btn ghost" onClick={use}><Check />Zużyto</button><button className="btn ghost" onClick={partial} aria-label={`Zużyj część ${product.name}`}><Minus />Część</button><button className="btn ghost" onClick={discard} aria-label={`Wyrzucono ${product.name}`}><Trash2 />Wyrzucono</button><button className="icon-btn" onClick={copy} aria-label={`Kolejne opakowanie ${product.name}`} title="Dodaj kolejne opakowanie"><Copy /></button></> : <button className="btn secondary" onClick={restore}><Undo2 />Przywróć do spiżarni</button>}</div>
  </article>;
}
