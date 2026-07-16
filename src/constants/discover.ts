import type {
  AirStatus,
  DiscoverFilters,
  DiscoverGenreOption,
  DiscoverSeason,
  DiscoverSort,
} from '../types/discover'

export const BANGUMI_TIMEOUT_MS = 6000
export const DISCOVER_PAGE_SIZE = 24

export const DEFAULT_DISCOVER_FILTERS: DiscoverFilters = {
  genres: [],
  year: null,
  season: null,
  status: 'all',
  scoreMin: 0,
  scoreMax: 10,
  sort: 'heat',
}

/**
 * Fallback genre lists used only when the live source catalog fails.
 * Prefer `fetchBangumiGenres` / `fetchAniListGenres` at runtime.
 */
export const FALLBACK_BANGUMI_GENRES: DiscoverGenreOption[] = [
  '科幻', '喜剧', '同人', '百合', '校园', '惊悚', '后宫', '机战', '悬疑',
  '恋爱', '奇幻', '推理', '运动', '耽美', '音乐', '战斗', '冒险', '萌',
  '穿越', '玄幻', '乙女向', '恐怖', '历史', '日常', '剧情', '武侠', '美食', '职场',
].map((tag) => ({ id: tag, label: tag, value: tag, source: 'bangumi' as const }))

export const FALLBACK_ANILIST_GENRES: DiscoverGenreOption[] = [
  'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror',
  'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance',
  'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller',
  'Harem', 'Historical', 'Boys Love', 'Girls Love', 'Gourmet',
].map((g) => ({ id: g, label: g, value: g, source: 'anilist' as const }))

/** @deprecated use dynamic genres from store */
export const DISCOVER_GENRES: DiscoverGenreOption[] = FALLBACK_BANGUMI_GENRES

export const SEASON_OPTIONS: { value: DiscoverSeason | ''; label: string }[] = [
  { value: '', label: '全部季度' },
  { value: 'WINTER', label: '冬季' },
  { value: 'SPRING', label: '春季' },
  { value: 'SUMMER', label: '夏季' },
  { value: 'FALL', label: '秋季' },
]

export const STATUS_OPTIONS: { value: AirStatus; label: string }[] = [
  { value: 'all', label: '全部状态' },
  { value: 'releasing', label: '放送中' },
  { value: 'finished', label: '已完结' },
  { value: 'not_yet', label: '未放送' },
]

export const SORT_OPTIONS: { value: DiscoverSort; label: string }[] = [
  { value: 'heat', label: '热度' },
  { value: 'score', label: '评分' },
  { value: 'rank', label: '排名' },
  { value: 'match', label: '匹配度' },
  { value: 'start_date', label: '开播时间' },
]

export function buildYearOptions(span = 30): number[] {
  const current = new Date().getFullYear() + 1
  return Array.from({ length: span }, (_, index) => current - index)
}

export function filterKey(keyword: string, filters: DiscoverFilters): string {
  return JSON.stringify({
    keyword: keyword.trim(),
    genres: [...filters.genres].sort(),
    year: filters.year,
    season: filters.season,
    status: filters.status,
    scoreMin: filters.scoreMin,
    scoreMax: filters.scoreMax,
    sort: filters.sort,
  })
}
