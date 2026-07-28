import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Anime } from '../types/anime'
import type { ScheduleDay } from '../types/schedule'
import {
  CATALOG_CACHE_KEY,
  CATALOG_CACHE_TTL_MS,
  clearCatalogCache,
  readCatalogCache,
  writeCatalogCache,
} from './catalogCache'

function sampleAnime(id: string): Anime {
  return {
    id,
    source: 'bangumi',
    title: `Title ${id}`,
    originalTitle: id,
    image: '',
    score: 7,
    year: 2026,
    season: 'TV',
    episodes: 12,
    watched: 0,
    status: 'planned',
    tags: [],
    summary: '',
  }
}

function sampleSchedule(): ScheduleDay[] {
  return [
    {
      weekday: 1,
      label: '周一',
      isToday: false,
      items: [{ anime: sampleAnime('bgm-1'), airTime: '22:00', timed: true }],
    },
  ]
}

describe('catalogCache', () => {
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes and reads a fresh snapshot', () => {
    const now = 1_000_000
    writeCatalogCache({
      savedAt: now,
      bangumi: [sampleAnime('bgm-1')],
      trending: [],
      schedule: sampleSchedule(),
    })

    const cached = readCatalogCache(now + 1000)
    expect(cached).not.toBeNull()
    expect(cached?.bangumi).toHaveLength(1)
    expect(cached?.bangumi[0]?.id).toBe('bgm-1')
    expect(cached?.schedule[0]?.items).toHaveLength(1)
  })

  it('returns null when TTL expired', () => {
    const savedAt = 1_000_000
    writeCatalogCache({
      savedAt,
      bangumi: [sampleAnime('bgm-1')],
      trending: [],
      schedule: sampleSchedule(),
    })

    expect(readCatalogCache(savedAt + CATALOG_CACHE_TTL_MS + 1)).toBeNull()
  })

  it('ignores corrupt JSON', () => {
    store.set(CATALOG_CACHE_KEY, '{not-json')
    expect(readCatalogCache()).toBeNull()
  })

  it('ignores empty lists', () => {
    writeCatalogCache({
      bangumi: [],
      trending: [],
      schedule: [],
    })
    expect(store.has(CATALOG_CACHE_KEY)).toBe(false)
    expect(readCatalogCache()).toBeNull()
  })

  it('ignores malformed shape', () => {
    store.set(CATALOG_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), bangumi: 'x' }))
    expect(readCatalogCache()).toBeNull()
  })

  it('clearCatalogCache removes the key', () => {
    writeCatalogCache({
      bangumi: [],
      trending: [sampleAnime('anilist-1')],
      schedule: [],
    })
    expect(readCatalogCache()).not.toBeNull()
    clearCatalogCache()
    expect(readCatalogCache()).toBeNull()
  })
})
