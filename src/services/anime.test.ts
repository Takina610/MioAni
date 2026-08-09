import { afterEach, describe, expect, it, vi } from 'vitest'
import { importAniList } from './anime'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AniList import', () => {
  it('preserves user watch start and completion dates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          MediaListCollection: {
            lists: [{
              entries: [{
                status: 'COMPLETED',
                progress: 12,
                score: 9,
                startedAt: { year: 2024, month: 2, day: 3 },
                completedAt: { year: 2024, month: 4, day: 5 },
                media: {
                  id: 1,
                  title: { romaji: 'Test Anime', native: 'テストアニメ', english: 'Test Anime' },
                  coverImage: {},
                  averageScore: 80,
                  seasonYear: 2024,
                  season: 'WINTER',
                  episodes: 12,
                  genres: [],
                  status: 'FINISHED',
                  nextAiringEpisode: null,
                },
              }],
            }],
          },
        },
      }),
    }))

    const result = await importAniList('test-user')

    expect(result.items[0]).toMatchObject({
      status: 'completed',
      watched: 12,
      startedAt: '2024-02-03',
      completedAt: '2024-04-05',
    })
  })
})
