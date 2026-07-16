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
import type { WatchStatus } from '../types/anime'

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
const tab = ref<'overview' | 'characters' | 'staff' | 'relations'>('overview')
/** Circle reveal origin in viewport % (from clicked card). */
const revealOrigin = ref({ x: 50, y: 45 })
let animTimer: ReturnType<typeof setTimeout> | null = null
let closing = false

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

/** Soft radial wipe from click point (no harsh hard-edge circle). */
const FLY_EASE = 'cubic-bezier(.22,1,.36,1)'
const FLY_IN_MS = 720
const FLY_OUT_MS = 640
const REVEAL_IN = `opacity ${FLY_IN_MS}ms ${FLY_EASE}, transform ${FLY_IN_MS}ms ${FLY_EASE}`
const REVEAL_OUT = `opacity ${FLY_OUT_MS}ms ${FLY_EASE}, transform ${FLY_OUT_MS}ms ${FLY_EASE}`
const FLY_IN = `top ${FLY_IN_MS}ms ${FLY_EASE}, left ${FLY_IN_MS}ms ${FLY_EASE}, width ${FLY_IN_MS}ms ${FLY_EASE}, height ${FLY_IN_MS}ms ${FLY_EASE}, border-radius ${FLY_IN_MS}ms ${FLY_EASE}, opacity .35s ease`
const FLY_OUT = `top ${FLY_OUT_MS}ms ${FLY_EASE}, left ${FLY_OUT_MS}ms ${FLY_EASE}, width ${FLY_OUT_MS}ms ${FLY_EASE}, height ${FLY_OUT_MS}ms ${FLY_EASE}, border-radius ${FLY_OUT_MS}ms ${FLY_EASE}, opacity .3s ease`

function applySurfaceReveal(open: boolean, withTransition: boolean) {
  const el = surfaceRef.value
  if (!el) return
  const { x, y } = revealOrigin.value
  el.style.setProperty('--reveal-x', `${x}%`)
  el.style.setProperty('--reveal-y', `${y}%`)
  el.style.transition = withTransition ? (open ? REVEAL_IN : REVEAL_OUT) : 'none'
  // Soft mask + scale (no harsh circle edge)
  el.style.webkitMaskImage = open
    ? `radial-gradient(circle at ${x}% ${y}%, #000 0%, #000 72%, transparent 100%)`
    : `radial-gradient(circle at ${x}% ${y}%, #000 0%, transparent 0%)`
  el.style.maskImage = el.style.webkitMaskImage
  if (open) {
    el.style.opacity = '1'
    el.style.transform = 'scale(1)'
  } else {
    el.style.opacity = '0'
    el.style.transform = 'scale(.97)'
  }
}

/** Measure real slot after surface is laid out full-size (may be invisible). */
function measureSlotRect() {
  const slot = posterSlotRef.value
  if (slot) {
    const r = slot.getBoundingClientRect()
    if (r.width > 8 && r.height > 8) {
      return { top: r.top, left: r.left, width: r.width, height: r.height }
    }
  }
  return getTargetPosterRect()
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

function setFlyerRect(
  rect: { top: number; left: number; width: number; height: number },
  radius = 12,
  withTransition: string | null = null,
) {
  const el = flyerRef.value
  if (!el) return
  if (withTransition === null) {
    el.style.transition = 'none'
  } else {
    el.style.transition = withTransition
  }
  el.style.top = `${rect.top}px`
  el.style.left = `${rect.left}px`
  el.style.width = `${rect.width}px`
  el.style.height = `${rect.height}px`
  el.style.borderRadius = `${radius}px`
}

/**
 * Locked poster target: top-aligned with detail header (align-items:start),
 * independent of summary/text height — prevents mid-flight vertical bounce.
 */
function getTargetPosterRect() {
  const vw = window.innerWidth
  const padX = Math.min(48, Math.max(16, vw * 0.04))
  // topbar + safe area + detail-scroll padding top
  const padTop = Math.max(72, 56 + (Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-top)')) || 0))
  const width = vw <= 640 ? Math.min(180, vw * 0.48) : vw <= 900 ? 132 : 180
  const height = width * 1.5
  if (vw <= 640) {
    return {
      top: padTop,
      left: (vw - width) / 2,
      width,
      height,
    }
  }
  return {
    top: padTop,
    left: padX,
    width,
    height,
  }
}

function flush(el: HTMLElement) {
  // Force style application before enabling transitions.
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  el.getBoundingClientRect()
}

/**
 * One continuous flight: card poster → in-flow detail slot.
 * After landing, hand off to a normal-flow poster (not fixed).
 */
async function runExpand() {
  closing = false
  settled.value = false
  contentReady.value = false
  await nextTick()

  const origin = store.originRect
  setRevealOriginFromRect(origin)
  // Start closed at click origin (enter must animate open).
  applySurfaceReveal(false, false)

  const flyer = flyerRef.value
  if (!flyer) {
    store.phase = 'open'
    requestAnimationFrame(() => {
      requestAnimationFrame(() => applySurfaceReveal(true, true))
    })
    settled.value = true
    contentReady.value = true
    return
  }

  // 1) Place flyer at card origin (no transition)
  const start = origin || getTargetPosterRect()
  setFlyerRect(start, 12, null)
  flyer.style.opacity = origin ? '1' : '0'
  flyer.style.visibility = 'visible'
  flush(flyer)
  if (surfaceRef.value) flush(surfaceRef.value)

  // 2) Wait two frames so surface layout (invisible) is ready, measure REAL slot once.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (closing) return
      const target = measureSlotRect()
      // 3) Animate surface open + flyer to measured slot (single continuous flight)
      applySurfaceReveal(true, true)
      setFlyerRect(target, 14, FLY_IN)
      flyer.style.opacity = '1'
      store.phase = 'open'

      if (animTimer) clearTimeout(animTimer)
      animTimer = setTimeout(() => {
        if (closing) return
        // Handoff only — never remeasure after flight (avoids bounce)
        settled.value = true
        contentReady.value = true
        flyer.style.visibility = 'hidden'
        flyer.style.transition = 'none'
      }, FLY_IN_MS)
    })
  })
}

async function closeOverlay() {
  if (!store.open || store.phase === 'collapsing' || closing) return
  closing = true
  store.beginCollapse()
  contentReady.value = false

  const flyer = flyerRef.value
  const origin = store.originRect
  setRevealOriginFromRect(origin)

  // Measure current in-flow poster before hiding it.
  const from = measureSlotRect()
  settled.value = false
  await nextTick()

  // Keep surface fully open one frame, then reverse to click origin.
  applySurfaceReveal(true, false)
  if (surfaceRef.value) flush(surfaceRef.value)

  if (flyer) {
    setFlyerRect(from, 14, null)
    flyer.style.opacity = '1'
    flyer.style.visibility = 'visible'
    flush(flyer)

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        applySurfaceReveal(false, true)
        if (origin) {
          setFlyerRect(origin, 12, FLY_OUT)
        } else {
          flyer.style.transition = 'opacity .35s ease'
          flyer.style.opacity = '0'
        }
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
    const shouldNavigate = route.name === 'anime-detail'
    store.finishClose()
    closing = false
    settled.value = false
    contentReady.value = false
    // Only push when close was triggered from UI (not browser back already navigated).
    if (shouldNavigate && router.currentRoute.value.name === 'anime-detail') {
      await router.push(back)
    }
  }, FLY_OUT_MS + 40)
}

watch(
  () => store.closeSignal,
  () => {
    if (store.open) void closeOverlay()
  },
)

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && store.open) void closeOverlay()
}

function setStatus(status: WatchStatus) {
  if (!display.value) return
  library.add(display.value, status)
}

function removeFromLibrary() {
  if (!display.value) return
  library.remove(libraryItem.value?.id || display.value.id)
}

async function openRelated(id: string) {
  if (!id || id === display.value?.id) return
  await store.reopenFromRoute(id, store.returnPath || '/')
  if (route.name === 'anime-detail') {
    await router.replace({ name: 'anime-detail', params: { id } })
  }
  tab.value = 'overview'
  settled.value = true
  contentReady.value = true
  await nextTick()
  if (flyerRef.value) {
    flyerRef.value.style.visibility = 'hidden'
  }
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
  async (id) => {
    if (typeof id !== 'string' || !id) return
    if (store.open && store.activeId === id) return
    await store.reopenFromRoute(id, store.returnPath || '/')
  },
)

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  if (route.name === 'anime-detail' && typeof route.params.id === 'string' && !store.open) {
    void store.reopenFromRoute(route.params.id, '/')
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  if (animTimer) clearTimeout(animTimer)
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
          'has-origin': Boolean(store.originRect),
        },
      ]"
      role="dialog"
      aria-modal="true"
      :aria-label="display.title"
    >
      <button class="detail-scrim" type="button" aria-label="关闭详情" @click="closeOverlay" />

      <div
        ref="surfaceRef"
        class="detail-surface"
        :style="{
          '--reveal-x': `${revealOrigin.x}%`,
          '--reveal-y': `${revealOrigin.y}%`,
        }"
      >
        <div
          class="detail-banner"
          :style="display.banner || display.image
            ? { backgroundImage: `url(${display.banner || display.image})` }
            : undefined"
        />
        <div class="detail-banner__shade" />

        <button class="detail-close" type="button" aria-label="关闭" @click="closeOverlay">
          <PhX :size="18" weight="bold" />
        </button>
        <button class="detail-back" type="button" aria-label="返回" @click="closeOverlay">
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

              <p class="detail-lead">
                <template v-if="store.loading">正在解码条目数据流…</template>
                <template v-else>{{ display.summary || store.error || '暂无剧情简介。' }}</template>
              </p>

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

              <div class="detail-tabs" role="tablist">
                <button type="button" role="tab" :class="{ active: tab === 'overview' }" @click="tab = 'overview'">概览</button>
                <button type="button" role="tab" :class="{ active: tab === 'relations' }" @click="tab = 'relations'">关联</button>
                <button type="button" role="tab" :class="{ active: tab === 'characters' }" @click="tab = 'characters'">角色 / CV</button>
                <button type="button" role="tab" :class="{ active: tab === 'staff' }" @click="tab = 'staff'">制作人员</button>
              </div>
            </div>
          </section>

          <div v-if="store.loading" class="detail-loader" aria-busy="true">
            <div class="detail-loader__prism" aria-hidden="true"><i /><i /><i /></div>
            <p>正在拉取关联作品与角色声优…</p>
            <div class="detail-loader__stream" aria-hidden="true">
              <span v-for="n in 12" :key="n" :style="{ '--i': n }" />
            </div>
          </div>

          <div v-else class="detail-content">
            <aside class="detail-sidebar">
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

            <section class="detail-main">
              <template v-if="tab === 'overview'">
                <header class="detail-block-head">
                  <span>OVERVIEW</span>
                  <h2>剧情与资料</h2>
                </header>
                <p class="detail-summary">{{ display.summary || '暂无剧情简介。' }}</p>
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
                </header>
                <div v-if="detail?.relations?.length" class="relation-grid">
                  <button
                    v-for="rel in detail.relations"
                    :key="rel.id + rel.type"
                    type="button"
                    class="relation-card"
                    @click="openRelated(rel.id)"
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
                <p v-else class="detail-empty">暂无关联作品。</p>
              </template>

              <template v-else-if="tab === 'characters'">
                <header class="detail-block-head">
                  <span>CHARACTERS</span>
                  <h2>角色与声优</h2>
                </header>
                <div v-if="detail?.characters?.length" class="character-grid">
                  <article v-for="(ch, idx) in detail.characters" :key="ch.name + idx" class="character-card">
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
                <p v-else class="detail-empty">暂无角色资料。</p>
              </template>

              <template v-else>
                <header class="detail-block-head">
                  <span>STAFF</span>
                  <h2>制作人员</h2>
                </header>
                <div v-if="detail?.staff?.length" class="staff-grid">
                  <article v-for="(st, idx) in detail.staff" :key="st.name + idx" class="staff-card">
                    <img v-if="st.image" :src="st.image" :alt="st.name" />
                    <div v-else class="staff-card__ph" />
                    <div>
                      <strong>{{ st.name }}</strong>
                      <span>{{ st.role }}</span>
                    </div>
                  </article>
                </div>
                <p v-else class="detail-empty">暂无制作人员资料。</p>
              </template>
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
