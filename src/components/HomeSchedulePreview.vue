<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import gsap from 'gsap'
import { PhArrowRight, PhClock, PhStar } from '@phosphor-icons/vue'
import type { ScheduleDay } from '../types/schedule'
import { useDetailOverlayStore } from '../stores/detailOverlay'
import {
  flattenRecentSchedule,
  itemsForWeekday,
  MON_FIRST_WEEKDAYS,
  scheduleHasContent,
  weekdayLabel,
  type SchedulePreviewItem,
} from '../services/schedule'

const AUTO_PX_PER_SEC = 32
const COARSE_MQ = '(pointer: coarse)'
const REDUCE_MQ = '(prefers-reduced-motion: reduce)'

const props = defineProps<{ days: ScheduleDay[] }>()

const detailOverlay = useDetailOverlayStore()
const router = useRouter()
const route = useRoute()

type TabKey = 'recent' | number

const activeTab = ref<TabKey>('recent')
const trackRef = ref<HTMLElement | null>(null)
const marqueeRef = ref<HTMLElement | null>(null)
const tabsRef = ref<HTMLElement | null>(null)
const cardRefs = ref<Record<string, HTMLElement | null>>({})

/** CSS sliding pill (same pattern as library tabs). */
const indicatorStyle = ref({ width: '0px', transform: 'translateX(0px)' })
const indicatorReady = ref(false)
const indicatorPulse = ref(false)

const railHovered = ref(false)
const marqueeMode = ref(false)
const railInView = ref(true)

const marqueeX = { value: 0 }
let loopWidth = 0
let tickerFn: ((t: number, dt: number) => void) | null = null
let wheelTween: gsap.core.Tween | null = null
let measureRaf = 0
let layoutRaf = 0
let tabsRo: ResizeObserver | null = null
let trackRo: ResizeObserver | null = null
let io: IntersectionObserver | null = null
let coarseMq: MediaQueryList | null = null
let reduceMq: MediaQueryList | null = null
let wheelBound = false
let indicatorPulseTimer: ReturnType<typeof setTimeout> | null = null

const tabs = computed(() => [
  { key: 'recent' as TabKey, label: '最近更新' },
  ...MON_FIRST_WEEKDAYS.map((weekday) => ({
    key: weekday as TabKey,
    label: weekdayLabel(weekday),
  })),
])

const hasContent = computed(() => scheduleHasContent(props.days))

const visibleItems = computed((): SchedulePreviewItem[] => {
  if (activeTab.value === 'recent') return flattenRecentSchedule(props.days, 14)
  const weekday = activeTab.value as number
  const day = props.days.find((d) => d.weekday === weekday)
  return itemsForWeekday(props.days, weekday).map((item) => ({
    ...item,
    weekday,
    dayLabel: day?.label || weekdayLabel(weekday),
  }))
})

/** Clone only when desktop marquee needs seamless loop. */
const showClone = computed(
  () => marqueeMode.value && railInView.value && visibleItems.value.length > 1,
)

function badgeText(item: SchedulePreviewItem): string {
  if (item.timed && item.airTime) return `${item.dayLabel} ${item.airTime}`
  return item.dayLabel
}

function badgeTone(item: SchedulePreviewItem): string {
  return `is-day-${((item.weekday % 7) + 7) % 7}`
}

function metaLine(item: SchedulePreviewItem): string {
  const ep = Number(item.anime.episodes)
  return Number.isFinite(ep) && ep > 0 ? `更新至第${ep}话` : ''
}

function isTouchPrimary(): boolean {
  return Boolean(coarseMq?.matches || reduceMq?.matches)
}

function wrapX(x: number): number {
  if (loopWidth <= 0) return x
  let n = x % loopWidth
  if (n > 0) n -= loopWidth
  if (n <= -loopWidth) n += loopWidth
  return n
}

function setMarqueeX(x: number) {
  marqueeX.value = wrapX(x)
  const el = marqueeRef.value
  if (el) gsap.set(el, { x: marqueeX.value, force3D: true })
}

function measureLoop() {
  const primary = marqueeRef.value?.querySelector<HTMLElement>('.home-schedule__strip--primary')
  if (!primary || !marqueeRef.value) {
    loopWidth = 0
    return
  }
  const gap = Number.parseFloat(getComputedStyle(marqueeRef.value).gap || '0') || 0
  loopWidth = primary.offsetWidth + gap
}

function canAuto(): boolean {
  return (
    marqueeMode.value
    && railInView.value
    && !railHovered.value
    && !wheelTween
    && loopWidth > 0
    && Boolean(trackRef.value && loopWidth > trackRef.value.clientWidth + 4)
  )
}

function stopAuto() {
  if (tickerFn) {
    gsap.ticker.remove(tickerFn)
    tickerFn = null
  }
}

function startAuto() {
  if (tickerFn || !canAuto()) return
  tickerFn = (_t, dt) => {
    if (!canAuto()) {
      stopAuto()
      return
    }
    setMarqueeX(marqueeX.value - AUTO_PX_PER_SEC * (Math.min(48, dt) / 1000))
  }
  gsap.ticker.add(tickerFn)
}

function syncAuto() {
  if (canAuto()) startAuto()
  else stopAuto()
}

function refreshMarquee() {
  marqueeMode.value = !isTouchPrimary()
  void nextTick(() => {
    measureLoop()
    if (!marqueeMode.value) {
      stopAuto()
      wheelTween?.kill()
      wheelTween = null
      marqueeX.value = 0
      if (marqueeRef.value) gsap.set(marqueeRef.value, { clearProps: 'transform' })
      return
    }
    if (loopWidth <= 0 || (trackRef.value && loopWidth <= trackRef.value.clientWidth + 4)) {
      stopAuto()
      setMarqueeX(0)
      return
    }
    setMarqueeX(marqueeX.value)
    syncAuto()
  })
}

function queueMarqueeRefresh() {
  if (layoutRaf) cancelAnimationFrame(layoutRaf)
  layoutRaf = requestAnimationFrame(() => {
    layoutRaf = 0
    refreshMarquee()
  })
}

function pulseIndicator() {
  indicatorPulse.value = false
  if (indicatorPulseTimer !== null) clearTimeout(indicatorPulseTimer)
  requestAnimationFrame(() => {
    indicatorPulse.value = true
    indicatorPulseTimer = setTimeout(() => {
      indicatorPulse.value = false
      indicatorPulseTimer = null
    }, 600)
  })
}

/** Sliding pill — CSS transition (library-tabs pattern), not GSAP. */
function updateIndicator() {
  const root = tabsRef.value
  if (!root || root.getClientRects().length === 0) return
  const active = root.querySelector<HTMLElement>('.home-schedule__tab.is-active')
  if (!active) {
    indicatorStyle.value = { width: '0px', transform: 'translateX(0px)' }
    return
  }
  const rootRect = root.getBoundingClientRect()
  const btnRect = active.getBoundingClientRect()
  if (btnRect.width < 8) return
  const left = btnRect.left - rootRect.left - root.clientLeft + root.scrollLeft
  indicatorStyle.value = {
    width: `${btnRect.width}px`,
    transform: `translateX(${left}px)`,
  }
  if (!indicatorReady.value) {
    requestAnimationFrame(() => {
      indicatorReady.value = true
    })
  }
}

function queueIndicator() {
  if (measureRaf) cancelAnimationFrame(measureRaf)
  measureRaf = requestAnimationFrame(() => {
    measureRaf = 0
    updateIndicator()
  })
}

function onRailEnter() {
  railHovered.value = true
  stopAuto()
}

function onRailLeave() {
  railHovered.value = false
  if (!wheelTween) syncAuto()
}

function onRailWheel(e: WheelEvent) {
  if (!marqueeMode.value) return
  const track = trackRef.value
  const el = marqueeRef.value
  if (!el || !track || loopWidth <= track.clientWidth + 4) return

  const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
  if (!delta) return
  e.preventDefault()

  stopAuto()
  wheelTween?.kill()

  const from = marqueeX.value
  let to = wrapX(from - delta * 1.1)
  if (loopWidth > 0 && Math.abs(to - from) > loopWidth * 0.5) {
    if (to < from) to += loopWidth
    else to -= loopWidth
  }

  wheelTween = gsap.fromTo(
    marqueeX,
    { value: from },
    {
      value: to,
      duration: 0.32,
      ease: 'power3.out',
      onUpdate: () => {
        marqueeX.value = wrapX(marqueeX.value)
        gsap.set(el, { x: marqueeX.value, force3D: true })
      },
      onComplete: () => {
        wheelTween = null
        setMarqueeX(marqueeX.value)
        if (!railHovered.value) syncAuto()
      },
    },
  )
}

function selectTab(key: TabKey) {
  if (activeTab.value === key) return
  activeTab.value = key
  pulseIndicator()
  // Indicator moves immediately via watch + CSS transition
  void nextTick(() => {
    queueIndicator()
    if (trackRef.value) trackRef.value.scrollLeft = 0
    setMarqueeX(0)
    // One deferred measure only (no triple timers)
    queueMarqueeRefresh()
  })
}

function setCardRef(id: string, el: unknown) {
  if (el instanceof HTMLElement) cardRefs.value[id] = el
  else delete cardRefs.value[id]
}

async function openItem(item: SchedulePreviewItem) {
  const row = cardRefs.value[item.anime.id]
  const poster = row?.querySelector('.home-schedule-card__cover') || row || null
  await detailOverlay.openFromCard(item.anime, poster, route.fullPath)
  if (route.name !== 'anime-detail' || route.params.id !== item.anime.id) {
    await router.push({ name: 'anime-detail', params: { id: item.anime.id } })
  }
}

function onResize() {
  queueIndicator()
  queueMarqueeRefresh()
}

function bind() {
  const track = trackRef.value
  if (!track) return

  if (!wheelBound) {
    track.addEventListener('wheel', onRailWheel, { passive: false })
    wheelBound = true
  }

  tabsRo?.disconnect()
  trackRo?.disconnect()
  if (typeof ResizeObserver !== 'undefined') {
    tabsRo = new ResizeObserver(() => queueIndicator())
    if (tabsRef.value) tabsRo.observe(tabsRef.value)
    trackRo = new ResizeObserver(() => queueMarqueeRefresh())
    trackRo.observe(track)
  }

  io?.disconnect()
  if (typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver(
      ([entry]) => {
        railInView.value = entry?.isIntersecting ?? true
        syncAuto()
      },
      { root: null, threshold: 0.05 },
    )
    const rail = track.closest('.home-schedule__rail')
    if (rail) io.observe(rail)
  }

  queueIndicator()
  // First paint: measure after layout, once
  requestAnimationFrame(() => {
    refreshMarquee()
    queueIndicator()
  })
}

function unbind() {
  if (wheelBound && trackRef.value) {
    trackRef.value.removeEventListener('wheel', onRailWheel)
    wheelBound = false
  }
  stopAuto()
  wheelTween?.kill()
  wheelTween = null
  tabsRo?.disconnect()
  trackRo?.disconnect()
  io?.disconnect()
  tabsRo = null
  trackRo = null
  io = null
}

watch(activeTab, () => {
  queueIndicator()
})

watch(
  () => props.days,
  () => {
    if (!hasContent.value) return
    if (activeTab.value !== 'recent') {
      const w = activeTab.value as number
      if (!props.days.some((d) => d.weekday === w)) activeTab.value = 'recent'
    }
    void nextTick(() => bind())
  },
)

watch(hasContent, (ok) => {
  if (ok) void nextTick(() => bind())
  else unbind()
})

// Avoid re-layout thrash on every list tick — only when length changes meaningfully
watch(
  () => visibleItems.value.length,
  () => queueMarqueeRefresh(),
)

onMounted(() => {
  coarseMq = window.matchMedia(COARSE_MQ)
  reduceMq = window.matchMedia(REDUCE_MQ)
  marqueeMode.value = !isTouchPrimary()
  coarseMq.addEventListener('change', onResize)
  reduceMq.addEventListener('change', onResize)
  window.addEventListener('resize', onResize, { passive: true })
  gsap.ticker.lagSmoothing(1000, 33)
  void nextTick(() => bind())
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  coarseMq?.removeEventListener('change', onResize)
  reduceMq?.removeEventListener('change', onResize)
  if (measureRaf) cancelAnimationFrame(measureRaf)
  if (layoutRaf) cancelAnimationFrame(layoutRaf)
  if (indicatorPulseTimer !== null) clearTimeout(indicatorPulseTimer)
  unbind()
  if (marqueeRef.value) gsap.killTweensOf(marqueeRef.value)
  gsap.killTweensOf(marqueeX)
})
</script>

<template>
  <section
    v-if="hasContent"
    class="home-schedule reveal-section"
    aria-labelledby="home-schedule-title"
  >
    <div class="home-schedule__head">
      <div class="home-schedule__title-wrap">
        <span class="home-schedule__icon" aria-hidden="true">
          <PhClock :size="26" weight="duotone" />
        </span>
        <h2 id="home-schedule-title" class="home-schedule__title">新番时间表</h2>
      </div>

      <div
        ref="tabsRef"
        class="home-schedule__tabs radio-group"
        :class="{ 'is-indicator-ready': indicatorReady }"
        role="tablist"
        aria-label="放送日筛选"
      >
        <span
          class="home-schedule__indicator slider"
          :class="{ 'is-pulsing': indicatorPulse }"
          :style="indicatorStyle"
          aria-hidden="true"
        />
        <button
          v-for="(tab, index) in tabs"
          :key="String(tab.key)"
          type="button"
          role="tab"
          class="home-schedule__tab radio-option"
          :style="{ animationDelay: `${(index + 1) * 0.1}s` }"
          :class="{ 'is-active': activeTab === tab.key }"
          :aria-selected="activeTab === tab.key"
          @click="selectTab(tab.key)"
        >
          <span class="radio-label">{{ tab.label }}</span>
        </button>
      </div>

      <RouterLink class="home-schedule__all" to="/schedule">
        查看全部
        <PhArrowRight :size="16" />
      </RouterLink>
    </div>

    <div
      class="home-schedule__rail"
      :class="{ 'is-marquee': marqueeMode, 'is-paused': railHovered }"
      @mouseenter="onRailEnter"
      @mouseleave="onRailLeave"
    >
      <div
        ref="trackRef"
        class="home-schedule__track"
        :class="{ 'is-marquee': marqueeMode }"
      >
        <div ref="marqueeRef" class="home-schedule__marquee">
          <div class="home-schedule__strip home-schedule__strip--primary">
            <article
              v-for="item in visibleItems"
              :key="item.anime.id"
              class="home-schedule-card"
              :class="{
                'is-expanding': detailOverlay.open && detailOverlay.returnCardId === item.anime.id,
              }"
              :data-anime-id="item.anime.id"
              :ref="(el) => setCardRef(item.anime.id, el)"
            >
              <button
                type="button"
                class="home-schedule-card__btn"
                :aria-label="`查看 ${item.anime.title}`"
                @click="openItem(item)"
              >
                <span class="home-schedule-card__badge" :class="badgeTone(item)">
                  {{ badgeText(item) }}
                </span>
                <span class="home-schedule-card__cover" data-anime-poster aria-hidden="true">
                  <img
                    v-if="item.anime.image"
                    :src="item.anime.image"
                    alt=""
                    width="214"
                    height="303"
                    loading="lazy"
                    decoding="async"
                  />
                  <span v-else class="home-schedule-card__cover-fallback" />
                </span>
                <span class="home-schedule-card__name" :title="item.anime.title">
                  {{ item.anime.title }}
                </span>
                <span class="home-schedule-card__foot">
                  <span class="home-schedule-card__meta">{{ metaLine(item) || ' ' }}</span>
                  <span v-if="item.anime.score" class="home-schedule-card__score">
                    <PhStar :size="12" weight="fill" />
                    {{ item.anime.score.toFixed(1) }}
                  </span>
                </span>
              </button>
            </article>
          </div>

          <div
            v-if="showClone"
            class="home-schedule__strip home-schedule__strip--clone"
            aria-hidden="true"
          >
            <article
              v-for="item in visibleItems"
              :key="`c-${item.anime.id}`"
              class="home-schedule-card"
            >
              <div class="home-schedule-card__btn">
                <span class="home-schedule-card__badge" :class="badgeTone(item)">
                  {{ badgeText(item) }}
                </span>
                <span class="home-schedule-card__cover">
                  <img
                    v-if="item.anime.image"
                    :src="item.anime.image"
                    alt=""
                    width="214"
                    height="303"
                    loading="lazy"
                    decoding="async"
                  />
                  <span v-else class="home-schedule-card__cover-fallback" />
                </span>
                <span class="home-schedule-card__name">{{ item.anime.title }}</span>
                <span class="home-schedule-card__foot">
                  <span class="home-schedule-card__meta">{{ metaLine(item) || ' ' }}</span>
                  <span v-if="item.anime.score" class="home-schedule-card__score">
                    <PhStar :size="12" weight="fill" />
                    {{ item.anime.score.toFixed(1) }}
                  </span>
                </span>
              </div>
            </article>
          </div>
        </div>

        <p v-if="!visibleItems.length" class="home-schedule__empty">这一天暂无放送</p>
      </div>
    </div>
  </section>
</template>
