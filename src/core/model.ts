export const CATEGORIES = [
  'Nabiał',
  'Mięso i ryby',
  'Warzywa',
  'Owoce',
  'Pieczywo',
  'Produkty suche',
  'Mrożonki',
  'Napoje',
  'Inne',
] as const;

export const LOCATIONS = ['Lodówka', 'Zamrażarka', 'Szafka', 'Spiżarnia', 'Inne'] as const;
export const UNITS = ['szt.', 'g', 'kg', 'ml', 'l', 'opak.'] as const;
export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_PRODUCTS = 10_000;

export interface Nutrition {
  basis: '100g' | '100ml';
  kcal: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  source: 'manual' | 'openfoodfacts';
  sourceBarcode?: string;
}

export interface Product {
  id: string;
  name: string;
  expiryDate: string;
  dateLabel: 'useBy' | 'bestBefore';
  category: string;
  location: string;
  quantity: number;
  unit: string;
  openedDate: string;
  note: string;
  state: 'active' | 'used' | 'discarded';
  archivedAt: string | null;
  barcode?: string;
  nutrition?: Nutrition;
}

export interface Settings {
  reminderDays: 1 | 3 | 7;
  theme: 'light' | 'dark';
  notifications: boolean;
}

export interface AppData {
  version: 1;
  products: Product[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  reminderDays: 3,
  theme: 'light',
  notifications: false,
};

export const EMPTY_DATA: AppData = {
  version: 1,
  products: [],
  settings: { ...DEFAULT_SETTINGS },
};

export type ExpiryStatus = 'expired' | 'today' | 'soon' | 'week' | 'later' | 'none';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const BARCODE_PATTERN = /^\d{8,14}$/;
const ARCHIVE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function dateParts(value: string): [number, number, number] | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]!) return null;
  return [year, month, day];
}

/** The user's local calendar day, with no conversion through UTC. */
export function dateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  if (!Number.isFinite(date.getTime()) || year < 1 || year > 9999) {
    throw new RangeError('Nieprawidłowa data.');
  }
  return `${String(year).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function calendarDay([year, month, day]: [number, number, number]): number {
  // setUTCFullYear also handles years 0001–0099, unlike Date.UTC(year, ...).
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime() / 86_400_000;
}

/** Whole calendar days; a daylight-saving transition never changes the result. */
export function daysLeft(value: string, today: Date = new Date()): number | null {
  const target = dateParts(value);
  if (!target || !Number.isFinite(today.getTime())) return null;
  const current = dateParts(dateKey(today));
  return current ? calendarDay(target) - calendarDay(current) : null;
}

export function expiryStatus(value: string, today: Date = new Date()): ExpiryStatus {
  const days = daysLeft(value, today);
  if (days === null) return 'none';
  if (days < 0) return 'expired';
  if (days === 0) return 'today';
  if (days <= 3) return 'soon';
  if (days <= 7) return 'week';
  return 'later';
}

export function displayDate(value: string): string {
  const parts = dateParts(value);
  return parts ? `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}` : 'Bez daty';
}

/** Convert a measured amount into multiples of the matching nutrition basis. */
export function nutritionFactor(quantity: number, unit: string, basis: Nutrition['basis']): number | null {
  if (!Number.isFinite(quantity) || quantity < 0) return null;
  if (basis === '100g') {
    if (unit === 'g') return quantity / 100;
    if (unit === 'kg') return quantity * 10;
  }
  if (basis === '100ml') {
    if (unit === 'ml') return quantity / 100;
    if (unit === 'l') return quantity * 10;
  }
  return null;
}

/** getRandomValues is available on HTTP origins where randomUUID may be absent. */
export function createId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

function invalid(path: string): never {
  throw new Error(`Nieprawidłowe dane: ${path}.`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(path);
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string, nonempty = false, maximum = Infinity): string {
  if (typeof value !== 'string' || (nonempty && !value.trim()) || value.length > maximum) invalid(path);
  return value;
}

function member<T extends string | number>(value: unknown, allowed: readonly T[], path: string): T {
  if (!allowed.includes(value as T)) invalid(path);
  return value as T;
}

function date(value: unknown, path: string): string {
  const result = string(value, path);
  if (result !== '' && !dateParts(result)) invalid(path);
  return result;
}

function barcode(value: unknown, path: string): string {
  const result = string(value, path);
  if (!BARCODE_PATTERN.test(result)) invalid(path);
  return result;
}

function optionalOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function readNutrition(value: unknown, path: string): Nutrition {
  const input = record(value, path);
  const basis = member(input.basis, ['100g', '100ml'] as const, `${path}.basis`);
  const source = member(input.source, ['manual', 'openfoodfacts'] as const, `${path}.source`);
  const nutrient = (key: 'kcal' | 'protein' | 'fat' | 'carbs', maximum: number): number | null => {
    const amount = input[key];
    if (amount === null) return null;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > maximum || Number(amount.toFixed(6)) !== amount) {
      invalid(`${path}.${key}`);
    }
    return amount;
  };
  const maximum = basis === '100g' ? 100 : 1000;
  const result: Nutrition = {
    basis,
    kcal: nutrient('kcal', 1000),
    protein: nutrient('protein', maximum),
    fat: nutrient('fat', maximum),
    carbs: nutrient('carbs', maximum),
    source,
  };
  if (optionalOwn(input, 'sourceBarcode')) result.sourceBarcode = barcode(input.sourceBarcode, `${path}.sourceBarcode`);
  if (source === 'openfoodfacts' && !result.sourceBarcode) invalid(`${path}.sourceBarcode`);
  return result;
}

function validQuantity(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.000001 || value > 1_000_000_000) return false;
  // Count decimal places in the canonical numeric representation, including exponents.
  const [coefficient = '', exponent = '0'] = value.toString().split('e');
  const decimalPlaces = (coefficient.split('.')[1]?.length ?? 0) - Number(exponent);
  return decimalPlaces <= 6;
}

function readProduct(value: unknown, index: number): Product {
  const path = `products[${index}]`;
  const input = record(value, path);
  if (!validQuantity(input.quantity)) invalid(`${path}.quantity`);
  const state = member(input.state, ['active', 'used', 'discarded'] as const, `${path}.state`);
  let archivedAt: string | null = null;
  if (state === 'active') {
    if (input.archivedAt !== null) invalid(`${path}.archivedAt`);
  } else {
    archivedAt = string(input.archivedAt, `${path}.archivedAt`);
    const parsed = new Date(archivedAt);
    if (!ARCHIVE_PATTERN.test(archivedAt) || !dateParts(archivedAt.slice(0, 10)) || !Number.isFinite(parsed.getTime()) || parsed.toISOString() !== archivedAt) {
      invalid(`${path}.archivedAt`);
    }
  }
  const result: Product = {
    id: string(input.id, `${path}.id`, true, 100),
    name: string(input.name, `${path}.name`, true, 200),
    expiryDate: date(input.expiryDate, `${path}.expiryDate`),
    dateLabel: member(input.dateLabel, ['useBy', 'bestBefore'] as const, `${path}.dateLabel`),
    category: member(input.category, CATEGORIES, `${path}.category`),
    location: member(input.location, LOCATIONS, `${path}.location`),
    quantity: input.quantity,
    unit: member(input.unit, UNITS, `${path}.unit`),
    openedDate: date(input.openedDate, `${path}.openedDate`),
    note: string(input.note, `${path}.note`, false, 2000),
    state,
    archivedAt,
  };
  if (optionalOwn(input, 'barcode')) result.barcode = input.barcode === '' ? '' : barcode(input.barcode, `${path}.barcode`);
  if (optionalOwn(input, 'nutrition')) result.nutrition = readNutrition(input.nutrition, `${path}.nutrition`);
  return result;
}

/** Validate an entire backup before returning a new, known-fields-only value. */
export function parseData(text: string): AppData {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_BYTES) {
    throw new Error('Plik przekracza limit 2 MiB.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Plik nie zawiera poprawnych danych JSON.');
  }
  const input = record(parsed, 'plik');
  if (input.version !== 1) invalid('version');
  if (!Array.isArray(input.products) || input.products.length > MAX_PRODUCTS) invalid('products');
  const products = input.products.map(readProduct);
  const ids = new Set<string>();
  for (const product of products) {
    if (ids.has(product.id)) invalid('powtórzone id produktu');
    ids.add(product.id);
  }
  const settings = record(input.settings, 'settings');
  if (typeof settings.notifications !== 'boolean') invalid('settings.notifications');
  return {
    version: 1,
    products,
    settings: {
      reminderDays: member(settings.reminderDays, [1, 3, 7] as const, 'settings.reminderDays'),
      theme: member(settings.theme, ['light', 'dark'] as const, 'settings.theme'),
      notifications: settings.notifications,
    },
  };
}
