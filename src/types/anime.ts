export type WatchStatus = 'watching' | 'completed' | 'planned' | 'paused' | 'dropped'

export interface Anime {
  id: string
  source: 'bangumi' | 'anilist' | 'local'
  title: string
  originalTitle: string
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
}

export interface ImportResult {
  source: 'bangumi' | 'anilist'
  items: Anime[]
  username: string
}
