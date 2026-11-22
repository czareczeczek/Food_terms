import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lookupFood } from './foodFacts'

const barcode = '5901234123457'
const fetchMock = vi.fn<typeof fetch>()

function product(nutrition?: unknown, extra: Record<string, unknown> = {}) {
  return { product: { code: barcode, product_name_pl: 'Jogurt naturalny', brands: 'Mleczarnia', nutrition, ...extra } }
}

function aggregate(per = '100g', preparation = 'as_sold', nutrients: Record<string, unknown> = {}) {
  return { aggregated_set: { per, preparation, nutrients: {
    'energy-kcal': { value: 60, unit: 'kcal' },
    proteins: { value: 4, unit: 'g' },
    fat: { value: 2, unit: 'g' },
    carbohydrates: { value: 6, unit: 'g' },
    ...nutrients,
  } } }
}

function reply(payload: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }))
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('lookupFood', () => {
  it('requests only the explicit barcode lookup without credentials or referrer', async () => {
    reply(product(aggregate()))
    const result = await lookupFood(' 590 1234 123457 ')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [address, options] = fetchMock.mock.calls[0]
    const url = new URL(String(address))
    expect(url.origin).toBe('https://world.openfoodfacts.org')
    expect(url.pathname).toBe(`/api/v3.6/product/${barcode}`)
    expect([...url.searchParams.keys()].sort()).toEqual(['fields', 'lc'])
    expect(url.searchParams.get('lc')).toBe('pl')
    expect(url.searchParams.get('fields')).toBe('code,product_name_pl,product_name,brands,nutrition,nutriments,nutrition_data_per')
    expect(options).toMatchObject({ method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer' })
    expect(options?.signal).toBeInstanceOf(AbortSignal)
    expect(result).toMatchObject({ barcode, name: 'Jogurt naturalny', brand: 'Mleczarnia', nutrition: {
      basis: '100g', kcal: 60, protein: 4, fat: 2, carbs: 6, source: 'openfoodfacts', sourceBarcode: barcode,
    } })
    expect(result?.warning).toBeUndefined()
  })

  it.each(['', '1234567', '123456789012345', '590-1234123457', '5901234abcd57'])('rejects invalid code %j before making a request', async code => {
    await expect(lookupFood(code)).rejects.toThrow('od 8 do 14 cyfr')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps genuine zero and rounds valid values, while missing data stays null', async () => {
    reply(product(aggregate('100g', 'as_sold', {
      'energy-kcal': { value: 0, unit: 'kcal' },
      proteins: { value: 1.23456789, unit: 'g' },
      fat: undefined,
      carbohydrates: { value: null, unit: 'g' },
    })))
    const result = await lookupFood(barcode)
    expect(result?.nutrition).toMatchObject({ kcal: 0, protein: 1.234568, fat: null, carbs: null })
    expect(result?.warning).toContain('Niektórych wartości')
  })

  it.each([
    [{ value: -1, unit: 'g' }, { value: 1001, unit: 'kcal' }],
    [{ value: 101, unit: 'g' }, { value: '10', unit: 'kcal' }],
    [{ value: 5, unit: 'kg' }, { value: 10, unit: 'kJ' }],
    [{ value: '', unit: 'g' }, { value: 10 }],
    [{ value: Infinity, unit: 'g' }, { value: NaN, unit: 'kcal' }],
  ])('rejects malformed nutrients independently without substituting zero', async (protein, kcal) => {
    reply(product(aggregate('100g', 'as_sold', { proteins: protein, 'energy-kcal': kcal })))
    expect((await lookupFood(barcode))?.nutrition).toMatchObject({ protein: null, kcal: null, fat: 2, carbs: 6 })
  })

  it('uses the distinct 100 ml bound without inferring mass or density', async () => {
    reply(product(aggregate('100ml', 'as_sold', { proteins: { value: 500, unit: 'g' }, fat: { value: 1001, unit: 'g' } })))
    expect((await lookupFood(barcode))?.nutrition).toMatchObject({ basis: '100ml', protein: 500, fat: null })
  })

  it.each([
    aggregate('serving', 'as_sold'),
    aggregate('100g', 'prepared'),
    { aggregated_set: { per: '100g', nutrients: { proteins: { value: 4, unit: 'g' } } } },
    { aggregated_set: { preparation: 'as_sold', nutrients: { proteins: { value: 4, unit: 'g' } } } },
  ])('does not guess the basis or preparation', async nutrition => {
    reply(product(nutrition))
    const result = await lookupFood(barcode)
    expect(result?.nutrition).toBeNull()
    expect(result?.warning).toContain('Wartości możesz wpisać ręcznie')
  })

  it('can select an explicit as-sold record from aggregate sets', async () => {
    reply(product({ aggregated_set: [aggregate('100g', 'prepared').aggregated_set, aggregate('100ml').aggregated_set] }))
    expect((await lookupFood(barcode))?.nutrition?.basis).toBe('100ml')
  })

  it('does not make an all-missing record into zero nutrition', async () => {
    reply(product({ aggregated_set: { per: '100g', preparation: 'as_sold', nutrients: {} } }))
    expect((await lookupFood(barcode))?.nutrition).toBeNull()
  })

  it('uses legacy values only with an explicit basis and a visible check warning', async () => {
    reply(product(undefined, { nutrition_data_per: '100ml', nutriments: { 'energy-kcal_100g': 40, proteins_100g: 0, fat_100g: 2, carbohydrates_100g: 6 } }))
    const result = await lookupFood(barcode)
    expect(result?.nutrition).toMatchObject({ basis: '100ml', kcal: 40, protein: 0 })
    expect(result?.warning).toContain('sprawdź na etykiecie')
    expect(result?.warning).toContain('100 ml')
    reply(product(undefined, { nutriments: { 'energy-kcal_100g': 40, proteins_100g: 0 } }))
    expect((await lookupFood(barcode))?.nutrition).toBeNull()
  })

  it('prefers localized names, limits imported text, and can fall back to the generic name', async () => {
    reply(product(aggregate(), { product_name_pl: `  ${'p'.repeat(250)}  `, brands: 'm'.repeat(240) }))
    const result = await lookupFood(barcode)
    expect(result?.name).toHaveLength(200)
    expect(result?.brand).toHaveLength(200)
    reply(product(aggregate(), { product_name_pl: ' ', product_name: '  Milk  ' }))
    expect((await lookupFood(barcode))?.name).toBe('Milk')
  })

  it('returns null for a missing product', async () => {
    reply({}, 404)
    expect(await lookupFood(barcode)).toBeNull()
    reply({ status: 0 })
    expect(await lookupFood(barcode)).toBeNull()
  })

  it('gives a useful retry and manual entry message for rate limits', async () => {
    reply({}, 429)
    await expect(lookupFood(barcode)).rejects.toThrow('Odczekaj chwilę albo wpisz dane ręcznie')
  })

  it('keeps manual entry available on network, server and malformed response errors', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(lookupFood(barcode)).rejects.toThrow('wpisz dane ręcznie')
    reply({}, 503)
    await expect(lookupFood(barcode)).rejects.toThrow('wpisz dane ręcznie')
    fetchMock.mockResolvedValueOnce(new Response('{broken json'))
    await expect(lookupFood(barcode)).rejects.toThrow('Wpisz dane ręcznie')
    reply({ product: 'broken' })
    await expect(lookupFood(barcode)).rejects.toThrow('wpisać dane ręcznie')
  })

  it('cancels the underlying request after twelve seconds and clears its timer', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementationOnce((_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const request = lookupFood(barcode)
    const assertion = expect(request).rejects.toThrow('Przekroczono czas oczekiwania')
    await vi.advanceTimersByTimeAsync(12_000)
    await assertion
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('honors external cancellation without turning it into a user-facing network error', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementationOnce((_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const controller = new AbortController()
    const request = lookupFood(barcode, controller.signal)
    controller.abort()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(vi.getTimerCount()).toBe(0)
    const count = fetchMock.mock.calls.length
    await expect(lookupFood(barcode, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(count)
  })
})
