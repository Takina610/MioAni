import type { Anime } from '../types/anime'

export function isAnimeReleasing(anime: Pick<Anime, 'airingStatus' | 'nextEpisode'>): boolean {
  return anime.airingStatus === 'releasing' || Boolean(anime.nextEpisode)
}

export function getLibraryProgress(
  anime: Pick<Anime, 'watched' | 'episodes' | 'airingStatus' | 'nextEpisode'>,
) {
  const watched = Math.max(0, Math.floor(anime.watched || 0))
  const available = Math.max(watched, Math.floor(anime.episodes || 0))
  const releasing = isAnimeReleasing(anime)
  const pending = releasing ? Math.max(0, available - watched) : 0
  return {
    watched,
    available,
    pending,
    releasing,
    canAdvance: releasing && pending > 0,
  }
}
