<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhPlus, PhCheck, PhStar, PhCaretDown, PhTrash } from '@phosphor-icons/vue'
import type { Anime, WatchStatus } from '../types/anime'
import { useLibraryStore } from '../stores/library'
import { getLibraryProgress } from '../services/libraryProgress'
import { useDetailOverlayStore } from '../stores/detailOverlay'
import { useLiquidGlass } from '../composables/useLiquidGlass'
import { observeReveal } from '../composables/useRevealObserver'

const props = withDefaults(defineProps<{
  anime: Anime
  index?: number
  /** Use the list thumbnail by default; homepage can opt into the full poster. */
  useThumb?: boolean
  /** Skip scroll-reveal (library tabs / already-visible grids). */
  instant?: boolean
}>(), {
  instant: false,
  useThumb: true,
})
const store = useLibraryStore()
const detailOverlay = useDetailOverlayStore()
const router = useRouter()
const route = useRoute()
const failed = ref(false)
const menuOpen = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const posterActionRef = ref<HTMLButtonElement | null>(null)
const statusMenuRef = ref<HTMLDivElement | null>(null)
const hovered = ref(false)
const focusWithin = ref(false)
/**
 * The poster action is invisible until the card is hovered / focused / its
 * menu is open, so the glass filter (an SVG backdrop-filter) is only built and
 * attached for those cards. Everything else in a long grid pays nothing.
 */
const glassActive = computed(() => hovered.value || focusWithin.value || menuOpen.value)
/** Match detail-back glass strength for the poster action. */
const { glassStyle: posterActionGlassStyle } = useLiquidGlass(posterActionRef, { active: glassActive })
/** Match main-nav glass strength for the expanded status menu. */
const { glassStyle: statusMenuGlassStyle } = useLiquidGlass(statusMenuRef, { blurAmount: 2.0 })
const revealed = ref(props.instant)
const feedback = ref('')
const flash = ref(false)
let feedbackTimer: ReturnType<typeof setTimeout> | null = null
let stopReveal: (() => void) | null = null
/**
 * Shared-element source card: hide list poster while its art "lives" in the overlay.
 * - expand / open / related stack: keep hidden (returnCardId is the list origin)
 * - collapsing return flight: still hidden until finishClose (flyer is the only art)
 */
const isActiveExpand = computed(() => {
  if (!detailOverlay.open) return false
  const returnId = detailOverlay.returnCardId
  if (!returnId || returnId !== props.anime.id) return false
  // Only the active list underlay owns the shared-element source.
  // Home stays mounted under schedule; do not hide a home card when open from /schedule.
  const root = rootRef.value
  if (!root) return true
  const layer = root.closest('.list-layer')
  if (!layer) return true
  return layer.classList.contains('is-active')
})

const STATUS_OPTIONS: { value: WatchStatus; label: string }[] = [
  { value: 'watching', label: '在看' },
  { value: 'completed', label: '看过' },
  { value: 'planned', label: '想看' },
  { value: 'dropped', label: '搁置' },
]

// Cross-source identity: Bangumi and AniList of the same show share library status.
const libraryItem = computed(() => store.findInLibrary(props.anime))
const inLibrary = computed(() => Boolean(libraryItem.value))
const trackedAnime = computed(() => libraryItem.value || props.anime)
const libraryProgress = computed(() => getLibraryProgress(trackedAnime.value))
const currentStatusLabel = computed(() =>
  STATUS_OPTIONS.find((opt) => opt.value === libraryItem.value?.status)?.label || '已加入',
)

const enterDelay = computed(() => `${Math.min((props.index ?? 1) - 1, 12) * 45}ms`)

/** AniList 的 medium 缩略图在列表里观感差，统一用原图；其余数据源继续用列表缩略图。 */
const displayImage = computed(() => {
  if (props.anime.source === 'anilist') return props.anime.image
  return props.useThumb ? (props.anime.thumb || props.anime.image) : props.anime.image
})

function showFeedback(message: string) {
  feedback.value = message
  flash.value = false
  requestAnimationFrame(() => {
    flash.value = true
  })
  if (feedbackTimer) clearTimeout(feedbackTimer)
  feedbackTimer = setTimeout(() => {
    flash.value = false
    feedback.value = ''
  }, 1400)
}

function toggleMenu(event: MouseEvent) {
  event.stopPropagation()
  menuOpen.value = !menuOpen.value
}

async function openDetail() {
  if (menuOpen.value) return
  const poster = rootRef.value?.querySelector('.poster-wrap') || rootRef.value
  const fromPath = route.fullPath
  await detailOverlay.openFromCard(props.anime, poster, fromPath)
  if (route.name !== 'anime-detail' || route.params.id !== props.anime.id) {
    await router.push({ name: 'anime-detail', params: { id: props.anime.id } })
  }
}

function pickStatus(status: WatchStatus, event: MouseEvent) {
  event.stopPropagation()
  const label = STATUS_OPTIONS.find((opt) => opt.value === status)?.label || '已加入'
  const wasIn = inLibrary.value
  store.add(props.anime, status)
  menuOpen.value = false
  showFeedback(wasIn ? `已切换为${label}` : `已加入 · ${label}`)
}

function removeFromLibrary(event: Event) {
  event.preventDefault()
  event.stopPropagation()
  // Remove by library record id (may differ from card source id after cross-source merge).
  store.remove(libraryItem.value?.id || props.anime.id)
  menuOpen.value = false
  showFeedback('已从列表删除')
}

function advanceProgress(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  if (!libraryProgress.value.canAdvance) return
  const id = libraryItem.value?.id || props.anime.id
  store.updateProgress(id, libraryProgress.value.watched + 1)
  showFeedback(`已看到第 ${libraryProgress.value.watched + 1} 集`)
}

function onDocPointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest?.('.anime-card.is-menu-open') === rootRef.value) return
  if (!rootRef.value?.contains(target)) menuOpen.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') menuOpen.value = false
}

// Only the card whose menu is open listens on document, instead of every
// mounted card running two handlers per click/keypress.
watch(menuOpen, (open) => {
  if (open) {
    document.addEventListener('pointerdown', onDocPointerDown)
    document.addEventListener('keydown', onKeydown)
  } else {
    document.removeEventListener('pointerdown', onDocPointerDown)
    document.removeEventListener('keydown', onKeydown)
  }
})

function onFocusOut(event: FocusEvent) {
  const next = event.relatedTarget as Node | null
  if (!next || !rootRef.value?.contains(next)) focusWithin.value = false
}

onMounted(() => {
  // Library tabs remount frequently — show immediately, no observer delay.
  if (props.instant || !rootRef.value) {
    revealed.value = true
    return
  }
  // Home/discover: reveal when scrolled into view (shared observer).
  stopReveal = observeReveal(rootRef.value, () => {
    revealed.value = true
    stopReveal = null
  })
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
  document.removeEventListener('keydown', onKeydown)
  if (feedbackTimer) clearTimeout(feedbackTimer)
  stopReveal?.()
  stopReveal = null
})
</script>

<template>
  <article
    ref="rootRef"
    class="anime-card"
    :data-anime-id="anime.id"
    :class="{
      'is-menu-open': menuOpen,
      'is-in-library': inLibrary,
      'is-flash': flash,
      'is-revealed': revealed,
      'is-expanding': isActiveExpand,
    }"
    :style="{ '--enter-delay': enterDelay }"
    role="button"
    tabindex="0"
    @click="openDetail"
    @keydown.enter.prevent="openDetail"
    @keydown.space.prevent="openDetail"
    @pointerenter="hovered = true"
    @pointerleave="hovered = false"
    @focusin="focusWithin = true"
    @focusout="onFocusOut"
  >
    <div class="poster-wrap">
      <div v-if="failed || !anime.image" class="poster-missing">暂无海报</div>
      <img
        v-else
        :src="displayImage"
        :alt="`${anime.title} 海报`"
        width="214"
        height="303"
        loading="lazy"
        decoding="async"
        @error="failed = true"
      />
      <span v-if="index" class="rank-number">{{ String(index).padStart(2, '0') }}</span>
      <span v-if="anime.score" class="card-score">
        <PhStar :size="12" weight="fill" />{{ anime.score.toFixed(1) }}
      </span>

      <Transition name="status-chip">
        <span v-if="inLibrary" class="library-chip">{{ currentStatusLabel }}</span>
      </Transition>

      <div class="poster-add">
        <button
          ref="posterActionRef"
          class="poster-action"
          type="button"
          :style="posterActionGlassStyle"
          :aria-label="inLibrary ? `追番状态：${currentStatusLabel}` : '加入追番库'"
          :title="inLibrary ? `追番状态：${currentStatusLabel}` : '加入追番库'"
          :aria-expanded="menuOpen"
          aria-haspopup="menu"
          @click="toggleMenu"
        >
          <PhCheck v-if="inLibrary" :size="17" weight="bold" />
          <PhPlus v-else :size="17" weight="bold" />
          <PhCaretDown class="poster-action__caret" :size="10" weight="bold" />
        </button>
      </div>

      <Transition name="card-toast">
        <div v-if="feedback" class="card-toast" role="status">{{ feedback }}</div>
      </Transition>
    </div>

    <!-- Outside poster-wrap so the menu can extend over anime-meta without overflow clip. -->
    <Transition name="status-menu">
      <div
        v-if="menuOpen"
        ref="statusMenuRef"
        class="poster-status-menu"
        :style="statusMenuGlassStyle"
        role="menu"
        aria-label="选择追番状态"
        @click.stop
      >
        <p class="poster-status-menu__title">{{ inLibrary ? '修改状态' : '加入到' }}</p>
        <button
          v-for="opt in STATUS_OPTIONS"
          :key="opt.value"
          type="button"
          role="menuitemradio"
          :aria-checked="libraryItem?.status === opt.value"
          :class="{ active: libraryItem?.status === opt.value }"
          @click="pickStatus(opt.value, $event)"
        >
          <span>{{ opt.label }}</span>
          <PhCheck v-if="libraryItem?.status === opt.value" :size="14" weight="bold" />
        </button>
        <button
          v-if="inLibrary"
          type="button"
          class="poster-status-menu__remove"
          role="menuitem"
          @pointerdown.stop.prevent="removeFromLibrary"
          @click.stop.prevent="removeFromLibrary"
        >
          <span>从列表删除</span>
          <PhTrash :size="14" weight="bold" />
        </button>
      </div>
    </Transition>

    <div class="anime-meta">
      <h3 :title="anime.title">{{ anime.title }}</h3>
      <p>
        <span class="source-label">{{ anime.source }}</span>
        <span>{{ anime.year || '待定' }}</span>
        <span
          v-if="anime.episodes"
          class="anime-meta__eps"
          :data-digits="String(anime.episodes).replace(/\D/g, '').length >= 5
            ? 5
            : String(anime.episodes).replace(/\D/g, '').length >= 4
              ? 4
              : String(anime.episodes).replace(/\D/g, '').length >= 3
                ? 3
                : 0"
        >{{ anime.episodes }}话</span>
      </p>
      <div
        v-if="inLibrary && libraryItem?.status !== 'planned'"
        class="anime-card-progress"
        :class="{
          'is-tracking': libraryProgress.mode === 'tracking',
          'is-catching-up': libraryProgress.mode === 'catching-up',
        }"
      >
        <div class="anime-card-progress__copy">
          <span>已看 {{ libraryProgress.watched }}{{ libraryProgress.available ? ` / ${libraryProgress.available}` : '' }} 集</span>
          <span v-if="libraryProgress.mode" class="anime-card-progress__update">
            <i aria-hidden="true" />{{ libraryProgress.mode === 'tracking' ? '追番' : '补番' }}
          </span>
        </div>
        <div class="anime-card-progress__actions">
          <span v-if="libraryItem?.userScore != null" class="anime-card-progress__score">
            <PhStar :size="12" weight="fill" />{{ libraryItem.userScore.toFixed(1) }}
          </span>
          <button
            v-if="libraryProgress.canAdvance"
            class="anime-card-progress__advance"
            type="button"
            aria-label="标记看到下一集"
            title="标记看到下一集"
            @click="advanceProgress"
          >
            <PhPlus :size="14" weight="bold" />
          </button>
        </div>
      </div>
    </div>
  </article>
</template>
