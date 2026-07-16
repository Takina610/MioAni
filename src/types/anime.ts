export type WatchStatus = 'watching' | 'completed' | 'planned' | 'paused' | 'dropped'

export interface AnimeTitles {
  cn?: string
  en?: string
  romaji?: string
  native?: string
}

export interface Anime {
  id: string
  source: 'bangumi' | 'anilist' | 'local'
  title: string
  originalTitle: string
  /** Extra title forms for cross-source matching and multilingual search. */
  titles?: AnimeTitles
  image: string
  banner?: string
  score: number
  year: number
  season: string
  episodes: number
  watched: number
  status: WatchStatus
  tags: string[]
  summary: string
  airDay?: string
  nextEpisode?: string
  popularity?: number
  /** Linked ids from other sources after merge, e.g. ['bgm-123', 'anilist-456'] */
  linkedIds?: string[]
}

export interface ImportResult {
  source: 'bangumi' | 'anilist'
  items: Anime[]
  username: string
}

export interface AnimeRelation {
  id: string
  title: string
  type: string
  image?: string
  format?: string
  status?: string
}

export interface AnimeCharacter {
  name: string
  role: string
  image?: string
  voiceActor?: string
  voiceActorImage?: string
}

export interface AnimeStaff {
  name: string
  role: string
  image?: string
}

export interface AnimeDetail extends Anime {
  studios?: string[]
  format?: string
  sourceMaterial?: string
  airDate?: string
  rank?: number
  scoreCount?: number
  duration?: number
  relations?: AnimeRelation[]
  characters?: AnimeCharacter[]
  staff?: AnimeStaff[]
}
