import { useEffect, useRef, useState } from 'react'
import type { Product } from '../core/model'
import { canonicalProducts, DriveSyncEngine } from '../core/sync'
import { driveAvailable, readDrive, writeDrive } from '../services/googleDrive'

interface DriveOptions {
  products: Product[]
  getProducts: () => Product[]
  applyRemote: (products: Product[]) => boolean
  busy: boolean
  blocked: boolean
  memoryOnly: boolean
}

export function useDrive(options: DriveOptions) {
  const current = useRef(options)
  current.current = options
  const engineRef = useRef<DriveSyncEngine | null>(null)
  if (!engineRef.current) engineRef.current = new DriveSyncEngine({
    available: driveAvailable,
    read: readDrive,
    write: writeDrive,
    getProducts: () => current.current.getProducts(),
    applyRemote: products => current.current.applyRemote(products),
    paused: () => current.current.busy || current.current.blocked,
    memoryOnly: () => current.current.memoryOnly,
  })
  const engine = engineRef.current
  const [snapshot, setSnapshot] = useState(engine.getSnapshot)
  const canonical = canonicalProducts(options.products)
  const previousMemoryOnly = useRef(options.memoryOnly)

  useEffect(() => {
    setSnapshot(engine.getSnapshot())
    return engine.subscribe(() => setSnapshot(engine.getSnapshot()))
  }, [engine])
  useEffect(() => {
    void engine.resume()
    return () => { engine.suspend() }
  }, [engine])
  useEffect(() => {
    engine.localChanged()
    if (!snapshot.connected || options.busy || options.blocked || snapshot.conflict) return
    const timer = setTimeout(() => { void engine.refresh(true) }, 1_000)
    return () => clearTimeout(timer)
  }, [engine, canonical, options.busy, options.blocked, options.memoryOnly, snapshot.connected, snapshot.conflict])
  useEffect(() => {
    if (previousMemoryOnly.current === options.memoryOnly) return
    previousMemoryOnly.current = options.memoryOnly
    if (snapshot.connected) void engine.refresh()
  }, [engine, options.memoryOnly, snapshot.connected])
  useEffect(() => {
    if (!snapshot.connected) return
    const check = () => { if (document.visibilityState !== 'hidden') void engine.refresh(true) }
    const interval = setInterval(check, 30_000)
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', check)
      window.removeEventListener('online', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [engine, snapshot.connected])

  return { ...snapshot, connect: engine.connect, refresh: () => engine.refresh(), disconnect: engine.disconnect, chooseLocal: engine.chooseLocal, chooseCloud: engine.chooseCloud }
}
