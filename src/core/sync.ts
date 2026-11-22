import type { Product } from './model'
import type { DriveResult, DriveState } from '../services/googleDrive'

export const DRIVE_METADATA_KEY = 'straznik-swiezosci:drive:v2'
export type SyncStatus = 'unavailable' | 'off' | 'connecting' | 'synced' | 'working' | 'offline' | 'conflict' | 'error'
export interface SyncSnapshot {
  status: SyncStatus
  message: string
  lastSync: string | null
  connected: boolean
  conflict: DriveState | null
}
interface Preference {
  version: 2
  enabled: boolean
}
interface Metadata extends Preference {
  accountKey: string
  remoteRevision: string | null
  baselineHash: string
  lastSync: string
}
export interface SyncDependencies {
  available: () => boolean
  read: () => Promise<DriveState>
  write: (revision: string | null, products: Product[], accountKey: string) => Promise<DriveResult>
  getProducts: () => Product[]
  applyRemote: (products: Product[]) => boolean
  paused: () => boolean
  memoryOnly: () => boolean
  storage?: () => Pick<Storage, 'getItem' | 'setItem'>
  now?: () => Date
  hash?: (canonical: string) => Promise<string>
}

// This map holds connection metadata only; memory-only sessions never touch localStorage.
const memoryMetadata = new Map<string, string>()
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, item]) => [key, ordered(item)]))
  }
  return value
}
export function canonicalProducts(products: Product[]): string { return JSON.stringify(ordered(products)) }
export async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
function validMetadata(value: unknown): value is Metadata {
  if (value === null || typeof value !== 'object') return false
  const item = value as Partial<Metadata>
  return item.version === 2 && item.enabled === true && typeof item.accountKey === 'string' && item.accountKey.length > 0
    && (item.remoteRevision === null || typeof item.remoteRevision === 'string')
    && typeof item.baselineHash === 'string' && /^[a-f0-9]{64}$/.test(item.baselineHash)
    && typeof item.lastSync === 'string' && Number.isFinite(Date.parse(item.lastSync))
}
function remoteIdentity(state: DriveState): string {
  return JSON.stringify([state.accountKey, state.revision, state.modifiedAt, canonicalProducts(state.products)])
}

/** The engine owns no product storage. A remote replacement is accepted only by applyRemote. */
export class DriveSyncEngine {
  private snapshot: SyncSnapshot
  private listeners = new Set<() => void>()
  private generation = 0
  private queue: Promise<void> = Promise.resolve()
  private baseline: Metadata | null = null
  private baselineCanonical: string | null = null
  private initialized = false
  private metadataLoaded = false
  private metadataMode: boolean | null = null
  private persistedEnabled = false
  private pendingMetadata: Metadata | null = null
  private halted = false
  private choice: { remote: DriveState; local: string } | null = null
  private uncertain: { accountKey: string; canonical: string } | null = null

  constructor(private deps: SyncDependencies) {
    const available = deps.available()
    this.snapshot = { status: available ? 'off' : 'unavailable', connected: false, lastSync: null, conflict: null,
      message: available ? 'Synchronizacja jest wyłączona. Połącz z Dyskiem Google, aby rozpocząć.' : 'Dysk Google jest dostępny w wersji Google Apps Script.' }
  }
  getSnapshot = (): SyncSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private set(patch: Partial<SyncSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }
  private current(generation: number): boolean { return generation === this.generation && this.snapshot.connected }
  private storage(): Pick<Storage, 'getItem' | 'setItem'> {
    if (this.deps.memoryOnly()) return { getItem: key => memoryMetadata.get(key) ?? null, setItem: (key, value) => { memoryMetadata.set(key, value) } }
    return this.deps.storage ? this.deps.storage() : globalThis.localStorage
  }
  private loadMetadata(): void {
    const memoryOnly = this.deps.memoryOnly()
    if (this.metadataLoaded) {
      // Changing the storage mode keeps the known baseline, but persists the opt-in
      // to the newly selected store before any more network requests.
      if (this.metadataMode !== memoryOnly) {
        this.metadataMode = memoryOnly
        this.persistedEnabled = false
      }
      return
    }
    const raw = this.storage().getItem(DRIVE_METADATA_KEY)
    let parsed: unknown = null
    try { parsed = raw ? JSON.parse(raw) : null } catch { /* Invalid metadata never grants permission to overwrite. */ }
    const preference = parsed as Partial<Preference> | null
    this.persistedEnabled = preference?.version === 2 && preference.enabled === true
    this.baseline = validMetadata(parsed) ? parsed : null
    this.initialized = this.baseline !== null
    this.metadataLoaded = true
    this.metadataMode = memoryOnly
    if (this.baseline) this.set({ lastSync: this.baseline.lastSync })
  }
  private enablePreference(): void {
    if (this.persistedEnabled) return
    this.storage().setItem(DRIVE_METADATA_KEY, JSON.stringify(this.baseline ?? { version: 2, enabled: true }))
    this.persistedEnabled = true
  }
  private enqueue(operation: (generation: number) => Promise<void>): Promise<void> {
    const generation = this.generation
    const next = this.queue.then(async () => {
      if (generation !== this.generation) return
      try { await operation(generation) } catch (error) {
        if (!this.current(generation)) return
        const message = error instanceof Error ? error.message : 'Nie udało się zsynchronizować danych. Spróbuj ponownie.'
        // A pending choice must always keep its usable conflict controls.
        if (this.choice) this.set({ status: 'conflict', message: `${message} Dane pozostają bez zmian. Wybierz ponownie lub odłącz synchronizację.` })
        else this.set({ status: /network|offline|timeout|połącze|potwierdzić|odczytać.*Dysku|sieć/i.test(message) ? 'offline' : 'error', message })
      }
    })
    this.queue = next.catch(() => {})
    return next
  }
  private metadataError(): void {
    this.halted = true
    this.set({ status: this.choice ? 'conflict' : 'error', message: 'Nie udało się zapisać ustawień synchronizacji w przeglądarce. Synchronizacja jest wstrzymana. Spróbuj odświeżyć synchronizację lub włącz tryb pamięci.' })
  }
  private async acknowledge(remote: DriveState, generation: number): Promise<boolean> {
    const canonical = canonicalProducts(remote.products)
    const hash = await (this.deps.hash ?? sha256)(canonical)
    if (!this.current(generation)) return false
    const metadata: Metadata = { version: 2, enabled: true, accountKey: remote.accountKey, remoteRevision: remote.revision, baselineHash: hash, lastSync: (this.deps.now?.() ?? new Date()).toISOString() }
    this.baseline = metadata
    this.baselineCanonical = canonical
    this.initialized = true
    this.uncertain = null
    this.pendingMetadata = metadata
    this.choice = null
    this.set({ conflict: null })
    try { this.storage().setItem(DRIVE_METADATA_KEY, JSON.stringify(metadata)) } catch {
      this.metadataError()
      return false
    }
    this.pendingMetadata = null
    this.persistedEnabled = true
    this.halted = false
    this.set({ lastSync: metadata.lastSync })
    this.localChanged()
    return true
  }
  private conflict(remote: DriveState, message = 'Dane na urządzeniu i na Dysku Google różnią się. Wybierz, którą wersję zachować.'): void {
    const safe = clone(remote)
    this.choice = { remote: safe, local: canonicalProducts(this.deps.getProducts()) }
    this.set({ status: 'conflict', conflict: safe, message })
  }
  private pause(): boolean {
    if (!this.deps.paused()) return false
    this.set({ status: this.choice ? 'conflict' : 'working', message: this.choice ? 'Wybór wersji czeka na zakończenie edycji lub potwierdzenia.' : 'Synchronizacja czeka na zakończenie edycji lub potwierdzenia.' })
    return true
  }
  /** Notify after local edits or a pause changes; no network traffic is started here. */
  localChanged = (): void => {
    if (!this.snapshot.connected || this.halted) return
    if (this.choice) { if (this.snapshot.status !== 'conflict') this.set({ status: 'conflict' }); return }
    if (!this.initialized) return
    const dirty = canonicalProducts(this.deps.getProducts()) !== this.baselineCanonical
    if (dirty) {
      if (this.snapshot.status === 'offline') return
      this.set({ status: 'working', message: this.deps.paused() ? 'Zmiany czekają na zakończenie edycji lub potwierdzenia.' : 'Zmiany na urządzeniu czekają na synchronizację.' })
    } else this.set({ status: 'synced', message: 'Dane są zsynchronizowane z Dyskiem Google.' })
  }
  connect = (): Promise<void> => {
    if (!this.deps.available()) { this.set({ status: 'unavailable', connected: false }); return Promise.resolve() }
    if (this.snapshot.connected) return this.refresh()
    this.set({ connected: true, status: 'connecting', message: 'Sprawdzanie danych na Dysku Google…' })
    return this.enqueue(async generation => { await this.synchronize(generation, false) })
  }
  /** Resume only a connection that the user previously enabled. Never grants a first opt-in. */
  resume = (): Promise<void> => {
    if (!this.deps.available()) return Promise.resolve()
    if (this.snapshot.connected) return Promise.resolve()
    try { this.loadMetadata() } catch { this.metadataError(); return Promise.resolve() }
    if (!this.persistedEnabled) return Promise.resolve()
    this.set({ connected: true, status: 'connecting', message: 'Przywracanie synchronizacji z Dyskiem Google…' })
    return this.enqueue(generation => this.synchronize(generation, false))
  }
  /** Lifecycle cleanup cancels results, without changing the user's saved preference. */
  suspend = (): void => {
    this.generation += 1
    this.choice = null
    this.uncertain = null
    this.baseline = null
    this.baselineCanonical = null
    this.initialized = false
    this.metadataLoaded = false
    this.metadataMode = null
    this.persistedEnabled = false
    this.pendingMetadata = null
    this.halted = false
    this.set({ connected: false, conflict: null, status: this.deps.available() ? 'off' : 'unavailable', message: 'Synchronizacja została wyłączona. Dane na urządzeniu pozostają zapisane.' })
  }
  disconnect = (): void => {
    this.suspend()
    try {
      this.storage().setItem(DRIVE_METADATA_KEY, JSON.stringify({ version: 2, enabled: false }))
    } catch {
      this.set({ status: 'error', message: 'Synchronizacja jest wyłączona w tej sesji, ale nie udało się zapamiętać tej decyzji. Po ponownym otwarciu aplikacji sprawdź ustawienia połączenia.' })
    }
  }
  /** Automatic callers may retry network failures, but never a storage failure or an unresolved choice. */
  refresh = (automatic = false): Promise<void> => {
    if (!this.snapshot.connected || (automatic && this.halted)) return Promise.resolve()
    if (this.choice) { this.set({ status: 'conflict' }); return Promise.resolve() }
    return this.enqueue(generation => this.synchronize(generation, automatic))
  }
  private async synchronize(generation: number, automatic: boolean): Promise<void> {
    if (!this.current(generation) || this.choice || (automatic && this.halted)) return
    try {
      this.loadMetadata()
      this.enablePreference()
      if (this.pendingMetadata) {
        this.storage().setItem(DRIVE_METADATA_KEY, JSON.stringify(this.pendingMetadata))
        this.pendingMetadata = null
      }
      this.halted = false
    } catch { this.metadataError(); return }
    if (this.pause()) return
    this.set({ status: this.initialized ? 'working' : 'connecting', message: 'Sprawdzanie danych na Dysku Google…' })
    const remote = clone(await this.deps.read())
    if (!this.current(generation) || this.pause()) return
    const localProducts = clone(this.deps.getProducts())
    const localCanonical = canonicalProducts(localProducts)
    const remoteCanonical = canonicalProducts(remote.products)
    if (this.uncertain && remote.accountKey === this.uncertain.accountKey && remoteCanonical === this.uncertain.canonical) {
      if (!await this.acknowledge(remote, generation)) return
      if (!this.current(generation) || this.pause()) return
    }
    if (!this.initialized) {
      if (localCanonical === remoteCanonical) { await this.acknowledge(remote, generation); return }
      if (localProducts.length === 0) { await this.pull(remote, localCanonical, generation); return }
      this.conflict(remote)
      return
    }
    if (!this.baseline || remote.accountKey !== this.baseline.accountKey) { this.conflict(remote, 'Zmieniło się konto Dysku Google. Sprawdź obie wersje i wybierz ponownie.'); return }
    if (remoteCanonical === localCanonical) { await this.acknowledge(remote, generation); return }
    if (remote.revision === null && this.baseline.remoteRevision !== null && localProducts.length > 0) { this.conflict(remote, 'Na Dysku Google nie ma pliku z danymi. Wybierz, którą wersję zachować.'); return }
    const hash = this.deps.hash ?? sha256
    const [localHash, remoteHash] = await Promise.all([hash(localCanonical), hash(remoteCanonical)])
    if (!this.current(generation) || this.pause()) return
    if (canonicalProducts(this.deps.getProducts()) !== localCanonical) { this.localChanged(); return }
    const remoteChanged = remote.revision !== this.baseline.remoteRevision || remoteHash !== this.baseline.baselineHash
    const localChanged = localHash !== this.baseline.baselineHash
    if (remoteChanged && localChanged) { this.conflict(remote); return }
    if (remoteChanged) { await this.pull(remote, localCanonical, generation); return }
    if (localChanged) { await this.push(remote, localProducts, localCanonical, generation); return }
    await this.acknowledge(remote, generation)
  }
  private async pull(remote: DriveState, expectedLocal: string, generation: number): Promise<void> {
    if (!this.current(generation) || this.pause()) return
    if (canonicalProducts(this.deps.getProducts()) !== expectedLocal) { this.conflict(remote, 'Dane na urządzeniu zmieniły się podczas odczytu. Sprawdź obie wersje i wybierz ponownie.'); return }
    if (!this.deps.applyRemote(clone(remote.products))) {
      this.halted = true
      this.set({ status: this.choice ? 'conflict' : 'error', message: 'Nie udało się zapisać danych z Dysku Google na urządzeniu. Synchronizacja jest wstrzymana. Spróbuj ponownie po przywróceniu zapisu.' })
      return
    }
    await this.acknowledge(remote, generation)
  }
  private async push(remote: DriveState, products: Product[], canonical: string, generation: number): Promise<void> {
    let result: DriveResult
    try { result = await this.deps.write(remote.revision, clone(products), remote.accountKey) } catch (error) {
      if (this.current(generation)) this.uncertain = { accountKey: remote.accountKey, canonical }
      throw error
    }
    if (!this.current(generation)) return
    if (!result.ok) { this.conflict(result.state, 'Dane na Dysku Google zmieniły się przed zapisem. Sprawdź obie wersje i wybierz ponownie.'); return }
    if (result.state.accountKey !== remote.accountKey || result.state.revision === null || canonicalProducts(result.state.products) !== canonical) {
      this.conflict(result.state, 'Nie udało się potwierdzić zapisanej wersji. Sprawdź obie wersje i wybierz ponownie.')
      return
    }
    await this.acknowledge(result.state, generation)
  }
  private choose = (side: 'local' | 'cloud'): Promise<void> => {
    if (!this.snapshot.connected || !this.choice) return Promise.resolve()
    const confirmed = this.choice
    return this.enqueue(async generation => {
      if (!this.current(generation) || this.choice !== confirmed || this.pause()) return
      this.set({ status: 'conflict', message: 'Sprawdzanie, czy wybrane wersje są nadal aktualne…' })
      const remote = clone(await this.deps.read())
      if (!this.current(generation) || this.pause()) return
      const localCanonical = canonicalProducts(this.deps.getProducts())
      // A failed acknowledgement may have hidden a successful, user-approved save.
      // Confirm that exact version instead of issuing the same write again.
      if (this.uncertain && remote.accountKey === this.uncertain.accountKey
        && canonicalProducts(remote.products) === this.uncertain.canonical
        && localCanonical === this.uncertain.canonical && localCanonical === confirmed.local) {
        await this.acknowledge(remote, generation)
        return
      }
      if (remoteIdentity(remote) !== remoteIdentity(confirmed.remote) || localCanonical !== confirmed.local) {
        this.conflict(remote, 'Dane zmieniły się od pokazania wyboru. Sprawdź aktualne wersje i wybierz ponownie.')
        return
      }
      if (side === 'cloud') await this.pull(remote, confirmed.local, generation)
      else await this.push(remote, clone(this.deps.getProducts()), confirmed.local, generation)
    })
  }
  chooseLocal = (): Promise<void> => this.choose('local')
  chooseCloud = (): Promise<void> => this.choose('cloud')
}
