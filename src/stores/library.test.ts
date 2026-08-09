import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Anime } from '../types/anime'
import { useLibraryStore } from './library'

function createMemoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => data.delete(key),
    setItem: (key, value) => data.set(key, value),
  }
}

const fixture: Anime = {
  id: 'anilist-1',
  source: 'anilist',
  title: 'Test Anime',
  originalTitle: 'Test Anime',
  image: '',
  score: 0,
  year: 2026,
  season: 'summer',
  episodes: 12,
  watched: 0,
  status: 'planned',
  tags: [],
  summary: '',
  airingStatus: 'finished',
}

describe('library records', () => {
  beforeEach(() => {
    globalThis.localStorage = createMemoryStorage()
    setActivePinia(createPinia())
  })

  it('records watching dates and completes when the final episode is entered', () => {
    const store = useLibraryStore()
    store.add(fixture, 'planned')

    store.updateProgress(fixture.id, fixture.episodes)

    const item = store.items[0]
    expect(item.watched).toBe(12)
    expect(item.status).toBe('completed')
    expect(item.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(item.completedAt).toBe(item.startedAt)
  })

  it('normalizes personal scores and supports clearing them', () => {
    const store = useLibraryStore()
    store.add(fixture, 'watching')

    store.setUserScore(fixture.id, 8.27)
    expect(store.items[0].userScore).toBe(8)

    store.setUserScore(fixture.id, 99)
    expect(store.items[0].userScore).toBe(10)

    store.setUserScore(fixture.id, null)
    expect(store.items[0].userScore).toBeUndefined()
  })

  it('supports custom watch dates and clearing them', () => {
    const store = useLibraryStore()
    store.add(fixture, 'watching')

    store.setWatchDates(fixture.id, '2026-01-02', '2026-02-03')
    expect(store.items[0].startedAt).toBe('2026-01-02')
    expect(store.items[0].completedAt).toBe('2026-02-03')

    store.setWatchDates(fixture.id)
    expect(store.items[0].startedAt).toBeUndefined()
    expect(store.items[0].completedAt).toBeUndefined()
  })

  it('migrates legacy paused records into the shared dropped state', () => {
    const legacy = JSON.parse(JSON.stringify({ ...fixture, status: 'paused' }))
    localStorage.setItem('mioani-library-v1', JSON.stringify([legacy]))
    const store = useLibraryStore()

    expect(store.items[0].status).toBe('dropped')
  })
})
