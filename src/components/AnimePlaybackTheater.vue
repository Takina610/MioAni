<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import '../styles/pages/playback/theater.css'
import { PhArrowLeft, PhCaretDown, PhPlay, PhTranslate, PhX } from '@phosphor-icons/vue'
import type Artplayer from 'artplayer'
import { useLibraryStore } from '../stores/library'
import {
  fetchBangumiEpisodeMeta,
  fetchEpisodeComments,
  type BangumiEpisodeMeta,
} from '../services/bangumiComments'
import { shouldOfferTranslation, translateToChinese } from '../services/translate'
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
import type { PersonComment } from '../types/anime'
import type {
  EpisodeInfo,
  PlaybackSourceChoice,
  PlaybackSourceInfo,
  PlayableStream,
} from '../types/playback'

type PlayerModules = {
  Artplayer: typeof import('artplayer').default
  Hls: typeof import('hls.js').default
  artplayerPluginAutoThumbnail: typeof import('artplayer-plugin-auto-thumbnail').default
  artplayerPluginDanmuku: typeof import('artplayer-plugin-danmuku').default
  artplayerPluginVttThumbnail: typeof import('artplayer-plugin-vtt-thumbnail').default
}

let playerModulesPromise: Promise<PlayerModules> | null = null

function loadPlayerModules(): Promise<PlayerModules> {
  playerModulesPromise ??= Promise.all([
    import('artplayer'),
    import('hls.js'),
    import('artplayer-plugin-auto-thumbnail'),
    import('artplayer-plugin-danmuku'),
    import('artplayer-plugin-vtt-thumbnail'),
  ]).then(([artplayer, hls, autoThumbnail, danmuku, vttThumbnail]) => ({
    Artplayer: artplayer.default,
    Hls: hls.default,
    artplayerPluginAutoThumbnail: autoThumbnail.default,
    artplayerPluginDanmuku: danmuku.default,
    artplayerPluginVttThumbnail: vttThumbnail.default,
  }))
  return playerModulesPromise
}

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
/** Bangumi episode metadata: concrete episode names + ep ids (comments source). */
const bangumiEpisodes = ref<BangumiEpisodeMeta[]>([])
/** Right-side panel: existing line/episodes vs Bangumi episode comments. */
const asideTab = ref<'channels' | 'comments'>('channels')
/** Episode-name overlay (player top-left); follows player controls on touch. */
const epLabelVisible = ref(false)
/** Auto-translated episode name when Bangumi has no Chinese title. */
const translatedEpisodeName = ref('')
/** Custom line picker state (replaces the native <select>). */
const linePickerOpen = ref(false)
/** Draggable aside width (0 = default). */
const asideWidth = ref(0)
const asideDragging = ref(false)
let asideDragStartX = 0
let asideDragStartW = 0
/** Comments state (lazy-loaded when the comments tab is opened). */
const comments = ref<PersonComment[]>([])
const commentsLoading = ref(false)
const commentsError = ref('')
const commentsPage = ref(1)
const commentsTotal = ref(0)
const commentsHasMore = ref(false)
const commentsSentinelRef = ref<HTMLElement | null>(null)
const commentsLoadedFor = ref<number | null>(null)
const commentTranslations = ref<Record<string, string>>({})
const commentTranslating = ref<Record<string, boolean>>({})
const commentTranslateErrors = ref<Record<string, string>>({})

let art: Artplayer | null = null
let closed = false
let playGeneration = 0
let completedMarked = false
let positionTimer: ReturnType<typeof setInterval> | null = null
let commentsObserver: IntersectionObserver | null = null
let commentsLoadGeneration = 0

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

const currentEpisodeName = computed(() => {
  const meta = bangumiEpisodes.value.find((ep) => ep.sort === currentEpisode.value)
  return meta?.nameCn || translatedEpisodeName.value || meta?.name || ''
})

const currentEpisodeLabel = computed(() => {
  const name = currentEpisodeName.value
  return name ? `第 ${currentEpisode.value} 集 · ${name}` : `第 ${currentEpisode.value} 集`
})

const commentsCountLabel = computed(() => {
  return commentsTotal.value > comments.value.length
    ? `${comments.value.length}/${commentsTotal.value}`
    : String(commentsTotal.value || comments.value.length)
})

const lineOptions = computed(() => [
  { value: 'auto' as const, label: '自动' },
  ...sourceOptions.value.map((s) => ({ value: s.id, label: s.label })),
])

const preferredSourceLabel = computed(() => {
  return lineOptions.value.find((o) => o.value === preferredSource.value)?.label || '自动'
})

const defaultAsideWidth = () => Math.min(320, Math.floor(window.innerWidth * 0.28))

function onLinePickerToggle() {
  linePickerOpen.value = !linePickerOpen.value
}

function pickLine(value: 'auto' | PlaybackSourceChoice) {
  if (value === preferredSource.value && playStatus.value !== 'resolving') {
    linePickerOpen.value = false
    return
  }
  preferredSource.value = value
  linePickerOpen.value = false
  onSourceChange()
}

function onLinePickerPointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest?.('.playback-line-picker__menu')) return
  linePickerOpen.value = false
}

function onResizeHandlePointerDown(event: PointerEvent) {
  if (window.innerWidth <= 959) return
  asideDragging.value = true
  asideDragStartX = event.clientX
  asideDragStartW = asideWidth.value || defaultAsideWidth()
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  event.preventDefault()
}

function onResizeHandlePointerMove(event: PointerEvent) {
  if (!asideDragging.value) return
  const next = asideDragStartW + asideDragStartX - event.clientX
  asideWidth.value = Math.min(
    Math.max(Math.round(next), 240),
    Math.floor(window.innerWidth * 0.46),
  )
}

function onResizeHandlePointerUp(event: PointerEvent) {
  if (!asideDragging.value) return
  asideDragging.value = false
  ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
  try {
    localStorage.setItem('mioani:playback-aside-w', String(asideWidth.value))
  } catch {
    // ignore
  }
}

function restoreAsideWidth() {
  try {
    const saved = Number(localStorage.getItem('mioani:playback-aside-w'))
    if (Number.isFinite(saved) && saved >= 240 && saved <= window.innerWidth * 0.46) {
      asideWidth.value = Math.round(saved)
    }
  } catch {
    // ignore
  }
}

async function loadBangumiMeta() {
  try {
    const meta = await fetchBangumiEpisodeMeta(props.anime)
    if (closed || meta.length) bangumiEpisodes.value = meta
  } catch {
    // non-fatal — episode labels and comments fall back to "第 X 集" / empty state
  }
}

function resetCommentsState() {
  comments.value = []
  commentsPage.value = 1
  commentsTotal.value = 0
  commentsHasMore.value = false
  commentsError.value = ''
  commentTranslations.value = {}
  commentTranslating.value = {}
  commentTranslateErrors.value = {}
}

async function loadComments(reset = true) {
  if (commentsLoading.value || closed) return
  const generation = ++commentsLoadGeneration
  commentsLoading.value = true
  commentsError.value = ''
  const page = reset ? 1 : commentsPage.value + 1
  try {
    const result = await fetchEpisodeComments(props.anime, currentEpisode.value, page, 20)
    if (closed || generation !== commentsLoadGeneration) return
    if (result === null) {
      comments.value = []
      commentsTotal.value = 0
      commentsHasMore.value = false
      return
    }
    comments.value = reset ? result.items : [...comments.value, ...result.items]
    commentsPage.value = result.page
    commentsTotal.value = result.total
    commentsHasMore.value = result.hasMore
  } catch (err) {
    if (closed || generation !== commentsLoadGeneration) return
    commentsError.value = err instanceof Error ? err.message : '吐槽加载失败'
  } finally {
    if (generation === commentsLoadGeneration) commentsLoading.value = false
  }
}

function ensureComments() {
  if (commentsLoadedFor.value === currentEpisode.value && comments.value.length) return
  if (commentsLoadedFor.value === currentEpisode.value && commentsError.value) return
  commentsLoadedFor.value = currentEpisode.value
  void loadComments(true)
}

function setupCommentsObserver() {
  commentsObserver?.disconnect()
  commentsObserver = null
  if (!commentsSentinelRef.value || !commentsHasMore.value) return
  commentsObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadComments(false)
    },
    // Viewport-based root works for both the desktop inner-scroll panel and the
    // mobile page scroll: the sentinel only crosses the viewport when reached.
    { rootMargin: '480px 0px' },
  )
  commentsObserver.observe(commentsSentinelRef.value)
}

async function translateComment(id: string, text: string) {
  if (!text || commentTranslating.value[id]) return
  if (commentTranslations.value[id]) {
    const next = { ...commentTranslations.value }
    delete next[id]
    commentTranslations.value = next
    return
  }
  commentTranslating.value = { ...commentTranslating.value, [id]: true }
  commentTranslateErrors.value = { ...commentTranslateErrors.value, [id]: '' }
  try {
    const translated = await translateToChinese(text)
    commentTranslations.value = { ...commentTranslations.value, [id]: translated }
  } catch (reason) {
    commentTranslateErrors.value = {
      ...commentTranslateErrors.value,
      [id]: reason instanceof Error ? reason.message : '翻译失败',
    }
  } finally {
    commentTranslating.value = { ...commentTranslating.value, [id]: false }
  }
}

function selectAsideTab(next: 'channels' | 'comments') {
  if (asideTab.value === next) return
  asideTab.value = next
  if (next === 'comments') ensureComments()
  void nextTick().then(setupCommentsObserver)
}

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

async function createArtplayer(url: string, kind: PlayableStream['kind'], useProxy: boolean, generation: number): Promise<void> {
  if (closed || generation !== playGeneration) {
    throw new Error('playback_aborted')
  }
  const playerModules = await loadPlayerModules()
  return new Promise<void>((resolve, reject) => {
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

      art = new playerModules.Artplayer({
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
                playerModules.artplayerPluginVttThumbnail({
                  vtt: import.meta.env.VITE_PLAYBACK_THUMB_VTT.trim(),
                }),
              ]
            : [
                playerModules.artplayerPluginAutoThumbnail({
                  // Empty url → plugin samples the current Artplayer media (works for progressive;
                  // HLS may be limited by CORS / cross-origin frames).
                  width: 160,
                  number: 100,
                  scale: 0.25,
                }),
              ]),
          playerModules.artplayerPluginDanmuku({
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
            if (playerModules.Hls.isSupported()) {
              const hls = new playerModules.Hls({
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
              hls.on(playerModules.Hls.Events.MANIFEST_PARSED, () => {
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
              hls.on(playerModules.Hls.Events.ERROR, (_e, data) => {
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

      // Episode-name overlay follows the player controls (tap / hover chrome).
      art.on('controls:show', () => {
        epLabelVisible.value = true
      })
      art.on('controls:hide', () => {
        epLabelVisible.value = false
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
    // Close the line picker first; a second Escape closes the theater.
    if (linePickerOpen.value) {
      linePickerOpen.value = false
      return
    }
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
  restoreAsideWidth()
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('pointerdown', onLinePickerPointerDown)
  void loadSourceOptions()
  void loadEpisodeMeta()
  void loadBangumiMeta()
  void startPlayback(initial)
})

onBeforeUnmount(() => {
  playGeneration += 1
  commentsObserver?.disconnect()
  commentsObserver = null
  document.removeEventListener('pointerdown', onLinePickerPointerDown)
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
    bangumiEpisodes.value = []
    commentsLoadedFor.value = null
    resetCommentsState()
    void loadBangumiMeta()
    void startPlayback(1)
  },
)

watch(
  () => currentEpisode.value,
  () => {
    if (asideTab.value === 'comments') {
      resetCommentsState()
      commentsLoadedFor.value = currentEpisode.value
      void loadComments(true)
    } else {
      commentsLoadedFor.value = null
    }
  },
)

watch(
  () => [commentsHasMore.value, commentsLoading.value, asideTab.value],
  () => {
    void nextTick().then(setupCommentsObserver)
  },
)

// Auto-translate non-Chinese episode names for the overlay when Bangumi lacks name_cn.
let episodeNameTranslateGeneration = 0
watch(
  () => [bangumiEpisodes.value, currentEpisode.value],
  async () => {
    const generation = ++episodeNameTranslateGeneration
    const ep = currentEpisode.value
    const meta = bangumiEpisodes.value.find((m) => m.sort === ep)
    const name = meta?.name || ''
    if (meta?.nameCn || !name || !shouldOfferTranslation(name)) {
      if (generation === episodeNameTranslateGeneration) translatedEpisodeName.value = ''
      return
    }
    try {
      const translated = await translateToChinese(name)
      if (generation === episodeNameTranslateGeneration) {
        translatedEpisodeName.value = translated
      }
    } catch {
      if (generation === episodeNameTranslateGeneration) translatedEpisodeName.value = ''
    }
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

      <div
        class="playback-theater-body"
        :style="{ '--playback-aside-w': asideWidth ? `${asideWidth}px` : undefined }"
      >
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
            <div
              class="playback-ep-label"
              :class="{ 'is-visible': epLabelVisible }"
              aria-hidden="true"
            >
              {{ currentEpisodeLabel }}
            </div>
          </div>
        </main>

        <aside class="playback-theater-aside" aria-label="播放线路、选集与评论">
          <div
            class="playback-resize-handle"
            :class="{ 'is-dragging': asideDragging }"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整侧栏宽度"
            @pointerdown="onResizeHandlePointerDown"
            @pointermove="onResizeHandlePointerMove"
            @pointerup="onResizeHandlePointerUp"
            @pointercancel="onResizeHandlePointerUp"
          />
          <div class="playback-aside-tabs" role="tablist" aria-label="播放器侧栏">
            <button
              type="button"
              role="tab"
              :aria-selected="asideTab === 'channels'"
              :class="{ active: asideTab === 'channels' }"
              @click="selectAsideTab('channels')"
            >
              线路/集数
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="asideTab === 'comments'"
              :class="{ active: asideTab === 'comments' }"
              @click="selectAsideTab('comments')"
            >
              评论
              <sup v-if="commentsTotal">{{ commentsCountLabel }}</sup>
            </button>
          </div>

          <div
            v-show="asideTab === 'channels'"
            class="playback-aside-panel playback-aside-panel--channels"
          >
            <section class="playback-theater-aside-section playback-theater-line-section">
              <h2 id="playback-theater-line-heading" class="playback-theater-aside-title">线路</h2>
              <div class="playback-line-picker">
                <button
                  type="button"
                  class="playback-line-picker__trigger"
                  :class="{ 'is-open': linePickerOpen }"
                  :aria-expanded="linePickerOpen"
                  aria-haspopup="listbox"
                  :disabled="playStatus === 'resolving'"
                  aria-labelledby="playback-theater-line-heading"
                  @click="onLinePickerToggle"
                >
                  <span>{{ preferredSourceLabel }}</span>
                  <PhCaretDown :size="14" weight="bold" />
                </button>
                <Transition name="line-menu">
                  <div
                    v-if="linePickerOpen"
                    class="playback-line-picker__menu"
                    role="listbox"
                    aria-label="选择线路"
                  >
                    <button
                      v-for="opt in lineOptions"
                      :key="opt.value"
                      type="button"
                      role="option"
                      :aria-selected="preferredSource === opt.value"
                      :class="{ active: preferredSource === opt.value }"
                      @click="pickLine(opt.value)"
                    >
                      {{ opt.label }}
                    </button>
                  </div>
                </Transition>
              </div>
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
          </div>

          <div
            v-show="asideTab === 'comments'"
            class="playback-aside-panel playback-aside-panel--comments"
            role="tabpanel"
          >
            <div
              v-if="commentsLoading && !comments.length"
              class="playback-comment-skeletons"
              aria-label="正在读取 Bangumi 吐槽"
              aria-busy="true"
            >
              <article v-for="index in 4" :key="index" class="playback-comment-skeleton">
                <i class="playback-comment-skeleton__avatar" />
                <span>
                  <i class="playback-comment-skeleton__name" />
                  <i class="playback-comment-skeleton__line" />
                  <i class="playback-comment-skeleton__line playback-comment-skeleton__line--short" />
                </span>
              </article>
            </div>

            <div v-else-if="commentsError" class="playback-comments-error">
              <p>{{ commentsError }}</p>
              <button type="button" @click="loadComments(true)">重试</button>
            </div>

            <div v-else-if="comments.length" class="playback-comments">
              <article
                v-for="(comment, index) in comments"
                :key="comment.id"
                class="playback-comment"
                :class="index % 2 === 0 ? 'is-left' : 'is-right'"
              >
                <header class="playback-comment__head">
                  <strong>{{ comment.author }}</strong>
                  <time v-if="comment.time">{{ comment.time }}</time>
                </header>
                <p v-if="comment.replyTo" class="playback-comment__reply-to">回复 @{{ comment.replyTo }}</p>
                <p class="playback-comment__body">{{ comment.text }}</p>
                <button
                  v-if="shouldOfferTranslation(comment.text)"
                  type="button"
                  class="playback-comment-translate"
                  :disabled="commentTranslating[comment.id]"
                  @click="translateComment(comment.id, comment.text)"
                >
                  <PhTranslate :size="13" weight="bold" />
                  {{ commentTranslating[comment.id] ? '翻译中' : commentTranslations[comment.id] ? '隐藏翻译' : '翻译' }}
                </button>
                <div
                  v-if="commentTranslations[comment.id] || commentTranslateErrors[comment.id]"
                  class="playback-comment-translation"
                >
                  <p v-if="commentTranslations[comment.id]">{{ commentTranslations[comment.id] }}</p>
                  <p v-else class="is-error">{{ commentTranslateErrors[comment.id] }}</p>
                </div>
                <div v-if="comment.replies?.length" class="playback-comment-replies">
                  <article
                    v-for="reply in comment.replies"
                    :key="reply.id"
                    class="playback-comment-reply"
                  >
                    <header class="playback-comment__head">
                      <strong>{{ reply.author }}</strong>
                      <time v-if="reply.time">{{ reply.time }}</time>
                    </header>
                    <p v-if="reply.replyTo" class="playback-comment__reply-to">回复 @{{ reply.replyTo }}</p>
                    <p class="playback-comment__body">{{ reply.text }}</p>
                  </article>
                </div>
              </article>
            </div>

            <div v-else class="playback-comments-empty">
              <p>暂时没有抓到用户吐槽。</p>
            </div>

            <div
              v-if="commentsHasMore"
              ref="commentsSentinelRef"
              class="playback-comments-sentinel"
              aria-hidden="true"
            />
            <div v-if="commentsLoading && comments.length" class="playback-comments-loading" aria-busy="true">
              加载更多…
            </div>
          </div>
        </aside>
      </div>
    </div>
  </Teleport>
</template>
