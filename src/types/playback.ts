export type StreamKind = 'hls' | 'progressive' | 'embed'

/** Internal line id from API (not shown as site brand). */
export type PlaybackProviderId = 'sorani' | 'ezdmw' | 'MXdm' | 'DM84'

export type PlaybackSourceChoice = 'auto' | PlaybackProviderId

export interface PlayableStream {
  url: string
  kind: StreamKind
  /** Always `mioani` in product responses. */
  source: string
}

export type ResolveResult =
  | {
      playable: true
      stream: PlayableStream
      episode: number
      episodeCount?: number
      /** Which line succeeded (for source picker). */
      provider?: PlaybackProviderId | string
    }
  | {
      playable: false
      reason: 'unplayable'
      episode: number
    }

export interface EpisodeInfo {
  index: number
  label: string
}

export interface EpisodesResult {
  episodeCount: number
  episodes?: EpisodeInfo[]
}

export interface PlaybackSourceInfo {
  id: PlaybackProviderId
  label: string
}

export interface PlaybackSourcesResult {
  sources: PlaybackSourceInfo[]
  default: 'auto'
}
