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

export function defaultEpisode(watched: number, episodeCount?: number): number {
  const next = Math.max(1, Math.floor(watched || 0) + 1)
  if (episodeCount && episodeCount > 0) return Math.min(next, episodeCount)
  return next
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
