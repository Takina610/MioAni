import type { Anime } from '../types/anime'
import type { ScheduleDay } from '../types/schedule'

export const CATALOG_CACHE_KEY = 'anime-catalog-v2'
export const CATALOG_CACHE_TTL_MS = 45 * 60 * 1000

export type CatalogCacheSnapshot = {
  savedAt: number
  bangumi: Anime[]
  trending: Anime[]
  schedule: ScheduleDay[]
}

function isUsableSnapshot(value: unknown): value is CatalogCacheSnapshot {
  if (!value || typeof value !== 'object') return false
  const snap = value as CatalogCacheSnapshot
  if (typeof snap.savedAt !== 'number' || !Number.isFinite(snap.savedAt)) return false
  if (!Array.isArray(snap.bangumi) || !Array.isArray(snap.trending) || !Array.isArray(snap.schedule)) {
    return false
  }
  return snap.bangumi.length > 0 || snap.trending.length > 0
}

export function readCatalogCache(
  now = Date.now(),
  ttlMs = CATALOG_CACHE_TTL_MS,
): CatalogCacheSnapshot | null {
  try {
    const raw = localStorage.getItem(CATALOG_CACHE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isUsableSnapshot(parsed)) return null
    if (now - parsed.savedAt > ttlMs) return null
    return parsed
  } catch {
    return null
  }
}

export function writeCatalogCache(snapshot: Omit<CatalogCacheSnapshot, 'savedAt'> & { savedAt?: number }) {
  if (!snapshot.bangumi.length && !snapshot.trending.length) return
  try {
    const payload: CatalogCacheSnapshot = {
      savedAt: snapshot.savedAt ?? Date.now(),
      bangumi: snapshot.bangumi,
      trending: snapshot.trending,
      schedule: snapshot.schedule,
    }
    localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(payload))
  } catch {
    // Quota / private mode — ignore.
  }
}

export function clearCatalogCache() {
  try {
    localStorage.removeItem(CATALOG_CACHE_KEY)
  } catch {
    // ignore
  }
}
