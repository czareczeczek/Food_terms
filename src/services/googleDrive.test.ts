import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Product } from '../core/model'
import { driveAvailable, readDrive, writeDrive, type DriveState } from './googleDrive'

const product: Product = {
  id: 'milk', name: 'Mleko', expiryDate: '2026-11-25', dateLabel: 'useBy', category: 'Nabiał',
  location: 'Lodówka', quantity: 1, unit: 'l', openedDate: '', note: '', state: 'active', archivedAt: null,
}
const cloud: DriveState = {
  accountKey: 'script:user', revision: '780b6ac2-8bc7-40df-b6b6-bfb7d7d7d7d7',
  products: [product], modifiedAt: '2026-11-22T10:00:00.000Z',
}

function installBridge() {
  type Call = { method: string; payload?: unknown; success: (value: unknown) => void; failure: (error: unknown) => void }
  const calls: Call[] = []
  function runner(success: (value: unknown) => void = () => {}, failure: (error: unknown) => void = () => {}) {
    return {
      withSuccessHandler: (next: typeof success) => runner(next, failure),
      withFailureHandler: (next: typeof failure) => runner(success, next),
      getPantryState: () => calls.push({ method: 'getPantryState', success, failure }),
      savePantryState: (payload: unknown) => calls.push({ method: 'savePantryState', payload, success, failure }),
    }
  }
  vi.stubGlobal('google', { script: { run: runner() } })
  return calls
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Google Apps Script adapter', () => {
  it('is unavailable outside the Apps Script host', async () => {
    vi.stubGlobal('google', undefined)
    expect(driveAvailable()).toBe(false)
    await expect(readDrive()).rejects.toThrow('Google Apps Script')
  })

  it('reads and validates the complete state through the browser RPC', async () => {
    const calls = installBridge()
    expect(driveAvailable()).toBe(true)
    const request = readDrive()
    expect(calls[0].method).toBe('getPantryState')
    calls[0].success(cloud)
    await expect(request).resolves.toEqual(cloud)
  })

  it('passes account identity and expected revision and preserves explicit conflicts', async () => {
    const calls = installBridge()
    const request = writeDrive(cloud.revision, [product], cloud.accountKey)
    expect(calls[0]).toMatchObject({ method: 'savePantryState', payload: {
      expectedRevision: cloud.revision, expectedAccountKey: cloud.accountKey, products: [product],
    } })
    calls[0].success({ ok: false, conflict: true, state: cloud })
    await expect(request).resolves.toEqual({ ok: false, conflict: true, state: cloud })
  })

  it('rejects invalid local products before issuing a write', async () => {
    const calls = installBridge()
    await expect(writeDrive(null, [{ ...product, expiryDate: '2026-02-30' }], cloud.accountKey)).rejects.toThrow('nieprawidłowe')
    expect(calls).toHaveLength(0)
  })

  it.each([
    { ...cloud, products: [{ ...product, quantity: -1 }] },
    { ...cloud, products: [{ ...product, state: 'used', archivedAt: null }] },
    { ...cloud, modifiedAt: '2026-02-30T10:00:00.000Z' },
    { ...cloud, modifiedAt: '0000-01-01T00:00:00.000Z' },
    { ...cloud, revision: null },
    { ...cloud, accountKey: '' },
  ])('rejects malformed cloud state without returning it', async invalid => {
    const calls = installBridge()
    const request = readDrive()
    calls[0].success(invalid)
    await expect(request).rejects.toThrow('nieprawidłowe dane')
  })

  it('does not expose raw server errors or their token strings', async () => {
    const calls = installBridge()
    const request = readDrive()
    calls[0].failure(new Error('Google API OAuth Bearer secret-token'))
    await expect(request).rejects.toThrow('Nie udało się odczytać')
    await expect(request).rejects.not.toThrow('secret-token')
  })

  it('reports a timed-out write as unconfirmed, makes one call, and ignores late completion', async () => {
    vi.useFakeTimers()
    const calls = installBridge()
    const request = writeDrive(null, [product], cloud.accountKey)
    const rejected = expect(request).rejects.toThrow('Nie udało się potwierdzić zapisu')
    await vi.advanceTimersByTimeAsync(20_000)
    await rejected
    calls[0].success({ ok: true, state: cloud })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toHaveLength(1)
  })

  it.each([
    { ok: false, state: cloud },
    { ok: true, state: { ...cloud, products: [{ ...product, expiryDate: '2026-02-30' }] } },
  ])('reports an unconfirmed write when its response cannot be validated', async result => {
    const calls = installBridge()
    const request = writeDrive(null, [product], cloud.accountKey)
    calls[0].success(result)
    await expect(request).rejects.toThrow('Nie udało się potwierdzić zapisu')
  })
})
