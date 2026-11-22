import { DEFAULT_SETTINGS, parseData, type Product } from '../core/model'

export interface DriveState {
  accountKey: string
  revision: string | null
  products: Product[]
  modifiedAt: string | null
}

export type DriveResult = { ok: true; state: DriveState } | { ok: false; conflict: true; state: DriveState }

type RpcRunner = {
  withSuccessHandler(handler: (value: unknown) => void): RpcRunner
  withFailureHandler(handler: (error: unknown) => void): RpcRunner
  getPantryState(): void
  savePantryState(payload: { expectedRevision: string | null; products: Product[]; expectedAccountKey: string }): void
}

const TIMEOUT_MS = 20_000
const READ_ERROR = 'Nie udało się odczytać danych z Dysku Google. Sprawdź połączenie i spróbuj ponownie.'
const SAVE_ERROR = 'Nie udało się potwierdzić zapisu na Dysku Google. Odczytaj ponownie stan przed kolejną próbą.'
const INVALID_RESPONSE = 'Dysk Google zwrócił nieprawidłowe dane. Zapis został wstrzymany.'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function bridge(): RpcRunner | null {
  const root = globalThis as typeof globalThis & { google?: { script?: { run?: unknown } } }
  const runner = root.google?.script?.run
  if ((typeof runner !== 'object' && typeof runner !== 'function') || runner === null) return null
  const candidate = runner as Partial<RpcRunner>
  return typeof candidate.withSuccessHandler === 'function' && typeof candidate.withFailureHandler === 'function'
    ? candidate as RpcRunner
    : null
}

export function driveAvailable(): boolean {
  return bridge() !== null
}

function revision(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0 && value.length <= 256)
}

function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString() === value
}

function products(value: unknown): Product[] {
  return parseData(JSON.stringify({ version: 1, products: value, settings: DEFAULT_SETTINGS })).products
}

function state(value: unknown): DriveState {
  try {
    if (!record(value) || typeof value.accountKey !== 'string' || !value.accountKey.trim() || value.accountKey.length > 1024 || !revision(value.revision)) throw new Error()
    if (value.revision === null ? value.modifiedAt !== null : !timestamp(value.modifiedAt)) throw new Error()
    const parsedProducts = products(value.products)
    if (value.revision === null && parsedProducts.length !== 0) throw new Error()
    return { accountKey: value.accountKey, revision: value.revision, products: parsedProducts, modifiedAt: value.modifiedAt as string | null }
  } catch {
    throw new Error(INVALID_RESPONSE)
  }
}

function invoke(method: 'getPantryState' | 'savePantryState', payload?: { expectedRevision: string | null; products: Product[]; expectedAccountKey: string }): Promise<unknown> {
  const runner = bridge()
  if (!runner) return Promise.reject(new Error('Synchronizacja z Dyskiem Google jest dostępna w aplikacji uruchomionej przez Google Apps Script.'))
  return new Promise((resolve, reject) => {
    let finished = false
    const message = method === 'savePantryState' ? SAVE_ERROR : READ_ERROR
    const finish = (success: boolean, value?: unknown) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (success) resolve(value)
      else reject(new Error(message))
    }
    const timer = setTimeout(() => finish(false), TIMEOUT_MS)
    try {
      const request = runner.withSuccessHandler(value => finish(true, value)).withFailureHandler(() => finish(false))
      if (method === 'getPantryState') request.getPantryState()
      else request.savePantryState(payload!)
    } catch {
      finish(false)
    }
  })
}

export async function readDrive(): Promise<DriveState> {
  return state(await invoke('getPantryState'))
}

export async function writeDrive(expectedRevision: string | null, nextProducts: Product[], expectedAccountKey: string): Promise<DriveResult> {
  if (!revision(expectedRevision) || typeof expectedAccountKey !== 'string' || !expectedAccountKey.trim() || expectedAccountKey.length > 1024) {
    throw new Error('Nieprawidłowy stan synchronizacji. Odczytaj ponownie dane z Dysku Google.')
  }
  let validProducts: Product[]
  try {
    validProducts = products(nextProducts)
  } catch {
    throw new Error('Dane produktów są nieprawidłowe. Popraw je przed zapisem na Dysku Google.')
  }
  const result = await invoke('savePantryState', { expectedRevision, products: validProducts, expectedAccountKey })
  try {
    if (!record(result) || (result.ok !== true && !(result.ok === false && result.conflict === true))) throw new Error()
    const nextState = state(result.state)
    return result.ok === true ? { ok: true, state: nextState } : { ok: false, conflict: true, state: nextState }
  } catch {
    throw new Error(SAVE_ERROR)
  }
}
