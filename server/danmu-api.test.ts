import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildMatchFileName,
  clearDanmuCache,
  emptyDanmuResponse,
  fetchAggregatedDanmu,
  parseDandanComments,
} from './danmu-api'

beforeEach(() => {
  clearDanmuCache()
})

describe('danmu-api helpers', () => {
  it('builds the DandanPlay match filename', () => {
    expect(buildMatchFileName('My Anime', 3)).toBe('My Anime S01E03')
    expect(buildMatchFileName('Title', 0, 0)).toBe('Title S01E01')
  })

  it('normalizes p/m comments and source labels', () => {
    const result = parseDandanComments({
      comments: [
        { p: '12.5,1,25,16711680,0,0,hash,id,[Bilibili&Tencent]', m: 'hello' },
        { p: '18,4,65280,[iqiyi]', m: 'bottom' },
        { p: '20,5,25,255,[bilibili]', m: '' },
      ],
    })

    expect(result).toEqual([
      {
        text: 'hello',
        time: 12.5,
        mode: 0,
        color: '#FF0000',
        sources: ['bilibili', 'tencent'],
      },
      {
        text: 'bottom',
        time: 18,
        mode: 2,
        color: '#00FF00',
        sources: ['iqiyi'],
      },
    ])
  })

  it('normalizes danmu_api platform aliases and millisecond timestamps', () => {
    expect(parseDandanComments({
      comments: [{
        t: 1_250_000,
        p: '12.5,1,25,16711680,0,0,hash,id,[bilibili1&qq&qiyi]',
        m: 'hello',
      }],
    })).toEqual([{
      text: 'hello',
      time: 1250,
      mode: 0,
      color: '#FF0000',
      sources: ['bilibili', 'tencent', 'iqiyi'],
    }])
  })

  it('returns an explicit unavailable empty response', () => {
    expect(emptyDanmuResponse()).toEqual({
      available: false,
      count: 0,
      comments: [],
      sourceCounts: [],
    })
  })

  it('returns an unavailable response without calling an unconfigured upstream', async () => {
    const upstreamFetch = vi.fn()
    vi.stubEnv('DANMU_API_BASE', '')
    vi.stubEnv('DANMU_API_TOKEN', '')
    vi.stubGlobal('fetch', upstreamFetch)
    try {
      await expect(fetchAggregatedDanmu({ title: 'My Anime', episode: 1 })).resolves.toEqual({
        available: false,
        count: 0,
        comments: [],
        sourceCounts: [],
      })
      expect(upstreamFetch).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  })

  it('matches an episode then loads its comments through the token path', async () => {
    const upstreamFetch = vi.fn()
    vi.stubEnv('DANMU_API_BASE', 'https://danmu.example.test')
    vi.stubEnv('DANMU_API_TOKEN', 'secret-token')
    vi.stubGlobal('fetch', upstreamFetch)
    upstreamFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ matches: [{ episodeId: 42 }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ comments: [{ p: '2,1,25,255', m: 'hello' }] }), {
          status: 200,
        }),
      )

    try {
      const result = await fetchAggregatedDanmu({ title: 'My Anime', episode: 3 })
      expect(result.count).toBe(1)
      expect(upstreamFetch).toHaveBeenCalledTimes(2)
      expect(upstreamFetch.mock.calls[0][0]).toBe(
        'https://danmu.example.test/secret-token/api/v2/match',
      )
      expect(JSON.parse(upstreamFetch.mock.calls[0][1].body)).toEqual({
        fileName: 'My Anime S01E03',
      })
      expect(upstreamFetch.mock.calls[1][0]).toBe(
        'https://danmu.example.test/secret-token/api/v2/comment/42?format=json',
      )
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  })

  it('retries temporary upstream failures before loading comments', async () => {
    const upstreamFetch = vi.fn()
    vi.stubEnv('DANMU_API_BASE', 'https://danmu.example.test')
    vi.stubEnv('DANMU_API_TOKEN', 'secret-token')
    vi.stubEnv('DANMU_API_RETRY_DELAY_MS', '0')
    vi.stubGlobal('fetch', upstreamFetch)
    upstreamFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ errorMessage: 'bad gateway' }), { status: 502 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ matches: [{ episodeId: 42 }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ comments: [{ p: '2,1,25,255', m: 'hello' }] }), {
          status: 200,
        }),
      )

    try {
      await expect(fetchAggregatedDanmu({ title: 'My Anime', episode: 1 })).resolves.toMatchObject({
        available: true,
        count: 1,
      })
      expect(upstreamFetch).toHaveBeenCalledTimes(3)
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  })

  it('deduplicates concurrent requests and caches the result', async () => {
    const upstreamFetch = vi.fn()
    vi.stubEnv('DANMU_API_BASE', 'https://danmu.example.test')
    vi.stubEnv('DANMU_API_TOKEN', 'secret-token')
    vi.stubEnv('DANMU_API_CACHE_TTL_MS', '60000')
    vi.stubGlobal('fetch', upstreamFetch)
    upstreamFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ matches: [{ episodeId: 42 }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ comments: [{ p: '2,1,25,255', m: 'hello' }] }), {
          status: 200,
        }),
      )

    try {
      const options = { title: 'Cached Anime', episode: 1 }
      const [first, second] = await Promise.all([
        fetchAggregatedDanmu(options),
        fetchAggregatedDanmu(options),
      ])
      const third = await fetchAggregatedDanmu(options)
      expect(first.count).toBe(1)
      expect(second.count).toBe(1)
      expect(third.count).toBe(1)
      expect(upstreamFetch).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  })
})
