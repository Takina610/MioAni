import process from 'node:process'

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

export interface FetchAggregatedDanmuOptions {
  title: string
  alt?: string[]
  episode: number
}

interface UpstreamError extends Error {
  status?: number
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_TOTAL_TIMEOUT_MS = 45_000
const DEFAULT_DANMU_API_BASE = 'https://mioani-danmu-api.onrender.com'
const DEFAULT_RETRY_COUNT = 5
const MAX_RETRY_COUNT = 5
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
const MATCH_PLATFORMS = ['bilibili1', 'dandan', 'qq', 'qiyi', 'youku', 'imgo'] as const

type UpstreamMatch = {
  episodeId: number
  animeTitle: string
  episodeTitle: string
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

function sourceLabelsFromComment(
  comment: Record<string, unknown>,
  p: string,
  fallbackSource = UNKNOWN_SOURCE,
): string[] {
  const pMatch = p.match(/\[([^\]]*)\]\s*$/)
  const tagged = pMatch?.[1] || ''
  const direct = ['source', 'platform', '_sourceLabel']
    .map((key) => asString(comment[key]))
    .find(Boolean)
  const labels = (tagged || direct || fallbackSource).split(/[\x26\uFF06]/).map(normalizeSourceId)
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

export function buildMatchFileName(
  title: string,
  episode: number,
  season = 1,
  platform = '',
): string {
  const safeTitle = title.trim()
  const safeSeason = Number.isFinite(season) && season > 0 ? Math.floor(season) : 1
  const safeEpisode = Number.isFinite(episode) && episode > 0 ? Math.floor(episode) : 1
  const platformSuffix = platform.trim() ? `@${platform.trim()}` : ''
  return `${safeTitle} S${String(safeSeason).padStart(2, '0')}E${String(safeEpisode).padStart(2, '0')}${platformSuffix}`
}

export function parseDandanComments(payload: unknown, fallbackSource = ''): AggregatedDanmuComment[] {
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
      sources: sourceLabelsFromComment(comment, p, fallbackSource || UNKNOWN_SOURCE),
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

function configuredApi(): {
  base: string
  token: string
  timeoutMs: number
  totalTimeoutMs: number
} | null {
  const configuredBase = process.env.DANMU_API_BASE
  const base = (configuredBase === undefined ? DEFAULT_DANMU_API_BASE : configuredBase)
    .trim()
    .replace(/\/+$/, '')
  const token = (process.env.TOKEN || '').trim()
  if (!base || !token) return null
  const timeout = Number(process.env.DANMU_API_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  const totalTimeout = Number(
    process.env.DANMU_API_TOTAL_TIMEOUT_MS || DEFAULT_TOTAL_TIMEOUT_MS,
  )
  return {
    base,
    token,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
    totalTimeoutMs:
      Number.isFinite(totalTimeout) && totalTimeout > 0
        ? totalTimeout
        : DEFAULT_TOTAL_TIMEOUT_MS,
  }
}

function upstreamUrl(config: { base: string; token: string }, path: string): string {
  return `${config.base}/${encodeURIComponent(config.token)}${path}`
}

function retryCount(): number {
  const configured = Number(process.env.DANMU_API_RETRY_COUNT || DEFAULT_RETRY_COUNT)
  return Number.isFinite(configured) && configured >= 0
    ? Math.min(Math.floor(configured), MAX_RETRY_COUNT)
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

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
    const finish = () => {
      cleanup()
      resolve()
    }
    const abort = () => {
      finish()
    }
    timer = setTimeout(finish, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

async function requestJsonOnce(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController()
  const abortFromParent = () => controller.abort()
  parentSignal?.addEventListener('abort', abortFromParent, { once: true })
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
    if (parentSignal?.aborted) {
      throw new Error('danmu_api_total_timeout')
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('danmu_api_timeout')
    }
    throw error
  } finally {
    clearTimeout(timer)
    parentSignal?.removeEventListener('abort', abortFromParent)
  }
}

async function requestJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<unknown> {
  const maxRetries = retryCount()
  for (let attempt = 0; ; attempt += 1) {
    if (parentSignal?.aborted) throw new Error('danmu_api_total_timeout')
    try {
      return await requestJsonOnce(url, init, timeoutMs, parentSignal)
    } catch (error) {
      if (attempt >= maxRetries || !shouldRetry(error)) throw error
      await wait(retryDelayMs() * 2 ** attempt, parentSignal)
    }
  }
}

function parseMatches(payload: unknown): UpstreamMatch[] {
  const record = asRecord(payload)
  const matches = Array.isArray(record?.matches) ? record.matches : []
  return matches.flatMap((value): UpstreamMatch[] => {
    const match = asRecord(value)
    const episodeId = asFiniteNumber(match?.episodeId)
    if (episodeId === undefined || episodeId <= 0) return []
    return [{
      episodeId: Math.floor(episodeId),
      animeTitle: asString(match?.animeTitle),
      episodeTitle: asString(match?.episodeTitle),
    }]
  })
}

function matchLabels(match: UpstreamMatch): string[] {
  const text = `${match.animeTitle} ${match.episodeTitle}`
  return [...text.matchAll(/[【\[]([^】\]]+)[】\]]/g)]
    .flatMap((item) => item[1].split(/[\x26,，]/))
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

function matchMentionsPlatform(match: UpstreamMatch, platform: string): boolean {
  return matchLabels(match).includes(platform.trim().toLowerCase())
}

function matchFallbackSource(match: UpstreamMatch): string {
  const platform = MATCH_PLATFORMS.find((candidate) => matchMentionsPlatform(match, candidate))
  return platform || ''
}

function mergeDanmuComments(groups: AggregatedDanmuComment[][]): AggregatedDanmuComment[] {
  const merged = new Map<string, AggregatedDanmuComment>()
  for (const comments of groups) {
    for (const comment of comments) {
      const key = JSON.stringify([comment.text, comment.time ?? null, comment.mode, comment.color])
      const previous = merged.get(key)
      if (!previous) {
        merged.set(key, { ...comment, sources: [...comment.sources] })
        continue
      }
      previous.sources = uniqueStrings([...previous.sources, ...comment.sources])
    }
  }
  return [...merged.values()]
}

async function fetchAggregatedDanmuUncached(
  config: { base: string; token: string; timeoutMs: number },
  options: FetchAggregatedDanmuOptions,
  signal?: AbortSignal,
): Promise<AggregatedDanmuResponse> {
  const candidates = uniqueStrings([options.title, ...(options.alt || [])])
  if (!candidates.length) return emptyDanmuResponse(true)

  let defaultMatch: UpstreamMatch | null = null
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
        signal,
      )
      defaultMatch = parseMatches(matchPayload)[0] || null
      if (defaultMatch) break
    } catch (error) {
      lastMatchError = error
    }
  }

  const shouldProbePlatforms = !defaultMatch || Boolean(defaultMatch.animeTitle || defaultMatch.episodeTitle)
  const platformMatches = shouldProbePlatforms
    ? await Promise.all(MATCH_PLATFORMS.map(async (platform) => {
        for (const title of candidates) {
          try {
            const matchPayload = await requestJson(
              upstreamUrl(config, '/api/v2/match'),
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                  fileName: buildMatchFileName(title, options.episode, 1, platform),
                }),
              },
              config.timeoutMs,
              signal,
            )
            const match = parseMatches(matchPayload).find((candidate) =>
              matchMentionsPlatform(candidate, platform),
            )
            if (match) return match
          } catch (error) {
            lastMatchError = error
          }
        }
        return null
      }))
    : []

  const matchesById = new Map<number, UpstreamMatch>()
  if (defaultMatch) matchesById.set(defaultMatch.episodeId, defaultMatch)
  for (const match of platformMatches) {
    if (match) matchesById.set(match.episodeId, match)
  }

  if (!matchesById.size) {
    if (lastMatchError) throw lastMatchError
    return emptyDanmuResponse(true)
  }

  const commentResults = await Promise.all(
    [...matchesById.values()].map(async (match) => {
      try {
        const commentPayload = await requestJson(
          upstreamUrl(config, `/api/v2/comment/${match.episodeId}?format=json`),
        { headers: { Accept: 'application/json' } },
        config.timeoutMs,
        signal,
      )
        return {
          comments: parseDandanComments(commentPayload, matchFallbackSource(match)),
          error: null,
        }
      } catch (error) {
        return {
          comments: [] as AggregatedDanmuComment[],
          error: (error as UpstreamError).status === 404 ? null : error,
        }
      }
    }),
  )

  const commentGroups = commentResults
    .map((result) => result.comments)
    .filter((comments) => comments.length > 0)
  const lastCommentError = commentResults.find((result) => result.error)?.error || null

  if (!commentGroups.length && lastCommentError) throw lastCommentError

  const comments = mergeDanmuComments(commentGroups)
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
  if (!config) return Promise.resolve(emptyDanmuResponse(false, 'not_configured'))

  const candidates = uniqueStrings([options.title, ...(options.alt || [])])
  if (!candidates.length) return Promise.resolve(emptyDanmuResponse(true))

  const key = cacheKey(config, options)
  const cached = cachedDanmu(key)
  if (cached) return Promise.resolve(cached)

  const current = danmuInFlight.get(key)
  if (current) return current

  const controller = new AbortController()
  const deadline = setTimeout(() => controller.abort(), config.totalTimeoutMs)
  const pending = fetchAggregatedDanmuUncached(config, options, controller.signal)
    .then((value) => {
      storeDanmuCache(key, value)
      return value
    })
    .finally(() => {
      clearTimeout(deadline)
      if (danmuInFlight.get(key) === pending) danmuInFlight.delete(key)
    })
  danmuInFlight.set(key, pending)
  return pending
}
