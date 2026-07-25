/** Prefer jsDelivr (CORS-friendly); GitHub raw often blocked in browsers. */
const DEFAULT_ONAIR_URLS = [
  'https://cdn.jsdelivr.net/gh/ekibot/bangumi-onair@master/calendar.json',
  'https://raw.githubusercontent.com/ekibot/bangumi-onair/master/calendar.json',
] as const

export type OnAirEntry = {
  weekDayCN?: number
  timeCN?: string
  weekDayJP?: number
  timeJP?: string
}

function resolveOnAirUrls(): string[] {
  const configured = (import.meta.env.VITE_BANGUMI_ONAIR_URL as string | undefined)?.trim()
  if (configured) return [configured, ...DEFAULT_ONAIR_URLS]
  return [...DEFAULT_ONAIR_URLS]
}

/**
 * Normalize onAir weekday to Bangumi calendar style (1=Mon … 7=Sun).
 * CDN data often uses JS `Date.getDay()` (0=Sun … 6=Sat); empty/null means unset.
 */
function asWeekday(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const n = Number(value)
  if (!Number.isFinite(n)) return undefined
  // Bangumi calendar / some paths: 1=Mon … 7=Sun.
  if (n >= 1 && n <= 7) return n
  // JS getDay style: 0=Sun → Bangumi 7.
  if (n === 0) return 7
  return undefined
}

function asTime(value: unknown): string | undefined {
  if (value == null) return undefined
  const text = String(value).trim()
  return text || undefined
}

/**
 * Soft-fetch onAir map keyed by Bangumi subject id (numeric string).
 * Never throws — empty map on any failure (CORS, network, parse).
 */
function parseOnAirPayload(payload: unknown): Map<string, OnAirEntry> {
  const map = new Map<string, OnAirEntry>()
  const list: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown })?.data)
      ? ((payload as { data: unknown[] }).data)
      : []

  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const id = item.id ?? item.subject_id
    if (id == null) continue
    map.set(String(id), {
      weekDayCN: asWeekday(item.weekDayCN),
      timeCN: asTime(item.timeCN),
      weekDayJP: asWeekday(item.weekDayJP),
      timeJP: asTime(item.timeJP),
    })
  }
  return map
}

/**
 * Soft-fetch onAir map keyed by Bangumi subject id (numeric string).
 * Never throws — empty map on any failure (CORS, network, parse).
 * Note: CDN is often incomplete for the newest season; AniList enrichment fills gaps.
 */
export async function fetchOnAirMap(signal?: AbortSignal): Promise<Map<string, OnAirEntry>> {
  for (const url of resolveOnAirUrls()) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal,
      })
      if (!response.ok) continue
      const map = parseOnAirPayload(await response.json())
      if (map.size) return map
    } catch {
      // try next mirror
    }
  }
  return new Map()
}

/**
 * Prefer non-empty CN time; fall back to JP.
 * Empty `timeCN` with `weekDayCN: 0` is common in the CDN and must not block JP time.
 * Weekday is only returned when a time is present so calendar day buckets stay authoritative.
 */
export function pickOnAirSlot(entry?: OnAirEntry): {
  bangumiWeekday?: number
  timeRaw?: string
} {
  if (!entry) return {}
  if (entry.timeCN) {
    return {
      bangumiWeekday: entry.weekDayCN,
      timeRaw: entry.timeCN,
    }
  }
  if (entry.timeJP) {
    return {
      bangumiWeekday: entry.weekDayJP,
      timeRaw: entry.timeJP,
    }
  }
  return {}
}
