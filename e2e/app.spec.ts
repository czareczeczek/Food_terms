import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { AppData, Product } from '../src/core/model';

const dataKey = 'straznik-swiezosci:v1';
const nav = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
const named = (page: Page, name: string) => page.getByRole('article', { name, exact: true });
const makeItem = (name: string, patch: Partial<Product> = {}): Product => ({ id: name, name, category: 'Inne', location: 'Szafka', quantity: 1, unit: 'szt.', expiryDate: '', openedDate: '', dateLabel: 'bestBefore', note: '', state: 'active', archivedAt: null, ...patch });
const backup: AppData = { version: 1, settings: { theme: 'dark', reminderDays: 1, notifications: false }, products: [
  makeItem('Makaron z pliku', { category: 'Produkty suche', quantity: 500, unit: 'g', nutrition: { basis: '100g', kcal: 340, protein: 12, fat: null, carbs: 60, source: 'manual' } }),
  makeItem('Wcześniej zużyty', { state: 'used', archivedAt: '2026-11-22T10:00:00.000Z' }),
] };

async function newProduct(page: Page, name: string, expiryDate = '', quantity = '1') {
  await page.getByRole('button', { name: 'Dodaj produkt', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByRole('textbox', { name: 'Nazwa produktu', exact: true }).fill(name);
  await form.getByLabel('Termin z opakowania', { exact: true }).fill(expiryDate);
  await form.getByLabel('Ilość', { exact: true }).fill(quantity);
  await form.getByRole('button', { name: 'Zapisz produkt', exact: true }).click();
  await expect(form).toBeHidden();
}
async function upload(page: Page, data: unknown) {
  await page.getByLabel('Plik JSON do importu', { exact: true }).setInputFiles({ name: 'kopia.json', mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)) });
}
async function exported(page: Page) {
  const next = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Eksportuj JSON', exact: true }).click();
  const file = await next;
  expect(file.suggestedFilename()).toMatch(/\.json$/);
  return JSON.parse(await readFile((await file.path())!, 'utf8'));
}
async function examples(page: Page) {
  await page.getByRole('button', { name: 'Wczytaj przykłady', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Dodaj przykłady', exact: true }).click();
}

test('the pantry begins empty and its keyboard dialog returns focus to the opener', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('article')).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), dataKey)).toBeNull();
  const button = page.getByRole('button', { name: 'Dodaj produkt', exact: true });
  await button.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Nowy produkt', exact: true });
  await expect(dialog.getByRole('textbox', { name: 'Nazwa produktu', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
  await expect(page.getByRole('article')).toHaveCount(0);
  await examples(page);
  await expect(page.getByRole('article')).toHaveCount(6);
});

test('separate packages support editing, partial use, history, restore and confirmed deletion', async ({ page }) => {
  await page.goto('/');
  await newProduct(page, 'Jogurt', '2099-01-01', '4');
  const first = named(page, 'Jogurt').filter({ hasText: '01.01.2099' });
  await first.getByRole('button', { name: 'Kolejne opakowanie Jogurt', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Termin z opakowania', { exact: true }).fill('2099-02-01');
  await dialog.getByLabel('Ilość', { exact: true }).fill('2');
  await dialog.getByRole('button', { name: 'Zapisz produkt', exact: true }).click();
  await expect(named(page, 'Jogurt')).toHaveCount(2);
  await first.getByRole('button', { name: 'Edytuj Jogurt', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Notatka', { exact: true }).fill('Na sos do obiadu');
  await dialog.getByLabel(/Data otwarcia/).fill('2026-11-20');
  await dialog.getByRole('button', { name: 'Zapisz zmiany', exact: true }).click();
  await first.getByRole('button', { name: 'Zużyj część Jogurt', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Zużyta ilość', { exact: true }).fill('1.25');
  await page.getByRole('dialog').getByRole('button', { name: 'Zapisz zużycie', exact: true }).click();
  await page.reload();
  await expect(first).toContainText('2,75 szt.');
  await expect(first).toContainText('Otwarto: 20.11.2026');
  await expect(first).toContainText('Na sos do obiadu');
  await first.getByRole('button', { name: 'Zużyto', exact: true }).click();
  await named(page, 'Jogurt').getByRole('button', { name: 'Wyrzucono Jogurt', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(0);
  await nav(page, 'Historia');
  await expect(named(page, 'Jogurt')).toHaveCount(2);
  await expect(first).toContainText('Zużyty');
  await expect(named(page, 'Jogurt').filter({ hasText: '01.02.2099' })).toContainText('Wyrzucony');
  await first.getByRole('button', { name: 'Przywróć do spiżarni', exact: true }).click();
  await nav(page, 'Spiżarnia');
  await first.getByRole('button', { name: 'Usuń Jogurt', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Anuluj', exact: true }).click();
  await expect(first).toBeVisible();
  await first.getByRole('button', { name: 'Usuń Jogurt', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Usuń produkt', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('dates, search, combined filters, sorting and reminder thresholds give useful results', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-22T11:00:00.000Z') });
  await page.goto('/');
  await examples(page);
  const summary = page.locator('.stat');
  await expect(summary).toHaveCount(6);
  for (const card of await summary.all()) await expect(card.locator('.stat-number')).toHaveText('1');
  const bread = named(page, 'Chleb żytni');
  await expect(bread).toContainText('Minął termin');
  await expect(bread).toContainText('nie oznacza automatycznie');
  await page.getByRole('searchbox').fill('MAKARON');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('article')).toContainText('Makaron');
  await page.getByRole('searchbox').fill('');
  await page.getByRole('combobox', { name: 'Filtr kategorii', exact: true }).selectOption('Nabiał');
  await page.getByRole('combobox', { name: 'Filtr miejsca', exact: true }).selectOption('Lodówka');
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Filtr terminu', exact: true }).selectOption('expired');
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByRole('button', { name: 'Wyczyść filtry', exact: true }).click();
  await page.getByRole('combobox', { name: 'Sortowanie produktów', exact: true }).selectOption('name');
  await expect(page.getByRole('article').first()).toHaveAttribute('aria-label', 'Chleb żytni');
  await nav(page, 'Ustawienia');
  await page.getByRole('combobox', { name: 'Ile dni przed terminem?', exact: true }).selectOption('7');
  await page.getByRole('navigation').getByRole('button', { name: /Przypomnienia/ }).click();
  await expect(page.getByRole('article')).toHaveCount(4);
});

test('JSON import validates before asking to replace and round-trips the full accepted data', async ({ page }) => {
  await page.goto('/');
  await newProduct(page, 'Lista przed importem');
  await nav(page, 'Ustawienia');
  await upload(page, '{invalid');
  await expect(page.getByRole('alert')).toContainText('JSON');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).products[0].name, dataKey)).toBe('Lista przed importem');
  await upload(page, backup);
  const confirmation = page.getByRole('dialog');
  await expect(confirmation).toContainText(/zastąpi/i);
  await confirmation.getByRole('button', { name: 'Anuluj', exact: true }).click();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).products[0].name, dataKey)).toBe('Lista przed importem');
  await upload(page, backup);
  await confirmation.getByRole('button', { name: 'Zastąp i importuj', exact: true }).click();
  expect(await exported(page)).toEqual(backup);
  await page.reload();
  await expect(named(page, 'Makaron z pliku')).toBeVisible();
  await expect(named(page, 'Lista przed importem')).toHaveCount(0);
  await nav(page, 'Historia');
  await expect(named(page, 'Wcześniej zużyty')).toBeVisible();
});

test('theme and mobile navigation work without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Włącz ciemny motyw', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await examples(page);
  for (const view of ['Historia', 'Ustawienia', 'Spiżarnia']) {
    await nav(page, view);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('navigation')).toBeVisible();
  }
  await page.getByRole('button', { name: 'Dodaj produkt', exact: true }).click();
  expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

for (const raw of ['', '{bad']) {
  test(`unreadable local data stays untouched until recovery (${raw ? 'invalid JSON' : 'empty string'})`, async ({ page }) => {
    await page.goto('/');
    await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: dataKey, raw });
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('nieczytelny');
    await page.getByRole('button', { name: 'Dodaj produkt', exact: true }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Nazwa produktu', exact: true }).fill('Nie nadpisuj');
    await form.getByRole('button', { name: 'Zapisz produkt', exact: true }).click();
    await expect(form.getByRole('alert')).toContainText('odzyskaj');
    expect(await page.evaluate(key => localStorage.getItem(key), dataKey)).toBe(raw);
    await form.getByRole('button', { name: 'Anuluj', exact: true }).click();
    await nav(page, 'Ustawienia');
    await upload(page, backup);
    await page.getByRole('dialog').getByRole('button', { name: 'Zastąp i importuj', exact: true }).click();
    await page.reload();
    await expect(named(page, 'Makaron z pliku')).toBeVisible();
  });
}

test('quota failure keeps the editable draft and exports only the previously accepted list', async ({ page }) => {
  await page.goto('/');
  await newProduct(page, 'Zapisany wcześniej');
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota', 'QuotaExceededError'); }; });
  await page.getByRole('button', { name: 'Dodaj produkt', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByRole('textbox', { name: 'Nazwa produktu', exact: true }).fill('Niezapisany szkic');
  await form.getByRole('button', { name: 'Zapisz produkt', exact: true }).click();
  await expect(form).toBeVisible();
  await expect(form.getByRole('alert')).toContainText('Nie udało się zapisać');
  await expect(form.getByRole('textbox', { name: 'Nazwa produktu', exact: true })).toHaveValue('Niezapisany szkic');
  await form.getByRole('button', { name: 'Anuluj', exact: true }).click();
  await nav(page, 'Ustawienia');
  expect((await exported(page)).products.map((p: Product) => p.name)).toEqual(['Zapisany wcześniej']);
});

test('a stale tab cannot overwrite a newer local list through settings or product edits', async ({ page, context }) => {
  await page.goto('/');
  const stale = await context.newPage();
  await stale.goto('/');
  await newProduct(page, 'Przyjęte w pierwszej karcie');
  await stale.getByRole('button', { name: 'Włącz ciemny motyw', exact: true }).click();
  await expect(stale.getByRole('alert')).toContainText('innej karcie');
  await expect(stale.locator('html')).toHaveAttribute('data-theme', 'light');
  await stale.getByRole('button', { name: 'Dodaj produkt', exact: true }).click();
  const form = stale.getByRole('dialog');
  await form.getByRole('textbox', { name: 'Nazwa produktu', exact: true }).fill('Szkic drugiej karty');
  await form.getByRole('button', { name: 'Zapisz produkt', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('innej karcie');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).products.map((p: Product) => p.name), dataKey)).toEqual(['Przyjęte w pierwszej karcie']);
  await stale.reload();
  await expect(named(stale, 'Przyjęte w pierwszej karcie')).toBeVisible();
  await newProduct(stale, 'Po odświeżeniu');
  await expect(stale.getByRole('article')).toHaveCount(2);
  await stale.close();
});

test('browser notifications ask permission only after opting in and describe the open-app limitation', async ({ page }) => {
  await page.addInitScript(() => {
    const observation = { requests: 0, notices: [] as string[] };
    Object.assign(window, { notificationObservation: observation });
    class PermissionControlledNotification {
      static permission = 'default';
      static async requestPermission() { observation.requests += 1; this.permission = 'granted'; return 'granted'; }
      constructor(title: string, options: { body?: string }) { observation.notices.push(`${title} ${options.body ?? ''}`); }
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: PermissionControlledNotification });
  });
  await page.goto('/');
  await examples(page);
  await nav(page, 'Ustawienia');
  const observation = () => page.evaluate(() => (window as unknown as { notificationObservation: { requests: number; notices: string[] } }).notificationObservation);
  expect((await observation()).requests).toBe(0);
  await expect(page.getByRole('main')).toContainText(/zamknię/i);
  await page.getByRole('button', { name: 'Włącz powiadomienia', exact: true }).click();
  expect((await observation()).requests).toBe(1);
  await expect.poll(async () => (await observation()).notices.length).toBe(1);
  await page.getByRole('button', { name: 'Wyłącz powiadomienia', exact: true }).click();
  await page.getByRole('combobox', { name: 'Ile dni przed terminem?', exact: true }).selectOption('7');
  expect((await observation()).notices).toHaveLength(1);
});
