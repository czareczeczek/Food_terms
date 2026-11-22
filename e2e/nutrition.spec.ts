import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { AppData, Nutrition, Product } from '../src/core/model';

const key = 'straznik-swiezosci:v1';
const endpoint = '**/api/v3.6/product/**';
const code = '5901234123457';
const basic: Nutrition = { basis: '100g', kcal: 100, protein: 0, fat: null, carbs: 20, source: 'manual' };
const make = (name: string, extra: Partial<Product> = {}): Product => ({ id: name, name, expiryDate: '', openedDate: '', dateLabel: 'bestBefore', category: 'Inne', location: 'Szafka', quantity: 100, unit: 'g', note: '', state: 'active', archivedAt: null, ...extra });
const result = {
  status: 'success',
  product: { code, product_name_pl: 'Naturalny jogurt z bazy', brands: 'Testowa marka', nutrition: { aggregated_set: { per: '100g', preparation: 'as_sold', nutrients: {
    'energy-kcal': { value: 70, unit: 'kcal' }, proteins: { value: 0, unit: 'g' }, carbohydrates: { value: 12, unit: 'g' },
  } } } },
};
async function seed(page: Page, products: Product[]) {
  const data: AppData = { version: 1, products, settings: { theme: 'light', reminderDays: 3, notifications: false } };
  await page.addInitScript(({ key, data }) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(data)); }, { key, data });
  await page.goto('/');
}
async function editor(page: Page, name?: string) {
  await page.getByRole('button', { name: name ? `Edytuj ${name}` : 'Dodaj produkt', exact: true }).click();
  return page.getByRole('dialog');
}
function value(page: Page, name: string, nutrient: string, total = false) {
  const section = page.getByRole('region', { name: `Wartości odżywcze: ${name}`, exact: true });
  const list = total ? section.locator('.nutrition-totals dl') : section.locator(':scope > dl');
  return list.locator(':scope > div').filter({ has: page.getByText(nutrient, { exact: true }) }).locator('dd');
}
async function start(page: Page) { await page.goto('/'); return editor(page); }

test('manual data stays local and distinguishes zero from an unknown nutrient across saves', async ({ page }) => {
  let requests = 0;
  await page.route(endpoint, route => { requests += 1; return route.abort(); });
  const form = await start(page);
  await form.getByRole('textbox', { name: 'Nazwa produktu', exact: true }).fill('Domowy mus');
  await form.getByLabel('Ilość', { exact: true }).fill('250');
  await form.getByRole('combobox', { name: 'Jednostka', exact: true }).selectOption('g');
  await form.getByLabel('Energia (kcal)', { exact: true }).fill('200');
  await form.getByLabel('Białko (g)', { exact: true }).fill('0');
  await form.getByLabel('Węglowodany (g)', { exact: true }).fill('10');
  await form.getByRole('button', { name: 'Zapisz produkt', exact: true }).click();
  await expect(value(page, 'Domowy mus', 'Energia', true)).toHaveText('500 kcal');
  await expect(value(page, 'Domowy mus', 'Białko')).toHaveText('0 g');
  await expect(value(page, 'Domowy mus', 'Tłuszcz')).toHaveText('—');
  await page.reload();
  await editor(page, 'Domowy mus');
  await expect(form.getByLabel('Tłuszcz (g)', { exact: true })).toHaveValue('');
  await form.getByLabel('Energia (kcal)', { exact: true }).fill('220');
  await form.getByRole('button', { name: 'Zapisz zmiany', exact: true }).click();
  await expect(value(page, 'Domowy mus', 'Energia', true)).toHaveText('550 kcal');
  expect(requests).toBe(0);
});

test('lookup is opt-in and a preview cannot change the product until applied', async ({ page }) => {
  const requests: { url: string; body: string | null; method: string }[] = [];
  await page.route(endpoint, route => {
    requests.push({ url: route.request().url(), body: route.request().postData(), method: route.request().method() });
    return route.fulfill({ status: 200, json: result });
  });
  const form = await start(page);
  await form.getByLabel('Notatka', { exact: true }).fill('Prywatny plan obiadu');
  await form.getByLabel('Kod kreskowy', { exact: true }).fill(code);
  expect(requests).toHaveLength(0);
  await form.getByRole('button', { name: 'Pobierz z Open Food Facts', exact: true }).click();
  const preview = form.getByRole('region', { name: 'Podgląd danych Open Food Facts', exact: true });
  await expect(preview).toContainText('Naturalny jogurt z bazy');
  await expect(form.getByRole('textbox', { name: 'Nazwa produktu', exact: true })).toHaveValue('');
  await expect(form.getByLabel('Energia (kcal)', { exact: true })).toHaveValue('');
  await expect(preview.locator('dl > div').filter({ has: page.getByText('Białko (g)', { exact: true }) }).locator('dd')).toHaveText('0');
  await expect(preview.locator('dl > div').filter({ has: page.getByText('Tłuszcz (g)', { exact: true }) }).locator('dd')).toHaveText('—');
  await preview.getByRole('button', { name: 'Zastosuj dane', exact: true }).click();
  await expect(form.getByRole('textbox', { name: 'Nazwa produktu', exact: true })).toHaveValue('Naturalny jogurt z bazy');
  await expect(form.getByLabel('Białko (g)', { exact: true })).toHaveValue('0');
  await expect(form.getByLabel('Tłuszcz (g)', { exact: true })).toHaveValue('');
  await form.getByLabel('Kod kreskowy', { exact: true }).fill('8001234567890');
  await form.getByRole('button', { name: 'Zapisz produkt', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Wartości odżywcze: Naturalny jogurt z bazy', exact: true }).getByRole('link', { name: 'Open Food Facts', exact: true })).toHaveAttribute('href', `https://world.openfoodfacts.org/product/${code}`);
  expect(requests).toHaveLength(1);
  expect(requests[0].body).toBeNull();
  expect(requests[0].method).toBe('GET');
  expect(requests[0].url).not.toContain('Prywatny');
});

test('Enter on the barcode searches without submitting, and applying keeps an existing name', async ({ page }) => {
  await page.route(endpoint, route => route.fulfill({ status: 200, json: result }));
  const form = await start(page);
  await form.getByRole('textbox', { name: 'Nazwa produktu', exact: true }).fill('Mój własny opis');
  const barcode = form.getByLabel('Kod kreskowy', { exact: true });
  await barcode.fill(code);
  await barcode.press('Enter');
  await expect(form.getByRole('region', { name: 'Podgląd danych Open Food Facts', exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await form.getByRole('button', { name: 'Zastosuj dane', exact: true }).click();
  await expect(form.getByRole('textbox', { name: 'Nazwa produktu', exact: true })).toHaveValue('Mój własny opis');
  await form.getByRole('button', { name: 'Zapisz produkt', exact: true }).click();
  await expect(value(page, 'Mój własny opis', 'Energia')).toHaveText('70 kcal');
});

test('a product found without usable nutrition does not erase manually entered values', async ({ page }) => {
  await page.route(endpoint, route => route.fulfill({ status: 200, json: { status: 'success', product: { code, product_name: 'Wpis bez tabeli odżywczej' } } }));
  const form = await start(page);
  await form.getByLabel('Energia (kcal)', { exact: true }).fill('123');
  await form.getByLabel('Kod kreskowy', { exact: true }).fill(code);
  await form.getByRole('button', { name: 'Pobierz z Open Food Facts', exact: true }).click();
  await expect(form.getByRole('region', { name: 'Podgląd danych Open Food Facts', exact: true })).toContainText('Wpis bez tabeli');
  await form.getByRole('button', { name: 'Zastosuj dane', exact: true }).click();
  await expect(form.getByLabel('Energia (kcal)', { exact: true })).toHaveValue('123');
  await form.getByRole('button', { name: 'Zapisz produkt', exact: true }).click();
  await expect(value(page, 'Wpis bez tabeli odżywczej', 'Energia')).toHaveText('123 kcal');
});

for (const failure of ['brak produktu', 'brak sieci', 'limit zapytań', 'limit czasu'] as const) {
  test(`lookup failure: ${failure}; the user can still save manual data`, async ({ page }) => {
    if (failure === 'limit czasu') await page.clock.install();
    await page.route(endpoint, route => {
      if (failure === 'limit czasu') return;
      if (failure === 'brak sieci') return route.abort('internetdisconnected');
      return route.fulfill({ status: failure === 'brak produktu' ? 404 : 429, json: { status: 'failure' } });
    });
    const form = await start(page);
    await form.getByRole('textbox', { name: 'Nazwa produktu', exact: true }).fill('Wpis z etykiety');
    await form.getByLabel('Energia (kcal)', { exact: true }).fill('80');
    await form.getByLabel('Białko (g)', { exact: true }).fill('0');
    await form.getByLabel('Kod kreskowy', { exact: true }).fill(code);
    const sent = page.waitForRequest(endpoint);
    await form.getByRole('button', { name: 'Pobierz z Open Food Facts', exact: true }).click();
    await sent;
    if (failure === 'limit czasu') await page.clock.fastForward(25_000);
    await expect(form.getByRole('alert')).toBeVisible();
    await expect(form.getByLabel('Energia (kcal)', { exact: true })).toHaveValue('80');
    await expect(form.getByLabel('Białko (g)', { exact: true })).toHaveValue('0');
    await form.getByRole('button', { name: 'Zapisz produkt', exact: true }).click();
    await expect(value(page, 'Wpis z etykiety', 'Energia')).toHaveText('80 kcal');
  });
}

test('a cancelled older response cannot replace the newer barcode preview', async ({ page }) => {
  let release: () => void = () => {};
  let completed: () => void = () => {};
  const first = new Promise<void>(resolve => { release = resolve; });
  const finished = new Promise<void>(resolve => { completed = resolve; });
  await page.route(endpoint, async route => {
    if (route.request().url().includes('8001234567890')) {
      await route.fulfill({ status: 200, json: { ...result, product: { ...result.product, product_name_pl: 'Nowy znaleziony produkt' } } });
    } else {
      await first;
      try { await route.fulfill({ status: 200, json: result }); } catch { /* The browser aborted this response. */ }
      finally { completed(); }
    }
  });
  const form = await start(page);
  const barcode = form.getByLabel('Kod kreskowy', { exact: true });
  await barcode.fill(code);
  const sent = page.waitForRequest(endpoint);
  await form.getByRole('button', { name: 'Pobierz z Open Food Facts', exact: true }).click();
  await sent;
  await barcode.fill('8001234567890');
  await form.getByRole('button', { name: 'Pobierz z Open Food Facts', exact: true }).click();
  const preview = form.getByRole('region', { name: 'Podgląd danych Open Food Facts', exact: true });
  await expect(preview).toContainText('Nowy znaleziony produkt');
  release(); await finished;
  await expect(preview).not.toContainText('Naturalny jogurt z bazy');
});

test('exports preserve nutrition provenance and missing values while legacy records stay usable', async ({ page }) => {
  const items = [make('Nowy zapis', { barcode: code, nutrition: { ...basic, source: 'openfoodfacts', sourceBarcode: code } }), make('Zapis bez nowych pól')];
  await seed(page, items);
  await expect(value(page, 'Nowy zapis', 'Białko')).toHaveText('0 g');
  await expect(value(page, 'Nowy zapis', 'Tłuszcz')).toHaveText('—');
  await expect(page.getByRole('article', { name: 'Zapis bez nowych pól', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Wartości odżywcze: Zapis bez nowych pól', exact: true })).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: 'Ustawienia', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Eksportuj JSON', exact: true }).click();
  const file = await pending;
  const exported = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(exported.products).toEqual(items);
  await page.reload();
  await expect(value(page, 'Nowy zapis', 'Białko')).toHaveText('0 g');
});

test('totals use physical units instead of guessing package mass or liquid density', async ({ page }) => {
  const liquid = { ...basic, basis: '100ml' as const };
  await seed(page, [
    make('Gramy', { quantity: 300, unit: 'g', nutrition: basic }),
    make('Kilogramy', { quantity: 0.4, unit: 'kg', nutrition: basic }),
    make('Mililitry', { quantity: 250, unit: 'ml', nutrition: liquid }),
    make('Litry', { quantity: 1.2, unit: 'l', nutrition: liquid }),
    make('Sztuki', { unit: 'szt.', nutrition: basic }),
    make('Opakowania', { unit: 'opak.', nutrition: basic }),
    make('Inna podstawa', { unit: 'l', nutrition: basic }),
  ]);
  for (const [name, expected] of [['Gramy', '300 kcal'], ['Kilogramy', '400 kcal'], ['Mililitry', '250 kcal'], ['Litry', '1200 kcal']]) await expect(value(page, name, 'Energia', true)).toHaveText(expected);
  for (const name of ['Sztuki', 'Opakowania', 'Inna podstawa']) await expect(page.getByRole('region', { name: `Wartości odżywcze: ${name}`, exact: true }).locator('.nutrition-totals')).toHaveCount(0);
});

test('dense liquids can contain more than 100 g of a nutrient per 100 ml', async ({ page }) => {
  const form = await start(page);
  await form.getByRole('textbox', { name: 'Nazwa produktu', exact: true }).fill('Syrop');
  await form.getByLabel('Ilość', { exact: true }).fill('200');
  await form.getByRole('combobox', { name: 'Jednostka', exact: true }).selectOption('ml');
  await form.getByRole('combobox', { name: 'Wartości dla', exact: true }).selectOption('100ml');
  await form.getByLabel('Węglowodany (g)', { exact: true }).fill('120');
  await form.getByRole('button', { name: 'Zapisz produkt', exact: true }).click();
  await expect(value(page, 'Syrop', 'Węglowodany', true)).toHaveText('240 g');
  await page.reload();
  await expect(value(page, 'Syrop', 'Węglowodany')).toHaveText('120 g');
});

test('partial consumption recalculates totals and the nutrition editor fits a phone', async ({ page }) => {
  await seed(page, [make('Płatki owsiane', { quantity: 500, nutrition: basic })]);
  await page.getByRole('button', { name: 'Zużyj część Płatki owsiane', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Zużyta ilość', { exact: true }).fill('150');
  await page.getByRole('dialog').getByRole('button', { name: 'Zapisz zużycie', exact: true }).click();
  await expect(value(page, 'Płatki owsiane', 'Energia', true)).toHaveText('350 kcal');
  await expect(value(page, 'Płatki owsiane', 'Tłuszcz', true)).toHaveText('—');
  await page.setViewportSize({ width: 360, height: 780 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const form = await editor(page, 'Płatki owsiane');
  await form.getByLabel('Energia (kcal)', { exact: true }).scrollIntoViewIfNeeded();
  expect(await form.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await form.getByLabel('Energia (kcal)', { exact: true }).fill('110');
  await form.getByRole('button', { name: 'Zapisz zmiany', exact: true }).click();
  await expect(value(page, 'Płatki owsiane', 'Energia', true)).toHaveText('385 kcal');
});
