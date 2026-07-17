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
} from '@phosphor-icons/vue'
import { useDetailOverlayStore } from '../stores/detailOverlay'
import { useLibraryStore } from '../stores/library'
import type { AnimeRelation, WatchStatus } from '../types/anime'

const store = useDetailOverlayStore()
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
 * Transform-only flight (GPU): place flyer at TARGET size/pos, invert to origin via matrix.
 * Avoids top/left layout thrash that caused vertical bounce.
 */
function placeFlyerAtTarget(target: { top: number; left: number; width: number; height: number }, radius: number) {
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

function invertFlyerToOrigin(
  origin: { top: number; left: number; width: number; height: number },
  target: { top: number; left: number; width: number; height: number },
) {
  const el = flyerRef.value
  if (!el) return
  const sx = origin.width / target.width
  const sy = origin.height / target.height
  const dx = origin.left - target.left
  const dy = origin.top - target.top
  el.style.transition = 'none'
  el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
  el.style.borderRadius = `${12 / Math.max(sx, 0.001)}px`
}

function playFlyerToIdentity(durationMs: number) {
  const el = flyerRef.value
  if (!el) return
  el.style.transition = `transform ${durationMs}ms cubic-bezier(.22,1,.36,1), border-radius ${durationMs}ms cubic-bezier(.22,1,.36,1), opacity ${Math.round(durationMs * 0.45)}ms ease`
  el.style.transform = 'none'
  el.style.borderRadius = '14px'
  el.style.opacity = '1'
}

function playFlyerToOrigin(
  origin: { top: number; left: number; width: number; height: number },
  target: { top: number; left: number; width: number; height: number },
  durationMs: number,
) {
  const el = flyerRef.value
  if (!el) return
  const sx = origin.width / target.width
  const sy = origin.height / target.height
  const dx = origin.left - target.left
  const dy = origin.top - target.top
  el.style.transition = `transform ${durationMs}ms cubic-bezier(.22,1,.36,1), border-radius ${durationMs}ms cubic-bezier(.22,1,.36,1), opacity ${Math.round(durationMs * 0.4)}ms ease`
  el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
  el.style.borderRadius = `${12 / Math.max(sx, 0.001)}px`
}

/**
 * Same expand as list-card open: circular surface + poster flight from origin.
 * Related push keeps parent layers mounted underneath (visible after reverse).
 */
async function runExpand() {
  closing = false
  settled.value = false
  contentReady.value = false
  tab.value = 'overview'
  await nextTick()

  const origin = store.originRect || store.topLayer?.originRect || null
  setRevealOriginFromRect(origin)
  // Always full open animation (same as card → detail).
  applySurfaceReveal(false, false)

  const flyer = flyerRef.value
  const target = getTargetPosterRect()

  if (!flyer) {
    store.phase = 'open'
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        applySurfaceReveal(true, true)
        contentReady.value = true
      })
    })
    settled.value = true
    return
  }

  placeFlyerAtTarget(target, 14)
  if (origin) invertFlyerToOrigin(origin, target)
  flyer.style.opacity = origin ? '1' : '0'
  flyer.style.visibility = 'visible'
  flush(flyer)
  if (surfaceRef.value) flush(surfaceRef.value)

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (closing) return
      applySurfaceReveal(true, true)
      playFlyerToIdentity(FLIGHT_MS)
      flyer.style.opacity = '1'
      store.phase = 'open'
      contentReady.value = true

      if (animTimer) clearTimeout(animTimer)
      animTimer = setTimeout(() => {
        if (closing) return
        settled.value = true
        flyer.style.visibility = 'hidden'
        flyer.style.transition = 'none'
        flyer.style.transform = 'none'
      }, FLIGHT_MS)
    })
  })
}

/**
 * Pop one layer: reverse of expand (circle collapse + poster flight to origin).
 * Parent layer stays mounted underneath and is revealed when top is removed.
 */
async function popDetailStack(opts: { fromBrowserBack?: boolean } = {}) {
  if (!store.canPopDetail || closing) return

  closing = true
  if (animTimer) clearTimeout(animTimer)
  store.beginStackReturn()
  contentReady.value = false

  const flyer = flyerRef.value
  // Reverse flight lands on the same origin that opened this top layer (relation thumb / card).
  const origin = store.resolvePopOrigin()
  if (origin) store.originRect = origin
  setRevealOriginFromRect(origin)
  const target = getTargetPosterRect()
  await nextTick()

  // Snapshot image for flight before layer unmounts.
  if (flyer && origin) {
    placeFlyerAtTarget(target, 14)
    flyer.style.opacity = '1'
    flyer.style.visibility = 'visible'
    flyer.style.transform = 'none'
    flush(flyer)
  }
  settled.value = false
  applySurfaceReveal(true, false)
  if (surfaceRef.value) flush(surfaceRef.value)

  if (flyer && origin) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Same reverse as list close: circle wipe + poster flight.
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
    // Drop top layer AFTER reverse flight — parent was always mounted underneath.
    store.applyStackPop()
    await nextTick()
    // Reset active surface to fully open parent (no remount).
    if (surfaceRef.value) {
      surfaceRef.value.style.transition = 'none'
      surfaceRef.value.style.opacity = '1'
      surfaceRef.value.style.transform = 'scale(1)'
      surfaceRef.value.style.setProperty('--reveal-r', '150%')
      surfaceRef.value.style.webkitMaskImage = ''
      surfaceRef.value.style.maskImage = ''
      flush(surfaceRef.value)
    }
    applySurfaceReveal(true, false)
    closing = false
    settled.value = true
    contentReady.value = true
    tab.value = 'overview'
    // Parent layer was never unloaded — keep epoch so UI doesn't soft-remount flash.
    lastOverviewId = store.activeId
    resetExtraVisible()
    await nextTick()
    if (flyer) {
      flyer.style.visibility = 'hidden'
      flyer.style.transition = 'none'
      flyer.style.transform = 'none'
      flyer.style.opacity = '1'
    }
    const id = store.activeId
    if (!opts.fromBrowserBack && id && router.currentRoute.value.name === 'anime-detail') {
      if (router.currentRoute.value.params.id !== id) {
        await router.replace({ name: 'anime-detail', params: { id } })
      }
    }
    updateTabIndicator()
  }, CLOSE_MS + 40)
}

/** Fully dismiss overlay to list (X button / final back). */
async function dismissToList() {
  if (!store.open || store.phase === 'collapsing' || closing) return
  closing = true
  store.beginCollapse()
  contentReady.value = false

  const flyer = flyerRef.value
  const origin = store.resolveCloseOrigin()
  if (origin) store.originRect = origin
  setRevealOriginFromRect(origin)
  const target = getTargetPosterRect()
  await nextTick()

  if (flyer && origin) {
    placeFlyerAtTarget(target, 14)
    flyer.style.opacity = '1'
    flyer.style.visibility = 'visible'
    flyer.style.transform = 'none'
    flush(flyer)
  }
  settled.value = false
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

  if (animTimer) clearTimeout(animTimer)
  animTimer = setTimeout(async () => {
    const back = store.returnPath || '/'
    const shouldNavigate = router.currentRoute.value.name === 'anime-detail'
    store.finishClose()
    closing = false
    settled.value = false
    contentReady.value = false
    if (shouldNavigate && router.currentRoute.value.name === 'anime-detail') {
      // Drop related history entries back to list.
      await router.replace(back)
    }
  }, CLOSE_MS + 40)
}

async function closeOverlay() {
  if (!store.open || store.phase === 'collapsing' || store.phase === 'returning' || closing) return

  // Back button: previous detail if stacked, else list.
  if (store.canPopDetail) {
    if (window.history.length > 1 && router.currentRoute.value.name === 'anime-detail') {
      router.back()
      return
    }
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
  if (next !== 'overview') {
    visibleByTab.value[next] = EXTRA_BATCH
    void store.ensureExtras(next)
  }
  void nextTick().then(() => {
    updateTabIndicator()
    setupExtraObserver()
  })
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

function setupExtraObserver() {
  extraObserver?.disconnect()
  if (!extraSentinelRef.value || tab.value === 'overview') return
  extraObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMoreExtra()
    },
    { root: document.querySelector('.detail-scroll'), rootMargin: '200px 0px' },
  )
  extraObserver.observe(extraSentinelRef.value)
}

// When a new card opens, reset tab + content epoch so old copy never cross-fades in.
watch(
  () => store.activeId,
  (id, prev) => {
    if (!id || id === prev) return
    tab.value = 'overview'
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
  },
)

watch(extraSentinelRef, () => setupExtraObserver())

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

async function openRelated(rel: AnimeRelation, event: Event) {
  if (!rel.id || rel.id === display.value?.id) return
  if (closing || store.phase === 'expanding' || store.phase === 'returning' || store.phase === 'collapsing') return

  const thumb = (event.currentTarget as HTMLElement | null)
    ?.querySelector?.('img, .relation-card__ph') as Element | null
    || (event.currentTarget as Element | null)

  tab.value = 'overview'
  lastOverviewId = ''
  contentEpoch.value = 0
  resetExtraVisible()
  // Parent layer stays mounted; new layer expands from relation thumb (same as card open).
  await store.openFromRelated(rel, thumb)
  await router.push({ name: 'anime-detail', params: { id: rel.id } })
}

watch(
  () => [store.open, store.phase, store.activeId] as const,
  async ([open, phase]) => {
    if (!open) {
      settled.value = false
      contentReady.value = false
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
  () => route.params.id,
  async (id, prevId) => {
    if (typeof id !== 'string' || !id) return
    if (store.open && store.activeId === id) return
    if (store.open && store.phase === 'expanding') return
    if (store.open && store.phase === 'returning') return
    if (store.open && store.phase === 'collapsing') return

    // Browser back onto a still-mounted parent layer → reverse flight, then drop top.
    if (
      store.open
      && typeof prevId === 'string'
      && store.stackContains(id)
      && store.layers.some((l) => l.seed.id === id)
    ) {
      // If target is not immediate parent, pop with animation once then hard-sync.
      await popDetailStack({ fromBrowserBack: true })
      if (store.activeId !== id && store.stackContains(id)) {
        store.restoreFromStackById(id)
        lastOverviewId = id
        contentEpoch.value += 1
        settled.value = true
        contentReady.value = true
        applySurfaceReveal(true, false)
      }
      return
    }

    await store.reopenFromRoute(id, store.returnPath || '/')
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
                  class="detail-poster-static"
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
          :style="display.banner || display.image
            ? { backgroundImage: `url(${display.banner || display.image})` }
            : undefined"
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
                v-if="display.image && settled"
                class="detail-poster-static"
                :src="display.image"
                :alt="display.title"
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
            </div>
          </section>

          <div class="detail-content">
            <Transition name="detail-soft" mode="out-in">
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
            </Transition>

            <section class="detail-main">
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
                          :key="ch.name + idx"
                          class="character-card detail-extra-item"
                          :style="{ '--enter-i': idx % EXTRA_BATCH }"
                        >
                          <img v-if="ch.image" :src="ch.image" :alt="ch.name" />
                          <div v-else class="character-card__ph" />
                          <div class="character-card__meta">
                            <strong>{{ ch.name }}</strong>
                            <span>{{ ch.role }}</span>
                            <p v-if="ch.voiceActor">
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
                          :key="st.name + idx"
                          class="staff-card detail-extra-item"
                          :style="{ '--enter-i': idx % EXTRA_BATCH }"
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
          </div>
        </div>
      </div>

      <!-- Fixed only while flying; hidden after handoff to in-flow poster -->
      <div
        v-if="display.image"
        ref="flyerRef"
        class="detail-flyer"
        aria-hidden="true"
      >
        <img :src="display.image" alt="" draggable="false" />
      </div>
    </div>
  </Teleport>
</template>
