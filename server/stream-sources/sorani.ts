import type { AnimeStreamProvider, EpisodesResult, InternalStream, ResolveRequest } from './types.js'
import { classifyMediaUrl, interceptMedia, pickBestMedia, UA, withPage } from './browser.js'
import { loadRule } from './rules.js'
import { pickBestMatch, uniqueQueries } from './match.js'
import { createTtlCache, workCacheKey } from './work-cache.js'

interface SoraniRecord {
  id: string | number
  title?: string
}

interface SoraniEpisode {
  episodeLabel?: string
  episodeOrder?: number
}

interface SoraniWork {
  recordId: string | number
  episodes: SoraniEpisode[]
}

const DEBUG = () => process.env.PLAYBACK_DEBUG === '1'

/** Cross-episode work cache: keyword → record + episode list (skips re-search/API). */
const workCache = createTtlCache<SoraniWork>({ maxSize: 60 })

async function searchRecords(keyword: string): Promise<SoraniRecord[]> {
  const rule = loadRule('sorani.json')
  const cfg = rule.searchApiConfig
  if (!cfg?.request?.url) return []
  const searchUrl = new URL(cfg.request.url)
  for (const [k, v] of Object.entries(cfg.request.query || {})) {
    searchUrl.searchParams.set(k, String(v).replaceAll('@keyword', keyword))
  }
  const res = await fetch(searchUrl, {
    headers: { 'User-Agent': UA, Accept: 'application/json', Referer: rule.referer || rule.baseURL },
    signal: AbortSignal.timeout(12000),
  })
  if (!res.ok) return []
  const json = (await res.json()) as { data?: { records?: SoraniRecord[] } }
  return json?.data?.records || []
}

async function fetchEpisodes(id: string | number): Promise<SoraniEpisode[]> {
  const res = await fetch(`https://api.sorani.cc/sorani-cms/api/video/${id}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://www.sorani.net/' },
    signal: AbortSignal.timeout(12000),
  })
  if (!res.ok) return []
  const json = (await res.json()) as { data?: { episodes?: SoraniEpisode[] } }
  return json?.data?.episodes || []
}

async function findBestRecord(queries: string[]): Promise<SoraniRecord | null> {
  for (const q of queries) {
    const records = await searchRecords(q)
    if (!records.length) continue
    const pick = pickBestMatch(records, (r) => r.title || '', queries)
    if (pick?.id != null) return pick
  }
  return null
}

async function resolveWork(queries: string[]): Promise<SoraniWork | null> {
  const key = workCacheKey(queries)
  const cached = workCache.get(key)
  if (cached) {
    if (DEBUG()) console.log('[sorani] work cache hit', key)
    return cached
  }

  const record = await findBestRecord(queries)
  if (!record?.id) return null
  const episodes = await fetchEpisodes(record.id)
  if (!episodes.length) return null

  const work: SoraniWork = { recordId: record.id, episodes }
  workCache.set(key, work)
  return work
}

export const soraniProvider: AnimeStreamProvider = {
  id: 'sorani',

  async listEpisodes(req): Promise<EpisodesResult | null> {
    const queries = uniqueQueries(req.title, req.alt)
    const work = await resolveWork(queries)
    if (!work) return null
    return {
      episodeCount: work.episodes.length,
      episodes: work.episodes.map((e, i) => ({
        index: e.episodeOrder || i + 1,
        label: e.episodeLabel || `第${e.episodeOrder || i + 1}集`,
      })),
      provider: 'sorani',
    }
  },

  async resolve(req: ResolveRequest): Promise<InternalStream | null> {
    const queries = uniqueQueries(req.title, req.alt)
    if (DEBUG()) console.log('[sorani] resolve', queries[0], 'ep', req.episode)

    const work = await resolveWork(queries)
    if (!work) {
      if (DEBUG()) console.log('[sorani] no search hit')
      return null
    }

    const { recordId, episodes: eps } = work
    const target =
      eps.find((e) => Number(e.episodeOrder) === req.episode) ||
      eps[req.episode - 1] ||
      null
    if (!target?.episodeOrder) {
      if (DEBUG()) console.log('[sorani] episode not found', req.episode, 'of', eps.length)
      return null
    }

    const epUrl = `https://www.sorani.net/anime/mal/${recordId}/episode/${target.episodeOrder}`
    if (DEBUG()) console.log('[sorani] episode page', epUrl)

    try {
      const media = await withPage(async (page) => interceptMedia(page, epUrl))
      const url = pickBestMedia(media.found)
      if (!url) {
        if (DEBUG()) console.log('[sorani] no media', media.error)
        return null
      }
      return {
        url,
        kind: classifyMediaUrl(url),
        provider: 'sorani',
        episodeCount: eps.length,
      }
    } catch (e) {
      if (DEBUG()) console.log('[sorani] intercept error', e)
      return null
    }
  },
}
