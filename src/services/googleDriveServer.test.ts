import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const serverCode = readFileSync(new URL('../../apps-script/Code.gs', import.meta.url), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('../../apps-script/appsscript.json', import.meta.url), 'utf8'))
const accountUuid = '10000000-0000-4000-8000-000000000001'
const initialRevision = '20000000-0000-4000-8000-000000000002'
const timestamp = '2026-11-22T10:00:00.000Z'
const product = {
  id: 'milk', name: 'Mleko', expiryDate: '2026-11-25', dateLabel: 'useBy', category: 'Nabiał',
  location: 'Lodówka', quantity: 1, unit: 'l', openedDate: '', note: '', state: 'active', archivedAt: null,
}

function server() {
  let file: { id: string; text: string } | null = null
  let listed: unknown = undefined
  let scriptId = 'script-A'
  let uuid = 10
  let held = false
  let lockAvailable = true
  const properties = new Map<string, string>()
  const metadata = (id = 'file_1') => ({ id, name: 'straznik-swiezosci.json', mimeType: 'application/json', size: String(file?.text.length ?? 1), modifiedTime: timestamp })
  const blob = (text: string, mime?: string, name?: string) => ({ text, mime, name, getBytes: () => Array.from(new TextEncoder().encode(text)) })
  const assertLocked = () => { if (!held) throw new Error('Operation without user lock') }
  const release = vi.fn(() => { held = false })
  const list = vi.fn(() => { assertLocked(); return listed !== undefined ? listed : file ? { files: [metadata(file.id)] } : {} })
  const create = vi.fn((resource: { parents: string[] }, data: ReturnType<typeof blob>) => {
    assertLocked()
    expect(resource.parents).toEqual(['appDataFolder'])
    if (file) throw new Error('Unexpected duplicate creation')
    file = { id: 'file_1', text: data.text }
    return metadata()
  })
  const update = vi.fn((_resource: unknown, id: string, data: ReturnType<typeof blob>) => {
    assertLocked()
    if (!file || file.id !== id) throw new Error('Unknown file')
    file.text = data.text
    return metadata(id)
  })
  const fetch = vi.fn((_url: string, options: { headers: { Authorization: string }; validateHttpsCertificates: boolean; followRedirects: boolean }) => {
    assertLocked()
    expect(options.headers.Authorization).toBe('Bearer server-only-secret')
    expect(options.validateHttpsCertificates).toBe(true)
    expect(options.followRedirects).toBe(false)
    return { getResponseCode: () => 200, getContentText: () => file?.text ?? '' }
  })
  const htmlOutput = {
    setTitle: vi.fn((_title: string) => htmlOutput),
    addMetaTag: vi.fn((_name: string, _content: string) => htmlOutput),
  }
  const createHtmlOutputFromFile = vi.fn((_file: string) => htmlOutput)
  const context = createContext({
    Drive: { Files: { list, create, update } }, UrlFetchApp: { fetch },
    ScriptApp: { getScriptId: () => scriptId, getOAuthToken: () => 'server-only-secret' },
    PropertiesService: { getUserProperties: () => ({ getProperty: (key: string) => properties.get(key) ?? null, setProperty: (key: string, value: string) => properties.set(key, value) }) },
    LockService: { getUserLock: () => ({ tryLock: () => { if (!lockAvailable || held) return false; held = true; return true }, releaseLock: release }) },
    Utilities: { newBlob: blob, getUuid: () => `${String(++uuid).padStart(8, '0')}-0000-4000-8000-000000000000` },
    HtmlService: { createHtmlOutputFromFile },
  })
  runInContext(serverCode, context)
  const api = context as unknown as {
    doGet: () => typeof htmlOutput
    getPantryState: () => { accountKey: string; revision: string | null; products: typeof product[]; modifiedAt: string | null }
    savePantryState: (payload: unknown) => { ok: boolean; conflict?: true; state: { accountKey: string; revision: string | null; products: typeof product[] } }
  }
  return {
    api, list, create, update, fetch, release, properties, createHtmlOutputFromFile, htmlOutput,
    setFile: (text: string) => { file = { id: 'file_1', text } },
    getFile: () => file?.text,
    setListed: (value: unknown) => { listed = value },
    setScriptId: (value: string) => { scriptId = value },
    setLockAvailable: (value: boolean) => { lockAvailable = value },
  }
}

function stored(products: unknown[] = [product]) {
  return JSON.stringify({ version: 1, revision: initialRevision, modifiedAt: timestamp, products })
}

describe('Apps Script private Drive server', () => {
  it('serves static Index HTML with a mobile viewport through HtmlService', () => {
    const backend = server()
    expect(backend.api.doGet()).toBe(backend.htmlOutput)
    expect(backend.createHtmlOutputFromFile).toHaveBeenCalledExactlyOnceWith('Index')
    expect(backend.htmlOutput.setTitle).toHaveBeenCalledExactlyOnceWith('Strażnik świeżości')
    expect(backend.htmlOutput.addMetaTag).toHaveBeenCalledExactlyOnceWith('viewport', 'width=device-width, initial-scale=1')
  })

  it('uses the accessing user and only the two necessary OAuth scopes', () => {
    expect(manifest.webapp).toEqual({ executeAs: 'USER_ACCESSING', access: 'MYSELF' })
    expect(manifest.oauthScopes).toEqual(['https://www.googleapis.com/auth/drive.appdata', 'https://www.googleapis.com/auth/script.external_request'])
    expect(manifest.dependencies.enabledAdvancedServices).toContainEqual({ userSymbol: 'Drive', version: 'v3', serviceId: 'drive' })
  })

  it('keeps a stable per-user identity and distinguishes copies of the script', () => {
    const backend = server()
    const first = backend.api.getPantryState()
    expect(first.revision).toBeNull()
    expect(backend.api.getPantryState().accountKey).toBe(first.accountKey)
    backend.setScriptId('script-B')
    expect(backend.api.getPantryState().accountKey).not.toBe(first.accountKey)
    backend.properties.set('PANTRY_ACCOUNT_ID_V1', accountUuid)
    expect(backend.api.getPantryState().accountKey).toBe(`script-B:${accountUuid}`)
    expect(backend.create).not.toHaveBeenCalled()
  })

  it('serializes compare-and-save and returns the winner to a stale second writer', () => {
    const backend = server()
    const empty = backend.api.getPantryState()
    const first = backend.api.savePantryState({ expectedAccountKey: empty.accountKey, expectedRevision: null, products: [product] })
    expect(first.ok).toBe(true)
    const second = backend.api.savePantryState({ expectedAccountKey: empty.accountKey, expectedRevision: null, products: [] })
    expect(second).toMatchObject({ ok: false, conflict: true, state: first.state })
    expect(backend.create).toHaveBeenCalledTimes(1)
    expect(backend.update).not.toHaveBeenCalled()
    const next = backend.api.savePantryState({ expectedAccountKey: first.state.accountKey, expectedRevision: first.state.revision, products: [] })
    expect(next.ok).toBe(true)
    expect(next.state.revision).not.toBe(first.state.revision)
    expect(backend.update).toHaveBeenCalledTimes(1)
    expect(backend.release).toHaveBeenCalledTimes(4)
  })

  it('returns an explicit account conflict without mutating the current account', () => {
    const backend = server()
    backend.setFile(stored())
    const result = backend.api.savePantryState({ expectedAccountKey: 'old-account', expectedRevision: initialRevision, products: [] })
    expect(result).toMatchObject({ ok: false, conflict: true, state: { products: [product] } })
    expect(backend.update).not.toHaveBeenCalled()
  })

  it.each(['{broken', 'null', '[]', stored([{ ...product, expiryDate: '2026-02-30' }]), stored([{ ...product, state: 'used', archivedAt: null }])])('preserves an existing malformed file: %s', text => {
    const backend = server()
    backend.setFile(text)
    expect(() => backend.api.getPantryState()).toThrow('nieprawidłowy')
    expect(() => backend.api.savePantryState({ expectedAccountKey: 'script:user', expectedRevision: initialRevision, products: [] })).toThrow('Nie został zastąpiony')
    expect(backend.getFile()).toBe(text)
    expect(backend.update).not.toHaveBeenCalled()
    expect(backend.release).toHaveBeenCalledTimes(2)
  })

  it.each([42, [], { files: {} }, { files: [{ name: 'straznik-swiezosci.json' }] }, { files: [], nextPageToken: 'another-page' }, { files: [{ id: 'a' }, { id: 'b' }] }])('rejects ambiguous or malformed list results without creating a file', listed => {
    const backend = server()
    backend.setListed(listed)
    expect(() => backend.api.getPantryState()).toThrow('nieprawidłowy')
    expect(() => backend.api.savePantryState({ expectedAccountKey: 'script:user', expectedRevision: null, products: [] })).toThrow('Nie został zastąpiony')
    expect(backend.create).not.toHaveBeenCalled()
    expect(backend.update).not.toHaveBeenCalled()
  })

  it.each([
    { ...product, quantity: 0.0000001 }, { ...product, quantity: 1.0000001 }, { ...product, expiryDate: '0000-01-01' },
    { ...product, archivedAt: timestamp }, { ...product, barcode: '123' },
    { ...product, id: 'a'.repeat(101) }, { ...product, name: 'a'.repeat(201) }, { ...product, note: 'a'.repeat(2001) },
    { ...product, nutrition: { basis: '100g', kcal: 50, protein: 101, fat: null, carbs: null, source: 'manual' } },
    { ...product, nutrition: { basis: '100g', kcal: 50.0000001, protein: 1, fat: null, carbs: null, source: 'manual' } },
    { ...product, nutrition: { basis: '100g', kcal: 50, protein: 0.0000001, fat: null, carbs: null, source: 'manual' } },
    { ...product, nutrition: { basis: '100ml', kcal: 50, protein: 1, fat: null, carbs: null, source: 'openfoodfacts' } },
    { ...product, nutrition: { basis: '100ml', kcal: 50, protein: 1, fat: null, carbs: null, source: 'manual', sourceBarcode: '' } },
  ])('validates products on the server before touching Drive', invalid => {
    const backend = server()
    expect(() => backend.api.savePantryState({ expectedAccountKey: 'script:user', expectedRevision: null, products: [invalid] })).toThrow('nieprawidłowe')
    expect(backend.list).not.toHaveBeenCalled()
    expect(backend.create).not.toHaveBeenCalled()
    expect(backend.release).toHaveBeenCalledTimes(1)
  })

  it('limits product count and UTF-8 file size before writing', () => {
    const backend = server()
    const empty = backend.api.getPantryState()
    expect(() => backend.api.savePantryState({ expectedAccountKey: empty.accountKey, expectedRevision: null, products: Array(10001).fill(product) })).toThrow('nieprawidłowe')
    const largeProducts = Array.from({ length: 1500 }, (_, index) => ({ ...product, id: String(index), note: 'ą'.repeat(2000) }))
    expect(() => backend.api.savePantryState({ expectedAccountKey: empty.accountKey, expectedRevision: null, products: largeProducts })).toThrow('2 MB')
    expect(backend.create).not.toHaveBeenCalled()
  })

  it('does not leak upstream messages and labels an uncertain write correctly', () => {
    const backend = server()
    const empty = backend.api.getPantryState()
    backend.create.mockImplementation(() => { throw new Error('OAuth token secret-value; Google API internal message') })
    expect(() => backend.api.savePantryState({ expectedAccountKey: empty.accountKey, expectedRevision: null, products: [] })).toThrow('Nie udało się potwierdzić zapisu')
    expect(() => backend.api.getPantryState()).not.toThrow()
    expect(backend.release).toHaveBeenCalledTimes(3)
    backend.list.mockImplementation(() => { throw new Error('Bearer secret-value') })
    expect(() => backend.api.getPantryState()).toThrow('Nie udało się odczytać')
    expect(() => backend.api.getPantryState()).not.toThrow('secret-value')
  })

  it('reports an unconfirmed result when Drive writes but returns malformed metadata', () => {
    const backend = server()
    const empty = backend.api.getPantryState()
    const actualCreate = backend.create.getMockImplementation()!
    backend.create.mockImplementation((resource, data) => ({ ...actualCreate(resource, data), id: '' }))
    expect(() => backend.api.savePantryState({ expectedAccountKey: empty.accountKey, expectedRevision: null, products: [product] })).toThrow('Nie udało się potwierdzić zapisu')
    expect(backend.api.getPantryState().products).toEqual([product])
    expect(backend.create).toHaveBeenCalledTimes(1)
  })

  it('stores only validated product fields, matching the browser model', () => {
    const backend = server()
    const empty = backend.api.getPantryState()
    const result = backend.api.savePantryState({ expectedAccountKey: empty.accountKey, expectedRevision: null, products: [{ ...product, unknown: 'ignored' }] })
    expect(result.state.products).toEqual([product])
    expect(JSON.parse(backend.getFile()!).products).toEqual([product])
  })

  it('accepts exact text and precision bounds, legacy empty barcode, and manual provenance', () => {
    const backend = server()
    const empty = backend.api.getPantryState()
    const valid = {
      ...product, id: 'a'.repeat(100), name: 'a'.repeat(200), note: 'a'.repeat(2000), barcode: '',
      nutrition: { basis: '100g', kcal: 50.123456, protein: 0.000001, fat: null, carbs: null, source: 'manual', sourceBarcode: '12345678' },
    }
    const result = backend.api.savePantryState({ expectedAccountKey: empty.accountKey, expectedRevision: null, products: [valid] })
    expect(result).toMatchObject({ ok: true, state: { products: [valid] } })
    expect(backend.api.getPantryState().products).toEqual([valid])
  })

  it('does not release a lock it could not acquire or access Drive while locked out', () => {
    const backend = server()
    backend.setLockAvailable(false)
    expect(() => backend.api.getPantryState()).toThrow('właśnie synchronizowane')
    expect(backend.release).not.toHaveBeenCalled()
    expect(backend.list).not.toHaveBeenCalled()
  })
})
