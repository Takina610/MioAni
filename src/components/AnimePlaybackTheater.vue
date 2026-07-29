<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PhArrowLeft, PhPlay, PhX } from '@phosphor-icons/vue'
import Artplayer from 'artplayer'
import artplayerPluginAutoThumbnail from 'artplayer-plugin-auto-thumbnail'
import artplayerPluginDanmuku from 'artplayer-plugin-danmuku'
import artplayerPluginVttThumbnail from 'artplayer-plugin-vtt-thumbnail'
import Hls from 'hls.js'
import { useLibraryStore } from '../stores/library'
import {
  buildProxyUrl,
  defaultEpisode,
  fetchEpisodes,
  fetchPlaybackSources,
  getWatchPosition,
  loadLocalDanmus,
  pickPlaybackTitle,
  resolveStream,
  saveLocalDanmu,
  setLastPlayedEpisode,
  setWatchPosition,
} from '../services/playback'
import type { Anime } from '../types/anime'
import type {
  EpisodeInfo,
  PlaybackSourceChoice,
  PlaybackSourceInfo,
  PlayableStream,
} from '../types/playback'

const props = defineProps<{
  anime: Pick<
    Anime,
    'id' | 'title' | 'originalTitle' | 'titles' | 'episodes' | 'watched' | 'linkedIds' | 'year' | 'source' | 'image' | 'score' | 'season' | 'status' | 'tags' | 'summary'
  >
  /** Initial 1-based episode. */
  initialEpisode?: number
}>()

const emit = defineEmits<{
  close: []
}>()

const library = useLibraryStore()

type PlayStatus = 'resolving' | 'playing' | 'unplayable' | 'error'
const playStatus = ref<PlayStatus>('resolving')
const playError = ref('')
const usingProxy = ref(false)
const currentEpisode = ref(1)
const episodeCount = ref(0)
const episodeList = ref<EpisodeInfo[]>([])
const playerHost = ref<HTMLElement | null>(null)
/** User-selected preferred line; failure still auto-falls through remaining sources. */
const preferredSource = ref<PlaybackSourceChoice>('auto')
const sourceOptions = ref<PlaybackSourceInfo[]>([])
/** Line that actually resolved (from API). */
const activeProvider = ref<string>('')

let art: Artplayer | null = null
let closed = false
let playGeneration = 0
let completedMarked = false
let positionTimer: ReturnType<typeof setInterval> | null = null

const titleKeys = computed(() => pickPlaybackTitle(props.anime))
const titleLabel = computed(() => titleKeys.value.title || props.anime.title)

const sourceLabelMap = computed(() => {
  const map = new Map<string, string>()
  for (const s of sourceOptions.value) map.set(s.id, s.label)
  return map
})

const activeSourceLabel = computed(() => {
  if (!activeProvider.value) return ''
  return sourceLabelMap.value.get(activeProvider.value) || activeProvider.value
})

const statusHint = computed(() => {
  if (playStatus.value === 'resolving') return '正在解析可播放流…'
  if (playStatus.value === 'unplayable') return '暂不可播放'
  if (playStatus.value === 'error') return '播放出错'
  if (usingProxy.value) return '代理回退'
  const line = activeSourceLabel.value ? ` · ${activeSourceLabel.value}` : ''
  return `第 ${currentEpisode.value} 集${line}`
})

const episodeChips = computed(() => {
  if (episodeList.value.length) return episodeList.value
  const n = episodeCount.value || props.anime.episodes || 0
  if (n > 0) {
    return Array.from({ length: Math.min(n, 120) }, (_, i) => ({
      index: i + 1,
      label: String(i + 1),
    }))
  }
  // Unknown count: show a small window around current
  const cur = currentEpisode.value
  const start = Math.max(1, cur - 4)
  return Array.from({ length: 12 }, (_, i) => ({
    index: start + i,
    label: String(start + i),
  }))
})

function destroyPlayer() {
  if (positionTimer) {
    clearInterval(positionTimer)
    positionTimer = null
  }
  if (art) {
    try {
      art.destroy(false)
    } catch {
      /* ignore */
    }
    art = null
  }
}

function getVideoEl(): HTMLVideoElement | null {
  return (art?.video as HTMLVideoElement | undefined) || null
}

function persistPosition() {
  if (closed || !props.anime.id) return
  const v = getVideoEl()
  if (!v) return
  const t = v.currentTime
  if (t > 1) setWatchPosition(props.anime.id, currentEpisode.value, t)
}

function writeLibraryWatched(episode: number) {
  if (closed || !props.anime.id) return
  let lib = library.findInLibrary(props.anime)
  // library.add() resets watched for non-completed status; always follow with updateProgress.
  if (!lib) {
    library.add(
      {
        ...(props.anime as Anime),
        status: 'watching',
      } as Anime,
      'watching',
    )
    lib = library.findInLibrary(props.anime)
  }
  const id = lib?.id || props.anime.id
  const prev = lib?.watched ?? props.anime.watched ?? 0
  library.updateProgress(id, Math.max(prev, episode))
}

function maybeMarkCompleted() {
  if (completedMarked || closed || !props.anime.id) return
  const v = getVideoEl()
  if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return
  if (v.currentTime / v.duration < 0.9) return
  completedMarked = true
  writeLibraryWatched(currentEpisode.value)
}

function startPositionLoop() {
  if (positionTimer) clearInterval(positionTimer)
  positionTimer = setInterval(() => {
    persistPosition()
    maybeMarkCompleted()
  }, 5000)
}

function applyResume(video: HTMLVideoElement) {
  const pos = getWatchPosition(props.anime.id, currentEpisode.value)
  if (pos <= 0) return
  const seek = () => {
    try {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = Math.min(pos, Math.max(0, video.duration - 1))
      } else {
        video.currentTime = pos
      }
    } catch {
      /* ignore */
    }
  }
  if (video.readyState >= 1) seek()
  else video.addEventListener('loadedmetadata', seek, { once: true })
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.message === 'playback_aborted'
}

function createArtplayer(url: string, kind: PlayableStream['kind'], useProxy: boolean, generation: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (closed || generation !== playGeneration) {
      reject(new Error('playback_aborted'))
      return
    }
    const host = playerHost.value
    if (!host) {
      reject(new Error('player host missing'))
      return
    }

    destroyPlayer()
    if (closed || generation !== playGeneration) {
      reject(new Error('playback_aborted'))
      return
    }

    host.innerHTML = ''
    const playUrl = useProxy ? buildProxyUrl(url) : url
    usingProxy.value = useProxy

    let settled = false
    const fail = (err: Error) => {
      if (settled) return
      settled = true
      reject(err)
    }
    const ok = () => {
      if (settled) return
      settled = true
      resolve()
    }

    try {
      const episodeForDanmu = currentEpisode.value
      const localDanmus = props.anime.id
        ? loadLocalDanmus(props.anime.id, episodeForDanmu)
        : []

      art = new Artplayer({
        container: host,
        url: playUrl,
        volume: 0.85,
        autoplay: true,
        pip: true,
        fullscreen: true,
        fullscreenWeb: true,
        miniProgressBar: true,
        mutex: true,
        backdrop: true,
        playsInline: true,
        autoPlayback: false,
        theme: '#b8f05f',
        lang: 'zh-cn',
        plugins: [
          // Prefer WebVTT sprite sheet when available; otherwise sample frames from the playing media.
          ...(typeof import.meta.env.VITE_PLAYBACK_THUMB_VTT === 'string' &&
          import.meta.env.VITE_PLAYBACK_THUMB_VTT.trim()
            ? [
                artplayerPluginVttThumbnail({
                  vtt: import.meta.env.VITE_PLAYBACK_THUMB_VTT.trim(),
                }),
              ]
            : [
                artplayerPluginAutoThumbnail({
                  // Empty url → plugin samples the current Artplayer media (works for progressive;
                  // HLS may be limited by CORS / cross-origin frames).
                  width: 160,
                  number: 100,
                  scale: 0.25,
                }),
              ]),
          artplayerPluginDanmuku({
            danmuku: localDanmus,
            speed: 5,
            opacity: 1,
            fontSize: 25,
            color: '#FFFFFF',
            mode: 0,
            modes: [0, 1, 2],
            margin: [10, '15%'],
            antiOverlap: true,
            synchronousPlayback: true,
            visible: true,
            emitter: true,
            maxLength: 100,
            lockTime: 3,
            theme: 'dark',
            heatmap: false,
            async beforeEmit(danmu) {
              const text = (danmu?.text || '').trim()
              if (!text || text.length > 100) return false
              if (props.anime.id) {
                saveLocalDanmu(props.anime.id, episodeForDanmu, {
                  text,
                  time: typeof danmu.time === 'number' ? danmu.time : undefined,
                  mode: danmu.mode === 1 || danmu.mode === 2 ? danmu.mode : 0,
                  color: typeof danmu.color === 'string' ? danmu.color : '#FFFFFF',
                  border: true,
                })
              }
              return true
            },
            filter(danmu) {
              return !!(danmu?.text && String(danmu.text).trim().length <= 200)
            },
          }),
        ],
        moreVideoAttr: {
          // Proxy is same-origin; credentials only needed if API is cross-origin with cookies.
          crossOrigin: 'anonymous',
        },
        customType: {
          m3u8(video: HTMLVideoElement, src: string, playerInstance: Artplayer) {
            if (Hls.isSupported()) {
              const hls = new Hls({
                enableWorker: true,
                xhrSetup(xhr, reqUrl) {
                  try {
                    const u = new URL(reqUrl, window.location.origin)
                    if (
                      u.origin === window.location.origin ||
                      u.pathname.includes('/playback/proxy')
                    ) {
                      xhr.withCredentials = true
                    }
                  } catch {
                    if (reqUrl.includes('/playback/proxy')) xhr.withCredentials = true
                  }
                },
              })
              hls.loadSource(src)
              hls.attachMedia(video)
              playerInstance.hls = hls
              playerInstance.on('destroy', () => {
                hls.destroy()
              })
              hls.on(Hls.Events.MANIFEST_PARSED, () => {
                if (closed || generation !== playGeneration) {
                  hls.destroy()
                  fail(new Error('playback_aborted'))
                  return
                }
                applyResume(video)
                void video.play().catch(() => {})
                startPositionLoop()
                ok()
              })
              hls.on(Hls.Events.ERROR, (_e, data) => {
                if (!data.fatal || settled) return
                if (closed || generation !== playGeneration) {
                  fail(new Error('playback_aborted'))
                  return
                }
                fail(new Error(data.type || 'hls_error'))
              })
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
              video.src = src
              applyResume(video)
              void video.play().catch(() => {})
              startPositionLoop()
              ok()
            } else {
              fail(new Error('HLS not supported'))
            }
          },
        },
        // Treat classic m3u8 and disguised listres (ezdmw .webp playlist) as HLS.
        type:
          kind === 'hls' ||
          /\.m3u8(\?|$)/i.test(playUrl) ||
          /\/index\/listres\//i.test(url) ||
          /\/index\/listres\//i.test(playUrl)
            ? 'm3u8'
            : undefined,
      })

      art.on('ready', () => {
        if (closed || generation !== playGeneration) {
          fail(new Error('playback_aborted'))
          return
        }
        const video = art?.video as HTMLVideoElement | undefined
        const isHlsLike =
          kind === 'hls' ||
          /\.m3u8(\?|$)/i.test(playUrl) ||
          /\/index\/listres\//i.test(url) ||
          /\/index\/listres\//i.test(playUrl)
        // HLS settles via Hls.Events.MANIFEST_PARSED; progressive/embed settle on ready.
        if (!isHlsLike && video) {
          applyResume(video)
          startPositionLoop()
          ok()
        }
      })

      art.on('error', (err) => {
        if (settled) return
        if (closed || generation !== playGeneration) {
          fail(new Error('playback_aborted'))
          return
        }
        fail(err instanceof Error ? err : new Error(String(err) || 'artplayer_error'))
      })

      art.on('video:timeupdate', () => {
        maybeMarkCompleted()
      })

      art.on('video:ended', () => {
        persistPosition()
        // Always mark episode complete on natural end (even if duration metadata was flaky).
        if (!completedMarked && props.anime.id) {
          completedMarked = true
          writeLibraryWatched(currentEpisode.value)
        } else {
          maybeMarkCompleted()
        }
      })

      art.on('video:pause', () => {
        persistPosition()
      })

      setTimeout(() => {
        if (!settled) {
          fail(
            new Error(
              closed || generation !== playGeneration ? 'playback_aborted' : 'player_timeout',
            ),
          )
        }
      }, 25000)
    } catch (e) {
      fail(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

async function playUrl(stream: PlayableStream, useProxy: boolean, generation: number) {
  if (closed || generation !== playGeneration) throw new Error('playback_aborted')
  if (stream.kind === 'embed') {
    // Embed is last-resort (cross-origin player page). Prefer not to open third-party chrome;
    // try progressive attach once — usually fails; caller may surface unplayable.
    await createArtplayer(stream.url, 'progressive', false, generation)
    if (closed || generation !== playGeneration) throw new Error('playback_aborted')
    playStatus.value = 'playing'
    return
  }
  // Disguised listres playlists need proxy for correct Content-Type + segment rewrite.
  const forceHls =
    stream.kind === 'hls' || /\/index\/listres\//i.test(stream.url) || /\.m3u8(\?|$)/i.test(stream.url)
  await createArtplayer(stream.url, forceHls ? 'hls' : stream.kind, useProxy, generation)
  if (closed || generation !== playGeneration) throw new Error('playback_aborted')
  playStatus.value = 'playing'
}

function prefersProxyFirst(stream: PlayableStream): boolean {
  // ezdmw listres is often CORS-blocked and/or served as image/webp — proxy first.
  return /\/index\/listres\//i.test(stream.url) || /player\.ezdmw\.com|image\.ezdmw\.com|wdbed\.vip/i.test(stream.url)
}

async function tryPlayWithFallback(stream: PlayableStream, generation: number) {
  const order = prefersProxyFirst(stream) ? [true, false] : [false, true]
  let lastErr: unknown = null
  for (const useProxy of order) {
    try {
      await playUrl(stream, useProxy, generation)
      return
    } catch (err) {
      if (isAbortError(err) || closed || generation !== playGeneration) return
      lastErr = err
    }
  }
  playStatus.value = 'error'
  playError.value = lastErr instanceof Error ? lastErr.message : String(lastErr || 'playback_failed')
  destroyPlayer()
}

async function loadEpisodeMeta() {
  try {
    const result = await fetchEpisodes({
      title: titleKeys.value.title,
      alt: titleKeys.value.alt,
    })
    if (result.episodeCount > 0) episodeCount.value = result.episodeCount
    if (result.episodes?.length) episodeList.value = result.episodes
  } catch {
    // non-fatal — resolve still works
  }
}

async function loadSourceOptions() {
  try {
    const result = await fetchPlaybackSources()
    if (result.sources?.length) sourceOptions.value = result.sources
  } catch {
    sourceOptions.value = []
  }
}

async function startPlayback(episode?: number) {
  if (closed) return
  const ep = episode ?? currentEpisode.value
  currentEpisode.value = ep
  completedMarked = false
  if (props.anime.id) setLastPlayedEpisode(props.anime.id, ep)

  const generation = ++playGeneration
  destroyPlayer()
  playStatus.value = 'resolving'
  playError.value = ''
  usingProxy.value = false
  activeProvider.value = ''

  await nextTick()
  if (closed || generation !== playGeneration) return

  try {
    const result = await resolveStream({
      title: titleKeys.value.title,
      alt: titleKeys.value.alt,
      episode: ep,
      id: props.anime.id,
      provider: preferredSource.value,
    })
    if (closed || generation !== playGeneration) return
    if (!result.playable) {
      playStatus.value = 'unplayable'
      return
    }
    if (result.episodeCount) episodeCount.value = result.episodeCount
    if (result.provider) activeProvider.value = result.provider
    await tryPlayWithFallback(result.stream, generation)
  } catch (err) {
    if (closed || generation !== playGeneration || isAbortError(err)) return
    playStatus.value = 'error'
    playError.value = err instanceof Error ? err.message : String(err)
  }
}

function selectEpisode(ep: number) {
  if (ep === currentEpisode.value && playStatus.value === 'playing') return
  void startPlayback(ep)
}

function onSourceChange() {
  void startPlayback(currentEpisode.value)
}

function onRetry() {
  void startPlayback(currentEpisode.value)
}

function lockBodyScroll() {
  document.body.dataset.playbackTheater = '1'
  document.body.style.overflow = 'hidden'
}

function unlockBodyScroll() {
  delete document.body.dataset.playbackTheater
  document.body.style.overflow = ''
}

function closeTheater() {
  if (closed) return
  closed = true
  playGeneration += 1
  persistPosition()
  destroyPlayer()
  unlockBodyScroll()
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    closeTheater()
  }
}

onMounted(() => {
  const maxEp = props.anime.episodes || 0
  const libraryWatched = library.findInLibrary(props.anime)?.watched ?? 0
  const initial =
    props.initialEpisode && props.initialEpisode > 0
      ? props.initialEpisode
      : defaultEpisode(libraryWatched, maxEp || undefined, props.anime.id)
  currentEpisode.value = initial
  if (maxEp) episodeCount.value = maxEp

  lockBodyScroll()
  window.addEventListener('keydown', onKeydown)
  void loadSourceOptions()
  void loadEpisodeMeta()
  void startPlayback(initial)
})

onBeforeUnmount(() => {
  playGeneration += 1
  if (!closed) {
    closed = true
    persistPosition()
    destroyPlayer()
    unlockBodyScroll()
  }
  window.removeEventListener('keydown', onKeydown)
})

watch(
  () => props.anime.id,
  (next, prev) => {
    if (!prev || next === prev) return
    void startPlayback(1)
  },
)
</script>

<template>
  <Teleport to="body">
    <div class="playback-theater" role="dialog" aria-modal="true" aria-label="站内播放">
      <div class="playback-theater-backdrop" aria-hidden="true" />

      <header class="playback-theater-chrome">
        <button type="button" class="playback-theater-back" aria-label="关闭播放" @click="closeTheater">
          <PhArrowLeft :size="22" weight="bold" />
        </button>

        <div class="playback-theater-heading">
          <span class="playback-theater-brand">MioAni</span>
          <span class="playback-theater-title" :title="titleLabel">{{ titleLabel }}</span>
        </div>

        <div class="playback-theater-status" aria-live="polite">
          <span
            v-if="statusHint"
            class="playback-theater-status-text"
            :class="{
              'is-proxy': playStatus === 'playing' && usingProxy,
              'is-error': playStatus === 'error' || playStatus === 'unplayable',
            }"
          >
            {{ statusHint }}
          </span>
          <button type="button" class="playback-theater-close" aria-label="关闭" @click="closeTheater">
            <PhX :size="20" weight="bold" />
          </button>
        </div>
      </header>

      <div class="playback-theater-body">
        <main class="playback-theater-main">
          <div class="playback-theater-stage">
            <div v-if="playStatus === 'resolving'" class="playback-theater-state">
              <div class="playback-theater-spinner" aria-hidden="true" />
              <p class="playback-theater-state-label">正在解析可播放流…</p>
            </div>

            <div v-else-if="playStatus === 'unplayable'" class="playback-theater-state">
              <p class="playback-theater-state-title">暂不可播放</p>
              <p class="playback-theater-state-msg">
                当前无法解析该作品的可播放流。目录与元数据仍可浏览。
              </p>
              <div class="playback-theater-actions">
                <button type="button" class="btn-primary" @click="onRetry">
                  <PhPlay :size="16" weight="fill" />
                  重试
                </button>
                <button type="button" class="btn-ghost" @click="closeTheater">关闭</button>
              </div>
            </div>

            <div v-else-if="playStatus === 'error'" class="playback-theater-state">
              <p class="playback-theater-state-title">播放出错</p>
              <p class="playback-theater-state-msg is-error">
                {{ playError || '播放失败，请稍后重试。' }}
              </p>
              <div class="playback-theater-actions">
                <button type="button" class="btn-primary" @click="onRetry">
                  <PhPlay :size="16" weight="fill" />
                  重试
                </button>
                <button type="button" class="btn-ghost" @click="closeTheater">关闭</button>
              </div>
            </div>

            <div
              ref="playerHost"
              class="playback-theater-player"
              :class="{ 'is-visible': playStatus === 'playing' }"
            />
          </div>
        </main>

        <aside class="playback-theater-aside" aria-label="播放线路与选集">
          <section class="playback-theater-aside-section playback-theater-line-section">
            <h2 id="playback-theater-line-heading" class="playback-theater-aside-title">线路</h2>
            <label
              class="playback-theater-source"
              title="优先线路；失败时自动切换下一线路"
            >
              <select
                v-model="preferredSource"
                class="playback-theater-source-select"
                :disabled="playStatus === 'resolving'"
                aria-labelledby="playback-theater-line-heading"
                @change="onSourceChange"
              >
                <option value="auto">自动</option>
                <option v-for="src in sourceOptions" :key="src.id" :value="src.id">
                  {{ src.label }}
                </option>
              </select>
            </label>
            <p v-if="activeSourceLabel && preferredSource === 'auto'" class="playback-theater-active-line">
              当前：{{ activeSourceLabel }}
            </p>
          </section>

          <section class="playback-theater-aside-section playback-theater-episodes-section">
            <h2 id="playback-theater-episodes-heading" class="playback-theater-aside-title">选集</h2>
            <nav
              class="playback-theater-episodes"
              aria-labelledby="playback-theater-episodes-heading"
            >
              <button
                v-for="ep in episodeChips"
                :key="ep.index"
                type="button"
                class="playback-ep-chip"
                :class="{ active: ep.index === currentEpisode }"
                :disabled="playStatus === 'resolving'"
                :title="ep.label && ep.label !== String(ep.index) ? ep.label : `第 ${ep.index} 集`"
                :aria-label="ep.label && ep.label !== String(ep.index) ? ep.label : `第 ${ep.index} 集`"
                @click="selectEpisode(ep.index)"
              >
                {{ ep.index }}
              </button>
            </nav>
          </section>
        </aside>
      </div>
    </div>
  </Teleport>
</template>
