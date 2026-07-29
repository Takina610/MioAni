/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
  readonly VITE_PLAYBACK?: string
  /** Optional WebVTT sprite URL for progress-bar thumbnails (artplayer-plugin-vtt-thumbnail). */
  readonly VITE_PLAYBACK_THUMB_VTT?: string
  readonly VITE_BANGUMI_API_BASE?: string
  readonly VITE_BANGUMI_ACCESS_TOKEN?: string
  readonly VITE_ANILIST_API_BASE?: string
  readonly VITE_ANILIST_ACCESS_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'artplayer' {
  export default class Artplayer {
    constructor(option: Record<string, unknown>, isMergeOption?: boolean)
    static instances: Artplayer[]
    get video(): HTMLVideoElement
    hls?: unknown
    on(event: string, callback: (...args: unknown[]) => void): void
    destroy(removeHtml?: boolean): void
  }
}
