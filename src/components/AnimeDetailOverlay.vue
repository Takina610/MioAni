<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  PhX,
  PhStar,
  PhCalendarBlank,
  PhFilmStrip,
  PhHash,
  PhArrowLeft,
  PhClock,
  PhCaretDown,
} from '@phosphor-icons/vue'
import { useDetailOverlayStore } from '../stores/detailOverlay'
import { usePersonOverlayStore } from '../stores/personOverlay'
import { useLibraryStore } from '../stores/library'
import { parsePersonId, personRouteName } from '../services/personIds'
import type { AnimeCharacter, AnimeRelation, AnimeStaff, WatchStatus } from '../types/anime'

const store = useDetailOverlayStore()
const personOverlay = usePersonOverlayStore()
const library = useLibraryStore()
const route = useRoute()
const router = useRouter()

const posterSlotRef = ref<HTMLElement | null>(null)
const flyerRef = ref<HTMLElement | null>(null)
const surfaceRef = ref<HTMLElement | null>(null)
// Keep slot mounted for layout parity with flyer target geometry.
void posterSlotRef
/** True once flyer has landed and in-flow poster is shown. */
const settled = ref(false)
const contentReady = ref(false)
/** Frozen poster URL for shared-element flight (must not follow stack pop mid-animation). */
const flyerImage = ref('')
/** In-flow poster: only swapped after decode so HD replace never flashes empty. */
const posterSrc = ref('')
/** Banner bg: start from seed art, upgrade to real banner only after decode. */
const bannerSrc = ref('')
type DetailTab = 'overview' | 'characters' | 'staff' | 'relations'
const tab = ref<DetailTab>('overview')
const tabsRef = ref<HTMLElement | null>(null)
const indicatorStyle = ref({ width: '0px', transform: 'translateX(0px)' })
const DETAIL_TABS: { id: DetailTab; label: string }[] = [
  { id: 'overview', label: '概览' },
  { id: 'relations', label: '关联作品' },
  { id: 'characters', label: '角色 / CV' },
  { id: 'staff', label: '制作人员' },
]
/** Infinite-scroll batch size for full lists. */
const EXTRA_BATCH = 12
type ExtraSection = 'relations' | 'characters' | 'staff'
const visibleByTab = ref<Record<ExtraSection, number>>({
  relations: EXTRA_BATCH,
  characters: EXTRA_BATCH,
  staff: EXTRA_BATCH,
})
const loadingMoreExtra = ref(false)
const extraSentinelRef = ref<HTMLElement | null>(null)
/** Mobile: meta board collapsed so tabs content stays above the fold. */
const metaExpanded = ref(false)
let extraObserver: IntersectionObserver | null = null
let extraLoadTimer: ReturnType<typeof setTimeout> | null = null
/**
 * Bumps only when overview for the current id finishes loading.
 * Keeps soft-enter tied to this open's data, not leftover previous anime text.
 */
const contentEpoch = ref(0)
/** Circle reveal origin in viewport % (from clicked card). */
const revealOrigin = ref({ x: 50, y: 45 })
let animTimer: ReturnType<typeof setTimeout> | null = null
let closing = false
let lastOverviewId = ''

/** Per-layer UI snapshot so stack return restores tab/scroll/poster instead of re-mounting. */
type LayerUiState = {
  tab: DetailTab
  visibleByTab: Record<ExtraSection, number>
  metaExpanded: boolean
  scrollTop: number
  contentEpoch: number
  lastOverviewId: string
  posterSrc: string
  bannerSrc: string
}
const layerUiByKey = new Map<string, LayerUiState>()

function defaultVisibleByTab(): Record<ExtraSection, number> {
  return {
    relations: EXTRA_BATCH,
    characters: EXTRA_BATCH,
    staff: EXTRA_BATCH,
  }
}

function layerPosterUrl(layer: { detail?: { image?: string; banner?: string } | null; seed?: { image?: string; banner?: string } } | null | undefined) {
  return layer?.detail?.image || layer?.seed?.image || ''
}

function layerBannerUrl(layer: { detail?: { image?: string; banner?: string } | null; seed?: { image?: string; banner?: string } } | null | undefined) {
  return layer?.detail?.banner || layer?.seed?.banner || layer?.detail?.image || layer?.seed?.image || ''
}

function captureLayerUi(key: string | undefined | null) {
  if (!key) return
  const scrollEl = surfaceRef.value?.querySelector?.('.detail-scroll') as HTMLElement | null
  layerUiByKey.set(key, {
    tab: tab.value,
    visibleByTab: { ...visibleByTab.value },
    metaExpanded: metaExpanded.value,
    scrollTop: scrollEl?.scrollTop || 0,
    contentEpoch: contentEpoch.value,
    lastOverviewId: lastOverviewId,
    posterSrc: posterSrc.value || display.value?.image || '',
    bannerSrc: bannerSrc.value || display.value?.banner || display.value?.image || '',
  })
}

function restoreLayerUi(key: string | undefined | null, opts?: { posterFallback?: string; bannerFallback?: string }) {
  if (!key) return
  const saved = layerUiByKey.get(key)
  if (!saved) {
    tab.value = 'overview'
    visibleByTab.value = defaultVisibleByTab()
    metaExpanded.value = false
    const fallback = opts?.posterFallback || ''
    if (fallback) posterSrc.value = fallback
    if (opts?.bannerFallback) bannerSrc.value = opts.bannerFallback
    return
  }
  tab.value = saved.tab
  visibleByTab.value = { ...saved.visibleByTab }
  metaExpanded.value = saved.metaExpanded
  contentEpoch.value = saved.contentEpoch
  lastOverviewId = saved.lastOverviewId
  // Immediate poster/banner swap (parent art already decoded earlier — no await flash).
  posterSrc.value = saved.posterSrc || opts?.posterFallback || posterSrc.value
  bannerSrc.value = saved.bannerSrc || opts?.bannerFallback || bannerSrc.value
  void nextTick(() => {
    const scrollEl = surfaceRef.value?.querySelector?.('.detail-scroll') as HTMLElement | null
    if (scrollEl) scrollEl.scrollTop = saved.scrollTop
    updateTabIndicator()
  })
}

/** Soft-upgrade banner only after decode; keep current art if same URL. */
async function setBannerSrc(src: string) {
  if (!src || src === bannerSrc.value) return
  const ok = await preloadImage(src)
  if (ok || !bannerSrc.value) bannerSrc.value = src
}

function forgetLayerUi(key: string | undefined | null) {
  if (key) layerUiByKey.delete(key)
}

function preloadImage(src: string): Promise<boolean> {
  if (!src) return Promise.resolve(false)
  return new Promise((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    const done = (ok: boolean) => resolve(ok)
    img.onload = () => {
      if (typeof img.decode === 'function') {
        img.decode().then(() => done(true)).catch(() => done(true))
      } else {
        done(true)
      }
    }
    img.onerror = () => done(false)
    img.src = src
  })
}

/** Swap static poster only after the bitmap is ready (kills HD-replace flash). */
async function setPosterSrc(src: string, opts?: { force?: boolean }) {
  if (!src) return false
  if (!opts?.force && src === posterSrc.value) return true
  const ok = await preloadImage(src)
  if (!ok) {
    // Still assign so we show something; avoid infinite empty slot.
    posterSrc.value = src
    return false
  }
  posterSrc.value = src
  return true
}

function updateTabIndicator() {
  const root = tabsRef.value
  if (!root) return
  const active = root.querySelector<HTMLElement>('button.active')
  if (!active) {
    indicatorStyle.value = { width: '0px', transform: 'translateX(0px)' }
    return
  }
  indicatorStyle.value = {
    width: `${active.offsetWidth}px`,
    transform: `translateX(${active.offsetLeft}px)`,
  }
}

function setRevealOriginFromRect(rect: { top: number; left: number; width: number; height: number } | null) {
  if (!rect) {
    revealOrigin.value = { x: 50, y: 42 }
    return
  }
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const vw = Math.max(window.innerWidth, 1)
  const vh = Math.max(window.innerHeight, 1)
  revealOrigin.value = {
    x: Math.min(100, Math.max(0, (cx / vw) * 100)),
    y: Math.min(100, Math.max(0, (cy / vh) * 100)),
  }
}

/**
 * Circular wipe from click origin.
 * Uses a soft radial mask (feathered edge) so the circle reads clearly
 * and the rim has a transitional color, not a hard cut.
 */
function applySurfaceReveal(open: boolean, withTransition: boolean) {
  const el = surfaceRef.value
  if (!el) return
  const { x, y } = revealOrigin.value
  el.style.setProperty('--reveal-x', `${x}%`)
  el.style.setProperty('--reveal-y', `${y}%`)
  // Slightly longer than flyer so the circle is readable as its own motion.
  const ms = open ? Math.round(FLIGHT_MS * 1.18) : Math.round(CLOSE_MS * 1.08)
  const ease = 'cubic-bezier(.16,.84,.24,1)'
  // Opacity lags slightly so the circle edge stays readable longer than a plain fade.
  const opacityMs = open ? Math.round(ms * 0.55) : Math.round(ms * 0.72)
  const opacityDelay = open ? 0 : Math.round(ms * 0.18)
  el.style.transition = withTransition
    ? [
        `opacity ${opacityMs}ms ${ease} ${opacityDelay}ms`,
        `transform ${ms}ms ${ease}`,
        `--reveal-r ${ms}ms ${ease}`,
        `box-shadow ${ms}ms ${ease}`,
      ].join(', ')
    : 'none'
  if (open) {
    el.style.opacity = '1'
    el.style.transform = 'scale(1)'
    el.style.setProperty('--reveal-r', '150%')
    el.style.boxShadow = 'inset 0 0 0 0 rgba(184,240,95,0)'
  } else {
    el.style.opacity = '0'
    el.style.transform = 'scale(.994)'
    el.style.setProperty('--reveal-r', '0%')
    el.style.boxShadow = 'inset 0 0 140px 0 rgba(184,240,95,.08)'
  }
}

const display = computed(() => store.detail || store.seed)
const libraryItem = computed(() => (display.value ? library.findInLibrary(display.value) : undefined))
const detail = computed(() => store.detail)

const STATUS_OPTIONS: { value: WatchStatus; label: string }[] = [
  { value: 'watching', label: '在看' },
  { value: 'completed', label: '看过' },
  { value: 'planned', label: '想看' },
]

const sideFacts = computed(() => {
  const d = detail.value
  const item = display.value
  if (!item) return [] as Array<{ label: string; value: string }>
  const facts: Array<{ label: string; value: string }> = []
  if (d?.format || item.season) facts.push({ label: '格式', value: String(d?.format || item.season || '—') })
  if (item.episodes) facts.push({ label: '话数', value: `${item.episodes}` })
  if (d?.duration) facts.push({ label: '单集时长', value: `${d.duration} 分钟` })
  if (item.year) facts.push({ label: '年份', value: `${item.year}` })
  if (d?.airDate) facts.push({ label: '开播', value: d.airDate })
  if (d?.studios?.length) facts.push({ label: '制作', value: d.studios.join(' / ') })
  if (d?.sourceMaterial) facts.push({ label: '原作', value: d.sourceMaterial })
  if (item.score) facts.push({ label: '评分', value: item.score.toFixed(1) })
  if (d?.rank) facts.push({ label: '排名', value: `#${d.rank}` })
  facts.push({ label: '来源', value: item.source })
  return facts
})

const FLIGHT_MS = 780
const CLOSE_MS = 720

/**
 * Locked poster target — matches CSS:
 * detail-scroll padding-top: max(64px, safe+48)
 * header align-items: start (no vertical shift from text height)
 */
function getTargetPosterRect() {
  const vw = window.innerWidth
  const safeTop = Number(getComputedStyle(document.documentElement).paddingTop.replace('px', '')) || 0
  const padX = Math.min(48, Math.max(16, vw * 0.04))
  const padTop = Math.max(64, safeTop + 48)
  const width = vw <= 640 ? Math.min(180, vw * 0.48) : vw <= 900 ? 132 : 180
  const height = width * 1.5
  if (vw <= 640) {
    return { top: padTop, left: (vw - width) / 2, width, height }
  }
  return { top: padTop, left: padX, width, height }
}

function flush(el: HTMLElement) {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  el.getBoundingClientRect()
}

/**
 * Shared-element flyer: park at origin (card rect) first so the poster never
 * disappears before flight starts, then animate to target geometry.
 */
function placeFlyerAtOrigin(
  origin: { top: number; left: number; width: number; height: number },
  radius = 12,
) {
  const el = flyerRef.value
  if (!el) return
  el.style.transition = 'none'
  el.style.top = `${origin.top}px`
  el.style.left = `${origin.left}px`
  el.style.width = `${origin.width}px`
  el.style.height = `${origin.height}px`
  el.style.borderRadius = `${radius}px`
  el.style.transformOrigin = 'top left'
  el.style.transform = 'none'
  el.style.opacity = '1'
  el.style.visibility = 'visible'
}

function placeFlyerAtTarget(
  target: { top: number; left: number; width: number; height: number },
  radius: number,
) {
  const el = flyerRef.value
  if (!el) return
  el.style.transition = 'none'
  el.style.top = `${target.top}px`
  el.style.left = `${target.left}px`
  el.style.width = `${target.width}px`
  el.style.height = `${target.height}px`
  el.style.borderRadius = `${radius}px`
  el.style.transformOrigin = 'top left'
  el.style.transform = 'none'
}

function playFlyerToTarget(
  origin: { top: number; left: number; width: number; height: number },
  target: { top: number; left: number; width: number; height: number },
  durationMs: number,
) {
  const el = flyerRef.value
  if (!el) return
  // Flyer is already parked at origin; invert matrix then play to identity at target.
  const sx = target.width / Math.max(origin.width, 0.001)
  const sy = target.height / Math.max(origin.height, 0.001)
  const dx = target.left - origin.left
  const dy = target.top - origin.top
  el.style.transition = 'none'
  el.style.top = `${origin.top}px`
  el.style.left = `${origin.left}px`
  el.style.width = `${origin.width}px`
  el.style.height = `${origin.height}px`
  el.style.borderRadius = '12px'
  el.style.transformOrigin = 'top left'
  el.style.transform = 'none'
  el.style.opacity = '1'
  el.style.visibility = 'visible'
  flush(el)
  // Next frame: animate to target via transform scale+translate (GPU).
  requestAnimationFrame(() => {
    el.style.transition = [
      `transform ${durationMs}ms cubic-bezier(.22,1,.36,1)`,
      `border-radius ${durationMs}ms cubic-bezier(.22,1,.36,1)`,
      `width ${durationMs}ms cubic-bezier(.22,1,.36,1)`,
      `height ${durationMs}ms cubic-bezier(.22,1,.36,1)`,
      `top ${durationMs}ms cubic-bezier(.22,1,.36,1)`,
      `left ${durationMs}ms cubic-bezier(.22,1,.36,1)`,
    ].join(', ')
    el.style.top = `${target.top}px`
    el.style.left = `${target.left}px`
    el.style.width = `${target.width}px`
    el.style.height = `${target.height}px`
    el.style.borderRadius = '14px'
    el.style.transform = 'none'
    void sx
    void sy
    void dx
    void dy
  })
}

function playFlyerToOrigin(
  origin: { top: number; left: number; width: number; height: number },
  target: { top: number; left: number; width: number; height: number },
  durationMs: number,
) {
  const el = flyerRef.value
  if (!el) return
  // Start at target (detail poster), animate back to origin (card).
  el.style.transition = 'none'
  el.style.top = `${target.top}px`
  el.style.left = `${target.left}px`
  el.style.width = `${target.width}px`
  el.style.height = `${target.height}px`
  el.style.borderRadius = '14px'
  el.style.transformOrigin = 'top left'
  el.style.transform = 'none'
  el.style.opacity = '1'
  el.style.visibility = 'visible'
  flush(el)
  requestAnimationFrame(() => {
    el.style.transition = [
      `top ${durationMs}ms cubic-bezier(.22,1,.36,1)`,
      `left ${durationMs}ms cubic-bezier(.22,1,.36,1)`,
      `width ${durationMs}ms cubic-bezier(.22,1,.36,1)`,
      `height ${durationMs}ms cubic-bezier(.22,1,.36,1)`,
      `border-radius ${durationMs}ms cubic-bezier(.22,1,.36,1)`,
    ].join(', ')
    el.style.top = `${origin.top}px`
    el.style.left = `${origin.left}px`
    el.style.width = `${origin.width}px`
    el.style.height = `${origin.height}px`
    el.style.borderRadius = '12px'
  })
}

/**
 * Card → detail: park flyer ON the card first (no blank), then fly to poster slot.
 */
async function runExpand() {
  closing = false
  settled.value = false
  contentReady.value = false
  tab.value = 'overview'
  const flightArt = display.value?.image || flyerImage.value
  flyerImage.value = flightArt
  // Seed banner with card art so CSS bg never starts empty / mid-swap.
  if (!bannerSrc.value || store.expandMode !== 'stack') {
    bannerSrc.value = flightArt || display.value?.banner || display.value?.image || ''
  }
  // Keep previous poster painted until this layer's art is preloaded (no empty slot flash).
  if (flightArt) void preloadImage(flightArt)
  await nextTick()

  const origin = store.originRect || store.topLayer?.originRect || null
  setRevealOriginFromRect(origin)
  applySurfaceReveal(false, false)

  const flyer = flyerRef.value
  const target = getTargetPosterRect()

  if (!flyer) {
    store.phase = 'open'
    requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        applySurfaceReveal(true, true)
        contentReady.value = true
        await setPosterSrc(flightArt || display.value?.image || '')
        settled.value = true
      })
    })
    return
  }

  // 1) Cover the source card immediately so hiding the card image is seamless.
  if (origin) {
    placeFlyerAtOrigin(origin, 12)
  } else {
    placeFlyerAtTarget(target, 14)
    flyer.style.opacity = '0'
    flyer.style.visibility = 'visible'
  }
  flush(flyer)
  if (surfaceRef.value) flush(surfaceRef.value)

  // 2) Only now hide the source card chrome (flyer already covers it).
  document.documentElement.classList.add('detail-flight-active')

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (closing) return
      applySurfaceReveal(true, true)
      if (origin) {
        playFlyerToTarget(origin, target, FLIGHT_MS)
      } else {
        flyer.style.transition = `opacity ${FLIGHT_MS}ms ease`
        flyer.style.opacity = '1'
      }
      store.phase = 'open'
      contentReady.value = true

      if (animTimer) clearTimeout(animTimer)
      animTimer = setTimeout(() => {
        if (closing) return
        // Decode in-flow poster under the still-visible flyer, then hand off once.
        void (async () => {
          const landSrc = display.value?.image || flightArt
          await setPosterSrc(landSrc)
          if (closing) return
          settled.value = true
          await nextTick()
          flyer.style.transition = 'opacity .1s linear'
          flyer.style.opacity = '0'
          window.setTimeout(() => {
            if (closing) return
            flyer.style.visibility = 'hidden'
            flyer.style.transition = 'none'
            flyer.style.transform = 'none'
            flyer.style.opacity = '1'
            document.documentElement.classList.remove('detail-flight-active')
          }, 100)
        })()
      }, FLIGHT_MS)
    })
  })
}

function resetSurfaceToOpen() {
  const el = surfaceRef.value
  if (!el) return
  el.style.transition = 'none'
  el.style.opacity = '1'
  el.style.transform = 'scale(1)'
  el.style.setProperty('--reveal-r', '150%')
  el.style.boxShadow = 'inset 0 0 0 0 rgba(184,240,95,0)'
  // Drop any temporary inline mask overrides so CSS radial mask works again.
  el.style.webkitMaskImage = ''
  el.style.maskImage = ''
  flush(el)
}

/**
 * Pop one layer back to the already-loaded parent detail.
 * Buried shells are incomplete (header only), so we never circle-collapse the whole surface.
 * Instead: swap to parent UI immediately (preserved snapshot), flyer alone returns to origin.
 */
async function popDetailStack(opts: { fromBrowserBack?: boolean } = {}) {
  if (!store.canPopDetail || closing) return

  closing = true
  if (animTimer) clearTimeout(animTimer)

  const outgoing = store.topLayer
  const parent = store.layers[store.layers.length - 2] || null
  const outgoingImage = display.value?.image || flyerImage.value || posterSrc.value
  const parentImage = layerPosterUrl(parent)
  // Snapshot current (outgoing) UI before swap; parent snapshot was taken when opening related.
  captureLayerUi(outgoing?.key)

  const origin = store.resolvePopOrigin()
  const target = getTargetPosterRect()
  // Flyer keeps child art for the return flight; slot switches to parent immediately.
  flyerImage.value = outgoingImage
  store.beginStackReturn()

  // Park flyer on the outgoing poster, then swap the page to parent underneath.
  const flyer = flyerRef.value
  if (flyer) {
    placeFlyerAtTarget(target, 14)
    flyer.style.opacity = '1'
    flyer.style.visibility = 'visible'
    flush(flyer)
  }

  const removed = store.applyStackPop()
  forgetLayerUi(removed?.key)
  const parentKey = parent?.key || store.topLayer?.key
  const parentBanner = layerBannerUrl(parent)
  restoreLayerUi(parentKey, { posterFallback: parentImage, bannerFallback: parentBanner })
  // Hard-assign parent poster/banner so art is never the child cover after pop.
  posterSrc.value = parentImage || layerUiByKey.get(parentKey || '')?.posterSrc || posterSrc.value
  bannerSrc.value = parentBanner || layerUiByKey.get(parentKey || '')?.bannerSrc || bannerSrc.value
  if (parentImage) void preloadImage(parentImage)
  if (parentBanner) void preloadImage(parentBanner)
  // Parent page is already fully loaded in store — keep chrome visible, no re-fetch flash.
  contentReady.value = true
  settled.value = true
  resetSurfaceToOpen()
  applySurfaceReveal(true, false)
  await nextTick()
  restoreLayerUi(parentKey, { posterFallback: parentImage })
  if (parentImage) posterSrc.value = parentImage

  document.documentElement.classList.add('detail-flight-active')

  if (flyer && origin) {
    flyerImage.value = outgoingImage
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        playFlyerToOrigin(origin, target, CLOSE_MS)
      })
    })
  } else if (flyer) {
    requestAnimationFrame(() => {
      flyer.style.transition = `opacity ${CLOSE_MS}ms ease`
      flyer.style.opacity = '0'
    })
  }

  animTimer = setTimeout(async () => {
    const parentArt = (store.detail || store.seed)?.image || parentImage || ''
    posterSrc.value = parentArt || posterSrc.value
    flyerImage.value = parentArt
    if (flyer) {
      flyer.style.visibility = 'hidden'
      flyer.style.transition = 'none'
      flyer.style.transform = 'none'
      flyer.style.opacity = '1'
    }
    document.documentElement.classList.remove('detail-flight-active')
    closing = false
    store.phase = 'open'
    store.expandMode = store.layers.length > 1 ? 'stack' : 'list'
    const id = store.activeId
    if (!opts.fromBrowserBack && id && router.currentRoute.value.name === 'anime-detail') {
      if (router.currentRoute.value.params.id !== id) {
        await router.replace({ name: 'anime-detail', params: { id } })
      }
    }
    restoreLayerUi(store.topLayer?.key, { posterFallback: parentArt })
    if (parentArt) posterSrc.value = parentArt
    updateTabIndicator()
  }, CLOSE_MS + 40)
}

/** Fully dismiss overlay to list (X button / final back). */
async function dismissToList() {
  if (!store.open || store.phase === 'collapsing' || closing) return
  closing = true
  if (animTimer) clearTimeout(animTimer)

  // Always return the FIRST opened detail (list card) — not the top of a related stack.
  const rootLayer = store.layers[0] || store.topLayer
  const rootImage = layerPosterUrl(rootLayer) || posterSrc.value || flyerImage.value
  const rootBanner = layerBannerUrl(rootLayer) || rootImage

  // Collapse stack to root immediately so surface + flyer art match the list card.
  if (store.layers.length > 1 && rootLayer) {
    store.layers = [rootLayer]
  }
  flyerImage.value = rootImage
  posterSrc.value = rootImage
  bannerSrc.value = rootBanner
  restoreLayerUi(rootLayer?.key, { posterFallback: rootImage, bannerFallback: rootBanner })
  if (rootImage) posterSrc.value = rootImage

  store.beginCollapse()
  contentReady.value = false
  layerUiByKey.clear()
  document.documentElement.classList.add('detail-flight-active')

  const flyer = flyerRef.value
  const origin = store.resolveCloseOrigin()
  if (origin) store.originRect = origin
  setRevealOriginFromRect(origin)
  const target = getTargetPosterRect()
  await nextTick()

  // Cover root poster first so reverse flight never blanks / never uses child art.
  if (flyer && origin) {
    placeFlyerAtTarget(target, 14)
    flyer.style.opacity = '1'
    flyer.style.visibility = 'visible'
    flush(flyer)
  }
  settled.value = false
  // Instantly clear surface + scrim blur (no fade that leaves the list frosted).
  applySurfaceReveal(true, false)
  if (surfaceRef.value) flush(surfaceRef.value)

  if (flyer && origin) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        applySurfaceReveal(false, true)
        playFlyerToOrigin(origin, target, CLOSE_MS)
      })
    })
  } else if (flyer) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        applySurfaceReveal(false, true)
        flyer.style.transition = `opacity ${CLOSE_MS}ms ease`
        flyer.style.opacity = '0'
      })
    })
  } else {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => applySurfaceReveal(false, true))
    })
  }

  animTimer = setTimeout(async () => {
    const back = store.returnPath || '/'
    const shouldNavigate = router.currentRoute.value.name === 'anime-detail'
    // Flyer is already sitting on the card; reveal card under it then unmount.
    document.documentElement.classList.remove('detail-flight-active')
    store.finishClose()
    closing = false
    settled.value = false
    contentReady.value = false
    flyerImage.value = ''
    posterSrc.value = ''
    bannerSrc.value = ''
    if (shouldNavigate && router.currentRoute.value.name === 'anime-detail') {
      await router.replace(back)
    }
  }, CLOSE_MS + 40)
}

async function closeOverlay() {
  if (!store.open || store.phase === 'collapsing' || store.phase === 'returning' || closing) return

  // Back button: previous detail if stacked, else list.
  // Always pop the in-app stack first and sync the route with replace.
  // Using history.back() races with the route watcher and can leave the surface
  // mid-collapse (blurred list + wrong flyer image).
  if (store.canPopDetail) {
    await popDetailStack()
    return
  }

  await dismissToList()
}

watch(
  () => store.closeSignal,
  () => {
    // X / external dismiss always closes fully to list.
    if (store.open) void dismissToList()
  },
)

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && store.open) {
    if (store.canPopDetail) void closeOverlay()
    else void dismissToList()
  }
}

function setStatus(status: WatchStatus) {
  if (!display.value) return
  library.add(display.value, status)
}

function removeFromLibrary() {
  if (!display.value) return
  library.remove(libraryItem.value?.id || display.value.id)
}

function selectTab(next: DetailTab) {
  if (tab.value === next) return
  tab.value = next
  // Keep tab body near tabs on mobile — collapse meta when switching away from overview.
  if (next !== 'overview') metaExpanded.value = false
  if (next !== 'overview') {
    visibleByTab.value[next] = EXTRA_BATCH
    void store.ensureExtras(next)
  }
  void nextTick().then(() => {
    updateTabIndicator()
    setupExtraObserver()
  })
}

function toggleMetaExpanded() {
  metaExpanded.value = !metaExpanded.value
}

const relationsAll = computed(() => detail.value?.relations || [])
const charactersAll = computed(() => detail.value?.characters || [])
const staffAll = computed(() => detail.value?.staff || [])

const relationsVisible = computed(() => relationsAll.value.slice(0, visibleByTab.value.relations))
const charactersVisible = computed(() => charactersAll.value.slice(0, visibleByTab.value.characters))
const staffVisible = computed(() => staffAll.value.slice(0, visibleByTab.value.staff))

const relationsHasMore = computed(() => visibleByTab.value.relations < relationsAll.value.length)
const charactersHasMore = computed(() => visibleByTab.value.characters < charactersAll.value.length)
const staffHasMore = computed(() => visibleByTab.value.staff < staffAll.value.length)

function activeExtraHasMore() {
  if (tab.value === 'relations') return relationsHasMore.value
  if (tab.value === 'characters') return charactersHasMore.value
  if (tab.value === 'staff') return staffHasMore.value
  return false
}

function loadMoreExtra() {
  if (tab.value === 'overview' || loadingMoreExtra.value || !activeExtraHasMore()) return
  const section = tab.value as ExtraSection
  loadingMoreExtra.value = true
  if (extraLoadTimer) clearTimeout(extraLoadTimer)
  // Short delay so newly appended cards can play enter transition.
  extraLoadTimer = setTimeout(() => {
    const allLen =
      section === 'relations'
        ? relationsAll.value.length
        : section === 'characters'
          ? charactersAll.value.length
          : staffAll.value.length
    visibleByTab.value[section] = Math.min(visibleByTab.value[section] + EXTRA_BATCH, allLen)
    loadingMoreExtra.value = false
    extraLoadTimer = null
    // Desktop tall viewports: sentinel may stay intersecting after batch —
    // IntersectionObserver won't re-fire; keep filling until scroll needed.
    void nextTick().then(() => fillExtraViewport())
  }, 160)
}

function resetExtraVisible() {
  visibleByTab.value = {
    relations: EXTRA_BATCH,
    characters: EXTRA_BATCH,
    staff: EXTRA_BATCH,
  }
  loadingMoreExtra.value = false
  if (extraLoadTimer) {
    clearTimeout(extraLoadTimer)
    extraLoadTimer = null
  }
}

/** Active layer scroll root (not a buried layer's empty .detail-scroll). */
function getDetailScrollRoot(): Element | null {
  return surfaceRef.value?.querySelector?.('.detail-scroll')
    || document.querySelector('.detail-overlay__layer.is-top .detail-scroll')
    || null
}

function isExtraSentinelInView(root: Element | null): boolean {
  const sentinel = extraSentinelRef.value
  if (!sentinel) return false
  const s = sentinel.getBoundingClientRect()
  if (root) {
    const r = root.getBoundingClientRect()
    // Expand root by ~200px like rootMargin so pre-fetch matches observer.
    return s.top < r.bottom + 200 && s.bottom > r.top - 40
  }
  const vh = window.innerHeight || 0
  return s.top < vh + 200 && s.bottom > -40
}

/** Keep loading batches while sentinel is still visible (desktop tall screens). */
function fillExtraViewport() {
  if (tab.value === 'overview' || loadingMoreExtra.value || !activeExtraHasMore()) return
  const root = getDetailScrollRoot()
  if (!isExtraSentinelInView(root)) return
  loadMoreExtra()
}

function setupExtraObserver() {
  extraObserver?.disconnect()
  extraObserver = null
  if (!extraSentinelRef.value || tab.value === 'overview') return
  const root = getDetailScrollRoot()
  extraObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMoreExtra()
    },
    { root: root || null, rootMargin: '200px 0px', threshold: 0 },
  )
  extraObserver.observe(extraSentinelRef.value)
  // If first paint already fills the screen, observer may not emit — force fill.
  void nextTick().then(() => fillExtraViewport())
}

// Only reset tab when a NEW layer is expanding (list card / related push).
// Stack pop also changes activeId; restoreLayerUi owns that path and must keep the saved tab.
watch(
  () => store.activeId,
  (id, prev) => {
    if (!id || id === prev) return
    if (store.phase !== 'expanding') {
      void nextTick().then(updateTabIndicator)
      return
    }
    tab.value = 'overview'
    metaExpanded.value = false
    lastOverviewId = ''
    contentEpoch.value = 0
    resetExtraVisible()
    void nextTick().then(updateTabIndicator)
  },
)

watch(tab, async () => {
  await nextTick()
  updateTabIndicator()
  setupExtraObserver()
})

watch(contentReady, async (ready) => {
  if (!ready) return
  await nextTick()
  updateTabIndicator()
  setupExtraObserver()
})

watch(
  () => [relationsAll.value.length, charactersAll.value.length, staffAll.value.length, tab.value] as const,
  async () => {
    await nextTick()
    setupExtraObserver()
    fillExtraViewport()
  },
)

watch(extraSentinelRef, () => {
  setupExtraObserver()
  fillExtraViewport()
})

// Overview arrived for this open → one soft enter for lead / sidebar / panel.
watch(
  () => [store.loading, store.activeId, store.detail?.summary] as const,
  ([loading, id, summary]) => {
    if (!id || loading) return
    if (lastOverviewId === id) return
    // Only advance after overview fetch settled (summary may still be empty).
    lastOverviewId = id
    contentEpoch.value += 1
    void summary
  },
)

async function openPersonEntity(opts: {
  id?: string
  name?: string
  image?: string
  contextRole?: string
}) {
  if (!opts.id || !parsePersonId(opts.id)) return
  if (closing || store.phase === 'expanding' || store.phase === 'returning' || store.phase === 'collapsing') return
  // Snapshot anime UI (tab/scroll/extras) so return keeps 角色/制作人员 list.
  captureLayerUi(store.topLayer?.key)
  const routeName = personRouteName(parsePersonId(opts.id)!.kind)
  const ok = await personOverlay.openPerson({
    id: opts.id,
    name: opts.name,
    image: opts.image,
    contextRole: opts.contextRole,
    returnAnimeId: store.activeId || (typeof route.params.id === 'string' ? route.params.id : ''),
  })
  if (!ok) return
  if (route.name !== routeName || route.params.id !== opts.id) {
    await router.push({ name: routeName, params: { id: opts.id } })
  }
}

function openCharacterDetail(ch: AnimeCharacter) {
  void openPersonEntity({
    id: ch.id,
    name: ch.name,
    image: ch.image,
    contextRole: ch.role,
  })
}

function openVoiceActorDetail(ch: AnimeCharacter, event?: Event) {
  event?.stopPropagation?.()
  if (!ch.voiceActorId) return
  void openPersonEntity({
    id: ch.voiceActorId,
    name: ch.voiceActor,
    image: ch.voiceActorImage,
    contextRole: `CV · ${ch.name}`,
  })
}

function openStaffDetail(st: AnimeStaff) {
  void openPersonEntity({
    id: st.id,
    name: st.name,
    image: st.image,
    contextRole: st.role,
  })
}

async function openRelated(rel: AnimeRelation, event: Event) {
  if (!rel.id || rel.id === display.value?.id) return
  if (closing || store.phase === 'expanding' || store.phase === 'returning' || store.phase === 'collapsing') return

  const thumb = (event.currentTarget as HTMLElement | null)
    ?.querySelector?.('img, .relation-card__ph') as Element | null
    || (event.currentTarget as Element | null)

  // Snapshot parent UI (tab/scroll/poster/banner) so return can restore without reloading.
  captureLayerUi(store.topLayer?.key)
  // Ensure parent poster is stored even if posterSrc lagged behind display.image.
  if (store.topLayer?.key) {
    const snap = layerUiByKey.get(store.topLayer.key)
    const parentArt = display.value?.image || posterSrc.value
    const parentBanner = display.value?.banner || display.value?.image || bannerSrc.value
    if (snap && parentArt) {
      layerUiByKey.set(store.topLayer.key, {
        ...snap,
        posterSrc: parentArt,
        bannerSrc: parentBanner || snap.bannerSrc,
      })
    }
  }

  tab.value = 'overview'
  lastOverviewId = ''
  contentEpoch.value = 0
  settled.value = false
  contentReady.value = false
  // Keep posterSrc until land so the slot never blanks mid-push.
  resetExtraVisible()
  // Parent layer stays mounted; new layer expands from relation thumb (same as card open).
  await store.openFromRelated(rel, thumb)
  const nextArt = (store.detail || store.seed)?.image || rel.image || ''
  flyerImage.value = nextArt
  bannerSrc.value = nextArt
  if (nextArt) void preloadImage(nextArt)
  await router.push({ name: 'anime-detail', params: { id: rel.id } })
}

watch(
  () => [store.open, store.phase, store.activeId] as const,
  async ([open, phase]) => {
    if (!open) {
      settled.value = false
      contentReady.value = false
      flyerImage.value = ''
      posterSrc.value = ''
      bannerSrc.value = ''
      closing = false
      return
    }
    if (phase === 'expanding') {
      await runExpand()
      return
    }
    if (phase === 'open' && !store.originRect && !settled.value) {
      // Deep link: no flight, show in-flow poster.
      settled.value = true
      contentReady.value = true
      await nextTick()
      if (flyerRef.value) flyerRef.value.style.visibility = 'hidden'
    }
  },
)

watch(
  () => [route.name, route.params.id] as const,
  async ([name, id], prev) => {
    const prevId = prev?.[1]
    // Person/character routes share params.id shape — never treat them as anime stack ops.
    if (name === 'character-detail' || name === 'person-detail') return

    // Left detail route entirely (e.g. browser back past stack root).
    if (name !== 'anime-detail' || typeof id !== 'string' || !id) {
      if (
        store.open
        && name !== 'anime-detail'
        && name !== 'character-detail'
        && name !== 'person-detail'
        && !closing
      ) {
        store.finishClose()
        settled.value = false
        contentReady.value = false
        flyerImage.value = ''
      }
      return
    }
    if (store.open && store.activeId === id) {
      // Returning from person overlay: only restore UI snapshot (tab/extras), no re-fetch.
      if (prev?.[0] === 'character-detail' || prev?.[0] === 'person-detail') {
        restoreLayerUi(store.topLayer?.key)
        contentReady.value = true
        settled.value = true
        void nextTick().then(updateTabIndicator)
      }
      return
    }
    if (store.open && store.phase === 'expanding') return
    if (store.open && store.phase === 'returning') return
    if (store.open && store.phase === 'collapsing') return
    if (closing) return

    // Browser back onto a still-mounted parent layer → reverse flight, then drop top.
    if (
      store.open
      && typeof prevId === 'string'
      && store.stackContains(id)
    ) {
      // If target is not immediate parent, pop with animation once then hard-sync.
      await popDetailStack({ fromBrowserBack: true })
      if (store.activeId !== id && store.stackContains(id)) {
        const parentKey = store.layers.find((l) => l.seed.id === id)?.key
        store.restoreFromStackById(id)
        restoreLayerUi(parentKey || store.topLayer?.key)
        flyerImage.value = display.value?.image || ''
        settled.value = true
        contentReady.value = true
        resetSurfaceToOpen()
        applySurfaceReveal(true, false)
      }
      return
    }

    await store.reopenFromRoute(id, store.returnPath || '/')
    flyerImage.value = (store.detail || store.seed)?.image || ''
  },
)

watch(
  () => display.value?.image,
  (image) => {
    if (!image) return
    // During flight / return: freeze flyer art — never swap mid-animation.
    if (closing || store.phase === 'returning' || store.phase === 'collapsing' || store.phase === 'expanding') {
      return
    }
    // Settled page: soft-swap HD poster only after decode (relation thumb → full cover).
    if (settled.value) {
      void setPosterSrc(image)
      flyerImage.value = image
      // Prefer seed image as banner until real banner arrives (handled below).
      if (!bannerSrc.value) bannerSrc.value = image
      return
    }
    flyerImage.value = image
    if (!bannerSrc.value) bannerSrc.value = image
  },
)

watch(
  () => [display.value?.banner, display.value?.image, store.loading, settled.value] as const,
  ([banner, image, loading, isSettled]) => {
    if (!isSettled || loading) return
    if (closing || store.phase === 'returning' || store.phase === 'collapsing' || store.phase === 'expanding') {
      return
    }
    const next = banner || image || ''
    if (!next) return
    // Soft upgrade only — never clear; avoids empty→image flash on overview paint.
    void setBannerSrc(next)
  },
)

function onResize() {
  updateTabIndicator()
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onResize)
  if (route.name === 'anime-detail' && typeof route.params.id === 'string' && !store.open) {
    void store.reopenFromRoute(route.params.id, '/')
  }
  void nextTick().then(updateTabIndicator)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
  document.documentElement.classList.remove('detail-flight-active')
  if (animTimer) clearTimeout(animTimer)
  if (extraLoadTimer) clearTimeout(extraLoadTimer)
  extraObserver?.disconnect()
  extraObserver = null
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="store.open && display"
      class="detail-overlay"
      :class="[
        `is-${store.phase}`,
        {
          'is-content-ready': contentReady,
          'is-settled': settled,
          'is-loading': store.loading,
          'has-origin': Boolean(store.originRect || store.topLayer?.originRect),
          'has-stack': store.canPopDetail,
        },
      ]"
      role="dialog"
      aria-modal="true"
      :aria-label="display.title"
    >
      <button class="detail-scrim" type="button" aria-label="关闭详情" @click="dismissToList" />

      <!-- Buried layers stay mounted (not destroyed) under the active surface. -->
      <div
        v-for="(layer, idx) in store.layers.slice(0, -1)"
        :key="layer.key"
        class="detail-overlay__layer is-buried"
        :style="{ zIndex: 1 + idx }"
        aria-hidden="true"
      >
        <div class="detail-surface is-static">
          <div
            class="detail-banner"
            :style="(layer.detail || layer.seed).banner || (layer.detail || layer.seed).image
              ? { backgroundImage: `url(${(layer.detail || layer.seed).banner || (layer.detail || layer.seed).image})` }
              : undefined"
          />
          <div class="detail-banner__shade" />
          <div class="detail-scroll">
            <section class="detail-header">
              <div class="detail-poster-slot">
                <img
                  v-if="(layer.detail || layer.seed).image"
                  class="detail-poster-static is-landed"
                  :src="(layer.detail || layer.seed).image"
                  :alt="(layer.detail || layer.seed).title"
                />
              </div>
              <div class="detail-header__main">
                <p class="detail-kicker">{{ (layer.detail || layer.seed).source.toUpperCase() }}</p>
                <h1 class="detail-title">{{ (layer.detail || layer.seed).title }}</h1>
              </div>
            </section>
          </div>
        </div>
      </div>

      <div
        ref="surfaceRef"
        class="detail-surface detail-overlay__layer is-top"
        :style="{
          '--reveal-x': `${revealOrigin.x}%`,
          '--reveal-y': `${revealOrigin.y}%`,
          zIndex: 10 + store.layers.length,
        }"
      >
        <div
          class="detail-banner"
          :class="{ 'has-art': Boolean(bannerSrc) }"
          :style="bannerSrc ? { backgroundImage: `url(${bannerSrc})` } : undefined"
        />
        <div class="detail-banner__shade" />

        <button class="detail-close" type="button" aria-label="关闭" @click="dismissToList">
          <PhX :size="18" weight="bold" />
        </button>
        <button
          class="detail-back"
          type="button"
          aria-label="返回"
          @click="closeOverlay"
        >
          <PhArrowLeft :size="16" weight="bold" />
          返回
        </button>

        <div class="detail-scroll">
          <section class="detail-header">
            <!-- In-flow poster slot: empty during flight, holds real poster after land -->
            <div ref="posterSlotRef" class="detail-poster-slot">
              <img
                v-if="posterSrc"
                class="detail-poster-static"
                :class="{ 'is-landed': settled }"
                :src="posterSrc"
                :alt="display.title"
                decoding="async"
              />
            </div>

            <div class="detail-header__main">
              <p class="detail-kicker">{{ display.source.toUpperCase() }} · {{ display.id }}</p>
              <h1 class="detail-title">{{ display.title }}</h1>
              <p
                v-if="display.originalTitle && display.originalTitle !== display.title"
                class="detail-original"
              >
                {{ display.originalTitle }}
              </p>

              <Transition name="detail-soft" mode="out-in">
                <p
                  :key="`lead-${store.activeId}-${contentEpoch}-${store.loading ? 'load' : 'ready'}`"
                  class="detail-lead"
                  :class="{ 'is-loading': store.loading }"
                >
                  <template v-if="store.loading">正在解码条目数据流…</template>
                  <template v-else>{{ display.summary || store.error || '暂无剧情简介。' }}</template>
                </p>
              </Transition>

              <div class="detail-actions">
                <button
                  v-for="opt in STATUS_OPTIONS"
                  :key="opt.value"
                  type="button"
                  class="detail-action"
                  :class="{ active: libraryItem?.status === opt.value }"
                  @click="setStatus(opt.value)"
                >
                  {{ opt.label }}
                </button>
                <button
                  v-if="libraryItem"
                  type="button"
                  class="detail-action danger"
                  @click="removeFromLibrary"
                >
                  移出
                </button>
              </div>
            </div>
          </section>

          <div class="detail-content">
            <!-- Main column: tabs + body (aligned with left meta top) -->
            <section class="detail-main">
              <div ref="tabsRef" class="detail-tabs sliding-tabs" role="tablist" aria-label="详情分区">
                <button
                  v-for="item in DETAIL_TABS"
                  :key="item.id"
                  type="button"
                  role="tab"
                  :aria-selected="tab === item.id"
                  :class="{ active: tab === item.id }"
                  @click="selectTab(item.id)"
                >
                  {{ item.label }}
                </button>
                <span class="sliding-tabs__indicator" :style="indicatorStyle" aria-hidden="true" />
              </div>
              <Transition name="detail-soft" mode="out-in">
                <div
                  :key="`panel-${store.activeId}-${contentEpoch}-${tab}-${store.loadingExtras ? 'x' : 'd'}-${detail?.relations?.length || 0}-${detail?.characters?.length || 0}-${detail?.staff?.length || 0}`"
                  class="detail-main__panel"
                >
                  <template v-if="tab === 'overview'">
                    <header class="detail-block-head">
                      <span>OVERVIEW</span>
                      <h2>剧情与资料</h2>
                    </header>
                    <p v-if="store.loading && !display.summary" class="detail-summary is-loading">正在加载简介…</p>
                    <p v-else class="detail-summary">{{ display.summary || store.error || '暂无剧情简介。' }}</p>
                    <div class="detail-mini-meta">
                      <span v-if="display.year"><PhCalendarBlank :size="14" />{{ display.year }}</span>
                      <span v-if="display.episodes"><PhFilmStrip :size="14" />{{ display.episodes }} 话</span>
                      <span v-if="detail?.duration"><PhClock :size="14" />{{ detail.duration }} 分钟</span>
                      <span v-if="display.score"><PhStar :size="14" weight="fill" />{{ display.score.toFixed(1) }}</span>
                      <span v-if="detail?.rank"><PhHash :size="14" />#{{ detail.rank }}</span>
                    </div>
                  </template>

                  <template v-else-if="tab === 'relations'">
                    <header class="detail-block-head">
                      <span>RELATIONS</span>
                      <h2>关联作品</h2>
                      <p v-if="relationsAll.length" class="detail-block-count">
                        已显示 {{ relationsVisible.length }} / {{ relationsAll.length }} 部
                      </p>
                    </header>
                    <div v-if="store.loadingExtras && !relationsAll.length" class="detail-loader detail-loader--inline" aria-busy="true">
                      <div class="detail-loader__prism" aria-hidden="true"><i /><i /><i /></div>
                      <p>正在加载关联作品…</p>
                    </div>
                    <template v-else-if="relationsAll.length">
                      <div class="relation-grid">
                          <button
                            v-for="(rel, idx) in relationsVisible"
                            :key="rel.id + rel.type"
                            type="button"
                            class="relation-card detail-extra-item"
                            :style="{ '--enter-i': idx % EXTRA_BATCH }"
                            @click="openRelated(rel, $event)"
                          >
                          <img v-if="rel.image" :src="rel.image" :alt="rel.title" />
                          <div v-else class="relation-card__ph" />
                          <div>
                            <em>{{ rel.type }}</em>
                            <strong>{{ rel.title }}</strong>
                            <span>{{ [rel.format, rel.status].filter(Boolean).join(' · ') || 'Related' }}</span>
                          </div>
                        </button>
                      </div>
                      <div ref="extraSentinelRef" class="detail-infinite-sentinel" aria-hidden="true" />
                      <p v-if="loadingMoreExtra" class="detail-infinite-status">加载更多…</p>
                      <p v-else-if="!relationsHasMore" class="detail-infinite-status">已全部加载</p>
                    </template>
                    <p v-else class="detail-empty">暂无关联作品。</p>
                  </template>

                  <template v-else-if="tab === 'characters'">
                    <header class="detail-block-head">
                      <span>CHARACTERS</span>
                      <h2>角色与声优</h2>
                      <p v-if="charactersAll.length" class="detail-block-count">
                        已显示 {{ charactersVisible.length }} / {{ charactersAll.length }} 位
                      </p>
                    </header>
                    <div v-if="store.loadingExtras && !charactersAll.length" class="detail-loader detail-loader--inline" aria-busy="true">
                      <div class="detail-loader__prism" aria-hidden="true"><i /><i /><i /></div>
                      <p>正在加载角色与声优…</p>
                    </div>
                    <template v-else-if="charactersAll.length">
                      <div class="character-grid">
                        <article
                          v-for="(ch, idx) in charactersVisible"
                          :key="ch.id || ch.name + idx"
                          class="character-card detail-extra-item"
                          :class="{ 'is-clickable': Boolean(ch.id) }"
                          :style="{ '--enter-i': idx % EXTRA_BATCH }"
                          :role="ch.id ? 'button' : undefined"
                          :tabindex="ch.id ? 0 : undefined"
                          @click="openCharacterDetail(ch)"
                          @keydown.enter.prevent="openCharacterDetail(ch)"
                        >
                          <img v-if="ch.image" :src="ch.image" :alt="ch.name" />
                          <div v-else class="character-card__ph" />
                          <div class="character-card__meta">
                            <strong>{{ ch.name }}</strong>
                            <span>{{ ch.role }}</span>
                            <p
                              v-if="ch.voiceActor"
                              class="character-card__va"
                              :class="{ 'is-clickable': Boolean(ch.voiceActorId) }"
                              @click="openVoiceActorDetail(ch, $event)"
                            >
                              <img v-if="ch.voiceActorImage" :src="ch.voiceActorImage" alt="" />
                              CV · {{ ch.voiceActor }}
                            </p>
                          </div>
                        </article>
                      </div>
                      <div ref="extraSentinelRef" class="detail-infinite-sentinel" aria-hidden="true" />
                      <p v-if="loadingMoreExtra" class="detail-infinite-status">加载更多…</p>
                      <p v-else-if="!charactersHasMore" class="detail-infinite-status">已全部加载</p>
                    </template>
                    <p v-else class="detail-empty">暂无角色资料。</p>
                  </template>

                  <template v-else>
                    <header class="detail-block-head">
                      <span>STAFF</span>
                      <h2>制作人员</h2>
                      <p v-if="staffAll.length" class="detail-block-count">
                        已显示 {{ staffVisible.length }} / {{ staffAll.length }} 位
                      </p>
                    </header>
                    <div v-if="store.loadingExtras && !staffAll.length" class="detail-loader detail-loader--inline" aria-busy="true">
                      <div class="detail-loader__prism" aria-hidden="true"><i /><i /><i /></div>
                      <p>正在加载制作人员…</p>
                    </div>
                    <template v-else-if="staffAll.length">
                      <div class="staff-grid">
                        <article
                          v-for="(st, idx) in staffVisible"
                          :key="st.id || st.name + idx"
                          class="staff-card detail-extra-item"
                          :class="{ 'is-clickable': Boolean(st.id) }"
                          :style="{ '--enter-i': idx % EXTRA_BATCH }"
                          :role="st.id ? 'button' : undefined"
                          :tabindex="st.id ? 0 : undefined"
                          @click="openStaffDetail(st)"
                          @keydown.enter.prevent="openStaffDetail(st)"
                        >
                          <img v-if="st.image" :src="st.image" :alt="st.name" />
                          <div v-else class="staff-card__ph" />
                          <div>
                            <strong>{{ st.name }}</strong>
                            <span>{{ st.role }}</span>
                          </div>
                        </article>
                      </div>
                      <div ref="extraSentinelRef" class="detail-infinite-sentinel" aria-hidden="true" />
                      <p v-if="loadingMoreExtra" class="detail-infinite-status">加载更多…</p>
                      <p v-else-if="!staffHasMore" class="detail-infinite-status">已全部加载</p>
                    </template>
                    <p v-else class="detail-empty">暂无制作人员资料。</p>
                  </template>
                </div>
              </Transition>
            </section>

            <!-- Meta board: always open on desktop; collapsible on mobile. -->
            <div class="detail-meta" :class="{ 'is-expanded': metaExpanded }">
              <button
                type="button"
                class="detail-meta__toggle"
                :aria-expanded="metaExpanded"
                @click="toggleMetaExpanded"
              >
                <span>作品资料</span>
                <em v-if="display.score">{{ display.score.toFixed(1) }}</em>
                <em v-if="detail?.rank">#{{ detail.rank }}</em>
                <em v-if="display.year">{{ display.year }}</em>
                <PhCaretDown class="detail-meta__caret" :size="16" weight="bold" />
              </button>
              <div class="detail-meta__panel">
                <aside
                  :key="`side-${store.activeId}-${contentEpoch}`"
                  class="detail-sidebar"
                >
                  <div v-if="display.score" class="detail-rank-card">
                    <PhStar :size="16" weight="fill" />
                    <div>
                      <strong>{{ display.score.toFixed(1) }}</strong>
                      <span>{{ detail?.rank ? `#${detail.rank} Rank` : 'SCORE' }}</span>
                    </div>
                  </div>
                  <div v-for="fact in sideFacts" :key="fact.label" class="detail-fact">
                    <span>{{ fact.label }}</span>
                    <strong>{{ fact.value }}</strong>
                  </div>
                  <div v-if="display.tags?.length" class="detail-side-tags">
                    <span v-for="tag in display.tags.slice(0, 10)" :key="tag">{{ tag }}</span>
                  </div>
                </aside>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Fixed only while flying; image frozen so stack pop cannot swap mid-flight -->
      <div
        v-if="flyerImage"
        ref="flyerRef"
        class="detail-flyer"
        aria-hidden="true"
      >
        <img :src="flyerImage" alt="" draggable="false" />
      </div>
    </div>
  </Teleport>
</template>
