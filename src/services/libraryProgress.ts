import type { Anime } from '../types/anime'

export type LibraryProgressMode = 'tracking' | 'catching-up' | null

export function isAnimeReleasing(anime: Pick<Anime, 'airingStatus' | 'nextEpisode'>): boolean {
  if (anime.airingStatus === 'finished') return false
  return anime.airingStatus === 'releasing' || Boolean(anime.nextEpisode)
}

export function getLibraryProgress(
  anime: Pick<Anime, 'watched' | 'episodes' | 'airingStatus' | 'nextEpisode'>,
) {
  const watched = Math.max(0, Math.floor(anime.watched || 0))
  const available = Math.max(watched, Math.floor(anime.episodes || 0))
  const releasing = isAnimeReleasing(anime)
  const pending = Math.max(0, available - watched)
  const mode: LibraryProgressMode = pending <= 0
    ? null
    : releasing
      ? 'tracking'
      : 'catching-up'
  return {
    watched,
    available,
    pending,
    releasing,
    mode,
    canAdvance: pending > 0,
  }
}
