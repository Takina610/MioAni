import type { Page } from 'playwright'
import type {
  AnimeStreamProvider,
  EpisodeInfo,
  EpisodesResult,
  InternalStream,
  ResolveRequest,
} from './types.js'
import {
  classifyMediaUrl,
  interceptMedia,
  pickBestMedia,
  UA,
  withPage,
} from './browser.js'
import { parseEpisodeIndex, pickBestMatch, uniqueQueries } from './match.js'
import { createTtlCache, workCacheKey } from './work-cache.js'

const DEBUG = () => process.env.PLAYBACK_DEBUG === '1'
const BASE = 'https://www.ezdmw.org'

interface EzdmwWork {
  bangumiUrl: string
  episodes: EpisodeInfo[]
}

/** Cross-episode: keyword → bangumi + episode video URLs. */
const workCache = createTtlCache<EzdmwWork>({ maxSize: 60 })

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function absUrl(href: string, base = BASE): string {
  try {
    return new URL(href, base).toString()
  } catch {
    return href
  }
}

/** HTTP search — prefer search_some (bangumi catalog) over community search.html. */
async function searchBangumiLinksHttp(
  keyword: string,
): Promise<Array<{ href: string; text: string }>> {
  const endpoints = [
    `${BASE}/Index/search_some.html?searchText=${encodeURIComponent(keyword)}&page=0`,
    `${BASE}/Index/search.html?searchText=${encodeURIComponent(keyword)}`,
  ]
  const found: Array<{ href: string; text: string }> = []
  const seen = new Set<string>()

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          Referer: `${BASE}/`,
        },
        signal: AbortSignal.timeout(12000),
        redirect: 'follow',
      })
      if (!res.ok) continue
      const html = await res.text()
      // <a href="/Index/bangumi/76634.html">葬送的芙莉莲 更至38话...</a>
      const re =
        /<a[^>]+href=["']([^"']*\/Index\/bangumi\/\d+\.html[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
      let m: RegExpExecArray | null
      while ((m = re.exec(html)) !== null) {
        const href = absUrl(m[1])
        const text = m[2]
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120)
        if (!text || seen.has(href)) continue
        seen.add(href)
        found.push({ href, text })
      }
      if (found.length) break
    } catch (e) {
      if (DEBUG()) console.log('[ezdmw] search http fail', url, e)
    }
  }
  return found
}

async function collectBangumiLinksFromPage(
  page: Page,
): Promise<Array<{ href: string; text: string }>> {
  return page.$$eval('a[href*="/Index/bangumi/"]', (as) =>
    as
      .map((a) => ({
        href: (a as HTMLAnchorElement).href,
        text: ((a as HTMLAnchorElement).textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
      }))
      .filter((x) => x.href && /\/Index\/bangumi\/\d+\.html/i.test(x.href) && x.text),
  )
}

async function parseEpisodesFromBangumi(page: Page, bangumiUrl: string): Promise<EpisodeInfo[]> {
  await page.goto(bangumiUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
  await sleep(500)

  const raw = await page.$$eval('a[href*="/Index/video/"]', (as) =>
    as
      .map((a) => ({
        href: (a as HTMLAnchorElement).href,
        text: ((a as HTMLAnchorElement).textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
      }))
      .filter((x) => x.href && /\/Index\/video\/\d+\.html/i.test(x.href)),
  )

  const byIndex = new Map<number, EpisodeInfo>()
  for (const e of raw) {
    // Episode label is typically bare number "1".."38"
    const idx = parseEpisodeIndex(e.text, e.href)
    if (idx == null) continue
    if (!byIndex.has(idx)) {
      byIndex.set(idx, {
        index: idx,
        label: e.text || `第${idx}集`,
        url: e.href,
      })
    }
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index)
}

async function findWork(page: Page, queries: string[]): Promise<EzdmwWork | null> {
  const key = workCacheKey(queries)
  const cached = workCache.get(key)
  if (cached) {
    if (DEBUG()) console.log('[ezdmw] work cache hit', key)
    return cached
  }

  let bangumiUrl = ''
  let episodes: EpisodeInfo[] = []

  for (const q of queries) {
    // 1) HTTP search first (fast, no browser for catalog)
    let candidates = await searchBangumiLinksHttp(q)

    // 2) Browser fallback if HTML parse missed (JS-rendered)
    if (!candidates.length) {
      for (const path of [
        `/Index/search_some.html?searchText=${encodeURIComponent(q)}&page=0`,
        `/Index/search.html?searchText=${encodeURIComponent(q)}`,
      ]) {
        await page.goto(`${BASE}${path}`, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        })
        await sleep(600)
        candidates = await collectBangumiLinksFromPage(page)
        if (candidates.length) break
      }
    }

    if (!candidates.length) continue

    const pick = pickBestMatch(candidates, (c) => c.text, queries) || candidates[0]
    if (!pick) continue

    bangumiUrl = pick.href
    if (DEBUG()) console.log('[ezdmw] bangumi', bangumiUrl, pick.text.slice(0, 40))

    episodes = await parseEpisodesFromBangumi(page, bangumiUrl)
    if (episodes.length) break
  }

  if (!bangumiUrl || !episodes.length) return null
  const work: EzdmwWork = { bangumiUrl, episodes }
  workCache.set(key, work)
  return work
}

/**
 * Open video page; intercept listres (disguised m3u8) or classic media.
 * Prefer HLS listres URL; fallback embed player iframe only if no playlist found.
 */
async function resolveEpisodeStream(
  page: Page,
  episodeUrl: string,
): Promise<{ url: string; kind: 'hls' | 'progressive' | 'embed' } | null> {
  const media = await interceptMedia(page, episodeUrl)
  const url = pickBestMedia(media.found)
  if (url) {
    return { url, kind: classifyMediaUrl(url) }
  }

  // Fallback: extract player iframe (danmuku) — last resort embed
  try {
    const iframeSrc = await page.evaluate(() => {
      const f =
        document.querySelector<HTMLIFrameElement>('iframe[src*="player.ezdmw"]') ||
        document.querySelector<HTMLIFrameElement>('iframe[src*="danmuku"]') ||
        document.querySelector<HTMLIFrameElement>('iframe[src*="player.danmuzf"]') ||
        document.querySelector<HTMLIFrameElement>('iframe[src*="player"]')
      return f?.src || null
    })
    if (iframeSrc && /^https?:/i.test(iframeSrc)) {
      if (DEBUG()) console.log('[ezdmw] embed fallback', iframeSrc.slice(0, 80))
      // Try opening player frame to catch listres once more
      try {
        const playerMedia = await interceptMedia(page, iframeSrc, 12000)
        const playerUrl = pickBestMedia(playerMedia.found)
        if (playerUrl) {
          return { url: playerUrl, kind: classifyMediaUrl(playerUrl) }
        }
      } catch {
        /* ignore */
      }
      return { url: iframeSrc, kind: 'embed' }
    }
  } catch {
    /* ignore */
  }

  if (DEBUG()) console.log('[ezdmw] no media', media.error)
  return null
}

export const ezdmwProvider: AnimeStreamProvider = {
  id: 'ezdmw',

  async listEpisodes(req): Promise<EpisodesResult | null> {
    const queries = uniqueQueries(req.title, req.alt)
    try {
      return await withPage(async (page) => {
        const work = await findWork(page, queries)
        if (!work) return null
        return {
          episodeCount: work.episodes.length,
          episodes: work.episodes.map(({ index, label }) => ({ index, label })),
          provider: 'ezdmw',
        }
      })
    } catch (e) {
      if (DEBUG()) console.log('[ezdmw] listEpisodes error', e)
      return null
    }
  },

  async resolve(req: ResolveRequest): Promise<InternalStream | null> {
    const queries = uniqueQueries(req.title, req.alt)
    if (DEBUG()) console.log('[ezdmw] resolve', queries[0], 'ep', req.episode)

    try {
      return await withPage(async (page) => {
        const work = await findWork(page, queries)
        if (!work) {
          if (DEBUG()) console.log('[ezdmw] no bangumi/episodes')
          return null
        }
        const target =
          work.episodes.find((e) => e.index === req.episode) ||
          work.episodes[req.episode - 1] ||
          null
        if (!target?.url) {
          if (DEBUG()) console.log('[ezdmw] episode missing', req.episode)
          return null
        }
        if (DEBUG()) console.log('[ezdmw] episode page', target.url)

        const stream = await resolveEpisodeStream(page, target.url)
        if (!stream) return null

        return {
          url: stream.url,
          kind: stream.kind,
          provider: 'ezdmw',
          episodeCount: work.episodes.length,
        }
      })
    } catch (e) {
      if (DEBUG()) console.log('[ezdmw] resolve error', e)
      return null
    }
  },
}
