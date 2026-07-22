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
  /** e.g. bgm-char-1 | anilist-char-123 */
  id: string
  name: string
  role: string
  image?: string
  voiceActor?: string
  voiceActorImage?: string
  /** e.g. bgm-person-9 | anilist-staff-456 */
  voiceActorId?: string
}

export interface AnimeStaff {
  /** e.g. bgm-person-9 | anilist-staff-456 */
  id: string
  name: string
  role: string
  image?: string
}

/** Character or person (CV / staff) detail page payload. */
export interface PersonDetail {
  id: string
  kind: 'character' | 'person'
  source: 'bangumi' | 'anilist'
  name: string
  nameAlt?: string
  image?: string
  summary?: string
  gender?: string
  birthday?: string
  bloodType?: string
  careers?: string[]
  /** Context from the anime list (role in that work). */
  contextRole?: string
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
