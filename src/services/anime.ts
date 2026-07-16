import { apiConfig, authHeaders } from '../config/api'
import {
  BANGUMI_TIMEOUT_MS,
  DISCOVER_PAGE_SIZE,
  FALLBACK_ANILIST_GENRES,
  FALLBACK_BANGUMI_GENRES,
} from '../constants/discover'
import type { Anime, AnimeDetail, ImportResult, WatchStatus } from '../types/anime'
import type {
  AirStatus,
  DiscoverFilters,
  DiscoverGenreOption,
  DiscoverPageRequest,
  DiscoverPageResult,
  DiscoverSeason,
  DiscoverSort,
  DiscoverSource,
} from '../types/discover'

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
    season: '',
    episodes: item.eps || item.total_episodes || 0,
    watched: item.ep_status || 0,
    status: 'planned',
    tags: bangumiTagNames(item),
    summary: cleanText(item.summary || item.short_summary),
    popularity: item.collection?.doing || 0,
  }
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

function seasonDateRange(year: number, season: DiscoverSeason): { start: string; end: string } {
  const ranges: Record<DiscoverSeason, [number, number]> = {
    WINTER: [1, 3],
    SPRING: [4, 6],
    SUMMER: [7, 9],
    FALL: [10, 12],
  }
  const [startMonth, endMonth] = ranges[season]
  const start = `${year}-${String(startMonth).padStart(2, '0')}-01`
  const endMonthStr = String(endMonth).padStart(2, '0')
  const lastDay = new Date(year, endMonth, 0).getDate()
  const end = `${year}-${endMonthStr}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

function bangumiAirDateFilter(filters: DiscoverFilters): string[] | undefined {
  if (filters.year && filters.season) {
    const { start, end } = seasonDateRange(filters.year, filters.season)
    return [`>=${start}`, `<=${end}`]
  }
  if (filters.year) {
    return [`>=${filters.year}-01-01`, `<=${filters.year}-12-31`]
  }
  // Season without year: map to current calendar year season window (best-effort).
  if (filters.season) {
    const year = new Date().getFullYear()
    const { start, end } = seasonDateRange(year, filters.season)
    return [`>=${start}`, `<=${end}`]
  }
  return undefined
}

function bangumiSort(sort: DiscoverSort, hasKeyword: boolean): string {
  // Keyword search must stay on match; heat/rank/score bury relevance.
  if (hasKeyword) return 'match'
  if (sort === 'score') return 'score'
  if (sort === 'rank') return 'rank'
  if (sort === 'match') return 'heat'
  return 'heat'
}

function aniListSort(sort: DiscoverSort, hasKeyword: boolean): string {
  if (hasKeyword) return 'SEARCH_MATCH'
  switch (sort) {
    case 'score':
      return 'SCORE_DESC'
    case 'rank':
      return 'TRENDING_DESC'
    case 'start_date':
      return 'START_DATE_DESC'
    case 'match':
      return 'POPULARITY_DESC'
    case 'heat':
    default:
      return 'POPULARITY_DESC'
  }
}

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

function aniListStatus(status: AirStatus): string | undefined {
  if (status === 'releasing') return 'RELEASING'
  if (status === 'finished') return 'FINISHED'
  if (status === 'not_yet') return 'NOT_YET_RELEASED'
  return undefined
}

/** Soft client filter for Bangumi (no native airing status API field). */
function softFilterBangumiStatus(items: Anime[], status: AirStatus): Anime[] {
  if (status === 'all') return items
  const year = new Date().getFullYear()
  return items.filter((item) => {
    if (status === 'not_yet') return item.year > year || (item.year === 0 && !item.nextEpisode)
    if (status === 'releasing') return Boolean(item.nextEpisode) || item.year === year
    if (status === 'finished') return item.year > 0 && item.year < year && !item.nextEpisode
    return true
  })
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
  const airDate = bangumiAirDateFilter(req.filters)
  const rating: string[] = []
  if (req.filters.scoreMin > 0) rating.push(`>=${req.filters.scoreMin}`)
  if (req.filters.scoreMax < 10) rating.push(`<=${req.filters.scoreMax}`)

  const filter: Record<string, unknown> = { type: [2] }
  // Keep API tag as a soft prefilter; client hard-filters for precision.
  if (genreValues.length) filter.tag = genreValues
  if (airDate) filter.air_date = airDate
  if (rating.length) filter.rating = rating

  const body = {
    keyword: keyword || '',
    sort: bangumiSort(req.filters.sort, Boolean(keyword)),
    filter,
  }

  // Keyword and/or genre: Bangumi is noisy — multi-fetch, hard-filter, then slice.
  const needsPrecision = Boolean(keyword || genreValues.length)
  if (needsPrecision) {
    const precise: Anime[] = []
    const seen = new Set<string>()
    let rawOffset = 0
    let apiTotal: number | undefined
    let exhausted = false
    const need = req.page * pageSize
    const maxRawScan = genreValues.length && !keyword ? 320 : 240

    while (precise.length < need && !exhausted && rawOffset < maxRawScan) {
      const batch = Math.min(40, maxRawScan - rawOffset)
      const payload = await fetchBangumiSearchPage(body, batch, rawOffset, signal)
      const rawBatch: any[] = payload.data ?? []
      if (typeof payload.total === 'number') apiTotal = payload.total
      rawOffset += rawBatch.length
      if (!rawBatch.length || (apiTotal != null && rawOffset >= apiTotal) || rawBatch.length < batch) {
        exhausted = true
      }

      let mapped = rawBatch.map(mapBangumi)
      mapped = softFilterBangumiStatus(mapped, req.filters.status)
      mapped = hardFilterByGenreValues(mapped, genreValues)
      if (keyword) mapped = filterAndRankByKeyword(mapped, keyword)
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

  const offset = (req.page - 1) * pageSize
  const payload = await fetchBangumiSearchPage(body, pageSize, offset, signal)
  const raw: Anime[] = (payload.data ?? []).map(mapBangumi)
  const items = softFilterBangumiStatus(raw, req.filters.status)
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
  const status = aniListStatus(req.filters.status)
  const sort = aniListSort(req.filters.sort, Boolean(keyword))

  const query = `
    query (
      $page: Int, $perPage: Int, $search: String, $genre_in: [String],
      $seasonYear: Int, $season: MediaSeason, $status: MediaStatus,
      $scoreGreater: Int, $scoreLesser: Int, $sort: [MediaSort]
    ) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(
          type: ANIME, isAdult: false,
          search: $search, genre_in: $genre_in,
          seasonYear: $seasonYear, season: $season, status: $status,
          averageScore_greater: $scoreGreater, averageScore_lesser: $scoreLesser,
          sort: $sort
        ) { ${mediaFields} status genres }
      }
    }
  `

  const variables: Record<string, unknown> = {
    page: req.page,
    perPage: pageSize,
    sort: [sort],
  }
  if (keyword) variables.search = keyword
  if (genreValues.length) variables.genre_in = genreValues
  // AniList rejects season without seasonYear; default year when only season is set.
  if (req.filters.year) {
    variables.seasonYear = req.filters.year
  } else if (req.filters.season) {
    variables.seasonYear = new Date().getFullYear()
  }
  if (req.filters.season) variables.season = req.filters.season
  if (status) variables.status = status
  // AniList averageScore is 0–100
  if (req.filters.scoreMin > 0) variables.scoreGreater = Math.round(req.filters.scoreMin * 10) - 1
  if (req.filters.scoreMax < 10) variables.scoreLesser = Math.round(req.filters.scoreMax * 10) + 1

  const mapMedia = (media: any): Anime => {
    const item = mapAniList(media)
    // Prefer full genre list for hard filter when available.
    if (Array.isArray(media.genres) && media.genres.length) {
      item.tags = media.genres
    }
    return item
  }

  // Keyword and/or genre: gather enough precise hits across AniList pages.
  if (keyword || genreValues.length) {
    const precise: Anime[] = []
    const seen = new Set<string>()
    let apiPage = 1
    let hasNext = true
    const need = req.page * pageSize
    const maxApiPages = genreValues.length && !keyword ? 10 : 8

    while (precise.length < need && hasNext && apiPage <= maxApiPages) {
      const data = await aniListRequest(query, { ...variables, page: apiPage })
      const page = data.Page
      const pageInfo = page.pageInfo
      hasNext = Boolean(pageInfo?.hasNextPage)
      let mapped: Anime[] = (page.media ?? []).map(mapMedia)
      mapped = hardFilterByGenreValues(mapped, genreValues)
      if (keyword) mapped = filterAndRankByKeyword(mapped, keyword)
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

  const data = await aniListRequest(query, variables)
  const page = data.Page
  const items: Anime[] = (page.media ?? []).map(mapMedia)
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
 * Unified discover browse:
 * - Chinese keyword: Bangumi first (better CN titles)
 * - Otherwise: Bangumi first with 6s timeout, fallback AniList
 * - Sticky sourceHint keeps pagination on one source
 */
export async function browseAnime(req: DiscoverPageRequest): Promise<DiscoverPageResult> {
  const normalized: DiscoverPageRequest = {
    ...req,
    page: Math.max(1, req.page || 1),
    pageSize: req.pageSize || DISCOVER_PAGE_SIZE,
    keyword: req.keyword?.trim() ?? '',
  }

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
      // Chinese search with zero precise hits: try AniList as secondary (rare).
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

  // Latin / Japanese keywords: AniList first, Bangumi fallback.
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

export async function fetchAnimeDetail(id: string): Promise<AnimeDetail> {
  if (id.startsWith('bgm-')) {
    const rawId = id.slice(4)
    const [subjectRes, personsRes, relatedRes, charactersRes] = await Promise.allSettled([
      fetch(`${apiConfig.bangumiBase}/v0/subjects/${encodeURIComponent(rawId)}`, { headers: bangumiHeaders() }),
      fetch(`${apiConfig.bangumiBase}/v0/subjects/${encodeURIComponent(rawId)}/persons`, { headers: bangumiHeaders() }),
      fetch(`${apiConfig.bangumiBase}/v0/subjects/${encodeURIComponent(rawId)}/subjects`, { headers: bangumiHeaders() }),
      fetch(`${apiConfig.bangumiBase}/v0/subjects/${encodeURIComponent(rawId)}/characters`, { headers: bangumiHeaders() }),
    ])

    if (subjectRes.status !== 'fulfilled' || !subjectRes.value.ok) {
      throw new Error('无法获取 Bangumi 详情')
    }
    const item = await subjectRes.value.json()
    const base = mapBangumi(item)

    let staff: AnimeDetail['staff'] = []
    if (personsRes.status === 'fulfilled' && personsRes.value.ok) {
      const persons = await personsRes.value.json()
      staff = (Array.isArray(persons) ? persons : []).slice(0, 12).map((p: any) => ({
        name: p.name || p.person?.name || '未知',
        role: (p.relation || p.career?.[0] || 'Staff') as string,
        image: (p.images?.medium || p.person?.images?.medium || '').replace('http://', 'https://') || undefined,
      }))
    }

    let relations: AnimeDetail['relations'] = []
    if (relatedRes.status === 'fulfilled' && relatedRes.value.ok) {
      const related = await relatedRes.value.json()
      relations = (Array.isArray(related) ? related : [])
        .filter((r: any) => (r.type ?? r.subject?.type) === 2 || r.subject?.type === 2 || true)
        .slice(0, 12)
        .map((r: any) => {
          const subject = r.subject || r
          return {
            id: `bgm-${subject.id}`,
            title: subject.name_cn || subject.name || '相关作品',
            type: r.relation || r.relation_type || 'Related',
            image: (subject.images?.medium || subject.images?.large || '').replace('http://', 'https://') || undefined,
            format: subject.platform || undefined,
          }
        })
    }

    let characters: AnimeDetail['characters'] = []
    if (charactersRes.status === 'fulfilled' && charactersRes.value.ok) {
      const chars = await charactersRes.value.json()
      characters = (Array.isArray(chars) ? chars : []).slice(0, 16).map((c: any) => ({
        name: c.name || c.character?.name || '角色',
        role: c.relation || '角色',
        image: (c.images?.medium || c.character?.images?.medium || '').replace('http://', 'https://') || undefined,
        voiceActor: c.actors?.[0]?.name || undefined,
        voiceActorImage: (c.actors?.[0]?.images?.medium || '').replace('http://', 'https://') || undefined,
      }))
    }

    return {
      ...base,
      id,
      summary: cleanText(item.summary || item.short_summary),
      airDate: item.date || item.air_date || undefined,
      rank: item.rating?.rank || undefined,
      scoreCount: item.rating?.total || undefined,
      tags: bangumiTagNames(item).slice(0, 12),
      format: item.platform || undefined,
      relations,
      characters,
      staff,
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
          characters(sort: [ROLE, RELEVANCE], perPage: 12) {
            edges {
              role
              node { name { full native } image { large } }
              voiceActors(language: JAPANESE, sort: [RELEVANCE]) {
                name { full native }
                image { large }
              }
            }
          }
          staff(sort: [RELEVANCE], perPage: 10) {
            edges {
              role
              node { name { full native } image { large } }
            }
          }
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

    const relations = (media.relations?.edges || [])
      .filter((edge: any) => edge?.node?.type === 'ANIME')
      .slice(0, 12)
      .map((edge: any) => ({
        id: `anilist-${edge.node.id}`,
        title: edge.node.title?.native || edge.node.title?.english || edge.node.title?.romaji || 'Related',
        type: edge.relationType || 'RELATED',
        image: edge.node.coverImage?.large || undefined,
        format: edge.node.format || undefined,
        status: edge.node.status || undefined,
      }))

    const characters = (media.characters?.edges || []).slice(0, 16).map((edge: any) => ({
      name: edge.node?.name?.native || edge.node?.name?.full || 'Character',
      role: edge.role || 'SUPPORTING',
      image: edge.node?.image?.large || undefined,
      voiceActor: edge.voiceActors?.[0]?.name?.native || edge.voiceActors?.[0]?.name?.full || undefined,
      voiceActorImage: edge.voiceActors?.[0]?.image?.large || undefined,
    }))

    const staff = (media.staff?.edges || []).slice(0, 12).map((edge: any) => ({
      name: edge.node?.name?.native || edge.node?.name?.full || 'Staff',
      role: edge.role || 'Staff',
      image: edge.node?.image?.large || undefined,
    }))

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
      relations,
      characters,
      staff,
    }
  }

  throw new Error('未知的动画来源')
}

export type { DiscoverPageRequest, DiscoverPageResult, DiscoverFilters }
