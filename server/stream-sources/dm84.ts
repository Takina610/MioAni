import type { Page } from 'playwright'
import type { AnimeStreamProvider, EpisodeInfo, EpisodesResult, InternalStream, ResolveRequest } from './types.js'
import { classifyMediaUrl, interceptMedia, pickBestMedia, withPage } from './browser.js'
import { loadRule } from './rules.js'
import { parseEpisodeIndex, pickBestMatch, uniqueQueries } from './match.js'
import { createTtlCache, workCacheKey } from './work-cache.js'

const DEBUG = () => process.env.PLAYBACK_DEBUG === '1'
const BASE = 'https://dmbus.cc/'

interface Dm84Work {
  detailUrl: string
  episodes: EpisodeInfo[]
}

/** Cross-episode: keyword → detail + episode play URLs. */
const workCache = createTtlCache<Dm84Work>({ maxSize: 60 })

async function collectLinks(page: Page): Promise<Array<{ href: string; text: string }>> {
  return page.$$eval('a[href]', (as) =>
    as
      .map((a) => ({
        href: (a as HTMLAnchorElement).href,
        text: ((a as HTMLAnchorElement).textContent || '').trim().slice(0, 120),
      }))
      .filter((x) => x.href && x.text && x.text.length > 0),
  )
}

function isDetailCandidate(href: string, text: string): boolean {
  if (/search|javascript:|void\(0\)/i.test(href)) return false
  return /detail|vod|anime|bangumi|\/play|\/video|\/movie/i.test(href) || text.length >= 2
}

function isEpisodeLink(href: string, text: string): boolean {
  if (/javascript:|void\(0\)|search/i.test(href)) return false
  return (
    /第?\s*\d+\s*集|EP\s*\d+|\b\d{1,3}\b|全集|OAD|OVA/i.test(text) ||
    /play|episode|e-\d|\/ep\//i.test(href)
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function findDetailAndEpisodes(
  page: Page,
  queries: string[],
): Promise<Dm84Work | null> {
  const key = workCacheKey(queries)
  const cached = workCache.get(key)
  if (cached) {
    if (DEBUG()) console.log('[DM84] work cache hit', key)
    return cached
  }

  const rule = loadRule('DM84.json')
  let detailUrl = ''
  let episodes: EpisodeInfo[] = []

  for (const q of queries) {
    const searchUrl = (rule.searchURL || `${BASE}s----------.html?wd=@keyword`).replaceAll(
      '@keyword',
      encodeURIComponent(q),
    )
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await sleep(800)

    const links = await collectLinks(page)
    const candidates = links.filter((l) => isDetailCandidate(l.href, l.text) && !l.href.includes('search'))
    const pick = pickBestMatch(candidates, (c) => c.text, queries) || candidates[0]
    if (!pick) continue

    detailUrl = pick.href
    await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await sleep(600)

    const epLinks = (await collectLinks(page)).filter((l) => isEpisodeLink(l.href, l.text))
    const seen = new Set<string>()
    const raw: EpisodeInfo[] = []
    for (const e of epLinks) {
      if (seen.has(e.href)) continue
      seen.add(e.href)
      const idx = parseEpisodeIndex(e.text, e.href) || raw.length + 1
      raw.push({ index: idx, label: e.text || `第${idx}集`, url: e.href })
    }
    const byIndex = new Map<number, EpisodeInfo>()
    for (const e of raw) {
      if (!byIndex.has(e.index)) byIndex.set(e.index, e)
    }
    episodes = [...byIndex.values()].sort((a, b) => a.index - b.index)
    if (episodes.length) break
  }

  if (!detailUrl || !episodes.length) return null
  const work: Dm84Work = { detailUrl, episodes }
  workCache.set(key, work)
  return work
}

export const dm84Provider: AnimeStreamProvider = {
  id: 'DM84',

  async listEpisodes(req): Promise<EpisodesResult | null> {
    const queries = uniqueQueries(req.title, req.alt)
    try {
      return await withPage(async (page) => {
        const found = await findDetailAndEpisodes(page, queries)
        if (!found) return null
        return {
          episodeCount: found.episodes.length,
          episodes: found.episodes.map(({ index, label }) => ({ index, label })),
          provider: 'DM84',
        }
      })
    } catch (e) {
      if (DEBUG()) console.log('[DM84] listEpisodes error', e)
      return null
    }
  },

  async resolve(req: ResolveRequest): Promise<InternalStream | null> {
    const queries = uniqueQueries(req.title, req.alt)
    if (DEBUG()) console.log('[DM84] resolve', queries[0], 'ep', req.episode)

    try {
      return await withPage(async (page) => {
        const found = await findDetailAndEpisodes(page, queries)
        if (!found) {
          if (DEBUG()) console.log('[DM84] no detail/episodes')
          return null
        }
        const target =
          found.episodes.find((e) => e.index === req.episode) ||
          found.episodes[req.episode - 1] ||
          null
        if (!target?.url) {
          if (DEBUG()) console.log('[DM84] episode missing', req.episode)
          return null
        }
        if (DEBUG()) console.log('[DM84] episode page', target.url)
        const media = await interceptMedia(page, target.url)
        const url = pickBestMedia(media.found)
        if (!url) {
          if (DEBUG()) console.log('[DM84] no media', media.error)
          return null
        }
        return {
          url,
          kind: classifyMediaUrl(url),
          provider: 'DM84',
          episodeCount: found.episodes.length,
        }
      })
    } catch (e) {
      if (DEBUG()) console.log('[DM84] resolve error', e)
      return null
    }
  },
}
