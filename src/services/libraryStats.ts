import type { Anime, WatchStatus } from '../types/anime'
import { getLibraryProgress } from './libraryProgress'

export type LibraryStatBucket = {
  label: string
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
}

const STATUS_LABELS: Record<WatchStatus, string> = {
  watching: '在看',
  completed: '看过',
  planned: '想看',
  paused: '暂停',
  dropped: '搁置',
}

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

  for (const item of items) {
    statusCounts.set(item.status, (statusCounts.get(item.status) || 0) + 1)
    sourceCounts.set(item.source, (sourceCounts.get(item.source) || 0) + 1)
    if (item.year > 0) yearCounts.set(String(item.year), (yearCounts.get(String(item.year)) || 0) + 1)
    for (const tag of item.tags || []) {
      const value = tag.trim()
      if (value) tagCounts.set(value, (tagCounts.get(value) || 0) + 1)
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

  return {
    totalTitles: items.length,
    watchedEpisodes,
    availableEpisodes,
    pendingEpisodes,
    completionRate: availableEpisodes ? watchedEpisodes / availableEpisodes : 0,
    averageScore: scored.length
      ? scored.reduce((sum, item) => sum + item.score, 0) / scored.length
      : 0,
    statusBreakdown: toBuckets(
      new Map([...statusCounts].map(([key, value]) => [STATUS_LABELS[key], value])),
      items.length,
      5,
    ),
    sourceBreakdown: toBuckets(sourceCounts, items.length, 4),
    yearBreakdown: toBuckets(yearCounts, items.length, 6),
    tagBreakdown: toBuckets(tagCounts, items.length, 8),
    progressLeaders,
  }
}
