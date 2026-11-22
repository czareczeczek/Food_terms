import { test, expect, type Page } from '@playwright/test';
import type { AppData, Product } from '../src/core/model';

const DATA_KEY = 'straznik-swiezosci:v1';
const CONNECTION_KEY = 'straznik-swiezosci:drive:v2';
const preferences = { theme: 'dark', reminderDays: 7, notifications: false } as const;
type State = { accountKey: string; revision: string | null; modifiedAt: string | null; products: Product[] };
type Write = { expectedRevision: string | null; expectedAccountKey: string; products: Product[] };
const item = (id: string, extra: Partial<Product> = {}): Product => ({
  id, name: id, category: 'Inne', location: 'Szafka', quantity: 1, unit: 'szt.',
  expiryDate: '', openedDate: '', dateLabel: 'bestBefore', note: '', state: 'active', archivedAt: null, ...extra,
});

class TestDrive {
  available = true;
  calls: { operation: string; payload?: Write }[] = [];
  state: State;
  private revision = 1;
  constructor(products: Product[], exists = true) {
    this.state = { accountKey: 'konto-testowe', revision: exists ? 'v1' : null, modifiedAt: exists ? '2026-11-22T12:00:00.000Z' : null, products: structuredClone(products) };
  }
  change(products: Product[]) {
    this.state = { ...this.state, revision: `v${++this.revision}`, modifiedAt: new Date().toISOString(), products: structuredClone(products) };
  }
  request(operation: string, payload?: Write) {
    this.calls.push({ operation, payload: payload && structuredClone(payload) });
    if (!this.available) throw new Error('Test: brak połączenia');
    if (operation === 'read') return structuredClone(this.state);
    if (!payload) throw new Error('Test: brak żądania');
    if (payload.expectedAccountKey !== this.state.accountKey || payload.expectedRevision !== this.state.revision) return { ok: false, conflict: true, state: structuredClone(this.state) };
    this.change(payload.products);
    return { ok: true, state: structuredClone(this.state) };
  }
  get writes() { return this.calls.filter(call => call.operation === 'write'); }
}

/** A controllable transport boundary; no Google account or Drive service is contacted. */
async function googleHost(page: Page, drive: TestDrive, initial?: AppData) {
  await page.exposeFunction('__testDrive', (operation: string, payload?: Write) => drive.request(operation, payload));
  await page.addInitScript(({ initial, key }) => {
    if (initial && localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(initial));
    const host = window as unknown as { __testDrive: (operation: string, payload?: unknown) => Promise<unknown>; google: unknown };
    const channel = (ok: (data: unknown) => void = () => {}, fail: (error: unknown) => void = () => {}) => ({
      withSuccessHandler(callback: (data: unknown) => void) { return channel(callback, fail); },
      withFailureHandler(callback: (error: unknown) => void) { return channel(ok, callback); },
      getPantryState() { void host.__testDrive('read').then(ok, fail); },
      savePantryState(payload: unknown) { void host.__testDrive('write', payload).then(ok, fail); },
    });
    host.google = { script: { run: channel() } };
  }, { initial, key: DATA_KEY });
}

const menu = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
async function connect(page: Page) {
  await menu(page, 'Ustawienia');
  await page.getByRole('button', { name: 'Połącz z Dyskiem Google', exact: true }).click();
}
async function add(page: Page, name: string) {
  await page.getByRole('button', { name: 'Dodaj produkt', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByRole('textbox', { name: 'Nazwa produktu', exact: true }).fill(name);
  await form.getByRole('button', { name: 'Zapisz produkt', exact: true }).click();
  await expect(form).toBeHidden();
}
const synchronized = (page: Page) => expect(page.locator('.cloud-strip')).toContainText('Lista zsynchronizowana');

test('standard hosting explains the Google option without pretending it can connect', async ({ page }) => {
  await page.goto('/');
  await menu(page, 'Ustawienia');
  await expect(page.getByRole('main')).toContainText('Google Apps Script');
  await expect(page.getByRole('button', { name: 'Połącz z Dyskiem Google', exact: true })).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), CONNECTION_KEY)).toBeNull();
});

test('connecting is explicit; products, history and nutrition travel while preferences remain local', async ({ page, browser }) => {
  const food = item('Płatki', { quantity: 250, unit: 'g', nutrition: { basis: '100g', kcal: 360, protein: 12, fat: 6, carbs: 60, source: 'manual' } });
  const consumed = item('Zużyty kefir', { state: 'used', archivedAt: '2026-11-22T08:00:00.000Z' });
  const drive = new TestDrive([food, consumed]);
  await googleHost(page, drive, { version: 1, products: [], settings: preferences });
  await page.goto('/');
  await menu(page, 'Ustawienia');
  expect(drive.calls).toHaveLength(0);
  await page.getByRole('button', { name: 'Połącz z Dyskiem Google', exact: true }).click();
  await synchronized(page);
  expect(drive.writes).toHaveLength(0);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).settings, DATA_KEY)).toEqual(preferences);
  await menu(page, 'Historia');
  await expect(page.getByRole('article', { name: consumed.name, exact: true })).toContainText('Zużyty');
  await menu(page, 'Spiżarnia');
  await expect(page.getByRole('article', { name: food.name, exact: true })).toContainText('360');
  await add(page, 'Gruszki');
  await expect.poll(() => drive.state.products.map(product => product.name)).toContain('Gruszki');
  await synchronized(page);
  const sent = drive.writes.at(-1)!.payload!;
  expect(Object.keys(sent).sort()).toEqual(['expectedAccountKey', 'expectedRevision', 'products']);
  expect(sent.products.find(product => product.id === food.id)?.nutrition).toEqual(food.nutrition);
  expect(sent.products.find(product => product.id === consumed.id)?.state).toBe('used');
  await page.reload();
  await synchronized(page);
  await expect(page.getByRole('article', { name: 'Gruszki', exact: true })).toBeVisible();

  const phone = await browser.newContext({ locale: 'pl-PL', timezoneId: 'Europe/Warsaw', viewport: { width: 390, height: 844 } });
  const another = await phone.newPage();
  await googleHost(another, drive);
  await another.goto('http://127.0.0.1:5173');
  await connect(another);
  await synchronized(another);
  await menu(another, 'Spiżarnia');
  await expect(another.getByRole('article', { name: 'Gruszki', exact: true })).toBeVisible();
  expect(await another.evaluate(key => JSON.parse(localStorage.getItem(key)!).settings.theme, DATA_KEY)).toBe('light');
  expect(await another.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await phone.close();
});

test('each replacement needs two steps, and changed cloud versions require a new decision in both directions', async ({ page }) => {
  const drive = new TestDrive([item('Lista z komputera')]);
  await googleHost(page, drive, { version: 1, products: [item('Lista telefonu')], settings: preferences });
  await page.goto('/');
  await connect(page);
  const conflict = page.getByRole('region', { name: 'Różne wersje listy', exact: true });
  await expect(conflict).toBeVisible();
  expect(drive.writes).toHaveLength(0);
  await conflict.getByRole('button', { name: 'Użyj listy z Dysku', exact: true }).click();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).products[0].name, DATA_KEY)).toBe('Lista telefonu');
  drive.change([item('Nieoglądana nowa wersja')]);
  await conflict.getByRole('button', { name: 'Potwierdź zastąpienie', exact: true }).click();
  await expect(conflict).toContainText('zmieni');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).products[0].name, DATA_KEY)).toBe('Lista telefonu');
  await conflict.getByRole('button', { name: 'Zapisz listę na Dysku', exact: true }).click();
  drive.change([item('Jeszcze nowsza wersja')]);
  await conflict.getByRole('button', { name: 'Potwierdź zastąpienie', exact: true }).click();
  await expect(conflict).toBeVisible();
  expect(drive.writes).toHaveLength(0);
  await conflict.getByRole('button', { name: 'Zapisz listę na Dysku', exact: true }).click();
  await conflict.getByRole('button', { name: 'Anuluj wybór', exact: true }).click();
  expect(drive.writes).toHaveLength(0);
  await conflict.getByRole('button', { name: 'Użyj listy z Dysku', exact: true }).click();
  await conflict.getByRole('button', { name: 'Potwierdź zastąpienie', exact: true }).click();
  await synchronized(page);
  await menu(page, 'Spiżarnia');
  await expect(page.getByRole('article', { name: 'Jeszcze nowsza wersja', exact: true })).toBeVisible();
});

test('first upload to an absent cloud file still requires an explicit choice', async ({ page }) => {
  const drive = new TestDrive([], false);
  await googleHost(page, drive, { version: 1, products: [item('Domowe zapasy')], settings: preferences });
  await page.goto('/');
  await connect(page);
  const conflict = page.getByRole('region', { name: 'Różne wersje listy', exact: true });
  await expect(conflict).toBeVisible();
  expect(drive.state.revision).toBeNull();
  await conflict.getByRole('button', { name: 'Zapisz listę na Dysku', exact: true }).click();
  expect(drive.writes).toHaveLength(0);
  await conflict.getByRole('button', { name: 'Potwierdź zastąpienie', exact: true }).click();
  await synchronized(page);
  expect(drive.writes[0].payload?.expectedRevision).toBeNull();
  expect(drive.state.products[0].name).toBe('Domowe zapasy');
});

test('offline edits resume after reload; disconnect preserves the remote file and stops further RPC calls', async ({ page }) => {
  const drive = new TestDrive([item('Wspólny produkt')]);
  await googleHost(page, drive);
  await page.goto('/');
  await connect(page);
  await synchronized(page);
  drive.available = false;
  await menu(page, 'Spiżarnia');
  await add(page, 'Dopisano bez sieci');
  await expect(page.locator('.cloud-strip')).toContainText('połączenie');
  expect(drive.state.products).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('article', { name: 'Dopisano bez sieci', exact: true })).toBeVisible();
  await expect(page.locator('.cloud-strip')).toContainText('połączenie');
  drive.available = true;
  await page.locator('.cloud-strip').getByRole('button', { name: 'Synchronizuj teraz', exact: true }).click();
  await expect.poll(() => drive.state.products.map(product => product.name)).toContain('Dopisano bez sieci');
  await synchronized(page);
  await menu(page, 'Ustawienia');
  await page.getByRole('button', { name: 'Odłącz Dysk', exact: true }).click();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).enabled, CONNECTION_KEY)).toBe(false);
  const before = structuredClone(drive.state);
  const calls = drive.calls.length;
  await add(page, 'Prywatny wpis lokalny');
  await page.reload();
  await expect(page.getByRole('article', { name: 'Prywatny wpis lokalny', exact: true })).toBeVisible();
  expect(drive.state).toEqual(before);
  expect(drive.calls).toHaveLength(calls);
});

test('an open edit blocks background updates; saving divergent edits yields a conflict', async ({ page }) => {
  const drive = new TestDrive([item('Plan posiłku')]);
  await googleHost(page, drive);
  await page.goto('/');
  await connect(page);
  await synchronized(page);
  await menu(page, 'Spiżarnia');
  await page.getByRole('button', { name: 'Edytuj Plan posiłku', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByRole('textbox', { name: 'Nazwa produktu', exact: true }).fill('Lokalny szkic');
  drive.change([item('Aktualizacja drugiego urządzenia')]);
  const calls = drive.calls.length;
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(form.getByRole('textbox', { name: 'Nazwa produktu', exact: true })).toHaveValue('Lokalny szkic');
  expect(drive.calls).toHaveLength(calls);
  await form.getByRole('button', { name: 'Zapisz zmiany', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Różne wersje listy', exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Lokalny szkic', exact: true })).toBeVisible();
  expect(drive.writes).toHaveLength(0);
});

test('a quota error prevents cloud data from becoming an unsaved local replacement', async ({ page }) => {
  const drive = new TestDrive([item('Tylko w chmurze')]);
  await googleHost(page, drive);
  await page.addInitScript(key => {
    const save = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Quota', 'QuotaExceededError');
      return save.call(this, name, value);
    };
  }, DATA_KEY);
  await page.goto('/');
  await connect(page);
  await expect(page.locator('.cloud-strip')).toContainText('uwagi');
  expect(await page.evaluate(key => localStorage.getItem(key), DATA_KEY)).toBeNull();
  await menu(page, 'Spiżarnia');
  await expect(page.getByRole('article')).toHaveCount(0);
  expect(drive.state.products[0].name).toBe('Tylko w chmurze');
  expect(drive.writes).toHaveLength(0);
});

test('blocked browser storage allows a session-only connection without attempting any storage writes', async ({ page }) => {
  const drive = new TestDrive([item('Produkt na Dysku')]);
  await googleHost(page, drive);
  await page.addInitScript(() => {
    const monitor = window as unknown as { storageWrites: number };
    monitor.storageWrites = 0;
    Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
    const blockedWrite = () => { monitor.storageWrites += 1; throw new DOMException('Blocked', 'SecurityError'); };
    Storage.prototype.setItem = blockedWrite;
    Storage.prototype.removeItem = blockedWrite;
    Storage.prototype.clear = blockedWrite;
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('zapis lokalny');
  await connect(page);
  await synchronized(page);
  await menu(page, 'Spiżarnia');
  await add(page, 'Zmiana z pamięci');
  await expect.poll(() => drive.state.products.map(product => product.name)).toContain('Zmiana z pamięci');
  await synchronized(page);
  expect(await page.evaluate(() => (window as unknown as { storageWrites: number }).storageWrites)).toBe(0);
  const before = drive.calls.length;
  await page.reload();
  await expect(page.getByRole('article')).toHaveCount(0);
  expect(drive.calls).toHaveLength(before);
  await connect(page);
  await synchronized(page);
  await menu(page, 'Spiżarnia');
  await expect(page.getByRole('article', { name: 'Zmiana z pamięci', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { storageWrites: number }).storageWrites)).toBe(0);
});
