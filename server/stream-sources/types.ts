export type StreamKind = 'hls' | 'progressive' | 'embed'

export type ProviderId = 'sorani' | 'ezdmw' | 'MXdm' | 'DM84'

export interface PlayableStream {
  url: string
  kind: StreamKind
  /** Public product source — always mioani to clients. */
  source: 'mioani'
}

export interface InternalStream {
  url: string
  kind: StreamKind
  provider: ProviderId
  episodeCount?: number
}

export type ResolveResult =
  | {
      playable: true
      stream: PlayableStream
      episode: number
      episodeCount?: number
      /** Which internal line succeeded (for source picker UI). */
      provider?: ProviderId
    }
  | {
      playable: false
      reason: 'unplayable'
      episode: number
    }

export interface EpisodeInfo {
  index: number
  label: string
  url?: string
}

export interface EpisodesResult {
  episodeCount: number
  episodes?: EpisodeInfo[]
  provider?: ProviderId
}

export interface ResolveRequest {
  title: string
  alt: string[]
  episode: number
  id?: string
  /** Prefer this provider first; on failure continue through the rest in order. */
  preferredProvider?: ProviderId
}

export interface ProviderInfo {
  id: ProviderId
  /** UI label — no upstream site brand names. */
  label: string
}

export interface AnimeStreamProvider {
  id: ProviderId
  resolve(req: ResolveRequest): Promise<InternalStream | null>
  listEpisodes?(req: Pick<ResolveRequest, 'title' | 'alt'>): Promise<EpisodesResult | null>
}
