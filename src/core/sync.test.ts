import { beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { canonicalProducts, DRIVE_METADATA_KEY, DriveSyncEngine, sha256, type SyncDependencies } from './sync'
import type { Product } from './model'
import type { DriveResult, DriveState } from '../services/googleDrive'

function product(name: string): Product {
  return { id: name, name, expiryDate: '', dateLabel: 'bestBefore', category: 'Inne', location: 'Szafka', quantity: 1, unit: 'szt.', openedDate: '', note: '', state: 'active', archivedAt: null }
}
function cloud(products: Product[] = [], revision: string | null = products.length ? '1' : null, accountKey = 'account-a'): DriveState {
  return { accountKey, revision, products: structuredClone(products), modifiedAt: revision === null ? null : '2026-11-22T12:00:00.000Z' }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
function harness(initial: Product[] = [], initialRemote = cloud()) {
  let local = structuredClone(initial)
  let remote = structuredClone(initialRemote)
  let paused = false
  let memoryOnly = false
  let durable = true
  let storageFailure = false
  const map = new Map<string, string>()
  const storage = { getItem: vi.fn((key: string) => { if (storageFailure) throw new Error('storage'); return map.get(key) ?? null }), setItem: vi.fn((key: string, value: string) => { if (storageFailure) throw new Error('storage'); map.set(key, value) }) }
  const read = vi.fn(async () => structuredClone(remote))
  const write = vi.fn(async (revision: string | null, products: Product[], accountKey: string): Promise<DriveResult> => {
    if (accountKey !== remote.accountKey || revision !== remote.revision) return { ok: false, conflict: true, state: structuredClone(remote) }
    remote = cloud(products, String(Number(remote.revision ?? 0) + 1), accountKey)
    return { ok: true, state: structuredClone(remote) }
  })
  const applyRemote = vi.fn((products: Product[]) => { if (!durable) return false; local = structuredClone(products); return true })
  const deps: SyncDependencies = {
    available: () => true, read, write, getProducts: () => local, applyRemote,
    paused: () => paused, memoryOnly: () => memoryOnly, storage: () => storage,
    now: () => new Date('2026-11-22T13:00:00.000Z'),
  }
  const engine = new DriveSyncEngine(deps)
  return { engine, deps, read, write, storage, applyRemote, map,
    local: () => local, remote: () => remote,
    edit: (products: Product[]) => { local = products; engine.localChanged() },
    changeRemote: (state: DriveState) => { remote = structuredClone(state) },
    pause: (value: boolean) => { paused = value; engine.localChanged() },
    memory: (value: boolean) => { memoryOnly = value },
    failStorage: (value: boolean) => { storageFailure = value },
    durable: (value: boolean) => { durable = value },
  }
}

beforeEach(() => { vi.stubGlobal('crypto', webcrypto) })

describe('canonical baseline', () => {
  it('uses SHA-256 with deterministic nested key ordering', async () => {
    expect(await sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    const a = product('Milk')
    const b = Object.fromEntries(Object.entries(a).reverse()) as unknown as Product
    expect(canonicalProducts([a])).toBe(canonicalProducts([b]))
  })
  it('does not access storage or network until an explicit connect', () => {
    const h = harness()
    expect(h.engine.getSnapshot().status).toBe('off')
    expect(h.storage.getItem).not.toHaveBeenCalled()
    expect(h.read).not.toHaveBeenCalled()
  })
  it('stores only opt-in, account, revision, a hash, and sync time', async () => {
    const h = harness([product('Private pantry name')], cloud([product('Private pantry name')]))
    await h.engine.connect()
    const metadata = JSON.parse(h.map.get(DRIVE_METADATA_KEY)!)
    expect(Object.keys(metadata).sort()).toEqual(['accountKey', 'baselineHash', 'enabled', 'lastSync', 'remoteRevision', 'version'])
    expect(metadata.baselineHash).toMatch(/^[a-f0-9]{64}$/)
    expect(h.map.get(DRIVE_METADATA_KEY)).not.toContain('Private pantry name')
  })
  it('never accesses localStorage in memory-only mode', async () => {
    const h = harness()
    h.memory(true)
    h.failStorage(true)
    await h.engine.connect()
    h.edit([product('Milk')])
    await h.engine.refresh()
    expect(h.engine.getSnapshot().status).toBe('synced')
    expect(h.storage.getItem).not.toHaveBeenCalled()
    expect(h.storage.setItem).not.toHaveBeenCalled()
  })
})

describe('first connection and conflict choices', () => {
  it('pulls cloud into an empty local collection after durable acceptance', async () => {
    const h = harness([], cloud([product('Milk')]))
    await h.engine.connect()
    expect(h.local()).toEqual([product('Milk')])
    expect(h.engine.getSnapshot().status).toBe('synced')
    expect(h.write).not.toHaveBeenCalled()
  })
  it.each([cloud(), cloud([product('Eggs')])])('requires a choice for a nonempty divergent local collection', async remote => {
    const h = harness([product('Milk')], remote)
    await h.engine.connect()
    expect(h.engine.getSnapshot().status).toBe('conflict')
    expect(h.local()).toEqual([product('Milk')])
    expect(h.write).not.toHaveBeenCalled()
    expect(h.applyRemote).not.toHaveBeenCalled()
  })
  it('freshly verifies both versions before choosing local', async () => {
    const h = harness([product('Milk')], cloud([product('Eggs')]))
    await h.engine.connect()
    await h.engine.chooseLocal()
    expect(h.read).toHaveBeenCalledTimes(2)
    expect(h.write).toHaveBeenCalledWith('1', [product('Milk')], 'account-a')
    expect(h.engine.getSnapshot().status).toBe('synced')
  })
  it.each(['local', 'cloud'] as const)('asks again when remote changes before choosing %s', async side => {
    const h = harness([product('Milk')], cloud([product('Eggs')]))
    await h.engine.connect()
    h.changeRemote(cloud([product('Bread')], '2'))
    await (side === 'local' ? h.engine.chooseLocal() : h.engine.chooseCloud())
    expect(h.engine.getSnapshot().status).toBe('conflict')
    expect(h.engine.getSnapshot().conflict?.revision).toBe('2')
    expect(h.write).not.toHaveBeenCalled()
    expect(h.applyRemote).not.toHaveBeenCalled()
  })
  it('acknowledges an uncertain successful local choice after a fresh read', async () => {
    const h = harness([product('Milk')], cloud([product('Eggs')]))
    await h.engine.connect()
    h.write.mockImplementationOnce(async () => { h.changeRemote(cloud([product('Milk')], '2')); throw new Error('timeout') })
    await h.engine.chooseLocal()
    expect(h.engine.getSnapshot().status).toBe('conflict')
    await h.engine.chooseLocal()
    expect(h.write).toHaveBeenCalledTimes(1)
    expect(h.engine.getSnapshot().status).toBe('synced')
  })
  it('keeps a choice available when editing temporarily blocks the action', async () => {
    const h = harness([product('Milk')], cloud([product('Eggs')]))
    await h.engine.connect()
    h.pause(true)
    await h.engine.chooseCloud()
    await h.engine.refresh()
    expect(h.engine.getSnapshot().status).toBe('conflict')
    expect(h.engine.getSnapshot().conflict).not.toBeNull()
    h.pause(false)
    await h.engine.chooseCloud()
    expect(h.engine.getSnapshot().status).toBe('synced')
  })
  it('checks content even if cloud revision remains unchanged', async () => {
    const h = harness([product('Milk')], cloud([product('Eggs')]))
    await h.engine.connect()
    h.changeRemote(cloud([product('Bread')], '1'))
    await h.engine.chooseLocal()
    expect(h.write).not.toHaveBeenCalled()
    expect(h.engine.getSnapshot().status).toBe('conflict')
  })
  it('protects local edits made during a slow cloud choice read', async () => {
    const h = harness([product('Milk')], cloud([product('Eggs')]))
    await h.engine.connect()
    const request = deferred<DriveState>()
    h.read.mockImplementationOnce(() => request.promise)
    const action = h.engine.chooseCloud()
    await Promise.resolve()
    h.edit([product('New local edit')])
    request.resolve(cloud([product('Eggs')]))
    await action
    expect(h.local()).toEqual([product('New local edit')])
    expect(h.applyRemote).not.toHaveBeenCalled()
    expect(h.engine.getSnapshot().status).toBe('conflict')
    await h.engine.chooseCloud()
    expect(h.local()).toEqual([product('Eggs')])
  })
  it('protects local changes before a local choice', async () => {
    const h = harness([product('Milk')], cloud([product('Eggs')]))
    await h.engine.connect()
    h.edit([product('New local edit')])
    await h.engine.chooseLocal()
    expect(h.write).not.toHaveBeenCalled()
    expect(h.engine.getSnapshot().status).toBe('conflict')
    await h.engine.chooseLocal()
    expect(h.remote().products).toEqual([product('New local edit')])
  })
  it('keeps conflicts resolvable after read failure and background refresh', async () => {
    const h = harness([product('Milk')], cloud([product('Eggs')]))
    await h.engine.connect()
    h.read.mockRejectedValueOnce(new Error('network offline'))
    await h.engine.chooseCloud()
    expect(h.engine.getSnapshot().status).toBe('conflict')
    await h.engine.refresh(true)
    expect(h.engine.getSnapshot().status).toBe('conflict')
    await h.engine.chooseCloud()
    expect(h.engine.getSnapshot().status).toBe('synced')
  })
})

describe('ongoing synchronization', () => {
  it('freshly reads before every write and uses its exact revision and account', async () => {
    const h = harness([product('Milk')], cloud([product('Milk')]))
    await h.engine.connect()
    h.edit([product('Eggs')])
    await h.engine.refresh()
    expect(h.read).toHaveBeenCalledTimes(2)
    expect(h.write).toHaveBeenCalledWith('1', [product('Eggs')], 'account-a')
    expect(h.engine.getSnapshot().status).toBe('synced')
  })
  it('preserves edits arriving while a save is in flight', async () => {
    const h = harness([product('Milk')], cloud([product('Milk')]))
    await h.engine.connect()
    const saved = deferred<DriveResult>()
    h.write.mockImplementationOnce(() => saved.promise)
    h.edit([product('Eggs')])
    const action = h.engine.refresh()
    await vi.waitFor(() => expect(h.write).toHaveBeenCalledTimes(1))
    h.edit([product('Bread')])
    h.changeRemote(cloud([product('Eggs')], '2'))
    saved.resolve({ ok: true, state: h.remote() })
    await action
    expect(h.local()).toEqual([product('Bread')])
    expect(h.engine.getSnapshot().status).toBe('working')
    await h.engine.refresh()
    expect(h.remote().products).toEqual([product('Bread')])
  })
  it('serializes overlapping refresh requests', async () => {
    const h = harness([product('Milk')], cloud([product('Milk')]))
    await h.engine.connect()
    const read = deferred<DriveState>()
    h.read.mockImplementationOnce(() => read.promise)
    const a = h.engine.refresh()
    const b = h.engine.refresh()
    await Promise.resolve()
    expect(h.read).toHaveBeenCalledTimes(2)
    read.resolve(h.remote())
    await Promise.all([a, b])
    expect(h.read).toHaveBeenCalledTimes(3)
  })
  it('retains offline edits and reconciles after network recovery', async () => {
    const h = harness([product('Milk')], cloud([product('Milk')]))
    await h.engine.connect()
    h.edit([product('Eggs')])
    h.read.mockRejectedValueOnce(new Error('network offline'))
    await h.engine.refresh()
    expect(h.engine.getSnapshot().status).toBe('offline')
    expect(h.local()).toEqual([product('Eggs')])
    await h.engine.refresh()
    expect(h.remote().products).toEqual([product('Eggs')])
  })
  it('acknowledges a timed out save that actually reached the server without resending it', async () => {
    const h = harness([product('Milk')], cloud([product('Milk')]))
    await h.engine.connect()
    h.edit([product('Eggs')])
    h.write.mockImplementationOnce(async () => { h.changeRemote(cloud([product('Eggs')], '2')); throw new Error('timeout: nie udało się potwierdzić zapisu') })
    await h.engine.refresh()
    expect(h.engine.getSnapshot().status).toBe('offline')
    await h.engine.refresh()
    expect(h.write).toHaveBeenCalledTimes(1)
    expect(h.engine.getSnapshot().status).toBe('synced')
  })
  it('stops when the account or revision changes alongside dirty local edits', async () => {
    for (const state of [cloud([product('Bread')], '2'), cloud([product('Milk')], '1', 'account-b')]) {
      const h = harness([product('Milk')], cloud([product('Milk')]))
      await h.engine.connect()
      h.edit([product('Eggs')])
      h.changeRemote(state)
      await h.engine.refresh()
      expect(h.engine.getSnapshot().status).toBe('conflict')
      expect(h.write).not.toHaveBeenCalled()
    }
  })
  it('handles the server conflict response without acknowledging a save', async () => {
    const h = harness([product('Milk')], cloud([product('Milk')]))
    await h.engine.connect()
    h.edit([product('Eggs')])
    h.write.mockResolvedValueOnce({ ok: false, conflict: true, state: cloud([product('Bread')], '2') })
    await h.engine.refresh()
    expect(h.engine.getSnapshot().status).toBe('conflict')
    expect(h.local()).toEqual([product('Eggs')])
  })
  it('defers all synchronization while an editor or confirmation is open', async () => {
    const h = harness([product('Milk')], cloud([product('Milk')]))
    await h.engine.connect()
    h.pause(true)
    h.edit([product('Eggs')])
    await h.engine.refresh()
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(h.write).not.toHaveBeenCalled()
    h.pause(false)
    await h.engine.refresh()
    expect(h.engine.getSnapshot().status).toBe('synced')
  })
  it('does not pull if editing starts during a pending read', async () => {
    const h = harness([product('Milk')], cloud([product('Milk')]))
    await h.engine.connect()
    const read = deferred<DriveState>()
    h.read.mockImplementationOnce(() => read.promise)
    const action = h.engine.refresh()
    await Promise.resolve()
    h.pause(true)
    read.resolve(cloud([product('Bread')], '2'))
    await action
    expect(h.applyRemote).not.toHaveBeenCalled()
    expect(h.local()).toEqual([product('Milk')])
  })
})

describe('durability, failures and disconnect', () => {
  it('halts autosync when replacement is not durably accepted', async () => {
    const h = harness([], cloud([product('Milk')]))
    h.durable(false)
    await h.engine.connect()
    expect(h.engine.getSnapshot().status).toBe('error')
    expect(h.local()).toEqual([])
    expect(JSON.parse(h.map.get(DRIVE_METADATA_KEY)!)).toEqual({ version: 2, enabled: true })
    await h.engine.refresh(true)
    expect(h.read).toHaveBeenCalledTimes(1)
    h.durable(true)
    await h.engine.refresh()
    expect(h.local()).toEqual([product('Milk')])
  })
  it('visibly halts autosync if metadata cannot be saved, then allows manual recovery', async () => {
    const h = harness([product('Milk')], cloud([product('Milk')]))
    await h.engine.connect()
    h.failStorage(true)
    h.edit([product('Eggs')])
    await h.engine.refresh()
    expect(h.engine.getSnapshot().status).toBe('error')
    expect(h.remote().products).toEqual([product('Eggs')])
    await h.engine.refresh(true)
    expect(h.write).toHaveBeenCalledTimes(1)
    h.failStorage(false)
    await h.engine.refresh()
    expect(h.write).toHaveBeenCalledTimes(1)
    expect(h.engine.getSnapshot().status).toBe('synced')
  })
  it('clears a completed choice even if storing its metadata fails', async () => {
    const h = harness([product('Milk')], cloud([product('Eggs')]))
    await h.engine.connect()
    h.failStorage(true)
    await h.engine.chooseLocal()
    expect(h.engine.getSnapshot().status).toBe('error')
    expect(h.engine.getSnapshot().conflict).toBeNull()
    expect(h.remote().products).toEqual([product('Milk')])
    h.failStorage(false)
    await h.engine.refresh()
    expect(h.engine.getSnapshot().status).toBe('synced')
    expect(h.write).toHaveBeenCalledTimes(1)
  })
  it('does not treat saved metadata as approval to overwrite divergent first-connect data', async () => {
    const h = harness([product('Milk')], cloud([product('Milk')]))
    await h.engine.connect()
    h.engine.disconnect()
    h.edit([product('Eggs')])
    await h.engine.connect()
    expect(h.engine.getSnapshot().status).toBe('conflict')
    expect(h.write).not.toHaveBeenCalled()
  })
  it('can recover a storage error by switching to memory-only mode', async () => {
    const h = harness()
    h.failStorage(true)
    await h.engine.connect()
    expect(h.engine.getSnapshot().status).toBe('error')
    h.memory(true)
    await h.engine.refresh()
    expect(h.engine.getSnapshot().status).toBe('synced')
    expect(h.read).toHaveBeenCalledTimes(1)
  })
  it.each(['read', 'write'] as const)('ignores a late %s completion after disconnect', async kind => {
    const h = harness([product('Milk')], cloud([product('Milk')]))
    await h.engine.connect()
    const read = deferred<DriveState>()
    const write = deferred<DriveResult>()
    if (kind === 'read') h.read.mockImplementationOnce(() => read.promise)
    else { h.edit([product('Eggs')]); h.write.mockImplementationOnce(() => write.promise) }
    const action = h.engine.refresh()
    await vi.waitFor(() => expect(kind === 'read' ? h.read : h.write).toHaveBeenCalledTimes(kind === 'read' ? 2 : 1))
    h.engine.disconnect()
    const writesBefore = h.storage.setItem.mock.calls.length
    read.resolve(cloud([product('Bread')], '2'))
    write.resolve({ ok: true, state: cloud([product('Eggs')], '2') })
    await action
    expect(h.engine.getSnapshot().status).toBe('off')
    expect(h.engine.getSnapshot().connected).toBe(false)
    expect(h.local()).toEqual([product(kind === 'read' ? 'Milk' : 'Eggs')])
    expect(h.storage.setItem).toHaveBeenCalledTimes(writesBefore)
  })
})


describe('saved opt-in and page lifecycle', () => {
  it('does not start any RPC on mount without an explicit prior opt-in', async () => {
    const h = harness()
    await h.engine.resume()
    expect(h.engine.getSnapshot().status).toBe('off')
    expect(h.read).not.toHaveBeenCalled()
    expect(h.storage.setItem).not.toHaveBeenCalled()
  })
  it('does not infer opt-in from a baseline without the enabled preference', async () => {
    const h = harness([product('Milk')], cloud([product('Milk')]))
    h.map.set(DRIVE_METADATA_KEY, JSON.stringify({ version: 2, accountKey: 'account-a', remoteRevision: '1', baselineHash: await sha256(canonicalProducts([product('Milk')])), lastSync: '2026-11-22T12:00:00.000Z' }))
    await h.engine.resume()
    expect(h.read).not.toHaveBeenCalled()
    expect(h.engine.getSnapshot().connected).toBe(false)
  })
  it('resumes dirty offline edits after reload using the saved hash and fresh remote revision', async () => {
    const h = harness([product('Milk')], cloud([product('Milk')]))
    await h.engine.connect()
    h.edit([product('Eggs')])
    h.read.mockRejectedValueOnce(new Error('network offline'))
    await h.engine.refresh()
    h.engine.suspend()
    const reloaded = new DriveSyncEngine(h.deps)
    await reloaded.resume()
    expect(reloaded.getSnapshot().status).toBe('synced')
    expect(h.write).toHaveBeenCalledExactlyOnceWith('1', [product('Eggs')], 'account-a')
    expect(h.remote().products).toEqual([product('Eggs')])
  })
  it('pulls cloud changes on reload when the local hash still equals the saved baseline', async () => {
    const h = harness([product('Milk')], cloud([product('Milk')]))
    await h.engine.connect()
    h.engine.suspend()
    h.changeRemote(cloud([product('Eggs')], '2'))
    const reloaded = new DriveSyncEngine(h.deps)
    await reloaded.resume()
    expect(h.local()).toEqual([product('Eggs')])
    expect(reloaded.getSnapshot().status).toBe('synced')
    expect(h.write).not.toHaveBeenCalled()
  })
  it('asks on reload when both sides changed from the saved baseline', async () => {
    const h = harness([product('Milk')], cloud([product('Milk')]))
    await h.engine.connect()
    h.engine.suspend()
    h.edit([product('Bread')])
    h.changeRemote(cloud([product('Eggs')], '2'))
    const reloaded = new DriveSyncEngine(h.deps)
    await reloaded.resume()
    expect(reloaded.getSnapshot().status).toBe('conflict')
    expect(h.write).not.toHaveBeenCalled()
    expect(h.applyRemote).not.toHaveBeenCalled()
  })
  it('asks on a different account after reload even if products are identical', async () => {
    const h = harness([product('Milk')], cloud([product('Milk')]))
    await h.engine.connect()
    h.engine.suspend()
    h.changeRemote(cloud([product('Milk')], '1', 'account-b'))
    const reloaded = new DriveSyncEngine(h.deps)
    await reloaded.resume()
    expect(reloaded.getSnapshot().status).toBe('conflict')
    expect(h.write).not.toHaveBeenCalled()
  })
  it('retains opt-in when the first network read fails, but does not invent a trusted baseline', async () => {
    const h = harness([product('Milk')])
    h.read.mockRejectedValueOnce(new Error('network offline'))
    await h.engine.connect()
    expect(JSON.parse(h.map.get(DRIVE_METADATA_KEY)!)).toEqual({ version: 2, enabled: true })
    h.engine.suspend()
    const reloaded = new DriveSyncEngine(h.deps)
    await reloaded.resume()
    expect(reloaded.getSnapshot().status).toBe('conflict')
    expect(h.write).not.toHaveBeenCalled()
  })
  it('persists explicit disconnect so reload cannot silently re-enable sync', async () => {
    const h = harness([product('Milk')], cloud([product('Milk')]))
    await h.engine.connect()
    h.engine.disconnect()
    expect(JSON.parse(h.map.get(DRIVE_METADATA_KEY)!)).toEqual({ version: 2, enabled: false })
    const reloaded = new DriveSyncEngine(h.deps)
    await reloaded.resume()
    expect(reloaded.getSnapshot().connected).toBe(false)
    expect(reloaded.getSnapshot().status).toBe('off')
    expect(h.read).toHaveBeenCalledTimes(1)
  })
  it('survives StrictMode-style mount cleanup and remount without changing the opt-in', async () => {
    const h = harness([product('Milk')], cloud([product('Milk')]))
    await h.engine.connect()
    h.engine.suspend()
    const mounted = new DriveSyncEngine(h.deps)
    const firstMount = mounted.resume()
    mounted.suspend()
    const secondMount = mounted.resume()
    await Promise.all([firstMount, secondMount])
    expect(mounted.getSnapshot().status).toBe('synced')
    expect(h.read).toHaveBeenCalledTimes(2)
    expect(JSON.parse(h.map.get(DRIVE_METADATA_KEY)!).enabled).toBe(true)
  })
  it('persists the user opt-in even if an open editor defers the first RPC', async () => {
    const h = harness()
    h.pause(true)
    await h.engine.connect()
    expect(h.read).not.toHaveBeenCalled()
    expect(JSON.parse(h.map.get(DRIVE_METADATA_KEY)!)).toEqual({ version: 2, enabled: true })
  })
  it('uses only the memory map for opt-in, resume and explicit disconnect in memory mode', async () => {
    const h = harness()
    h.memory(true)
    h.failStorage(true)
    await h.engine.connect()
    h.engine.suspend()
    const reloaded = new DriveSyncEngine(h.deps)
    await reloaded.resume()
    expect(reloaded.getSnapshot().connected).toBe(true)
    reloaded.disconnect()
    const disconnected = new DriveSyncEngine(h.deps)
    await disconnected.resume()
    expect(disconnected.getSnapshot().connected).toBe(false)
    expect(h.storage.getItem).not.toHaveBeenCalled()
    expect(h.storage.setItem).not.toHaveBeenCalled()
  })
})
