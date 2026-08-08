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
  warning?: 'upstream_unavailable'
}

export interface FetchAggregatedDanmuOptions {
  title: string
  alt?: string[]
  episode: number
}

interface UpstreamError extends Error {
  status?: number
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_RETRY_COUNT = 1
const DEFAULT_RETRY_DELAY_MS = 250
const DEFAULT_CACHE_TTL_MS = 5 * 60_000
const DEFAULT_EMPTY_CACHE_TTL_MS = 30_000
const MAX_CACHE_ENTRIES = 64
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504])
const UNKNOWN_SOURCE = 'unknown'
const SOURCE_ALIASES: Record<string, string> = {
  bilibili1: 'bilibili',
  qq: 'tencent',
  qiyi: 'iqiyi',
}

type DanmuCacheEntry = {
  expiresAt: number
  value: AggregatedDanmuResponse
}

const danmuCache = new Map<string, DanmuCacheEntry>()
const danmuInFlight = new Map<string, Promise<AggregatedDanmuResponse>>()

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asFiniteNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function normalizeSourceId(label: string): string {
  const normalized = label.normalize('NFKC').trim().toLowerCase()
  return SOURCE_ALIASES[normalized] || normalized || UNKNOWN_SOURCE
}

function normalizeDanmuTime(value: unknown): number | undefined {
  const number = asFiniteNumber(value)
  if (number === undefined || number < 0) return undefined
  // danmu_api uses seconds. This also protects the player if an upstream
  // adapter accidentally returns a millisecond timestamp.
  return number > 86_400 ? number / 1000 : number
}

function normalizeMode(value: unknown): DanmuMode {
  const mode = asFiniteNumber(value)
  if (mode === 5) return 1
  if (mode === 4 || mode === 2) return 2
  return 0
}

function normalizeColor(value: unknown): string {
  if (typeof value === 'string') {
    const raw = value.trim()
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toUpperCase()
    if (/^0x[0-9a-f]{1,6}$/i.test(raw)) {
      return `#${raw.slice(2).padStart(6, '0')}`.toUpperCase()
    }
    if (!/^\d+$/.test(raw)) return '#FFFFFF'
    value = Number(raw)
  }
  const number = asFiniteNumber(value)
  if (number === undefined || number < 0 || number > 0xffffff) return '#FFFFFF'
  return `#${Math.round(number).toString(16).padStart(6, '0')}`.toUpperCase()
}

function sourceLabelsFromComment(comment: Record<string, unknown>, p: string): string[] {
  const pMatch = p.match(/\[([^\]]*)\]\s*$/)
  const tagged = pMatch?.[1] || ''
  const direct = ['source', 'platform', '_sourceLabel']
    .map((key) => asString(comment[key]))
    .find(Boolean)
  const labels = (tagged || direct || UNKNOWN_SOURCE).split(/[\x26\uFF06]/).map(normalizeSourceId)
  return uniqueStrings(labels)
}

function sourceCountsFor(comments: AggregatedDanmuComment[]): DanmuSourceCount[] {
  const counts = new Map<string, DanmuSourceCount>()
  for (const comment of comments) {
    for (const id of comment.sources.length ? comment.sources : [UNKNOWN_SOURCE]) {
      const current = counts.get(id)
      if (current) {
        current.count += 1
      } else {
        counts.set(id, { id, label: id === UNKNOWN_SOURCE ? 'Unknown' : id, count: 1 })
      }
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export function buildMatchFileName(title: string, episode: number, season = 1): string {
  const safeTitle = title.trim()
  const safeSeason = Number.isFinite(season) && season > 0 ? Math.floor(season) : 1
  const safeEpisode = Number.isFinite(episode) && episode > 0 ? Math.floor(episode) : 1
  return `${safeTitle} S${String(safeSeason).padStart(2, '0')}E${String(safeEpisode).padStart(2, '0')}`
}

export function parseDandanComments(payload: unknown): AggregatedDanmuComment[] {
  const record = asRecord(payload)
  const rawComments = Array.isArray(record?.comments) ? record.comments : []
  const result: AggregatedDanmuComment[] = []

  for (const value of rawComments) {
    const comment = asRecord(value)
    if (!comment) continue
    const text = asString(comment.m) || asString(comment.text) || asString(comment.content)
    if (!text || text.length > 200) continue

    const p = asString(comment.p)
    const parts = p.split(',')
    const time = normalizeDanmuTime(comment.t) ?? normalizeDanmuTime(parts[0])
    const mode = normalizeMode(comment.mode ?? parts[1])
    const colorPart = parts.length >= 8 ? parts[3] : parts[2]
    result.push({
      text,
      time: time !== undefined && time >= 0 ? time : undefined,
      mode,
      color: normalizeColor(comment.color ?? colorPart),
      sources: sourceLabelsFromComment(comment, p),
    })
  }

  return result
}

export function emptyDanmuResponse(
  available = false,
  warning?: AggregatedDanmuResponse['warning'],
): AggregatedDanmuResponse {
  return { available, count: 0, comments: [], sourceCounts: [], ...(warning ? { warning } : {}) }
}

function configuredApi(): { base: string; token: string; timeoutMs: number } | null {
  const base = (process.env.DANMU_API_BASE || '').trim().replace(/\/+$/, '')
  const token = (process.env.DANMU_API_TOKEN || '').trim()
  if (!base || !token) return null
  const timeout = Number(process.env.DANMU_API_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  return {
    base,
    token,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  }
}

function upstreamUrl(config: { base: string; token: string }, path: string): string {
  return `${config.base}/${encodeURIComponent(config.token)}${path}`
}

function retryCount(): number {
  const configured = Number(process.env.DANMU_API_RETRY_COUNT || DEFAULT_RETRY_COUNT)
  return Number.isFinite(configured) && configured >= 0
    ? Math.min(Math.floor(configured), 4)
    : DEFAULT_RETRY_COUNT
}

function retryDelayMs(): number {
  const configured = Number(process.env.DANMU_API_RETRY_DELAY_MS || DEFAULT_RETRY_DELAY_MS)
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_RETRY_DELAY_MS
}

function cacheTtlMs(): number {
  const configured = Number(process.env.DANMU_API_CACHE_TTL_MS ?? DEFAULT_CACHE_TTL_MS)
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_CACHE_TTL_MS
}

function cacheKey(
  config: { base: string; token: string },
  options: FetchAggregatedDanmuOptions,
): string {
  return JSON.stringify([
    config.base,
    config.token,
    options.title.trim(),
    uniqueStrings(options.alt || []),
    Math.floor(options.episode),
  ])
}

function cachedDanmu(key: string): AggregatedDanmuResponse | undefined {
  const entry = danmuCache.get(key)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    danmuCache.delete(key)
    return undefined
  }
  return entry.value
}

function storeDanmuCache(key: string, value: AggregatedDanmuResponse): void {
  const ttl = cacheTtlMs()
  if (ttl <= 0) return
  const effectiveTtl = value.count > 0 ? ttl : Math.min(ttl, DEFAULT_EMPTY_CACHE_TTL_MS)
  danmuCache.delete(key)
  while (danmuCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = danmuCache.keys().next().value
    if (!oldestKey) break
    danmuCache.delete(oldestKey)
  }
  danmuCache.set(key, { expiresAt: Date.now() + effectiveTtl, value })
}

export function clearDanmuCache(): void {
  danmuCache.clear()
  danmuInFlight.clear()
}

function shouldRetry(error: unknown): boolean {
  const status = (error as UpstreamError).status
  if (typeof status === 'number') return RETRYABLE_STATUS_CODES.has(status)
  return error instanceof Error && (error.message === 'danmu_api_timeout' || error.name === 'TypeError')
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function requestJsonOnce(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const text = await response.text()
    let payload: unknown = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      throw new Error('danmu_api_invalid_json')
    }
    if (!response.ok) {
      const message = asString(asRecord(payload)?.errorMessage) || `danmu_api_http_${response.status}`
      const error = new Error(message) as UpstreamError
      error.status = response.status
      throw error
    }
    return payload
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('danmu_api_timeout')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function requestJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown> {
  const maxRetries = retryCount()
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestJsonOnce(url, init, timeoutMs)
    } catch (error) {
      if (attempt >= maxRetries || !shouldRetry(error)) throw error
      await wait(retryDelayMs() * 2 ** attempt)
    }
  }
}

function firstMatchId(payload: unknown): number | null {
  const record = asRecord(payload)
  const matches = Array.isArray(record?.matches) ? record.matches : []
  const first = asRecord(matches[0])
  const episodeId = asFiniteNumber(first?.episodeId)
  return episodeId !== undefined && episodeId > 0 ? Math.floor(episodeId) : null
}

async function fetchAggregatedDanmuUncached(
  config: { base: string; token: string; timeoutMs: number },
  options: FetchAggregatedDanmuOptions,
): Promise<AggregatedDanmuResponse> {
  const candidates = uniqueStrings([options.title, ...(options.alt || [])])
  if (!candidates.length) return emptyDanmuResponse(true)

  let episodeId: number | null = null
  let lastMatchError: unknown = null
  for (const title of candidates) {
    try {
      const matchPayload = await requestJson(
        upstreamUrl(config, '/api/v2/match'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ fileName: buildMatchFileName(title, options.episode) }),
        },
        config.timeoutMs,
      )
      episodeId = firstMatchId(matchPayload)
      if (episodeId !== null) break
    } catch (error) {
      lastMatchError = error
    }
  }

  if (episodeId === null && lastMatchError) throw lastMatchError
  if (episodeId === null) return emptyDanmuResponse(true)

  let commentPayload: unknown
  try {
    commentPayload = await requestJson(
      upstreamUrl(config, `/api/v2/comment/${episodeId}?format=json`),
      { headers: { Accept: 'application/json' } },
      config.timeoutMs,
    )
  } catch (error) {
    const status = (error as UpstreamError).status
    if (status === 404) return emptyDanmuResponse(true)
    throw error
  }

  const comments = parseDandanComments(commentPayload)
  return {
    available: true,
    count: comments.length,
    comments,
    sourceCounts: sourceCountsFor(comments),
  }
}

export function fetchAggregatedDanmu(
  options: FetchAggregatedDanmuOptions,
): Promise<AggregatedDanmuResponse> {
  const config = configuredApi()
  if (!config) return Promise.resolve(emptyDanmuResponse(false))

  const candidates = uniqueStrings([options.title, ...(options.alt || [])])
  if (!candidates.length) return Promise.resolve(emptyDanmuResponse(true))

  const key = cacheKey(config, options)
  const cached = cachedDanmu(key)
  if (cached) return Promise.resolve(cached)

  const current = danmuInFlight.get(key)
  if (current) return current

  const pending = fetchAggregatedDanmuUncached(config, options)
    .then((value) => {
      storeDanmuCache(key, value)
      return value
    })
    .finally(() => {
      if (danmuInFlight.get(key) === pending) danmuInFlight.delete(key)
    })
  danmuInFlight.set(key, pending)
  return pending
}
