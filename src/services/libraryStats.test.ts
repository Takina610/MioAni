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
    expect(stats.completionTitleRate).toBeCloseTo(0.5)
  })

  it('ranks the most progressed titles and groups tags', () => {
    const stats = buildLibraryStats([
      anime({ watched: 2, tags: ['Drama'] }),
      anime({ id: 'anime-2', title: 'Leader', watched: 10, tags: ['Drama', 'Comedy'] }),
    ])

    expect(stats.progressLeaders[0].title).toBe('Leader')
    expect(stats.tagBreakdown[0]).toMatchObject({ label: 'Drama', value: 2 })
  })

  it('hides strong persona below five titles', () => {
    const stats = buildLibraryStats([
      anime({ id: 'a1', status: 'planned' }),
      anime({ id: 'a2', status: 'planned' }),
      anime({ id: 'a3', status: 'planned' }),
      anime({ id: 'a4', status: 'planned' }),
    ])
    expect(stats.persona).toBeNull()
  })

  it('builds a persona when library is large enough', () => {
    const stats = buildLibraryStats([
      anime({ id: 'a1', status: 'planned', tags: ['A'] }),
      anime({ id: 'a2', status: 'planned', tags: ['A'] }),
      anime({ id: 'a3', status: 'planned', tags: ['A'] }),
      anime({ id: 'a4', status: 'dropped', tags: ['B'] }),
      anime({ id: 'a5', status: 'watching', tags: ['B'] }),
    ])
    expect(stats.persona?.label).toBe('开坑收藏家')
    expect(stats.dropRate).toBeCloseTo(0.2)
    expect(stats.plannedRate).toBeCloseTo(0.6)
  })

  it('requires three dated completions for median finish days', () => {
    const thin = buildLibraryStats([
      anime({
        id: 'c1',
        status: 'completed',
        watched: 12,
        startedAt: '2024-01-01',
        completedAt: '2024-01-10',
      }),
      anime({
        id: 'c2',
        status: 'completed',
        watched: 12,
        startedAt: '2024-02-01',
        completedAt: '2024-03-01',
      }),
    ])
    expect(thin.medianFinishDays).toBeNull()
    expect(thin.finishDurationSampleSize).toBe(2)

    const rich = buildLibraryStats([
      anime({
        id: 'c1',
        status: 'completed',
        watched: 12,
        startedAt: '2024-01-01',
        completedAt: '2024-01-08',
      }),
      anime({
        id: 'c2',
        status: 'completed',
        watched: 12,
        startedAt: '2024-02-01',
        completedAt: '2024-03-02',
      }),
      anime({
        id: 'c3',
        status: 'completed',
        watched: 12,
        startedAt: '2024-04-01',
        completedAt: '2024-04-11',
      }),
    ])
    expect(rich.finishDurationSampleSize).toBe(3)
    expect(rich.medianFinishDays).toBe(10)
    expect(rich.finishDurationBuckets.some((bucket) => bucket.value > 0)).toBe(true)
  })

  it('builds score contrast only when both personal and catalog scores exist', () => {
    const stats = buildLibraryStats([
      anime({ id: 's1', title: 'Harsh', userScore: 6, score: 9 }),
      anime({ id: 's2', title: 'Soft', userScore: 10, score: 7 }),
      anime({ id: 's3', title: 'Even', userScore: 8, score: 8 }),
      anime({ id: 's4', title: 'No personal', score: 9 }),
    ])
    expect(stats.userScoreSampleSize).toBe(3)
    expect(stats.averageUserScore).toBeCloseTo(8)
    expect(stats.scoreContrast).toHaveLength(3)
    expect(stats.scoreContrastBias).not.toBeNull()
  })

  it('flags tag betrayal for low finish-rate genres', () => {
    const stats = buildLibraryStats([
      anime({ id: 't1', status: 'watching', tags: ['Romance'] }),
      anime({ id: 't2', status: 'dropped', tags: ['Romance'] }),
      anime({ id: 't3', status: 'dropped', tags: ['Romance'] }),
      anime({ id: 't4', status: 'completed', tags: ['Action'], watched: 12 }),
      anime({ id: 't5', status: 'completed', tags: ['Action'], watched: 12 }),
    ])
    expect(stats.tagBetrayal?.tag).toBe('Romance')
    expect(stats.tagLoyalty.find((row) => row.tag === 'Action')?.finishRate).toBe(1)
  })

  it('ignores non AniList season strings', () => {
    const stats = buildLibraryStats([
      anime({ id: 's1', season: 'TV' }),
      anime({ id: 's2', season: 'SUMMER' }),
      anime({ id: 's3', season: 'SUMMER' }),
    ])
    expect(stats.seasonPreference).toEqual([
      expect.objectContaining({ season: '夏', value: 2 }),
    ])
  })
})
