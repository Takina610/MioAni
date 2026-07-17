import type { Anime } from './anime'

export type DiscoverSort = 'match' | 'heat' | 'score' | 'rank' | 'start_date'
export type AirStatus = 'all' | 'releasing' | 'finished' | 'not_yet'
export type DiscoverSeason = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL'
export type DiscoverSource = 'bangumi' | 'anilist'

/**
 * Source-native format value:
 * - Bangumi: platform/tag string e.g. "TV" | "剧场版" | "OVA"
 * - AniList: MediaFormat e.g. "TV" | "MOVIE" | "OVA"
 * null = no format filter
 */
export type DiscoverFormatValue = string | null

/**
 * Source-native language / origin:
 * - Bangumi: soft tag keys "ja"|"zh"|"en"|"ko"|"other"
 * - AniList: countryOfOrigin ISO "JP"|"CN"|"TW"|"HK"|"KR"|"US"|...
 */
export type DiscoverLanguageValue = string

export interface DiscoverFilters {
  genres: string[]
  year: number | null
  season: DiscoverSeason | null
  status: AirStatus
  scoreMin: number
  scoreMax: number
  sort: DiscoverSort
  /** Single-select, source-native format value */
  format: DiscoverFormatValue
  /** Single-select, source-native language/origin value; null = all */
  language: DiscoverLanguageValue | null
}

export interface DiscoverFormatOption {
  id: string
  label: string
  /** Value sent to the active source API / hard filter */
  value: string
  source: DiscoverSource
}

export interface DiscoverLanguageOption {
  id: string
  label: string
  value: string
  source: DiscoverSource
}

export interface DiscoverPageRequest {
  keyword: string
  filters: DiscoverFilters
  page: number
  pageSize: number
  sourceHint?: DiscoverSource
}

export interface DiscoverPageResult {
  items: Anime[]
  hasMore: boolean
  source: DiscoverSource
  total?: number
}

/** Dynamic genre chip from the active data source. */
export interface DiscoverGenreOption {
  /** Stable key for selection (usually same as value). */
  id: string
  /** Display label. */
  label: string
  /** Value sent to the active source API / hard filter. */
  value: string
  source: DiscoverSource
}

/** @deprecated kept for migration; prefer DiscoverGenreOption */
export interface DiscoverGenreOptionLegacy {
  id: string
  labelZh: string
  bangumiTag: string
  aniListGenre: string
}
