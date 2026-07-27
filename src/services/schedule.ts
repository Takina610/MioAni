import type { Anime } from '../types/anime'
import type { ScheduleDay, ScheduleItem, ScheduleSourceItem } from '../types/schedule'
import { isSameAnime } from '../utils/animeIdentity'

/** Chinese labels indexed by JS `Date.getDay()` (0=Sun … 6=Sat). */
export const WEEKDAY_LABELS_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

/** Display order: Monday → Sunday. */
export const MON_FIRST_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const

/**
 * Bangumi `/calendar` weekday.id is 1=Mon … 7=Sun.
 * Convert to JS `Date.getDay()` (0=Sun … 6=Sat).
 */
export function bangumiWeekdayToJs(id: number): number {
  const n = Number(id)
  if (!Number.isFinite(n) || n < 1 || n > 7) return 0
  return n === 7 ? 0 : n
}

/** Normalize onAir / raw times (`2330`, `23:30`, `9:05`) → `HH:mm`. */
export function formatAirTime(raw?: string | number | null): string | undefined {
  if (raw == null) return undefined
  const text = String(raw).trim()
  if (!text) return undefined

  const colon = text.match(/^(\d{1,2}):(\d{2})$/)
  if (colon) {
    const h = Number(colon[1])
    const m = Number(colon[2])
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }
    return undefined
  }

  const digits = text.replace(/\D/g, '')
  if (digits.length === 3 || digits.length === 4) {
    const padded = digits.padStart(4, '0')
    const h = Number(padded.slice(0, 2))
    const m = Number(padded.slice(2, 4))
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }
  }
  return undefined
}

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS_CN[((weekday % 7) + 7) % 7] ?? '周日'
}

/** Local calendar midnight for `d` (time zeroed). */
export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Add `n` local calendar days to `d` (preserves time-of-day if not midnight). */
export function addLocalDays(d: Date, n: number): Date {
  const next = new Date(d.getTime())
  next.setDate(next.getDate() + n)
  return next
}

/** Inclusive window of local midnights: `start + 0..columns-1`. */
export function sliceScheduleWindow(start: Date, columns: number): Date[] {
  const base = startOfLocalDay(start)
  const n = Math.max(0, Math.floor(columns))
  const out: Date[] = []
  for (let i = 0; i < n; i += 1) out.push(addLocalDays(base, i))
  return out
}

/** Items from the week template matching JS weekday (0=Sun … 6=Sat). */
export function itemsForWeekday(days: ScheduleDay[], weekday: number): ScheduleItem[] {
  const day = days.find((d) => d.weekday === weekday)
  return day?.items ?? []
}

/** True when both dates share the same local Y/M/D. */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  )
}

/** Month/day label for column headers, e.g. `7/25`. */
export function formatScheduleMonthDay(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** Week-template item plus day chrome for home preview rail. */
export type SchedulePreviewItem = ScheduleItem & {
  weekday: number
  dayLabel: string
}

/**
 * Flatten Mon→Sun template into a “最近更新” list:
 * dedupe by anime id, timed first / time / popularity, then `limit`.
 */
export function flattenRecentSchedule(
  days: ScheduleDay[],
  limit = 14,
): SchedulePreviewItem[] {
  const seen = new Set<string>()
  const out: SchedulePreviewItem[] = []
  for (const day of days) {
    for (const item of day.items) {
      if (seen.has(item.anime.id)) continue
      seen.add(item.anime.id)
      out.push({
        ...item,
        weekday: day.weekday,
        dayLabel: day.label,
      })
    }
  }
  out.sort(compareScheduleItems)
  const n = Math.max(0, Math.floor(limit))
  return out.slice(0, n)
}

function sortKeyTime(time?: string): number {
  if (!time) return Number.POSITIVE_INFINITY
  const [h, m] = time.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return Number.POSITIVE_INFINITY
  return h * 60 + m
}

export function compareScheduleItems(a: ScheduleItem, b: ScheduleItem): number {
  if (a.timed !== b.timed) return a.timed ? -1 : 1
  if (a.timed && b.timed) {
    const byTime = sortKeyTime(a.airTime) - sortKeyTime(b.airTime)
    if (byTime !== 0) return byTime
  }
  const byPop = (b.anime.popularity || 0) - (a.anime.popularity || 0)
  if (byPop !== 0) return byPop
  return a.anime.title.localeCompare(b.anime.title, 'zh')
}

/**
 * Build a fixed 7-day Mon→Sun schedule.
 * Timed items sort by `HH:mm` ascending; untimed (待定) follow, by popularity/title.
 */
export function buildWeekSchedule(
  sources: ScheduleSourceItem[],
  now: Date = new Date(),
): ScheduleDay[] {
  const today = now.getDay()
  const buckets = new Map<number, ScheduleItem[]>()
  for (const day of MON_FIRST_WEEKDAYS) buckets.set(day, [])

  const seen = new Set<string>()
  for (const src of sources) {
    const weekday = ((Number(src.airWeekday) % 7) + 7) % 7
    if (!buckets.has(weekday)) continue
    if (seen.has(src.anime.id)) continue
    seen.add(src.anime.id)

    const airTime = formatAirTime(src.airTime) || formatAirTime(src.anime.airTime)
    const anime: Anime = {
      ...src.anime,
      airWeekday: weekday,
      airDay: weekdayLabel(weekday),
      ...(airTime ? { airTime } : { airTime: undefined }),
    }
    buckets.get(weekday)!.push({
      anime,
      airTime,
      timed: Boolean(airTime),
    })
  }

  return MON_FIRST_WEEKDAYS.map((weekday) => {
    const items = (buckets.get(weekday) || []).slice().sort(compareScheduleItems)
    return {
      weekday,
      label: weekdayLabel(weekday),
      isToday: weekday === today,
      items,
    }
  })
}

/** AniList fallback: group by local weekday/time from `nextAiringEpisode.airingAt`. */
export function buildScheduleFromAniList(
  items: Anime[],
  airingAtById: Map<string, number>,
  now: Date = new Date(),
): ScheduleDay[] {
  const sources: ScheduleSourceItem[] = []
  for (const anime of items) {
    const airingAt = airingAtById.get(anime.id)
    if (!airingAt) continue
    const date = new Date(airingAt * 1000)
    if (Number.isNaN(date.getTime())) continue
    const airTime = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    sources.push({
      anime,
      airWeekday: date.getDay(),
      airTime,
    })
  }
  return buildWeekSchedule(sources, now)
}

export function emptyWeekSchedule(now: Date = new Date()): ScheduleDay[] {
  return buildWeekSchedule([], now)
}

export function scheduleHasContent(days: ScheduleDay[]): boolean {
  return days.some((day) => day.items.length > 0)
}

/**
 * Fill missing HH:mm / episodes on Bangumi calendar rows using AniList donors
 * (`nextAiringEpisode` time + episode progress, or any donor with airTime / episodes).
 */
export function enrichScheduleWithAiringTimes(
  days: ScheduleDay[],
  donors: Anime[],
  now: Date = new Date(),
): ScheduleDay[] {
  if (!scheduleHasContent(days) || !donors.length) return days

  const sources: ScheduleSourceItem[] = []
  let changed = 0

  for (const day of days) {
    for (const item of day.items) {
      let airTime = formatAirTime(item.airTime) || formatAirTime(item.anime.airTime)
      let airWeekday = item.anime.airWeekday ?? day.weekday
      let anime = item.anime
      const match = donors.find((d) => isSameAnime(item.anime, d))

      if (match) {
        if (!airTime) {
          airTime = formatAirTime(match.airTime)
          if (match.airWeekday != null) airWeekday = match.airWeekday
          if (airTime) changed += 1
        }
        if (!(anime.episodes > 0) && match.episodes > 0) {
          anime = { ...anime, episodes: match.episodes }
          changed += 1
        }
        if (!(anime.score > 0) && match.score > 0) {
          anime = { ...anime, score: match.score }
          changed += 1
        }
      }

      sources.push({
        anime,
        airWeekday,
        airTime,
      })
    }
  }

  if (!changed) return days
  return buildWeekSchedule(sources, now)
}
