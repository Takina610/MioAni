import { apiConfig, authHeaders } from '../config/api'
import {
  BANGUMI_TIMEOUT_MS,
  DISCOVER_PAGE_SIZE,
  FALLBACK_ANILIST_GENRES,
  FALLBACK_BANGUMI_GENRES,
} from '../constants/discover'
import {
  bangumiNeedsPrecisionGather,
  buildAniListVariables,
  buildBangumiSearchBody,
  mapAniListLanguageCode,
  softFilterBangumiStatus,
} from './discoverFilters'
import {
  buildAniListCharacterId,
  buildAniListStaffId,
  buildBgmCharacterId,
  buildBgmPersonId,
} from './personIds'
import type { Anime, AnimeDetail, ImportResult, WatchStatus } from '../types/anime'
import type {
  DiscoverFilters,
  DiscoverGenreOption,
  DiscoverPageRequest,
  DiscoverPageResult,
  DiscoverSource,
} from '../types/discover'

export {
  aniListStatus,
  bangumiNeedsPrecisionGather,
  buildAniListVariables,
  buildBangumiSearchBody,
  classifyBangumiAirStatus,
  softFilterBangumiStatus,
} from './discoverFilters'

const statusMap: Record<string, WatchStatus> = {
  CURRENT: 'watching', COMPLETED: 'completed', PLANNING: 'planned', PAUSED: 'paused', DROPPED: 'dropped',
}

function cleanText(value?: string): string {
  return value?.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() ?? ''
}

function formatAiring(seconds?: number): string | undefined {
  if (!seconds) return undefined
  const days = Math.floor(seconds / 86400)
  if (days) return `${days} 天后更新`
  const hours = Math.max(1, Math.floor(seconds / 3600))
  return `${hours} 小时后更新`
}

async function aniListRequest(query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(apiConfig.aniListBase, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeaders(apiConfig.aniListToken) },
    body: JSON.stringify({ query, variables }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.errors) throw new Error(payload?.errors?.[0]?.message ?? 'AniList 服务暂时不可用')
  return payload.data
}

function mapAniList(media: any, entry?: any): Anime {
  const titles = {
    en: media.title?.english || undefined,
    romaji: media.title?.romaji || undefined,
    native: media.title?.native || undefined,
  }
  return {
    id: `anilist-${media.id}`,
    source: 'anilist',
    // Prefer native for CJK users; still keep english/romaji in titles for matching.
    title: media.title?.native || media.title?.english || media.title?.romaji,
    originalTitle: media.title?.romaji || media.title?.native || media.title?.english || '',
    titles,
    image: media.coverImage.extraLarge,
    banner: media.bannerImage || undefined,
    score: media.averageScore ? media.averageScore / 10 : entry?.score || 0,
    year: media.seasonYear || 0,
    season: media.season || '',
    episodes: media.episodes || 0,
    watched: entry?.progress || 0,
    status: statusMap[entry?.status] ?? 'planned',
    tags: media.genres?.slice(0, 3) || [],
    summary: '',
    nextEpisode: formatAiring(media.nextAiringEpisode?.timeUntilAiring),
    popularity: media.popularity || 0,
  }
}

const mediaFields = `id title { romaji native english } coverImage { extraLarge } bannerImage averageScore popularity seasonYear season episodes genres nextAiringEpisode { episode timeUntilAiring }`

function currentSeason() {
  const month = new Date().getMonth() + 1
  if (month <= 3) return 'WINTER'
  if (month <= 6) return 'SPRING'
  if (month <= 9) return 'SUMMER'
  return 'FALL'
}

export async function fetchAniListSeasonal(limit = 50): Promise<Anime[]> {
  const query = `query ($perPage: Int, $season: MediaSeason, $year: Int) { Page(page: 1, perPage: $perPage) { media(type: ANIME, season: $season, seasonYear: $year, sort: TRENDING_DESC, isAdult: false) { ${mediaFields} } } }`
  const data = await aniListRequest(query, { perPage: limit, season: currentSeason(), year: new Date().getFullYear() })
  return data.Page.media.map((media: any) => mapAniList(media))
}

export async function importAniList(username: string): Promise<ImportResult> {
  const query = `query ($name: String) { MediaListCollection(userName: $name, type: ANIME) { lists { entries { status progress score media { ${mediaFields} } } } } }`
  const data = await aniListRequest(query, { name: username })
  const entries = data.MediaListCollection.lists.flatMap((list: any) => list.entries)
  return { source: 'anilist', items: entries.map((entry: any) => mapAniList(entry.media, entry)), username }
}

function bangumiHeaders(): Record<string, string> {
  return { Accept: 'application/json', ...authHeaders(apiConfig.bangumiToken) }
}

function bangumiTagNames(item: any): string[] {
  const fromTags = (item.tags || [])
    .map((tag: any) => (typeof tag === 'string' ? tag : tag?.name))
    .filter(Boolean)
  const fromMeta = (item.meta_tags || []).filter((tag: any) => typeof tag === 'string')
  // Keep enough tags for precise client-side genre filtering (API tag filter is loose).
  return [...new Set([...fromMeta, ...fromTags])].slice(0, 40)
}

function mapBangumi(item: any): Anime {
  return {
    id: `bgm-${item.id ?? item.subject_id}`,
    source: 'bangumi',
    title: item.name_cn || item.name,
    originalTitle: item.name,
    titles: {
      cn: item.name_cn || undefined,
      native: item.name || undefined,
    },
    image: (item.images?.large || '').replace('http://', 'https://'),
    score: item.rating?.score || item.score || 0,
    year: Number((item.air_date || item.date)?.slice(0, 4)) || 0,
    season: item.platform || '',
    episodes: item.eps || item.total_episodes || 0,
    watched: item.ep_status || 0,
    status: 'planned',
    tags: bangumiTagNames(item),
    summary: cleanText(item.summary || item.short_summary),
    popularity: item.collection?.doing || 0,
  }
}

/**
 * Bangumi format is a native platform/tag string (TV / 剧场版 / OVA …).
 * API: merge into filter.tag; client: soft-check platform when present.
 */
function hardFilterBangumiFormat(items: Anime[], format: string | null): Anime[] {
  if (!format) return items
  const f = format.trim().toLowerCase()
  return items.filter((item) => {
    const platform = (item.season || '').trim().toLowerCase()
    if (!platform) return true // tag prefilter already applied
    // Exact or contains (WEB vs TV 等)
    if (platform === f) return true
    if (f === 'tv' && /tv|web|动画/.test(platform)) return true
    if (f === 'web' && /web|ona|网/.test(platform)) return true
    if ((f === '剧场版' || f === 'movie') && /剧场|movie|映画/.test(platform)) return true
    if (f === 'ova' && /ova/.test(platform)) return true
    if (f === 'oad' && /oad/.test(platform)) return true
    return platform.includes(f) || f.includes(platform)
  })
}

/**
 * Soft client check after Bangumi language tag prefilter.
 * Missing tags still keep the row (tag API already narrowed the pool).
 */
function softFilterBangumiLanguage(items: Anime[], language: string | null): Anime[] {
  if (!language) return items
  const key = language.trim().toLowerCase()
  if (key === 'ja' || key === 'jp') return items
  return items.filter((item) => {
    const tags = (item.tags || []).join(' ')
    const blob = `${item.title} ${item.originalTitle} ${tags}`
    // Tag prefilter already applied — keep rows with empty tags
    if (!tags) return true
    if (key === 'ko' || key === 'kr') {
      return /韩国|韩语|korean|한국/i.test(blob)
    }
    if (key === 'en' || key === 'us' || key === 'gb') {
      return /美国|英国|英语|english|usa|america/i.test(blob)
    }
    if (key === 'zh' || key === 'cn' || key === 'tw' || key === 'hk') {
      return /国产|国创|中国动画|华语|国语|中国|台湾|香港|bilibili/i.test(blob)
    }
    if (key === 'other') {
      return !/日本|日语|japanese|japan|アニメ|国产|国创|韩国|韩语|英语|english/i.test(blob)
        && !/[\u3040-\u30ff]/.test(item.originalTitle || '')
    }
    return true
  })
}

/**
 * AniList format is already sent via format_in API.
 * Only soft-check when platform field is present — never drop rows missing format
 * (would collapse pagination to a handful of items).
 */
function hardFilterAniListFormat(items: Anime[], format: string | null): Anime[] {
  if (!format) return items
  const f = format.toUpperCase()
  return items.filter((item) => {
    const fmt = (item.season || '').toUpperCase()
    if (!fmt) return true
    return fmt === f
  })
}

/** AniList: single countryOfOrigin ISO code. */
function hardFilterAniListLanguage(items: Anime[], country: string | null): Anime[] {
  if (!country) return items
  const code = country.toUpperCase()
  return items.filter((item) => {
    const origin = ((item as Anime & { countryOfOrigin?: string }).countryOfOrigin || '').toUpperCase()
    if (!origin) return code === 'JP'
    return origin === code
  })
}

export async function fetchBangumiCalendar(): Promise<Anime[]> {
  const response = await fetch(`${apiConfig.bangumiBase}/calendar`, { headers: bangumiHeaders() })
  if (!response.ok) throw new Error('Bangumi 放送数据暂时不可用')
  const days = await response.json()
  const now = new Date()
  const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3
  const quarterStart = new Date(now.getFullYear(), quarterStartMonth, 1)
  const quarterEnd = new Date(now.getFullYear(), quarterStartMonth + 3, 1)
  const currentQuarter = days.flatMap((day: any) => day.items).filter((item: any) => {
    const airDate = item.air_date ? new Date(`${item.air_date}T00:00:00`) : null
    return airDate && airDate >= quarterStart && airDate < quarterEnd
  })
  const quarterUnique = new Map<string, Anime>()
  currentQuarter.forEach((item: any) => quarterUnique.set(String(item.id), mapBangumi(item)))
  return [...quarterUnique.values()].sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
}

export async function importBangumi(username: string): Promise<ImportResult> {
  const all: any[] = []
  let offset = 0
  do {
    const response = await fetch(`${apiConfig.bangumiBase}/v0/users/${encodeURIComponent(username)}/collections?subject_type=2&limit=50&offset=${offset}`, { headers: bangumiHeaders() })
    if (!response.ok) throw new Error('Bangumi 用户不存在、收藏不可见或服务暂时不可用')
    const payload = await response.json()
    all.push(...payload.data)
    offset += payload.data.length
    if (payload.data.length < 50 || offset >= payload.total) break
  } while (offset < 1000)
  const typeMap: Record<number, WatchStatus> = { 1: 'planned', 2: 'completed', 3: 'watching', 4: 'paused', 5: 'dropped' }
  const items = all.map((entry: any) => ({ ...mapBangumi({ ...entry.subject, subject_id: entry.subject_id, ep_status: entry.ep_status }), status: typeMap[entry.type] ?? 'planned' }))
  return { source: 'bangumi', items, username }
}

export async function searchBangumi(keyword: string): Promise<Anime[]> {
  const response = await fetch(`${apiConfig.bangumiBase}/v0/search/subjects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...bangumiHeaders() },
    body: JSON.stringify({ keyword, sort: 'match', filter: { type: [2] } }),
  })
  if (!response.ok) throw new Error('Bangumi 搜索暂时不可用')
  const payload = await response.json()
  return payload.data.slice(0, 30).map(mapBangumi)
}

export async function searchAniList(keyword: string): Promise<Anime[]> {
  const query = `query ($search: String) { Page(page: 1, perPage: 30) { media(type: ANIME, search: $search, sort: SEARCH_MATCH, isAdult: false) { ${mediaFields} } } }`
  const data = await aniListRequest(query, { search: keyword })
  return data.Page.media.map((media: any) => mapAniList(media))
}

export async function searchAnime(keyword: string): Promise<Anime[]> {
  try {
    const bangumiResults = await searchBangumi(keyword)
    if (bangumiResults.length) return bangumiResults
  } catch {
    // AniList is the automatic fallback for Bangumi network and API failures.
  }
  return searchAniList(keyword)
}

// ── Discover browse pipeline (paginated + filters) ──────────────────────────

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[【】\[\]「」『』〈〉《》()（）·・\s._\-—–:'"“”‘’!！?？,，.。/\\|+]/g, '')
}

/**
 * Precise title match only.
 * Bangumi fuzzy "match" returns token-level noise (我推的孩子 → 我叫MT).
 * Keep an item only when the full query phrase appears contiguously in
 * title or originalTitle (punctuation/space-insensitive).
 */
export function filterAndRankByKeyword(items: Anime[], keyword: string): Anime[] {
  const compact = normalizeSearchText(keyword)
  if (!compact || !items.length) return items

  const scoreOf = (item: Anime): number => {
    const candidates = [
      item.title,
      item.originalTitle,
      item.titles?.cn,
      item.titles?.en,
      item.titles?.romaji,
      item.titles?.native,
    ]
      .map((value) => normalizeSearchText(value || ''))
      .filter(Boolean)
    if (!candidates.length) return -1

    if (candidates.some((t) => t === compact)) return 0
    if (candidates.some((t) => t.startsWith(compact))) return 1
    if (candidates.some((t) => t.includes(compact))) return 2
    return -1
  }

  return items
    .map((item) => ({ item, score: scoreOf(item) }))
    .filter((row) => row.score >= 0)
    .sort((a, b) => a.score - b.score || (b.item.popularity || 0) - (a.item.popularity || 0))
    .map((row) => row.item)
}

/**
 * Hard-require every selected genre value to appear in item.tags.
 * Selected values are source-native strings (Bangumi tag / AniList genre).
 */
function hardFilterByGenreValues(items: Anime[], genreValues: string[]): Anime[] {
  if (!genreValues.length) return items
  const required = genreValues.map((g) => g.trim()).filter(Boolean)
  if (!required.length) return items
  return items.filter((item) => {
    const tagSet = new Set((item.tags || []).map((t) => t.trim().toLowerCase()))
    return required.every((tag) => tagSet.has(tag.toLowerCase()))
  })
}

const BANGUMI_TAG_BLOCKLIST = new Set([
  '日本', 'TV', '剧场版', 'OVA', 'OAD', 'WEB', '原创', '漫画改', '漫改', '小说改',
  '轻小说改', '轻改', '游戏改', 'GAL改', '动画', '续作', '第二季', '第三季', '第四季',
  '神作', '催泪', '热血', '治愈', '搞笑', '青春', '成长', '纯爱', '魔法',
])

/**
 * Build Bangumi genre options from popular subject tags (no dedicated tags API).
 * Prefers meta_tags; falls back to frequent free tags.
 */
export async function fetchBangumiGenres(signal?: AbortSignal): Promise<DiscoverGenreOption[]> {
  try {
    const counts = new Map<string, number>()
    const metaCounts = new Map<string, number>()
    for (let offset = 0; offset < 120; offset += 40) {
      const response = await fetch(
        `${apiConfig.bangumiBase}/v0/search/subjects?limit=40&offset=${offset}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...bangumiHeaders() },
          body: JSON.stringify({ keyword: '', sort: 'heat', filter: { type: [2] } }),
          signal,
        },
      )
      if (!response.ok) throw new Error('Bangumi tags unavailable')
      const payload = await response.json()
      for (const item of payload.data ?? []) {
        for (const tag of item.meta_tags ?? []) {
          if (typeof tag === 'string' && tag && !BANGUMI_TAG_BLOCKLIST.has(tag)) {
            metaCounts.set(tag, (metaCounts.get(tag) || 0) + 3)
          }
        }
        for (const tag of item.tags ?? []) {
          const name = typeof tag === 'string' ? tag : tag?.name
          if (!name || BANGUMI_TAG_BLOCKLIST.has(name)) continue
          counts.set(name, (counts.get(name) || 0) + 1)
        }
      }
      if ((payload.data?.length ?? 0) < 40) break
    }

    const merged = new Map<string, number>()
    for (const [k, v] of metaCounts) merged.set(k, (merged.get(k) || 0) + v)
    for (const [k, v] of counts) merged.set(k, (merged.get(k) || 0) + v)

    const ranked = [...merged.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 36)
      .map(([tag]) => ({
        id: tag,
        label: tag,
        value: tag,
        source: 'bangumi' as const,
      }))

    return ranked.length ? ranked : FALLBACK_BANGUMI_GENRES
  } catch {
    return FALLBACK_BANGUMI_GENRES
  }
}

export async function fetchAniListGenres(): Promise<DiscoverGenreOption[]> {
  try {
    const query = `query { GenreCollection }`
    const data = await aniListRequest(query)
    const list: string[] = data?.GenreCollection ?? []
    if (!list.length) return FALLBACK_ANILIST_GENRES
    return list
      .filter((g) => g && g !== 'Hentai')
      .map((g) => ({
        id: g,
        label: g,
        value: g,
        source: 'anilist' as const,
      }))
  } catch {
    return FALLBACK_ANILIST_GENRES
  }
}

export async function fetchGenresForSource(source: DiscoverSource, signal?: AbortSignal) {
  if (source === 'anilist') return fetchAniListGenres()
  return fetchBangumiGenres(signal)
}

async function fetchBangumiSearchPage(
  body: Record<string, unknown>,
  limit: number,
  offset: number,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `${apiConfig.bangumiBase}/v0/search/subjects?limit=${limit}&offset=${offset}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bangumiHeaders() },
      body: JSON.stringify(body),
      signal,
    },
  )
  if (!response.ok) throw new Error('Bangumi 搜索暂时不可用')
  return response.json()
}

export async function browseBangumi(req: DiscoverPageRequest, signal?: AbortSignal): Promise<DiscoverPageResult> {
  const pageSize = req.pageSize || DISCOVER_PAGE_SIZE
  const keyword = req.keyword.trim()
  const genreValues = req.filters.genres.filter(Boolean)
  const format = (req.filters.format || '').trim() || null
  const language = (req.filters.language || '').trim() || null
  const body = buildBangumiSearchBody(req)

  // Soft client filters only (API already applied format/language tags).
  const applyBangumiSoftFilters = (list: Anime[]) => {
    let mapped = softFilterBangumiStatus(list, req.filters.status)
    mapped = hardFilterByGenreValues(mapped, genreValues)
    mapped = hardFilterBangumiFormat(mapped, format)
    // Language: only soft-check when tags present; tag prefilter already applied.
    if (language && language !== 'ja') {
      mapped = softFilterBangumiLanguage(mapped, language)
    }
    if (keyword) mapped = filterAndRankByKeyword(mapped, keyword)
    return mapped
  }

  // Keyword / genre / airing-status need multi-page gather (status is client-only on BGM).
  const needsPrecision = bangumiNeedsPrecisionGather(req)
  if (needsPrecision) {
    const precise: Anime[] = []
    const seen = new Set<string>()
    let rawOffset = 0
    let apiTotal: number | undefined
    let exhausted = false
    const need = req.page * pageSize
    const maxRawScan = 360

    while (precise.length < need && !exhausted && rawOffset < maxRawScan) {
      const batch = Math.min(40, maxRawScan - rawOffset)
      const payload = await fetchBangumiSearchPage(body, batch, rawOffset, signal)
      const rawBatch: any[] = payload.data ?? []
      if (typeof payload.total === 'number') apiTotal = payload.total
      rawOffset += rawBatch.length
      if (!rawBatch.length || (apiTotal != null && rawOffset >= apiTotal) || rawBatch.length < batch) {
        exhausted = true
      }

      const mapped = applyBangumiSoftFilters(rawBatch.map(mapBangumi))
      for (const item of mapped) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        precise.push(item)
      }
    }

    const start = (req.page - 1) * pageSize
    const items = precise.slice(start, start + pageSize)
    const hasMore = precise.length > start + items.length
      || (!exhausted && rawOffset < maxRawScan && (apiTotal == null || rawOffset < apiTotal))

    return {
      items,
      hasMore,
      source: 'bangumi',
      total: exhausted ? precise.length : undefined,
    }
  }

  // Normal path (format / language / bare browse): trust API pagination.
  const offset = (req.page - 1) * pageSize
  const payload = await fetchBangumiSearchPage(body, pageSize, offset, signal)
  const raw: Anime[] = (payload.data ?? []).map(mapBangumi)
  const items = applyBangumiSoftFilters(raw)
  const total = typeof payload.total === 'number' ? payload.total : undefined
  const rawCount = payload.data?.length ?? 0
  const hasMore = total != null
    ? offset + rawCount < total
    : rawCount >= pageSize

  return { items, hasMore, source: 'bangumi', total }
}

export async function browseAniList(req: DiscoverPageRequest): Promise<DiscoverPageResult> {
  const pageSize = req.pageSize || DISCOVER_PAGE_SIZE
  const keyword = req.keyword.trim()
  const genreValues = req.filters.genres.filter(Boolean)
  const format = (req.filters.format || '').trim() || null
  const language = mapAniListLanguageCode(req.filters.language)
  const variables = buildAniListVariables({ ...req, pageSize })

  const query = `
    query (
      $page: Int, $perPage: Int, $search: String, $genre_in: [String],
      $seasonYear: Int, $season: MediaSeason, $status: MediaStatus,
      $scoreGreater: Int, $scoreLesser: Int, $sort: [MediaSort],
      $format_in: [MediaFormat], $countryOfOrigin: CountryCode
    ) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(
          type: ANIME, isAdult: false,
          search: $search, genre_in: $genre_in,
          seasonYear: $seasonYear, season: $season, status: $status,
          averageScore_greater: $scoreGreater, averageScore_lesser: $scoreLesser,
          format_in: $format_in, countryOfOrigin: $countryOfOrigin,
          sort: $sort
        ) { ${mediaFields} status genres format countryOfOrigin }
      }
    }
  `

  const mapMedia = (media: any): Anime => {
    const item = mapAniList(media)
    if (Array.isArray(media.genres) && media.genres.length) {
      item.tags = media.genres
    }
    if (media.format) item.season = String(media.format)
    if (media.countryOfOrigin) {
      ;(item as Anime & { countryOfOrigin?: string }).countryOfOrigin = media.countryOfOrigin
    }
    return item
  }

  // Soft client filters only — never drop enough rows to break hasMore.
  const applyAniListSoft = (list: Anime[]) => {
    let mapped = hardFilterByGenreValues(list, genreValues)
    mapped = hardFilterAniListFormat(mapped, format)
    mapped = hardFilterAniListLanguage(mapped, language)
    if (keyword) mapped = filterAndRankByKeyword(mapped, keyword)
    return mapped
  }

  // Keyword/genre still need multi-page gather; status is API-native (no gather).
  const needsPrecision = Boolean(keyword || genreValues.length)
  if (needsPrecision) {
    const precise: Anime[] = []
    const seen = new Set<string>()
    let apiPage = 1
    let hasNext = true
    const need = req.page * pageSize
    const maxApiPages = genreValues.length && !keyword ? 12 : 8

    while (precise.length < need && hasNext && apiPage <= maxApiPages) {
      const data = await aniListRequest(query, { ...variables, page: apiPage })
      const page = data.Page
      const pageInfo = page.pageInfo
      hasNext = Boolean(pageInfo?.hasNextPage)
      let mapped: Anime[] = (page.media ?? []).map(mapMedia)
      mapped = applyAniListSoft(mapped)
      for (const item of mapped) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        precise.push(item)
      }
      apiPage += 1
      if (!(page.media ?? []).length) break
    }

    const start = (req.page - 1) * pageSize
    const items = precise.slice(start, start + pageSize)
    const hasMore = precise.length > start + items.length || (hasNext && apiPage <= maxApiPages)
    return {
      items,
      hasMore,
      source: 'anilist',
      total: hasNext ? undefined : precise.length,
    }
  }

  // Normal path (format / language / status / bare browse): one API page, trust pageInfo.
  const data = await aniListRequest(query, variables)
  const page = data.Page
  let items: Anime[] = (page.media ?? []).map(mapMedia)
  items = applyAniListSoft(items)
  const pageInfo = page.pageInfo
  const hasMore = Boolean(pageInfo?.hasNextPage)
    || (pageInfo?.total != null && req.page * pageSize < pageInfo.total)

  return {
    items,
    hasMore,
    source: 'anilist',
    total: pageInfo?.total,
  }
}

function prefersBangumiForKeyword(keyword: string): boolean {
  // Chinese queries match Bangumi titles much better; Latin/JP can use either.
  return /[\u4e00-\u9fff]/.test(keyword)
}

/**
 * Unified discover browse.
 * - sourceHint sticky: never flip BGM ↔ AL mid-session once chosen
 * - First resolve: Chinese keyword → Bangumi; else Bangumi with timeout → AniList
 * - Language/format filters stay on the sticky source (no cross-source jump)
 */
export async function browseAnime(req: DiscoverPageRequest): Promise<DiscoverPageResult> {
  const normalized: DiscoverPageRequest = {
    ...req,
    page: Math.max(1, req.page || 1),
    pageSize: req.pageSize || DISCOVER_PAGE_SIZE,
    keyword: req.keyword?.trim() ?? '',
  }

  // Sticky source: always honor hint, never switch mid-browse.
  if (normalized.sourceHint === 'anilist') {
    return browseAniList(normalized)
  }
  if (normalized.sourceHint === 'bangumi') {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), BANGUMI_TIMEOUT_MS)
    try {
      const result = await browseBangumi(normalized, controller.signal)
      clearTimeout(timer)
      return result
    } catch {
      clearTimeout(timer)
      if (!controller.signal.aborted) controller.abort()
      // Only on hard failure of sticky Bangumi, allow AniList once.
      return browseAniList(normalized)
    }
  }

  const keyword = normalized.keyword
  const preferBgm = !keyword || prefersBangumiForKeyword(keyword)

  if (preferBgm) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), BANGUMI_TIMEOUT_MS)
    try {
      const result = await browseBangumi(normalized, controller.signal)
      clearTimeout(timer)
      // First resolve only: empty Chinese search may try AniList once.
      if (keyword && !result.items.length) {
        const alt = await browseAniList(normalized)
        if (alt.items.length) return alt
      }
      return result
    } catch {
      clearTimeout(timer)
      if (!controller.signal.aborted) controller.abort()
      return browseAniList(normalized)
    }
  }

  // Latin / Japanese keywords: AniList first, Bangumi fallback (first resolve only).
  try {
    const result = await browseAniList(normalized)
    if (keyword && !result.items.length) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), BANGUMI_TIMEOUT_MS)
      try {
        const alt = await browseBangumi(normalized, controller.signal)
        clearTimeout(timer)
        if (alt.items.length) return alt
      } catch {
        clearTimeout(timer)
      }
    }
    return result
  } catch {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), BANGUMI_TIMEOUT_MS)
    try {
      const result = await browseBangumi(normalized, controller.signal)
      clearTimeout(timer)
      return result
    } catch {
      clearTimeout(timer)
      throw new Error('搜索服务暂时不可用')
    }
  }
}

export type DetailExtraSection = 'relations' | 'characters' | 'staff'

/** Overview only — no relations / characters / staff. Used for first paint. */
export async function fetchAnimeDetailOverview(id: string): Promise<AnimeDetail> {
  if (id.startsWith('bgm-')) {
    const rawId = id.slice(4)
    const response = await fetch(
      `${apiConfig.bangumiBase}/v0/subjects/${encodeURIComponent(rawId)}`,
      { headers: bangumiHeaders() },
    )
    if (!response.ok) throw new Error('无法获取 Bangumi 详情')
    const item = await response.json()
    const base = mapBangumi(item)
    return {
      ...base,
      id,
      summary: cleanText(item.summary || item.short_summary),
      airDate: item.date || item.air_date || undefined,
      rank: item.rating?.rank || undefined,
      scoreCount: item.rating?.total || undefined,
      tags: bangumiTagNames(item).slice(0, 12),
      format: item.platform || undefined,
    }
  }

  if (id.startsWith('anilist-')) {
    const rawId = Number(id.slice(8))
    const query = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          ${mediaFields}
          description(asHtml: false)
          status format source duration
          startDate { year month day }
          studios(isMain: true) { nodes { name } }
          averageScore popularity
        }
      }
    `
    const data = await aniListRequest(query, { id: rawId })
    const media = data.Media
    const base = mapAniList(media)
    const start = media.startDate
    const airDate = start?.year
      ? `${start.year}-${String(start.month || 1).padStart(2, '0')}-${String(start.day || 1).padStart(2, '0')}`
      : undefined
    return {
      ...base,
      id,
      summary: cleanText(media.description || ''),
      airDate,
      studios: (media.studios?.nodes || []).map((n: any) => n.name).filter(Boolean),
      format: media.format || undefined,
      sourceMaterial: media.source || undefined,
      duration: media.duration || undefined,
      tags: media.genres || base.tags,
      scoreCount: media.popularity || undefined,
    }
  }

  throw new Error('未知的动画来源')
}

/** Lazy tab payloads — full lists (UI paginates). */
export async function fetchAnimeDetailExtras(
  id: string,
  sections: DetailExtraSection[],
): Promise<Pick<AnimeDetail, 'relations' | 'characters' | 'staff'>> {
  const want = new Set(sections)
  const out: Pick<AnimeDetail, 'relations' | 'characters' | 'staff'> = {}

  if (id.startsWith('bgm-')) {
    const rawId = id.slice(4)
    const jobs: Array<Promise<void>> = []

    if (want.has('staff')) {
      jobs.push((async () => {
        const res = await fetch(
          `${apiConfig.bangumiBase}/v0/subjects/${encodeURIComponent(rawId)}/persons`,
          { headers: bangumiHeaders() },
        )
        if (!res.ok) return
        const persons = await res.json()
        out.staff = (Array.isArray(persons) ? persons : []).map((p: any) => {
          const rawId = p.id ?? p.person?.id
          return {
            id: rawId != null ? buildBgmPersonId(rawId) : '',
            name: p.name || p.person?.name || '未知',
            role: (p.relation || p.career?.[0] || 'Staff') as string,
            image: (p.images?.medium || p.person?.images?.medium || '').replace('http://', 'https://') || undefined,
          }
        }).filter((s: { id: string }) => Boolean(s.id))
      })())
    }

    if (want.has('relations')) {
      jobs.push((async () => {
        const res = await fetch(
          `${apiConfig.bangumiBase}/v0/subjects/${encodeURIComponent(rawId)}/subjects`,
          { headers: bangumiHeaders() },
        )
        if (!res.ok) return
        const related = await res.json()
        out.relations = (Array.isArray(related) ? related : []).map((r: any) => {
          const subject = r.subject || r
          return {
            id: `bgm-${subject.id}`,
            title: subject.name_cn || subject.name || '相关作品',
            type: r.relation || r.relation_type || 'Related',
            image: (subject.images?.medium || subject.images?.large || '').replace('http://', 'https://') || undefined,
            format: subject.platform || undefined,
          }
        })
      })())
    }

    if (want.has('characters')) {
      jobs.push((async () => {
        const res = await fetch(
          `${apiConfig.bangumiBase}/v0/subjects/${encodeURIComponent(rawId)}/characters`,
          { headers: bangumiHeaders() },
        )
        if (!res.ok) return
        const chars = await res.json()
        out.characters = (Array.isArray(chars) ? chars : []).map((c: any) => {
          const rawId = c.id ?? c.character?.id
          const actor = c.actors?.[0]
          const actorId = actor?.id
          return {
            id: rawId != null ? buildBgmCharacterId(rawId) : '',
            name: c.name || c.character?.name || '角色',
            role: c.relation || '角色',
            image: (c.images?.medium || c.character?.images?.medium || '').replace('http://', 'https://') || undefined,
            voiceActor: actor?.name || undefined,
            voiceActorImage: (actor?.images?.medium || '').replace('http://', 'https://') || undefined,
            voiceActorId: actorId != null ? buildBgmPersonId(actorId) : undefined,
          }
        }).filter((ch: { id: string }) => Boolean(ch.id))
      })())
    }

    await Promise.all(jobs)
    return out
  }

  if (id.startsWith('anilist-')) {
    const rawId = Number(id.slice(8))

    if (want.has('relations')) {
      const query = `
        query ($id: Int) {
          Media(id: $id, type: ANIME) {
            relations {
              edges {
                relationType
                node {
                  id type
                  title { romaji native english }
                  coverImage { large }
                  format status
                }
              }
            }
          }
        }
      `
      const data = await aniListRequest(query, { id: rawId })
      out.relations = (data.Media?.relations?.edges || [])
        .filter((edge: any) => edge?.node?.type === 'ANIME')
        .map((edge: any) => ({
          id: `anilist-${edge.node.id}`,
          title: edge.node.title?.native || edge.node.title?.english || edge.node.title?.romaji || 'Related',
          type: edge.relationType || 'RELATED',
          image: edge.node.coverImage?.large || undefined,
          format: edge.node.format || undefined,
          status: edge.node.status || undefined,
        }))
    }

    if (want.has('characters')) {
      const characters: NonNullable<AnimeDetail['characters']> = []
      let page = 1
      let hasNext = true
      while (hasNext) {
        const query = `
          query ($id: Int, $page: Int) {
            Media(id: $id, type: ANIME) {
              characters(sort: [ROLE, RELEVANCE], page: $page, perPage: 25) {
                pageInfo { hasNextPage }
                edges {
                  role
                  node { id name { full native } image { large } }
                  voiceActors(language: JAPANESE, sort: [RELEVANCE]) {
                    id
                    name { full native }
                    image { large }
                  }
                }
              }
            }
          }
        `
        const data = await aniListRequest(query, { id: rawId, page })
        const block = data.Media?.characters
        const edges = block?.edges || []
        characters.push(...edges.map((edge: any) => {
          const nodeId = edge.node?.id
          const va = edge.voiceActors?.[0]
          return {
            id: nodeId != null ? buildAniListCharacterId(nodeId) : '',
            name: edge.node?.name?.native || edge.node?.name?.full || 'Character',
            role: edge.role || 'SUPPORTING',
            image: edge.node?.image?.large || undefined,
            voiceActor: va?.name?.native || va?.name?.full || undefined,
            voiceActorImage: va?.image?.large || undefined,
            voiceActorId: va?.id != null ? buildAniListStaffId(va.id) : undefined,
          }
        }).filter((ch: { id: string }) => Boolean(ch.id)))
        hasNext = Boolean(block?.pageInfo?.hasNextPage)
        page += 1
        if (page > 40) break
      }
      out.characters = characters
    }

    if (want.has('staff')) {
      const staff: NonNullable<AnimeDetail['staff']> = []
      let page = 1
      let hasNext = true
      while (hasNext) {
        const query = `
          query ($id: Int, $page: Int) {
            Media(id: $id, type: ANIME) {
              staff(sort: [RELEVANCE], page: $page, perPage: 25) {
                pageInfo { hasNextPage }
                edges {
                  role
                  node { id name { full native } image { large } }
                }
              }
            }
          }
        `
        const data = await aniListRequest(query, { id: rawId, page })
        const block = data.Media?.staff
        const edges = block?.edges || []
        staff.push(...edges.map((edge: any) => {
          const nodeId = edge.node?.id
          return {
            id: nodeId != null ? buildAniListStaffId(nodeId) : '',
            name: edge.node?.name?.native || edge.node?.name?.full || 'Staff',
            role: edge.role || 'Staff',
            image: edge.node?.image?.large || undefined,
          }
        }).filter((s: { id: string }) => Boolean(s.id)))
        hasNext = Boolean(block?.pageInfo?.hasNextPage)
        page += 1
        if (page > 40) break
      }
      out.staff = staff
    }

    return out
  }

  throw new Error('未知的动画来源')
}

/** Full detail (overview + all extras). Prefer overview + lazy extras for UI. */
export async function fetchAnimeDetail(id: string): Promise<AnimeDetail> {
  const overview = await fetchAnimeDetailOverview(id)
  try {
    const extras = await fetchAnimeDetailExtras(id, ['relations', 'characters', 'staff'])
    return { ...overview, ...extras }
  } catch {
    return overview
  }
}

export type { DiscoverPageRequest, DiscoverPageResult, DiscoverFilters }
