/**
 * Short-TTL in-memory cache for provider search / work metadata
 * (record id, episode lists, detail URLs) so switching episodes
 * skips re-search when possible.
 */

export interface TtlCacheOptions {
  /** Default 20 minutes */
  ttlMs?: number
  /** Max entries before oldest eviction */
  maxSize?: number
}

export interface TtlCache<T> {
  get(key: string): T | null
  set(key: string, value: T): void
  has(key: string): boolean
  clear(): void
  size(): number
}

export function createTtlCache<T>(opts: TtlCacheOptions = {}): TtlCache<T> {
  const ttlMs = opts.ttlMs ?? Number(process.env.PLAYBACK_WORK_CACHE_TTL_MS || 20 * 60 * 1000)
  const maxSize = opts.maxSize ?? 80
  const map = new Map<string, { at: number; value: T }>()

  function evictExpired() {
    const now = Date.now()
    for (const [k, v] of map) {
      if (now - v.at > ttlMs) map.delete(k)
    }
  }

  function bound() {
    while (map.size > maxSize) {
      const first = map.keys().next().value
      if (first === undefined) break
      map.delete(first)
    }
  }

  return {
    get(key: string): T | null {
      const hit = map.get(key)
      if (!hit) return null
      if (Date.now() - hit.at > ttlMs) {
        map.delete(key)
        return null
      }
      // refresh insertion order for crude LRU
      map.delete(key)
      map.set(key, hit)
      return hit.value
    },
    set(key: string, value: T) {
      map.delete(key)
      map.set(key, { at: Date.now(), value })
      if (map.size > maxSize + 10) evictExpired()
      bound()
    },
    has(key: string): boolean {
      return this.get(key) != null
    },
    clear() {
      map.clear()
    },
    size() {
      return map.size
    },
  }
}

/** Stable key from title query list (order-independent). */
export function workCacheKey(queries: string[]): string {
  return queries
    .map((q) => q.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('|')
}
