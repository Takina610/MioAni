import { apiConfig, authHeaders } from '../config/api'
import type { Anime } from '../types/anime'
import type { PersonComment } from '../types/anime'
import { normalizeTitleKey } from '../utils/animeIdentity'
import { fetchBangumiPageHtml, pageItems, parseBangumiMonoHtmlComments, type PersonExtraPage } from './person'

const BANGUMI_API_TIMEOUT_MS = 15_000
const EP_META_CACHE_TTL_MS = 30 * 60 * 1000
const EP_META_STORAGE_PREFIX = 'mioani:bgm-ep-meta:'

export interface BangumiEpisodeMeta {
  /** Bangumi episode id (used by the ep page / comments). */
  id: number
  /** 1-based episode number (Bangumi `sort`). */
  sort: number
  name?: string
  nameCn?: string
  /** Airing date `YYYY-MM-DD`; future dates mark not-yet-aired placeholders. */
  airdate?: string
}

interface CachedMeta {
  at: number
  value: BangumiEpisodeMeta[]
}

const epMetaCache = new Map<number, CachedMeta>()

function bangumiHeaders(): Record<string, string> {
  return { Accept: 'application/json', ...authHeaders(apiConfig.bangumiToken) }
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = BANGUMI_API_TIMEOUT_MS): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
}

/**
 * Bangumi subject id from the anime identity (`bgm-{n}`), including linked ids.
 * Returns null when the anime is not linked to a Bangumi subject yet.
 */
export function bangumiSubjectIdFromAnime(anime: Pick<Anime, 'id' | 'linkedIds'>): number | null {
  for (const id of [anime.id, ...(anime.linkedIds || [])]) {
    const match = /^bgm-(\d+)$/i.exec(String(id || '').trim())
    if (match) return Number(match[1])
  }
  return null
}

function loadCachedMeta(subjectId: number): BangumiEpisodeMeta[] | null {
  const memory = epMetaCache.get(subjectId)
  if (memory && Date.now() - memory.at < EP_META_CACHE_TTL_MS) return memory.value
  if (memory) epMetaCache.delete(subjectId)
  try {
    const raw = localStorage.getItem(`${EP_META_STORAGE_PREFIX}${subjectId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedMeta
    if (!parsed?.value || !Array.isArray(parsed.value) || !parsed.at) return null
    if (Date.now() - parsed.at >= EP_META_CACHE_TTL_MS) return null
    epMetaCache.set(subjectId, parsed)
    return parsed.value
  } catch {
    return null
  }
}

function saveCachedMeta(subjectId: number, value: BangumiEpisodeMeta[]) {
  const entry: CachedMeta = { at: Date.now(), value }
  epMetaCache.set(subjectId, entry)
  try {
    localStorage.setItem(`${EP_META_STORAGE_PREFIX}${subjectId}`, JSON.stringify(entry))
  } catch {
    // quota / private mode — memory cache still holds this session
  }
}

/** Longest common substring length (loose title matching for 漏字/别字). */
function lcsLength(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp = new Array<number>(n + 1).fill(0)
  let best = 0
  for (let i = 1; i <= m; i += 1) {
    let prev = 0
    for (let j = 1; j <= n; j += 1) {
      const next = dp[j]
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev + 1
        if (dp[j] > best) best = dp[j]
      } else {
        dp[j] = 0
      }
      prev = next
    }
  }
  return best
}

function bangumiTitleKeysMatch(candidateKeys: string[], animeKeys: string[]): boolean {
  for (const candidate of candidateKeys) {
    for (const key of animeKeys) {
      if (!candidate || !key) continue
      if (candidate === key) return true
      // Season/cour suffixes: one title contains the other with a bounded length gap.
      const shorter = candidate.length <= key.length ? candidate : key
      const longer = candidate.length <= key.length ? key : candidate
      if (shorter.length >= 4 && longer.includes(shorter)) return true
      // Missing/miswritten characters: long common substring (>= 60% of the shorter title).
      if (
        lcsLength(candidate, key)
          >= Math.max(5, Math.min(candidate.length, key.length) * 0.6)
      ) {
        return true
      }
    }
  }
  return false
}

/** Search Bangumi for the subject id by title; prefers exact normalized title + year match. */
export async function searchBangumiSubjectId(anime: Pick<Anime, 'title' | 'originalTitle' | 'titles' | 'year'>): Promise<number | null> {
  const keywords = [
    anime.titles?.cn,
    anime.title,
    anime.originalTitle,
    anime.titles?.en,
    anime.titles?.romaji,
    anime.titles?.native,
  ]
    .map((s) => (s || '').trim())
    .filter(Boolean)
  const animeKeys = [
    anime.title,
    anime.originalTitle,
    anime.titles?.cn,
    anime.titles?.en,
    anime.titles?.romaji,
    anime.titles?.native,
  ]
    .map(normalizeTitleKey)
    .filter(Boolean)

  for (const keyword of [...new Set(keywords)]) {
    try {
      const response = await fetchWithTimeout(`${apiConfig.bangumiBase}/v0/search/subjects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...bangumiHeaders() },
        body: JSON.stringify({ keyword, sort: 'match', filter: { type: [2] } }),
      })
      if (!response.ok) continue
      const payload = await response.json().catch(() => null) as { data?: Array<Record<string, unknown>> } | null
      const candidates = (payload?.data || []).filter((item) => {
        const keys = [item.name_cn, item.name]
          .map((s) => normalizeTitleKey(typeof s === 'string' ? s : ''))
          .filter(Boolean)
        return bangumiTitleKeysMatch(keys, animeKeys)
      })
      const year = anime.year || 0
      const byYear = year
        ? candidates.filter((item) => {
            const date = String(item.date || item.air_date || '')
            const itemYear = Number(/^(\d{4})/.exec(date)?.[1])
            return Number.isFinite(itemYear) && itemYear > 0 && Math.abs(itemYear - year) <= 1
          })
        : []
      const pick = byYear[0] || candidates[0]
      const rawId = pick?.id ?? pick?.subject_id
      if (rawId != null) return Number(rawId)
    } catch {
      // try next keyword
    }
  }
  return null
}

async function fetchBangumiEpisodeMetaRaw(subjectId: number): Promise<BangumiEpisodeMeta[]> {
  const url = `${apiConfig.bangumiBase}/v0/episodes?subject_id=${encodeURIComponent(subjectId)}&type=0&limit=200`
  const response = await fetchWithTimeout(url, { headers: bangumiHeaders() })
  if (!response.ok) throw new Error(`Bangumi 章节接口 ${response.status}`)
  const payload = await response.json() as {
    data?: Array<{ id?: unknown; sort?: unknown; name?: unknown; name_cn?: unknown; airdate?: unknown }>
  }
  const list = (payload.data || [])
    .filter((ep) => Number.isFinite(Number(ep.id)) && Number.isFinite(Number(ep.sort)))
    .map((ep) => ({
      id: Number(ep.id),
      sort: Number(ep.sort),
      name: typeof ep.name === 'string' && ep.name ? ep.name : undefined,
      nameCn: typeof ep.name_cn === 'string' && ep.name_cn ? ep.name_cn : undefined,
      airdate: typeof ep.airdate === 'string' && ep.airdate ? ep.airdate : undefined,
    }))
    .sort((a, b) => a.sort - b.sort)
  return list
}

function localToday(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Resolve the Bangumi subject id for an anime (direct link first, then search). */
async function resolveBangumiSubjectId(anime: Parameters<typeof fetchBangumiEpisodeMeta>[0]): Promise<number | null> {
  return bangumiSubjectIdFromAnime(anime) ?? searchBangumiSubjectId(anime)
}

/**
 * Episode metadata (Bangumi ep ids + names) for an anime, cached 30 minutes.
 * Future-dated placeholder episodes (not yet aired) are dropped so a weekly
 * show reports only the episodes that are actually available.
 * Returns [] when the anime has no resolvable Bangumi subject.
 */
export async function fetchBangumiEpisodeMeta(anime: Pick<Anime, 'id' | 'linkedIds' | 'title' | 'originalTitle' | 'titles' | 'year'>): Promise<BangumiEpisodeMeta[]> {
  const subjectId = await resolveBangumiSubjectId(anime)
  if (subjectId == null) return []
  const cached = loadCachedMeta(subjectId)
  if (cached) return cached
  const today = localToday()
  const list = (await fetchBangumiEpisodeMetaRaw(subjectId)).filter(
    (ep) => !ep.airdate || ep.airdate <= today,
  )
  if (list.length) saveCachedMeta(subjectId, list)
  return list
}

/**
 * Paged Bangumi comments for one episode, reusing the person-page parser.
 * Returns null when this anime has no Bangumi episode link (caller shows the empty state).
 */
export async function fetchEpisodeComments(
  anime: Pick<Anime, 'id' | 'linkedIds' | 'title' | 'originalTitle' | 'titles' | 'year'>,
  episode: number,
  page = 1,
  pageSize = 20,
): Promise<PersonExtraPage<PersonComment> | null> {
  const meta = await fetchBangumiEpisodeMeta(anime)
  const target = meta.find((ep) => ep.sort === episode)
  if (!target) return null
  const html = await fetchBangumiPageHtml(`ep/${target.id}`)
  if (!html) throw new Error('吐槽页面加载失败')
  const comments = parseBangumiMonoHtmlComments(html)
  return pageItems(comments, page, pageSize)
}

/**
 * Paged Bangumi comments for the anime's subject page (`/subject/{id}/comments`),
 * the same 吐槽箱 structure as episode/person pages.
 */
export async function fetchSubjectComments(
  anime: Pick<Anime, 'id' | 'linkedIds' | 'title' | 'originalTitle' | 'titles' | 'year'>,
  page = 1,
  pageSize = 20,
): Promise<PersonExtraPage<PersonComment> | null> {
  const subjectId = await resolveBangumiSubjectId(anime)
  if (subjectId == null) return null
  const html = await fetchBangumiPageHtml(`subject/${subjectId}/comments`)
  if (!html) throw new Error('吐槽页面加载失败')
  const comments = parseBangumiMonoHtmlComments(html)
  return pageItems(comments, page, pageSize)
}
