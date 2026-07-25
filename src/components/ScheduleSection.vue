<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhCaretLeft, PhCaretRight, PhStar } from '@phosphor-icons/vue'
import type { ScheduleDay, ScheduleItem } from '../types/schedule'
import { useDetailOverlayStore } from '../stores/detailOverlay'

const props = withDefaults(defineProps<{
  days: ScheduleDay[]
  page?: boolean
}>(), {
  page: false,
})

const detailOverlay = useDetailOverlayStore()
const router = useRouter()
const route = useRoute()

const selectedWeekday = ref(0)
const rowRefs = ref<Record<string, HTMLElement | null>>({})
const railRef = ref<HTMLElement | null>(null)
/** Skip first paint animation + scrollIntoView (enter page must stay snappy). */
const ready = ref(false)

const dayIndex = computed(() => {
  const i = props.days.findIndex((d) => d.weekday === selectedWeekday.value)
  return i >= 0 ? i : 0
})

const activeDay = computed(() => props.days[dayIndex.value] || props.days[0])

const timedCount = computed(() => {
  const items = activeDay.value?.items
  if (!items?.length) return 0
  let n = 0
  for (const item of items) if (item.timed) n += 1
  return n
})

const pendingCount = computed(() => {
  const items = activeDay.value?.items
  if (!items?.length) return 0
  return items.length - timedCount.value
})

function defaultWeekday(days: ScheduleDay[]): number {
  return days.find((d) => d.isToday)?.weekday ?? days[0]?.weekday ?? 1
}

function selectDay(weekday: number) {
  if (weekday === selectedWeekday.value) return
  selectedWeekday.value = weekday
}

function stepDay(delta: number) {
  if (!props.days.length) return
  const next = (dayIndex.value + delta + props.days.length) % props.days.length
  selectDay(props.days[next].weekday)
}

function setRowRef(id: string, el: unknown) {
  if (el instanceof HTMLElement) rowRefs.value[id] = el
  else delete rowRefs.value[id]
}

async function openItem(item: ScheduleItem) {
  const row = rowRefs.value[item.anime.id]
  const poster = row?.querySelector('.schedule-flow__cover') || row || null
  const fromPath = route.fullPath
  await detailOverlay.openFromCard(item.anime, poster, fromPath)
  if (route.name !== 'anime-detail' || route.params.id !== item.anime.id) {
    await router.push({ name: 'anime-detail', params: { id: item.anime.id } })
  }
}

function onKeydown(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (e.key === 'ArrowLeft') {
    e.preventDefault()
    stepDay(-1)
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    stepDay(1)
  }
}

watch(
  () => props.days,
  (days) => {
    if (!days.length) return
    if (!days.some((d) => d.weekday === selectedWeekday.value)) {
      selectedWeekday.value = defaultWeekday(days)
    }
  },
  { immediate: true },
)

watch(selectedWeekday, () => {
  if (!ready.value) return
  const active = railRef.value?.querySelector<HTMLElement>('.schedule-rail__day.is-active')
  active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
})

onMounted(() => {
  selectedWeekday.value = defaultWeekday(props.days)
  // Defer "ready" so first paint is static (no enter animation jank).
  requestAnimationFrame(() => {
    ready.value = true
  })
  window.addEventListener('keydown', onKeydown, { passive: false })
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <section
    class="season-schedule schedule-flow"
    :class="{ 'season-schedule--page': page, 'is-ready': ready }"
    :aria-labelledby="page ? undefined : 'schedule-heading'"
  >
    <div v-if="!page" class="directory-head directory-head--solo">
      <div>
        <span>SCHEDULE</span>
        <h2 id="schedule-heading">番剧时间表</h2>
      </div>
      <p class="directory-count">本周放送 · 按时间流</p>
    </div>

    <div class="schedule-rail-wrap">
      <button type="button" class="schedule-rail__nav" aria-label="上一天" @click="stepDay(-1)">
        <PhCaretLeft :size="18" weight="bold" />
      </button>

      <div ref="railRef" class="schedule-rail" role="tablist" aria-label="选择星期">
        <button
          v-for="day in days"
          :key="day.weekday"
          type="button"
          role="tab"
          class="schedule-rail__day"
          :class="{
            'is-active': day.weekday === selectedWeekday,
            'is-today': day.isToday,
          }"
          :aria-selected="day.weekday === selectedWeekday"
          :aria-label="`${day.label}${day.isToday ? '，今天' : ''}，${day.items.length} 部`"
          @click="selectDay(day.weekday)"
        >
          <span class="schedule-rail__label">{{ day.label.replace('周', '') }}</span>
          <strong class="schedule-rail__count">{{ day.items.length }}</strong>
          <span v-if="day.isToday" class="schedule-rail__dot" aria-hidden="true" />
        </button>
      </div>

      <button type="button" class="schedule-rail__nav" aria-label="下一天" @click="stepDay(1)">
        <PhCaretRight :size="18" weight="bold" />
      </button>
    </div>

    <div class="schedule-stage">
      <header class="schedule-stage__head">
        <div>
          <p class="schedule-stage__kicker">TIME STREAM</p>
          <h3 class="schedule-stage__title">
            {{ activeDay?.label || '—' }}
            <span v-if="activeDay?.isToday" class="schedule-stage__badge">今天</span>
          </h3>
        </div>
        <p class="schedule-stage__meta">
          <span>{{ activeDay?.items.length || 0 }} 部</span>
          <span v-if="timedCount"> · {{ timedCount }} 有时刻</span>
          <span v-if="pendingCount"> · {{ pendingCount }} 待定</span>
        </p>
      </header>

      <div v-if="activeDay?.items.length" class="schedule-flow__track">
        <div class="schedule-flow__spine" aria-hidden="true" />

        <article
          v-for="(item, index) in activeDay.items"
          :key="item.anime.id"
          class="schedule-flow__item"
          :class="{
            'is-pending': !item.timed,
            'is-expanding': detailOverlay.open && detailOverlay.returnCardId === item.anime.id,
          }"
          :data-anime-id="item.anime.id"
          :style="ready ? { '--i': Math.min(index, 12) } : undefined"
          :ref="(el) => setRowRef(item.anime.id, el)"
        >
          <div class="schedule-flow__node" aria-hidden="true">
            <span class="schedule-flow__ring" />
          </div>

          <button
            type="button"
            class="schedule-flow__card"
            :aria-label="`查看 ${item.anime.title}`"
            @click="openItem(item)"
          >
            <time class="schedule-flow__time" :class="{ 'is-pending': !item.timed }">
              {{ item.timed ? item.airTime : '待定' }}
            </time>
            <span class="schedule-flow__cover" data-anime-poster aria-hidden="true">
              <img
                v-if="item.anime.image"
                :src="item.anime.image"
                alt=""
                loading="lazy"
                decoding="async"
              />
              <span v-else class="schedule-flow__cover-fallback" />
            </span>
            <span class="schedule-flow__body">
              <span class="schedule-flow__name">{{ item.anime.title }}</span>
              <span v-if="item.anime.score" class="schedule-flow__sub">
                <PhStar :size="12" weight="fill" />
                {{ item.anime.score.toFixed(1) }}
              </span>
              <span
                v-else-if="item.anime.originalTitle && item.anime.originalTitle !== item.anime.title"
                class="schedule-flow__sub"
              >
                {{ item.anime.originalTitle }}
              </span>
            </span>
            <span class="schedule-flow__index" aria-hidden="true">
              {{ String(index + 1).padStart(2, '0') }}
            </span>
          </button>
        </article>
      </div>

      <p v-else class="schedule-flow__empty">这一天暂无放送</p>
    </div>
  </section>
</template>
