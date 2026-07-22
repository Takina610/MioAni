import type { Anime } from '../types/anime'
import type {
  AirStatus,
  DiscoverFilters,
  DiscoverPageRequest,
  DiscoverSeason,
  DiscoverSort,
} from '../types/discover'

export type BangumiAirClass = 'releasing' | 'finished' | 'not_yet' | 'unknown'

export function seasonDateRange(year: number, season: DiscoverSeason): { start: string; end: string } {
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

/**
 * Build Bangumi `filter.air_date` clauses.
 * Year/season win as the primary window; airing-status further tightens
 * (or supplies a window when year/season are empty) so heat-sorted pages
 * are not dominated by classic titles from past decades.
 */
export function bangumiAirDateFilter(
  filters: DiscoverFilters,
  now: Date = new Date(),
): string[] | undefined {
  const currentYear = now.getFullYear()
  let lower: string | undefined
  let upper: string | undefined

  const tightenLower = (value: string) => {
    if (!lower || value > lower) lower = value
  }
  const tightenUpper = (value: string) => {
    if (!upper || value < upper) upper = value
  }

  if (filters.year && filters.season) {
    const { start, end } = seasonDateRange(filters.year, filters.season)
    lower = start
    upper = end
  } else if (filters.year) {
    lower = `${filters.year}-01-01`
    upper = `${filters.year}-12-31`
  } else if (filters.season) {
    const { start, end } = seasonDateRange(currentYear, filters.season)
    lower = start
    upper = end
  }

  // Status has no native Bangumi field — approximate with air_date so the API
  // returns candidates in the right era (client soft-filter still refines).
  if (filters.status === 'releasing') {
    tightenLower(`${currentYear}-01-01`)
    tightenUpper(`${currentYear}-12-31`)
  } else if (filters.status === 'finished') {
    tightenUpper(`${currentYear - 1}-12-31`)
  } else if (filters.status === 'not_yet') {
    tightenLower(`${currentYear + 1}-01-01`)
  }

  if (!lower && !upper) return undefined
  const clauses: string[] = []
  if (lower) clauses.push(`>=${lower}`)
  if (upper) clauses.push(`<=${upper}`)
  // Impossible window (e.g. year=2020 + releasing in 2026) → empty result by design.
  if (lower && upper && lower > upper) {
    return [`>=${lower}`, `<=${upper}`]
  }
  return clauses
}

export function bangumiSort(sort: DiscoverSort, hasKeyword: boolean): string {
  if (hasKeyword) return 'match'
  if (sort === 'score') return 'score'
  if (sort === 'rank') return 'rank'
  if (sort === 'match') return 'heat'
  return 'heat'
}

export function aniListSort(sort: DiscoverSort, hasKeyword: boolean): string {
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

export function aniListStatus(status: AirStatus): string | undefined {
  if (status === 'releasing') return 'RELEASING'
  if (status === 'finished') return 'FINISHED'
  if (status === 'not_yet') return 'NOT_YET_RELEASED'
  return undefined
}

/**
 * Bangumi language → search tags (API has no country field).
 * 日语 is default catalog — no tag prefilter.
 */
export function bangumiLanguageTags(language: string | null): string[] {
  if (!language) return []
  const key = language.trim().toLowerCase()
  if (key === 'ja' || key === 'jp') return []
  if (key === 'zh' || key === 'cn' || key === 'tw' || key === 'hk') {
    return ['中国', '国产', '国创', '中国动画']
  }
  if (key === 'ko' || key === 'kr') return ['韩国']
  if (key === 'en' || key === 'us' || key === 'gb') return ['美国']
  if (key === 'other') return []
  return []
}

export function mapAniListLanguageCode(languageRaw: string | null | undefined): string | null {
  if (!languageRaw) return null
  const map: Record<string, string> = {
    ja: 'JP',
    jp: 'JP',
    zh: 'CN',
    cn: 'CN',
    en: 'US',
    us: 'US',
    ko: 'KR',
    kr: 'KR',
    tw: 'TW',
    hk: 'HK',
  }
  const lower = languageRaw.trim().toLowerCase()
  if (!lower || lower === 'other') return null
  return (map[lower] || languageRaw).toUpperCase()
}

/**
 * Year-only airing classification for Bangumi (no nextEpisode required).
 * year === 0 → unknown (only under status=all).
 */
export function classifyBangumiAirStatus(
  item: Pick<Anime, 'year'>,
  now: Date = new Date(),
): BangumiAirClass {
  const year = Number(item.year) || 0
  if (year <= 0) return 'unknown'
  const current = now.getFullYear()
  if (year > current) return 'not_yet'
  if (year < current) return 'finished'
  return 'releasing'
}

export function softFilterBangumiStatus(
  items: Anime[],
  status: AirStatus,
  now: Date = new Date(),
): Anime[] {
  if (status === 'all') return items
  return items.filter((item) => classifyBangumiAirStatus(item, now) === status)
}

export function buildBangumiSearchBody(req: DiscoverPageRequest): {
  keyword: string
  sort: string
  filter: Record<string, unknown>
} {
  const keyword = req.keyword.trim()
  const genreValues = req.filters.genres.filter(Boolean)
  const format = (req.filters.format || '').trim() || null
  const language = (req.filters.language || '').trim() || null
  const airDate = bangumiAirDateFilter(req.filters)
  const rating: string[] = []
  if (req.filters.scoreMin > 0) rating.push(`>=${req.filters.scoreMin}`)
  if (req.filters.scoreMax < 10) rating.push(`<=${req.filters.scoreMax}`)

  const filter: Record<string, unknown> = { type: [2] }
  const langTags = bangumiLanguageTags(language)
  // Use ONE language tag as primary (API AND-s all tags — multi-tag empties results).
  const primaryLangTag = langTags[0] || null
  const allTags = [
    ...genreValues,
    ...(format ? [format] : []),
    ...(primaryLangTag ? [primaryLangTag] : []),
  ]
  if (allTags.length) filter.tag = allTags
  if (airDate) filter.air_date = airDate
  if (rating.length) filter.rating = rating

  return {
    keyword: keyword || '',
    sort: bangumiSort(req.filters.sort, Boolean(keyword)),
    filter,
  }
}

export function buildAniListVariables(req: DiscoverPageRequest): Record<string, unknown> {
  const pageSize = req.pageSize
  const keyword = req.keyword.trim()
  const genreValues = req.filters.genres.filter(Boolean)
  const format = (req.filters.format || '').trim() || null
  const language = mapAniListLanguageCode(req.filters.language)
  const status = aniListStatus(req.filters.status)
  const sort = aniListSort(req.filters.sort, Boolean(keyword))

  const variables: Record<string, unknown> = {
    page: req.page,
    perPage: pageSize,
    sort: [sort],
  }
  if (keyword) variables.search = keyword
  if (genreValues.length) variables.genre_in = genreValues
  if (req.filters.year) {
    variables.seasonYear = req.filters.year
  } else if (req.filters.season) {
    variables.seasonYear = new Date().getFullYear()
  }
  if (req.filters.season) variables.season = req.filters.season
  if (status) variables.status = status
  if (req.filters.scoreMin > 0) variables.scoreGreater = Math.round(req.filters.scoreMin * 10) - 1
  if (req.filters.scoreMax < 10) variables.scoreLesser = Math.round(req.filters.scoreMax * 10) + 1
  if (format) variables.format_in = [format.toUpperCase()]
  if (language) variables.countryOfOrigin = language
  return variables
}

export function bangumiNeedsPrecisionGather(req: DiscoverPageRequest): boolean {
  const keyword = req.keyword.trim()
  const genreValues = req.filters.genres.filter(Boolean)
  return Boolean(keyword || genreValues.length || req.filters.status !== 'all')
}
