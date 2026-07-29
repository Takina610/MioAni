import type { Anime } from '../types/anime'
import type {
  EpisodesResult,
  PlaybackSourceChoice,
  PlaybackSourcesResult,
  ResolveResult,
} from '../types/playback'

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api'

const WATCH_PREFIX = 'mioani:watch:'

/** Title search priority: titles.cn → title → originalTitle → other titles.* */
export function pickPlaybackTitle(anime: Pick<Anime, 'title' | 'originalTitle' | 'titles'>): {
  title: string
  alt: string[]
} {
  const cn = anime.titles?.cn?.trim()
  const primary = (cn || anime.title || anime.originalTitle || '').trim()
  const extras = [
    anime.title,
    anime.originalTitle,
    anime.titles?.cn,
    anime.titles?.en,
    anime.titles?.romaji,
    anime.titles?.native,
  ]
    .map((s) => (s || '').trim())
    .filter((s) => s && s !== primary)
  return { title: primary, alt: [...new Set(extras)] }
}

const LAST_EP_PREFIX = 'mioani:last-ep:'

/** Session/memory fallback when localStorage is missing or blocked (e.g. tests). */
const lastPlayedMemory = new Map<string, number>()

function lastEpisodeKey(animeId: string): string {
  return `${LAST_EP_PREFIX}${animeId}`
}

/**
 * Default start episode for in-site play.
 * Priority: local Watch Position / last-played resume → local library progress (next ep) → ep 1.
 * Do not pass catalog/Bangumi progress as `libraryWatched` — that wrongly opens ep 2.
 */
export function defaultEpisode(
  libraryWatched: number = 0,
  episodeCount?: number,
  animeId?: string,
): number {
  const maxEp = episodeCount && episodeCount > 0 ? episodeCount : undefined
  if (animeId) {
    const resume = findResumeEpisode(animeId, maxEp)
    if (resume != null) return resume
  }
  const watched = Math.max(0, Math.floor(libraryWatched || 0))
  if (watched <= 0) return 1
  const next = watched + 1
  if (maxEp) return Math.min(next, maxEp)
  return next
}

/** Last played episode for this work (memory + localStorage), if any. */
export function findResumeEpisode(animeId: string, maxEpisode?: number): number | null {
  const id = (animeId || '').trim()
  if (!id) return null
  let ep: number | null = lastPlayedMemory.get(id) ?? null
  if (ep == null) {
    try {
      const raw = localStorage.getItem(lastEpisodeKey(id))
      if (raw) {
        const n = Number(raw)
        if (Number.isFinite(n) && n >= 1) ep = Math.floor(n)
      }
    } catch {
      /* ignore */
    }
  }
  if (ep == null || ep < 1) return null
  if (maxEpisode && ep > maxEpisode) return maxEpisode
  return ep
}

export function setLastPlayedEpisode(animeId: string, episode: number): void {
  const id = (animeId || '').trim()
  if (!id || !Number.isFinite(episode) || episode < 1) return
  const ep = Math.floor(episode)
  lastPlayedMemory.set(id, ep)
  try {
    localStorage.setItem(lastEpisodeKey(id), String(ep))
  } catch {
    // quota / private mode — memory still holds value for this session
  }
}

/** Test helper: clear in-memory last-played map. */
export function clearLastPlayedMemory(): void {
  lastPlayedMemory.clear()
}

export async function resolveStream(opts: {
  title: string
  episode: number
  alt?: string[]
  id?: string
  /** Preferred line; server still falls back to others on failure. */
  provider?: PlaybackSourceChoice
}): Promise<ResolveResult> {
  const params = new URLSearchParams({
    title: opts.title.trim(),
    episode: String(opts.episode),
  })
  if (opts.id) params.set('id', opts.id)
  if (opts.provider && opts.provider !== 'auto') {
    params.set('provider', opts.provider)
  }
  for (const a of opts.alt || []) {
    if (a.trim()) params.append('alt', a.trim())
  }
  const res = await fetch(`${API_BASE}/playback/resolve?${params}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json() as Promise<ResolveResult>
}

export async function fetchPlaybackSources(): Promise<PlaybackSourcesResult> {
  const res = await fetch(`${API_BASE}/playback/sources`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json() as Promise<PlaybackSourcesResult>
}

export async function fetchEpisodes(opts: {
  title: string
  alt?: string[]
}): Promise<EpisodesResult> {
  const params = new URLSearchParams({ title: opts.title.trim() })
  for (const a of opts.alt || []) {
    if (a.trim()) params.append('alt', a.trim())
  }
  const res = await fetch(`${API_BASE}/playback/episodes?${params}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json() as Promise<EpisodesResult>
}

export function buildProxyUrl(upstreamUrl: string): string {
  const path = `/playback/proxy?url=${encodeURIComponent(upstreamUrl)}`
  if (API_BASE.startsWith('http')) return `${API_BASE}${path}`
  return `${API_BASE}${path}`
}

export function watchPositionKey(animeId: string, episode: number): string {
  return `${WATCH_PREFIX}${animeId}:${episode}`
}

export function getWatchPosition(animeId: string, episode: number): number {
  const key = watchPositionKey(animeId, episode)
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return 0
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

export function setWatchPosition(animeId: string, episode: number, seconds: number): void {
  const key = watchPositionKey(animeId, episode)
  try {
    if (!Number.isFinite(seconds) || seconds < 1) {
      localStorage.removeItem(key)
      return
    }
    localStorage.setItem(key, String(Math.floor(seconds)))
  } catch {
    // quota / private mode
  }
  if (Number.isFinite(seconds) && seconds >= 1) {
    setLastPlayedEpisode(animeId, episode)
  }
}

export function clearWatchPosition(animeId: string, episode: number): void {
  try {
    localStorage.removeItem(watchPositionKey(animeId, episode))
  } catch {
    // ignore
  }
}

/** Playback enabled unless explicitly disabled. */
export function isPlaybackEnabled(): boolean {
  const flag = import.meta.env.VITE_PLAYBACK
  if (flag === '0' || flag === 'false') return false
  return true
}

const DANMU_PREFIX = 'mioani:danmu:'
const DANMU_MAX = 400

export interface LocalDanmu {
  text: string
  time?: number
  mode?: 0 | 1 | 2
  color?: string
  border?: boolean
}

function danmuStorageKey(animeId: string, episode: number): string {
  return `${DANMU_PREFIX}${animeId}:${Math.floor(episode)}`
}

export function loadLocalDanmus(animeId: string, episode: number): LocalDanmu[] {
  const id = (animeId || '').trim()
  if (!id || !Number.isFinite(episode) || episode < 1) return []
  try {
    const raw = localStorage.getItem(danmuStorageKey(id, episode))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((d): d is LocalDanmu => !!d && typeof d === 'object' && typeof (d as LocalDanmu).text === 'string')
      .map((d): LocalDanmu => {
        const mode: LocalDanmu['mode'] = d.mode === 1 || d.mode === 2 ? d.mode : 0
        return {
          text: String(d.text).slice(0, 200),
          time: typeof d.time === 'number' && Number.isFinite(d.time) ? d.time : undefined,
          mode,
          color: typeof d.color === 'string' ? d.color : undefined,
          border: !!d.border,
        }
      })
      .slice(0, DANMU_MAX)
  } catch {
    return []
  }
}

export function saveLocalDanmu(animeId: string, episode: number, danmu: LocalDanmu): void {
  const id = (animeId || '').trim()
  if (!id || !Number.isFinite(episode) || episode < 1) return
  const text = (danmu.text || '').trim()
  if (!text) return
  const list = loadLocalDanmus(id, episode)
  list.push({
    text: text.slice(0, 200),
    time: typeof danmu.time === 'number' && Number.isFinite(danmu.time) ? danmu.time : undefined,
    mode: danmu.mode === 1 || danmu.mode === 2 ? danmu.mode : 0,
    color: typeof danmu.color === 'string' ? danmu.color : undefined,
    border: true,
  })
  try {
    localStorage.setItem(danmuStorageKey(id, episode), JSON.stringify(list.slice(-DANMU_MAX)))
  } catch {
    // quota / private mode
  }
}
