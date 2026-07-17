<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhPlus, PhCheck, PhStar, PhCaretDown, PhTrash } from '@phosphor-icons/vue'
import type { Anime, WatchStatus } from '../types/anime'
import { useLibraryStore } from '../stores/library'
import { useDetailOverlayStore } from '../stores/detailOverlay'

const props = withDefaults(defineProps<{
  anime: Anime
  index?: number
  /** Skip scroll-reveal (library tabs / already-visible grids). */
  instant?: boolean
}>(), {
  instant: false,
})
const store = useLibraryStore()
const detailOverlay = useDetailOverlayStore()
const router = useRouter()
const route = useRoute()
const failed = ref(false)
const menuOpen = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const revealed = ref(props.instant)
const feedback = ref('')
const flash = ref(false)
let feedbackTimer: ReturnType<typeof setTimeout> | null = null
let revealObserver: IntersectionObserver | null = null
/**
 * Hide source poster only while flyer is leaving the card.
 * During collapse the card poster stays visible under the returning flyer
 * so handoff never flashes a blank frame.
 */
/**
 * Hide list poster only when THIS card is the return target during flight.
 * Related handoffs keep the original list card hidden until full close.
 */
const isActiveExpand = computed(() => {
  if (!detailOverlay.open || detailOverlay.phase === 'collapsing') return false
  const returnId = detailOverlay.returnCardId || detailOverlay.activeId
  return returnId === props.anime.id
})

const STATUS_OPTIONS: { value: WatchStatus; label: string }[] = [
  { value: 'watching', label: '在看' },
  { value: 'completed', label: '看过' },
  { value: 'planned', label: '想看' },
]

// Cross-source identity: Bangumi and AniList of the same show share library status.
const libraryItem = computed(() => store.findInLibrary(props.anime))
const inLibrary = computed(() => Boolean(libraryItem.value))
const currentStatusLabel = computed(() =>
  STATUS_OPTIONS.find((opt) => opt.value === libraryItem.value?.status)?.label || '已加入',
)

const enterDelay = computed(() => `${Math.min((props.index ?? 1) - 1, 12) * 45}ms`)

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

function onDocPointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest?.('.anime-card.is-menu-open') === rootRef.value) return
  if (!rootRef.value?.contains(target)) menuOpen.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') menuOpen.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown)
  document.addEventListener('keydown', onKeydown)

  // Library tabs remount frequently — show immediately, no observer delay.
  if (props.instant) {
    revealed.value = true
    return
  }

  // Home/discover: reveal when scrolled into view.
  if (typeof IntersectionObserver === 'undefined') {
    revealed.value = true
    return
  }
  revealObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        revealed.value = true
        revealObserver?.disconnect()
        revealObserver = null
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  )
  if (rootRef.value) revealObserver.observe(rootRef.value)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
  document.removeEventListener('keydown', onKeydown)
  if (feedbackTimer) clearTimeout(feedbackTimer)
  revealObserver?.disconnect()
  revealObserver = null
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
  >
    <div class="poster-wrap">
      <div v-if="failed || !anime.image" class="poster-missing">暂无海报</div>
      <img v-else :src="anime.image" :alt="`${anime.title} 海报`" loading="lazy" @error="failed = true" />
      <span v-if="index" class="rank-number">{{ String(index).padStart(2, '0') }}</span>

      <Transition name="status-chip">
        <span v-if="inLibrary" class="library-chip">{{ currentStatusLabel }}</span>
      </Transition>

      <div class="poster-add">
        <button
          class="poster-action"
          type="button"
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

        <Transition name="status-menu">
          <div v-if="menuOpen" class="poster-status-menu" role="menu" aria-label="选择追番状态">
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
      </div>

      <Transition name="card-toast">
        <div v-if="feedback" class="card-toast" role="status">{{ feedback }}</div>
      </Transition>
    </div>
    <div class="anime-meta">
      <h3 :title="anime.title">{{ anime.title }}</h3>
      <p>
        <span class="source-label">{{ anime.source }}</span>
        <span>{{ anime.year || '待定' }}</span>
        <span v-if="anime.episodes">{{ anime.episodes }} 话</span>
        <span v-if="anime.score" class="card-score"><PhStar :size="12" weight="fill" />{{ anime.score.toFixed(1) }}</span>
      </p>
    </div>
  </article>
</template>
