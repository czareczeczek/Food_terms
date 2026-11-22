import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MAX_BYTES,
  MAX_PRODUCTS,
  createId,
  dateKey,
  daysLeft,
  displayDate,
  expiryStatus,
  nutritionFactor,
  parseData,
  type AppData,
  type Nutrition,
  type Product,
} from './model';

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'mleko-1',
    name: 'Mleko',
    expiryDate: '2024-03-31',
    dateLabel: 'useBy',
    category: 'Nabiał',
    location: 'Lodówka',
    quantity: 1,
    unit: 'l',
    openedDate: '',
    note: '',
    state: 'active',
    archivedAt: null,
    ...overrides,
  };
}

function data(products: Product[] = [product()]): AppData {
  return { version: 1, products, settings: { ...DEFAULT_SETTINGS } };
}

function nutrition(overrides: Partial<Nutrition> = {}): Nutrition {
  return { basis: '100g', kcal: 0, protein: 0, fat: null, carbs: 5, source: 'manual', ...overrides };
}

function parseProducts(products: unknown[]) {
  return parseData(JSON.stringify({ ...data([]), products }));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('local calendar dates', () => {
  it('uses the local date around midnight on both sides of UTC', () => {
    vi.stubEnv('TZ', 'Europe/Warsaw');
    const polishMidnight = new Date('2024-06-30T22:30:00Z');
    expect(dateKey(polishMidnight)).toBe('2024-07-01');
    expect(daysLeft('2024-07-01', polishMidnight)).toBe(0);
    vi.stubEnv('TZ', 'America/Los_Angeles');
    expect(dateKey(new Date('2024-07-01T00:30:00Z'))).toBe('2024-06-30');
  });

  it('counts calendar days across both Polish daylight-saving transitions', () => {
    vi.stubEnv('TZ', 'Europe/Warsaw');
    const spring = new Date(2024, 2, 31);
    const autumn = new Date(2024, 9, 27);
    expect(new Date(2024, 3, 1).getTime() - spring.getTime()).toBe(23 * 60 * 60 * 1000);
    expect(new Date(2024, 9, 28).getTime() - autumn.getTime()).toBe(25 * 60 * 60 * 1000);
    expect(daysLeft('2024-04-01', spring)).toBe(1);
    expect(daysLeft('2024-10-28', autumn)).toBe(1);
    expect(daysLeft('2024-03-30', spring)).toBe(-1);
  });

  it('handles leap years and early four-digit years without normalization', () => {
    expect(daysLeft('2024-02-29', new Date(2024, 1, 28))).toBe(1);
    expect(daysLeft('2000-02-29', new Date(2000, 1, 28))).toBe(1);
    expect(daysLeft('2100-02-29')).toBeNull();
    expect(daysLeft('0000-02-29')).toBeNull();
    expect(daysLeft('2024-04-31')).toBeNull();
    expect(daysLeft('2024-2-09')).toBeNull();
    expect(daysLeft('')).toBeNull();
    const early = new Date(0);
    early.setFullYear(99, 11, 31);
    expect(dateKey(early)).toBe('0099-12-31');
    expect(daysLeft('0100-01-01', early)).toBe(1);
    early.setFullYear(0, 0, 1);
    expect(() => dateKey(early)).toThrow();
  });

  it.each([
    ['2024-01-09', 'expired'], ['2024-01-10', 'today'],
    ['2024-01-11', 'soon'], ['2024-01-13', 'soon'],
    ['2024-01-14', 'week'], ['2024-01-17', 'week'],
    ['2024-01-18', 'later'], ['', 'none'],
  ])('classifies %s as %s', (value, status) => {
    expect(expiryStatus(value, new Date(2024, 0, 10, 23, 59))).toBe(status);
  });

  it('formats dates for Polish readers and treats invalid values as undated', () => {
    expect(displayDate('2024-02-29')).toBe('29.02.2024');
    expect(displayDate('')).toBe('Bez daty');
    expect(displayDate('2023-02-29')).toBe('Bez daty');
    expect(daysLeft('2024-02-29', new Date('invalid'))).toBeNull();
    expect(() => dateKey(new Date('invalid'))).toThrow();
  });
});

describe('backup validation', () => {
  it('round-trips legacy version 1 without optional nutrition or barcode', () => {
    const original = data([product({ expiryDate: '', openedDate: '' })]);
    const parsed = parseData(JSON.stringify(original));
    expect(parsed).toEqual(original);
    expect(parsed.products[0]).not.toHaveProperty('nutrition');
    expect(parsed.products[0]).not.toHaveProperty('barcode');
    expect(parseData(JSON.stringify(parsed))).toEqual(original);
  });

  it('round-trips the empty optional barcode used in legacy version 1 exports', () => {
    const original = data([product({ barcode: '' })]);
    expect(parseData(JSON.stringify(original))).toEqual(original);
  });

  it('preserves zero, null, source metadata, and archived products', () => {
    const original = data([product({
      state: 'used', archivedAt: '2024-02-29T12:34:56.789Z', barcode: '0123456789012',
      nutrition: nutrition({ source: 'openfoodfacts', sourceBarcode: '0123456789012' }),
    })]);
    expect(parseData(JSON.stringify(original))).toEqual(original);
    expect(parseProducts([product({ nutrition: nutrition({ sourceBarcode: '12345678' }) })]).products[0]?.nutrition)
      .toEqual(nutrition({ sourceBarcode: '12345678' }));
  });

  it('strips unknown fields at every level without assigning imported prototypes', () => {
    const imported = {
      ...data(), extra: true, ['__proto__']: { polluted: true },
      settings: { ...DEFAULT_SETTINGS, debug: true },
      products: [{ ...product(), extra: true, ['__proto__']: { polluted: true }, nutrition: { ...nutrition(), debug: true } }],
    };
    const parsed = parseData(JSON.stringify(imported));
    expect(parsed).toEqual(data([product({ nutrition: nutrition() })]));
    expect(Object.getPrototypeOf(parsed.products[0])).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each([
    { quantity: 0 }, { quantity: -1 }, { quantity: 1e-7 }, { quantity: 1e9 + 1 },
    { quantity: 1.1234567 }, { quantity: '1' }, { quantity: null },
    { id: '' }, { name: '   ' }, { expiryDate: '2023-02-29' }, { expiryDate: '2024-02-30' },
    { id: 'a'.repeat(101) }, { name: 'a'.repeat(201) }, { note: 'a'.repeat(2001) },
    { expiryDate: '0000-01-01' }, { openedDate: '0000-12-31' },
    { openedDate: '2024-13-01' }, { dateLabel: 'expiry' }, { category: 'Obce' },
    { location: 'Garaż' }, { unit: 'szt' }, { state: 'deleted' },
    { archivedAt: '2024-01-01T00:00:00.000Z' },
    { state: 'used', archivedAt: null },
    { state: 'discarded', archivedAt: '2024-02-30T00:00:00.000Z' },
    { state: 'used', archivedAt: '2024-01-01T00:00:00Z' },
    { state: 'used', archivedAt: '2024-01-01T01:00:00.000+01:00' },
    { state: 'used', archivedAt: '+010000-01-01T00:00:00.000Z' },
    { state: 'used', archivedAt: '0000-01-01T00:00:00.000Z' },
    { barcode: '1234567' }, { barcode: '123456789012345' }, { barcode: '1234abcd' },
    { nutrition: null },
  ])('rejects invalid product fields %j', (overrides) => {
    expect(() => parseProducts([{ ...product(), ...overrides }])).toThrow();
  });

  it('requires every nonoptional product field', () => {
    for (const key of Object.keys(product())) {
      const incomplete = { ...product() } as Record<string, unknown>;
      delete incomplete[key];
      expect(() => parseProducts([incomplete]), key).toThrow();
    }
  });

  it('accepts exact quantity boundaries and six decimal places', () => {
    for (const quantity of [0.000001, 0.000007, 1.123456, 1_000_000_000, 999_999_999.999999]) {
      expect(parseProducts([product({ quantity })]).products[0]?.quantity).toBe(quantity);
    }
  });

  it('accepts exact text length limits and year 0001', () => {
    const bounded = product({ id: 'a'.repeat(100), name: 'b'.repeat(200), note: 'c'.repeat(2000), expiryDate: '0001-01-01' });
    expect(parseProducts([bounded]).products[0]).toEqual(bounded);
  });

  it.each([
    { kcal: -1 }, { kcal: 1000.01 }, { kcal: '0' }, { protein: 100.01 },
    { fat: -0.1 }, { carbs: 101 }, { basis: 'serving' }, { source: 'unknown' },
    { source: 'openfoodfacts' }, { sourceBarcode: '123' },
    { sourceBarcode: '' }, { kcal: 0.1234567 }, { protein: 0.0000001 },
  ])('rejects invalid nutrition %j', (overrides) => {
    expect(() => parseProducts([{ ...product(), nutrition: { ...nutrition(), ...overrides } }])).toThrow();
  });

  it('requires all nutrient values and enforces the correct basis bounds', () => {
    for (const key of ['basis', 'kcal', 'protein', 'fat', 'carbs', 'source']) {
      const incomplete = { ...nutrition() } as Record<string, unknown>;
      delete incomplete[key];
      expect(() => parseProducts([{ ...product(), nutrition: incomplete }]), key).toThrow();
    }
    expect(parseProducts([product({ nutrition: nutrition({ kcal: 1000, protein: 100, fat: 100, carbs: 100 }) })])).toBeTruthy();
    expect(parseProducts([product({ nutrition: nutrition({ kcal: 0.123456, protein: 0.000001 }) })])).toBeTruthy();
    expect(parseProducts([product({ nutrition: nutrition({ basis: '100ml', protein: 1000, fat: 1000, carbs: 1000 }) })])).toBeTruthy();
    expect(() => parseProducts([product({ nutrition: nutrition({ basis: '100ml', protein: 1000.01 }) })])).toThrow();
  });

  it('rejects nonfinite values, duplicate IDs, wrong versions and malformed roots/settings', () => {
    const validText = JSON.stringify(data());
    expect(() => parseData(validText.replace('"quantity":1', '"quantity":1e309'))).toThrow();
    const nutrientText = JSON.stringify(data([product({ nutrition: nutrition() })]));
    expect(() => parseData(nutrientText.replace('"kcal":0', '"kcal":1e309'))).toThrow();
    expect(() => parseProducts([product(), product()])).toThrow();
    for (const invalid of [null, [], {}, { ...data(), version: 2 }, { ...data(), products: {} },
      { ...data(), settings: null }, { ...data(), settings: { ...DEFAULT_SETTINGS, reminderDays: 2 } },
      { ...data(), settings: { ...DEFAULT_SETTINGS, theme: 'system' } },
      { ...data(), settings: { ...DEFAULT_SETTINGS, notifications: 'yes' } }]) {
      expect(() => parseData(JSON.stringify(invalid))).toThrow();
    }
    expect(() => parseData('{')).toThrow();
  });

  it('enforces the byte limit in UTF-8 and rejects excess product count', () => {
    const payload = { ...data(), padding: '' };
    const overhead = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    payload.padding = 'a'.repeat(MAX_BYTES - overhead);
    const boundary = JSON.stringify(payload);
    expect(new TextEncoder().encode(boundary).byteLength).toBe(MAX_BYTES);
    expect(parseData(boundary)).toEqual(data());
    expect(() => parseData(`${boundary} `)).toThrow();
    payload.padding = 'ą'.repeat(Math.ceil((MAX_BYTES - overhead) / 2) + 1);
    const multibyte = JSON.stringify(payload);
    expect(multibyte.length).toBeLessThan(MAX_BYTES);
    expect(() => parseData(multibyte)).toThrow();
    expect(() => parseProducts(Array.from({ length: MAX_PRODUCTS + 1 }, () => ({})))).toThrow(/products/);
  });
});

describe('nutrition quantities and identifiers', () => {
  it.each([
    [250, 'g', '100g', 2.5], [0.5, 'kg', '100g', 5],
    [330, 'ml', '100ml', 3.3], [1.5, 'l', '100ml', 15],
    [0, 'g', '100g', 0], [1, 'szt.', '100g', null], [1, 'opak.', '100ml', null],
    [100, 'ml', '100g', null], [100, 'g', '100ml', null],
    [-1, 'g', '100g', null], [Infinity, 'g', '100g', null],
  ] as const)('converts %s %s against %s to %s', (quantity, unit, basis, expected) => {
    expect(nutritionFactor(quantity, unit, basis)).toBe(expected);
  });

  it('creates IDs using getRandomValues without depending on secure-origin randomUUID', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.set(Array.from({ length: bytes.length }, (_, index) => index));
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues });
    expect(createId()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    expect(getRandomValues).toHaveBeenCalledOnce();
  });
});
