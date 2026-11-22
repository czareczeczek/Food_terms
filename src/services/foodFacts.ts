import type { Nutrition } from '../core/model'

export interface FoodFactsProduct {
  barcode: string
  name: string
  brand: string
  nutrition: Nutrition | null
  warning?: string
}

const LOOKUP_TIMEOUT_MS = 12_000
const NO_NUTRITION = 'Brak danych dla 100 g lub 100 ml produktu w postaci sprzedawanej. Wartości możesz wpisać ręcznie.'

type RecordValue = Record<string, unknown>

function record(value: unknown): RecordValue | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : null
}

/** Whitespace from a scanner or a pasted, grouped barcode is harmless. */
export function normalizeBarcode(value: string): string {
  const code = value.replace(/\s/g, '')
  if (!/^\d{8,14}$/.test(code)) {
    throw new Error('Kod kreskowy musi zawierać od 8 do 14 cyfr.')
  }
  return code
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 200) : ''
}

function nutrientValue(value: unknown, unit: 'g' | 'kcal', maximum: number): number | null {
  const nutrient = record(value)
  if (!nutrient || nutrient.unit !== unit || typeof nutrient.value !== 'number') return null
  if (!Number.isFinite(nutrient.value) || nutrient.value < 0 || nutrient.value > maximum) return null
  return Math.round(nutrient.value * 1_000_000) / 1_000_000
}

function readNutrition(value: unknown, barcode: string): Nutrition | null {
  const nutrition = record(value)
  const aggregate = nutrition?.aggregated_set
  const sets = Array.isArray(aggregate) ? aggregate : [aggregate]
  for (const candidate of sets) {
    const set = record(candidate)
    if (!set || set.preparation !== 'as_sold' || (set.per !== '100g' && set.per !== '100ml')) continue
    const nutrients = record(set.nutrients)
    if (!nutrients) continue
    const maximum = set.per === '100g' ? 100 : 1000
    const parsed: Nutrition = {
      basis: set.per,
      kcal: nutrientValue(nutrients['energy-kcal'], 'kcal', 1000),
      protein: nutrientValue(nutrients.proteins, 'g', maximum),
      fat: nutrientValue(nutrients.fat, 'g', maximum),
      carbs: nutrientValue(nutrients.carbohydrates, 'g', maximum),
      source: 'openfoodfacts',
      sourceBarcode: barcode,
    }
    if ([parsed.kcal, parsed.protein, parsed.fat, parsed.carbs].some(item => item !== null)) return parsed
  }
  return null
}

function readLegacyNutrition(product: RecordValue, barcode: string): Nutrition | null {
  const basis = product.nutrition_data_per
  if (basis !== '100g' && basis !== '100ml') return null
  const nutriments = record(product.nutriments)
  if (!nutriments) return null
  const maximum = basis === '100g' ? 100 : 1000
  const legacyValue = (key: string, unit: 'g' | 'kcal', max: number) => nutrientValue({
    value: nutriments[`${key}_100g`],
    unit: nutriments[`${key}_unit`] ?? unit,
  }, unit, max)
  const nutrition: Nutrition = {
    basis,
    kcal: legacyValue('energy-kcal', 'kcal', 1000),
    protein: legacyValue('proteins', 'g', maximum),
    fat: legacyValue('fat', 'g', maximum),
    carbs: legacyValue('carbohydrates', 'g', maximum),
    source: 'openfoodfacts',
    sourceBarcode: barcode,
  }
  return [nutrition.kcal, nutrition.protein, nutrition.fat, nutrition.carbs].some(value => value !== null) ? nutrition : null
}

/** Explicit, read-only lookup. No list, account credentials, or referrer is sent. */
export async function lookupFood(rawBarcode: string, signal?: AbortSignal): Promise<FoodFactsProduct | null> {
  const barcode = normalizeBarcode(rawBarcode)
  if (signal?.aborted) throw new DOMException('Wyszukiwanie anulowano.', 'AbortError')

  const controller = new AbortController()
  let timedOut = false
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, LOOKUP_TIMEOUT_MS)
  const url = new URL(`https://world.openfoodfacts.org/api/v3.6/product/${barcode}`)
  url.searchParams.set('fields', 'code,product_name_pl,product_name,brands,nutrition,nutriments,nutrition_data_per')
  url.searchParams.set('lc', 'pl')

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })
    if (signal?.aborted) throw new DOMException('Wyszukiwanie anulowano.', 'AbortError')
    if (timedOut) throw new Error('Przekroczono czas oczekiwania na Open Food Facts. Spróbuj ponownie lub wpisz dane ręcznie.')
    if (response.status === 404) return null
    if (response.status === 429) {
      throw new Error('Open Food Facts otrzymało zbyt wiele zapytań. Odczekaj chwilę albo wpisz dane ręcznie.')
    }
    if (!response.ok) throw new Error('Open Food Facts jest teraz niedostępne. Spróbuj później lub wpisz dane ręcznie.')

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new Error('Nie udało się odczytać odpowiedzi Open Food Facts. Wpisz dane ręcznie lub spróbuj ponownie.')
    }
    if (signal?.aborted) throw new DOMException('Wyszukiwanie anulowano.', 'AbortError')
    if (timedOut) throw new Error('Przekroczono czas oczekiwania na Open Food Facts. Spróbuj ponownie lub wpisz dane ręcznie.')
    const body = record(payload)
    if (!body) throw new Error('Nieprawidłowa odpowiedź Open Food Facts. Możesz wpisać dane ręcznie.')
    if (body.status === 0) return null
    const product = record(body.product)
    if (!product) throw new Error('Nieprawidłowa odpowiedź Open Food Facts. Możesz wpisać dane ręcznie.')

    const currentNutrition = readNutrition(product.nutrition, barcode)
    const nutrition = currentNutrition ?? readLegacyNutrition(product, barcode)
    const partial = nutrition && [nutrition.kcal, nutrition.protein, nutrition.fat, nutrition.carbs].some(item => item === null)
    const warning = !nutrition ? NO_NUTRITION
      : !currentNutrition ? `Dane ze starszego formatu Open Food Facts. Przed zapisaniem sprawdź na etykiecie wartości i podstawę ${nutrition.basis === '100g' ? '100 g' : '100 ml'}.`
        : partial ? 'Niektórych wartości brakuje lub mają nieprawidłowy format. Możesz je uzupełnić ręcznie.' : undefined
    return {
      barcode,
      name: cleanText(product.product_name_pl) || cleanText(product.product_name),
      brand: cleanText(product.brands),
      nutrition,
      ...(warning ? { warning } : {}),
    }
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Wyszukiwanie anulowano.', 'AbortError')
    if (timedOut) throw new Error('Przekroczono czas oczekiwania na Open Food Facts. Spróbuj ponownie lub wpisz dane ręcznie.')
    if (error instanceof TypeError) {
      throw new Error('Nie udało się połączyć z Open Food Facts. Sprawdź połączenie lub wpisz dane ręcznie.')
    }
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', cancel)
  }
}
