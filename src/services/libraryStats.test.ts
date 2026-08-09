import { describe, expect, it } from 'vitest'
import { buildLibraryStats } from './libraryStats'
import type { Anime } from '../types/anime'

function anime(overrides: Partial<Anime>): Anime {
  return {
    id: 'anime-1',
    source: 'anilist',
    title: 'Demo',
    originalTitle: 'Demo',
    image: '',
    score: 8,
    year: 2026,
    season: 'SUMMER',
    episodes: 12,
    watched: 4,
    status: 'watching',
    tags: ['Action', 'Drama'],
    summary: '',
    ...overrides,
  }
}

describe('library stats', () => {
  it('calculates totals, completion, and pending releasing episodes', () => {
    const stats = buildLibraryStats([
      anime({ airingStatus: 'releasing' }),
      anime({ id: 'anime-2', title: 'Finished', watched: 12, status: 'completed', airingStatus: 'finished' }),
    ])

    expect(stats.totalTitles).toBe(2)
    expect(stats.watchedEpisodes).toBe(16)
    expect(stats.availableEpisodes).toBe(24)
    expect(stats.pendingEpisodes).toBe(8)
    expect(stats.completionRate).toBeCloseTo(16 / 24)
    expect(stats.averageScore).toBe(8)
  })

  it('ranks the most progressed titles and groups tags', () => {
    const stats = buildLibraryStats([
      anime({ watched: 2, tags: ['Drama'] }),
      anime({ id: 'anime-2', title: 'Leader', watched: 10, tags: ['Drama', 'Comedy'] }),
    ])

    expect(stats.progressLeaders[0].title).toBe('Leader')
    expect(stats.tagBreakdown[0]).toMatchObject({ label: 'Drama', value: 2 })
  })
})
