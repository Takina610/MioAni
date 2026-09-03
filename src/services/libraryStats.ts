import type { Anime, WatchStatus } from '../types/anime'
import { getLibraryProgress } from './libraryProgress'

export type LibraryStatBucket = {
  label: string
  value: number
  share: number
}

export type StatsPersona = {
  label: string
  blurb: string
  supports: string[]
}

export type FinishDurationBucket = {
  label: string
  value: number
}

export type ScoreContrastPoint = {
  title: string
  userScore: number
  catalogScore: number
  delta: number
}

export type TagLoyaltyRow = {
  tag: string
  started: number
  completed: number
  dropped: number
  /** completed / started; 0 when started is 0 */
  finishRate: number
}

export type TimelinePoint = {
  month: string
  started: number
  completed: number
}

export type SeasonBucket = {
  season: string
  value: number
  share: number
}

export type LibraryStats = {
  totalTitles: number
  watchedEpisodes: number
  availableEpisodes: number
  pendingEpisodes: number
  completionRate: number
  averageScore: number
  statusBreakdown: LibraryStatBucket[]
  sourceBreakdown: LibraryStatBucket[]
  yearBreakdown: LibraryStatBucket[]
  tagBreakdown: LibraryStatBucket[]
  progressLeaders: Anime[]

  completionTitleRate: number
  dropRate: number
  plannedRate: number
  /** Median days from start→complete; null when sample < 3 */
  medianFinishDays: number | null
  finishDurationSampleSize: number
  averageUserScore: number | null
  userScoreSampleSize: number
  persona: StatsPersona | null
  finishDurationBuckets: FinishDurationBucket[]
  scoreContrast: ScoreContrastPoint[]
  scoreContrastBias: number | null
  tagLoyalty: TagLoyaltyRow[]
  tagBetrayal: TagLoyaltyRow | null
  timeline: TimelinePoint[]
  seasonPreference: SeasonBucket[]
}

const STATUS_LABELS: Record<WatchStatus, string> = {
  watching: '在看',
  completed: '看过',
  planned: '想看',
  dropped: '搁置',
}

const ANILIST_SEASONS = new Set(['WINTER', 'SPRING', 'SUMMER', 'FALL'])

const SEASON_LABELS: Record<string, string> = {
  WINTER: '冬',
  SPRING: '春',
  SUMMER: '夏',
  FALL: '秋',
}

const DURATION_BUCKETS: { label: string; max: number }[] = [
  { label: '≤7 天', max: 7 },
  { label: '8–30 天', max: 30 },
  { label: '1–3 月', max: 90 },
  { label: '3–12 月', max: 365 },
  { label: '>1 年', max: Number.POSITIVE_INFINITY },
]

function toBuckets(counts: Map<string, number>, total: number, limit = 6): LibraryStatBucket[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .slice(0, limit)
    .map(([label, value]) => ({
      label,
      value,
      share: total ? value / total : 0,
    }))
}

function parseStamp(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function finishDays(item: Anime): number | null {
  const start = parseStamp(item.startedAt)
  const end = parseStamp(item.completedAt)
  if (!start || !end || end < start) return null
  return Math.round((end.getTime() - start.getTime()) / 86_400_000)
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
  }
  return sorted[mid]!
}

function monthKey(value: string | undefined): string | null {
  const date = parseStamp(value)
  if (!date) return null
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function buildPersona(
  total: number,
  completed: number,
  dropped: number,
  planned: number,
  watching: number,
): StatsPersona | null {
  if (total < 5) return null

  const dropRate = dropped / total
  const plannedRate = planned / total
  const completedRate = completed / total
  const watchingRate = watching / total

  let label = '均衡追番者'
  let blurb = '开坑、完结与积压之间相对平衡，节奏稳定。'

  if (plannedRate >= 0.4 && planned >= 3) {
    label = '开坑收藏家'
    blurb = '想看列表很饱满——兴趣广，收束还在路上。'
  } else if (dropRate >= 0.25 && dropped >= 2) {
    label = '高弃番探险家'
    blurb = '试探得多、留存得狠，口味筛选很果断。'
  } else if (completedRate >= 0.45 && completed >= 3) {
    label = '收束型观众'
    blurb = '看过占比高，更偏向把故事看到句号。'
  } else if (watchingRate >= 0.35 && watching >= 3) {
    label = '多线连载党'
    blurb = '同时在追的作品不少，档期感很强。'
  }

  const supports = [
    `看过 ${completed} · 在看 ${watching}`,
    `想看积压 ${planned}（${Math.round(plannedRate * 100)}%）`,
    `搁置 ${dropped}（${Math.round(dropRate * 100)}%）`,
  ]

  return { label, blurb, supports }
}

function bucketFinishDays(daysList: number[]): FinishDurationBucket[] {
  const counts = DURATION_BUCKETS.map((bucket) => ({ label: bucket.label, value: 0 }))
  for (const days of daysList) {
    const index = DURATION_BUCKETS.findIndex((bucket) => days <= bucket.max)
    const target = counts[index < 0 ? counts.length - 1 : index]
    if (target) target.value += 1
  }
  return counts
}

export function buildLibraryStats(items: Anime[]): LibraryStats {
  const watchedEpisodes = items.reduce((sum, item) => sum + Math.max(0, item.watched || 0), 0)
  const availableEpisodes = items.reduce((sum, item) => sum + Math.max(0, item.episodes || 0), 0)
  const pendingEpisodes = items.reduce(
    (sum, item) => sum + getLibraryProgress(item).pending,
    0,
  )
  const scored = items.filter((item) => item.score > 0)
  const statusCounts = new Map<WatchStatus, number>()
  const sourceCounts = new Map<string, number>()
  const yearCounts = new Map<string, number>()
  const tagCounts = new Map<string, number>()
  const seasonCounts = new Map<string, number>()
  const tagStarted = new Map<string, number>()
  const tagCompleted = new Map<string, number>()
  const tagDropped = new Map<string, number>()
  const timelineMap = new Map<string, { started: number; completed: number }>()
  const finishDayValues: number[] = []
  const scoreContrast: ScoreContrastPoint[] = []
  const userScores: number[] = []

  let completedCount = 0
  let droppedCount = 0
  let plannedCount = 0
  let watchingCount = 0

  for (const item of items) {
    statusCounts.set(item.status, (statusCounts.get(item.status) || 0) + 1)
    sourceCounts.set(item.source, (sourceCounts.get(item.source) || 0) + 1)
    if (item.year > 0) yearCounts.set(String(item.year), (yearCounts.get(String(item.year)) || 0) + 1)

    if (item.status === 'completed') completedCount += 1
    else if (item.status === 'dropped') droppedCount += 1
    else if (item.status === 'planned') plannedCount += 1
    else if (item.status === 'watching') watchingCount += 1

    if (item.userScore != null && item.userScore > 0) {
      userScores.push(item.userScore)
      if (item.score > 0) {
        scoreContrast.push({
          title: item.title,
          userScore: item.userScore,
          catalogScore: item.score,
          delta: item.userScore - item.score,
        })
      }
    }

    const season = (item.season || '').toUpperCase()
    if (ANILIST_SEASONS.has(season)) {
      seasonCounts.set(season, (seasonCounts.get(season) || 0) + 1)
    }

    if (item.status === 'completed') {
      const days = finishDays(item)
      if (days != null) finishDayValues.push(days)
    }

    const startMonth = monthKey(item.startedAt)
    if (startMonth) {
      const row = timelineMap.get(startMonth) || { started: 0, completed: 0 }
      row.started += 1
      timelineMap.set(startMonth, row)
    }
    const completeMonth = monthKey(item.completedAt)
    if (completeMonth) {
      const row = timelineMap.get(completeMonth) || { started: 0, completed: 0 }
      row.completed += 1
      timelineMap.set(completeMonth, row)
    }

    for (const tag of item.tags || []) {
      const value = tag.trim()
      if (!value) continue
      tagCounts.set(value, (tagCounts.get(value) || 0) + 1)
      if (item.status !== 'planned') {
        tagStarted.set(value, (tagStarted.get(value) || 0) + 1)
      }
      if (item.status === 'completed') {
        tagCompleted.set(value, (tagCompleted.get(value) || 0) + 1)
      }
      if (item.status === 'dropped') {
        tagDropped.set(value, (tagDropped.get(value) || 0) + 1)
      }
    }
  }

  const progressLeaders = items
    .filter((item) => item.watched > 0)
    .slice()
    .sort((a, b) => {
      const progressA = a.episodes ? a.watched / a.episodes : a.watched
      const progressB = b.episodes ? b.watched / b.episodes : b.watched
      return progressB - progressA || b.watched - a.watched
    })
    .slice(0, 5)

  const total = items.length
  const tagLoyalty: TagLoyaltyRow[] = [...tagStarted.keys()]
    .map((tag) => {
      const started = tagStarted.get(tag) || 0
      const completed = tagCompleted.get(tag) || 0
      const dropped = tagDropped.get(tag) || 0
      return {
        tag,
        started,
        completed,
        dropped,
        finishRate: started ? completed / started : 0,
      }
    })
    .filter((row) => row.started >= 2)
    .sort((a, b) => b.started - a.started || a.tag.localeCompare(b.tag, 'zh'))
    .slice(0, 8)

  const tagBetrayalCandidate = tagLoyalty.length
    ? [...tagLoyalty].sort((a, b) => {
      // Prefer tags you start a lot but finish rarely.
      const scoreA = a.started * (1 - a.finishRate)
      const scoreB = b.started * (1 - b.finishRate)
      return scoreB - scoreA || b.started - a.started
    })[0] || null
    : null
  const tagBetrayal = tagBetrayalCandidate
    && tagBetrayalCandidate.started >= 2
    && tagBetrayalCandidate.finishRate < 0.55
    ? tagBetrayalCandidate
    : null

  const timeline = [...timelineMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, row]) => ({ month, started: row.started, completed: row.completed }))

  const seasonTotal = [...seasonCounts.values()].reduce((sum, n) => sum + n, 0)
  const seasonPreference: SeasonBucket[] = ['WINTER', 'SPRING', 'SUMMER', 'FALL']
    .filter((season) => seasonCounts.has(season))
    .map((season) => {
      const value = seasonCounts.get(season) || 0
      return {
        season: SEASON_LABELS[season] || season,
        value,
        share: seasonTotal ? value / seasonTotal : 0,
      }
    })

  const contrastSorted = scoreContrast
    .slice()
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 12)

  const scoreContrastBias = contrastSorted.length >= 3
    ? contrastSorted.reduce((sum, row) => sum + row.delta, 0) / contrastSorted.length
    : null

  return {
    totalTitles: total,
    watchedEpisodes,
    availableEpisodes,
    pendingEpisodes,
    completionRate: availableEpisodes ? watchedEpisodes / availableEpisodes : 0,
    averageScore: scored.length
      ? scored.reduce((sum, item) => sum + item.score, 0) / scored.length
      : 0,
    statusBreakdown: toBuckets(
      new Map([...statusCounts].map(([key, value]) => [STATUS_LABELS[key], value])),
      total,
      5,
    ),
    sourceBreakdown: toBuckets(sourceCounts, total, 4),
    yearBreakdown: toBuckets(yearCounts, total, 8),
    tagBreakdown: toBuckets(tagCounts, total, 8),
    progressLeaders,
    completionTitleRate: total ? completedCount / total : 0,
    dropRate: total ? droppedCount / total : 0,
    plannedRate: total ? plannedCount / total : 0,
    medianFinishDays: finishDayValues.length >= 3 ? median(finishDayValues) : null,
    finishDurationSampleSize: finishDayValues.length,
    averageUserScore: userScores.length
      ? userScores.reduce((sum, n) => sum + n, 0) / userScores.length
      : null,
    userScoreSampleSize: userScores.length,
    persona: buildPersona(total, completedCount, droppedCount, plannedCount, watchingCount),
    finishDurationBuckets: bucketFinishDays(finishDayValues),
    scoreContrast: contrastSorted,
    scoreContrastBias,
    tagLoyalty,
    tagBetrayal,
    timeline,
    seasonPreference,
  }
}
