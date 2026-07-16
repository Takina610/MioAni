import type { Anime } from './anime'

export type DiscoverSort = 'match' | 'heat' | 'score' | 'rank' | 'start_date'
export type AirStatus = 'all' | 'releasing' | 'finished' | 'not_yet'
export type DiscoverSeason = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL'
export type DiscoverSource = 'bangumi' | 'anilist'

export interface DiscoverFilters {
  genres: string[]
  year: number | null
  season: DiscoverSeason | null
  status: AirStatus
  scoreMin: number
  scoreMax: number
  sort: DiscoverSort
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
