export type DanmuMode = 0 | 1 | 2

export interface AggregatedDanmuComment {
  text: string
  time?: number
  mode: DanmuMode
  color: string
  sources: string[]
}

export interface DanmuSourceCount {
  id: string
  label: string
  count: number
}

export interface AggregatedDanmuResponse {
  available: boolean
  count: number
  comments: AggregatedDanmuComment[]
  sourceCounts: DanmuSourceCount[]
  warning?: 'not_configured' | 'upstream_unavailable'
}

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api'
const DANMU_SOURCES_KEY = 'mioani:danmu-source-preferences'
const DANMU_SETTINGS_KEY = 'mioani:danmu-settings'
const SOURCE_ALIASES: Record<string, string> = {
  bilibili1: 'bilibili',
  qq: 'tencent',
  qiyi: 'iqiyi',
}

export type DanmuMargin = [number | `${number}%`, number | `${number}%`]

export const DANMU_MARGIN_STEPS: DanmuMargin[] = [
  [10, '75%'],
  [10, '50%'],
  [10, '25%'],
  [10, 10],
]

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}

function normalizeSourceId(value: string): string {
  const normalized = value.normalize('NFKC').trim().toLowerCase()
  return SOURCE_ALIASES[normalized] || normalized || 'unknown'
}

function normalizeDanmuTime(value: unknown): number | undefined {
  const number = asNumber(value)
  if (number === undefined || number < 0) return undefined
  return number > 86_400 ? number / 1000 : number
}

function normalizeMode(value: unknown): DanmuMode {
  const number = asNumber(value)
  if (number === 5) return 1
  if (number === 4 || number === 2) return 2
  return 0
}

function normalizeColor(value: unknown): string {
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim())) {
    return value.trim().toUpperCase()
  }
  const number = asNumber(value)
  if (number === undefined || number < 0 || number > 0xffffff) return '#FFFFFF'
  return `#${Math.round(number).toString(16).padStart(6, '0')}`.toUpperCase()
}

function normalizeSources(value: unknown): string[] {
  const rawValues = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const sources = rawValues
    .flatMap((item) => asString(item).split(/[\x26\uFF06]/))
    .map(normalizeSourceId)
    .filter(Boolean)
  return [...new Set(sources.length ? sources : ['unknown'])]
}

function sourceCountsFromComments(comments: AggregatedDanmuComment[]): DanmuSourceCount[] {
  const counts = new Map<string, DanmuSourceCount>()
  for (const comment of comments) {
    for (const id of comment.sources) {
      const current = counts.get(id)
      if (current) current.count += 1
      else counts.set(id, { id, label: id === 'unknown' ? 'Unknown' : id, count: 1 })
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export function normalizeDanmuResponse(value: unknown): AggregatedDanmuResponse {
  const record = asRecord(value)
  const rawComments = Array.isArray(record?.comments) ? record.comments : []
  const comments = rawComments.flatMap((item): AggregatedDanmuComment[] => {
    const comment = asRecord(item)
    if (!comment) return []
    const text = asString(comment.text) || asString(comment.m) || asString(comment.content)
    if (!text || text.length > 200) return []
    const time = normalizeDanmuTime(comment.time)
    return [{
      text,
      time: time !== undefined && time >= 0 ? time : undefined,
      mode: normalizeMode(comment.mode),
      color: normalizeColor(comment.color),
      sources: normalizeSources(comment.sources),
    }]
  })
  const sourceCountMap = new Map<string, DanmuSourceCount>()
  if (Array.isArray(record?.sourceCounts)) {
    for (const item of record.sourceCounts) {
      const source = asRecord(item)
      const id = normalizeSourceId(asString(source?.id) || asString(source?.label))
      const count = asNumber(source?.count)
      if (count === undefined || count < 0) continue
      const current = sourceCountMap.get(id)
      if (current) current.count += Math.floor(count)
      else sourceCountMap.set(id, {
        id,
        label: id === 'unknown' ? 'Unknown' : asString(source?.label) || id,
        count: Math.floor(count),
      })
    }
  }
  const sourceCounts = [...sourceCountMap.values()]

  const warning = record?.warning === 'upstream_unavailable' || record?.warning === 'not_configured'
    ? record.warning
    : undefined
  return {
    available: record?.available !== false || comments.length > 0,
    count: Math.max(0, Math.floor(asNumber(record?.count) ?? comments.length)),
    comments,
    sourceCounts: sourceCounts.length ? sourceCounts : sourceCountsFromComments(comments),
    ...(warning ? { warning } : {}),
  }
}

export async function fetchAggregatedDanmu(options: {
  title: string
  alt?: string[]
  episode: number
  signal?: AbortSignal
}): Promise<AggregatedDanmuResponse> {
  const params = new URLSearchParams({
    title: options.title.trim(),
    episode: String(Math.floor(options.episode)),
  })
  for (const alt of options.alt || []) {
    if (alt.trim()) params.append('alt', alt.trim())
  }
  const response = await fetch(`${API_BASE}/playback/danmu?${params}`, { signal: options.signal })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `HTTP ${response.status}`)
  }
  return normalizeDanmuResponse(await response.json())
}

export type DanmuSourcePreferences = Record<string, boolean>

export function readDanmuSourcePreferences(): DanmuSourcePreferences {
  try {
    const raw = localStorage.getItem(DANMU_SOURCES_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const preferences: DanmuSourcePreferences = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') preferences[normalizeSourceId(key)] = value
    }
    return preferences
  } catch {
    return {}
  }
}

export function writeDanmuSourcePreferences(preferences: DanmuSourcePreferences): void {
  try {
    const normalized = Object.fromEntries(
      Object.entries(preferences).map(([key, value]) => [normalizeSourceId(key), value]),
    )
    localStorage.setItem(DANMU_SOURCES_KEY, JSON.stringify(normalized))
  } catch {
    // localStorage may be unavailable in private mode or tests.
  }
}

function normalizeDanmuMargin(value: unknown): DanmuMargin | null {
  if (!Array.isArray(value) || value.length !== 2) return null
  const match = DANMU_MARGIN_STEPS.find(
    ([top, bottom]) => value[0] === top && value[1] === bottom,
  )
  return match ? [...match] : null
}

export function readDanmuMargin(): DanmuMargin {
  try {
    const raw = localStorage.getItem(DANMU_SETTINGS_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return normalizeDanmuMargin(asRecord(parsed)?.margin) || [...DANMU_MARGIN_STEPS[0]]
  } catch {
    return [...DANMU_MARGIN_STEPS[0]]
  }
}

export function writeDanmuMargin(margin: DanmuMargin): void {
  const normalized = normalizeDanmuMargin(margin)
  if (!normalized) return
  try {
    const raw = localStorage.getItem(DANMU_SETTINGS_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    const settings = asRecord(parsed) || {}
    localStorage.setItem(DANMU_SETTINGS_KEY, JSON.stringify({ ...settings, margin: normalized }))
  } catch {
    // localStorage may be unavailable in private mode or tests.
  }
}

export function filterDanmuBySource(
  comments: AggregatedDanmuComment[],
  preferences: DanmuSourcePreferences,
): AggregatedDanmuComment[] {
  return comments.filter((comment) =>
    !comment.sources.length ||
      comment.sources.some((source) => preferences[normalizeSourceId(source)] !== false),
  )
}
