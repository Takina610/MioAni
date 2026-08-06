<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhCaretLeft, PhCaretRight, PhStar } from '@phosphor-icons/vue'
import type { ScheduleDay, ScheduleItem } from '../types/schedule'
import { useDetailOverlayStore } from '../stores/detailOverlay'
import {
  addLocalDays,
  formatScheduleMonthDay,
  isSameLocalDay,
  itemsForWeekday,
  sliceScheduleWindow,
  startOfLocalDay,
  weekdayLabel,
} from '../services/schedule'

/** Match discover `catalog-grid` density: 6 desktop / 3 mobile. */
const DESKTOP_COLUMNS = 6
const NARROW_COLUMNS = 3
const COLUMN_MQ = '(min-width: 760px)'

export type ScheduleColumn = {
  key: string
  date: Date
  weekday: number
  label: string
  monthDay: string
  isToday: boolean
  items: ScheduleItem[]
}

const props = withDefaults(defineProps<{
  days: ScheduleDay[]
  page?: boolean
}>(), {
  page: false,
})

const detailOverlay = useDetailOverlayStore()
const router = useRouter()
const route = useRoute()

function initialColumnCount(): number {
  if (typeof window === 'undefined') return DESKTOP_COLUMNS
  return window.matchMedia(COLUMN_MQ).matches ? DESKTOP_COLUMNS : NARROW_COLUMNS
}

const windowStart = ref(startOfLocalDay(new Date()))
const columnCount = ref(initialColumnCount())
const rowRefs = ref<Record<string, HTMLElement | null>>({})
/** Skip first paint animation (enter page must stay snappy). */
const ready = ref(false)

let mediaQuery: MediaQueryList | null = null

const visibleColumns = computed((): ScheduleColumn[] => {
  const dates = sliceScheduleWindow(windowStart.value, columnCount.value)
  const now = new Date()
  return dates.map((date) => {
    const weekday = date.getDay()
    return {
      key: `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
      date,
      weekday,
      label: weekdayLabel(weekday),
      monthDay: formatScheduleMonthDay(date),
      isToday: isSameLocalDay(date, now),
      items: itemsForWeekday(props.days, weekday),
    }
  })
})

function syncColumnCount() {
  columnCount.value = mediaQuery?.matches ? DESKTOP_COLUMNS : NARROW_COLUMNS
}

function stepWindow(delta: number) {
  windowStart.value = startOfLocalDay(addLocalDays(windowStart.value, delta))
}

function setRowRef(id: string, el: unknown) {
  if (el instanceof HTMLElement) rowRefs.value[id] = el
  else delete rowRefs.value[id]
}

async function openItem(item: ScheduleItem) {
  const row = rowRefs.value[item.anime.id]
  const poster = row?.querySelector('.schedule-poster-card__cover') || row || null
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
    stepWindow(-1)
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    stepWindow(1)
  }
}

function onMediaChange() {
  syncColumnCount()
}

onMounted(() => {
  windowStart.value = startOfLocalDay(new Date())
  mediaQuery = window.matchMedia(COLUMN_MQ)
  syncColumnCount()
  mediaQuery.addEventListener('change', onMediaChange)
  requestAnimationFrame(() => {
    ready.value = true
  })
  window.addEventListener('keydown', onKeydown, { passive: false })
})

onUnmounted(() => {
  mediaQuery?.removeEventListener('change', onMediaChange)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <section
    class="season-schedule schedule-flow"
    :class="{ 'season-schedule--page': page, 'is-ready': ready }"
    :style="{ '--schedule-cols': columnCount }"
    :aria-labelledby="page ? undefined : 'schedule-heading'"
  >
    <div v-if="!page" class="directory-head directory-head--solo">
      <div>
        <span>SCHEDULE</span>
        <h2 id="schedule-heading">番剧时间表</h2>
      </div>
      <p class="directory-count">本周放送 · 六日窗口</p>
    </div>

    <div class="schedule-rail-wrap">
      <button type="button" class="schedule-rail__nav" aria-label="向前一天" @click="stepWindow(-1)">
        <PhCaretLeft :size="18" weight="bold" />
      </button>

      <div
        class="schedule-window-heads"
        role="group"
        :aria-label="`放送窗口，${columnCount} 日`"
      >
        <div
          v-for="col in visibleColumns"
          :key="col.key"
          class="schedule-window-head"
          :class="{ 'is-today': col.isToday }"
        >
          <span class="schedule-window-head__label">{{ col.label }}</span>
          <span class="schedule-window-head__date">{{ col.monthDay }}</span>
        </div>
      </div>

      <button type="button" class="schedule-rail__nav" aria-label="向后一天" @click="stepWindow(1)">
        <PhCaretRight :size="18" weight="bold" />
      </button>
    </div>

    <div
      class="schedule-columns"
      role="list"
      aria-label="放送日程"
    >
      <div
        v-for="col in visibleColumns"
        :key="col.key"
        class="schedule-col"
        :class="{ 'is-today': col.isToday }"
        role="listitem"
        :aria-label="`${col.label} ${col.monthDay}`"
      >
        <header class="schedule-col__head">
          <h3 class="schedule-col__title">{{ col.label }}</h3>
          <p class="schedule-col__date">{{ col.monthDay }}</p>
        </header>

        <div v-if="col.items.length" class="schedule-col__track">
          <article
            v-for="(item, index) in col.items"
            :key="`${col.key}-${item.anime.id}`"
            class="schedule-poster-card"
            :class="{
              'is-pending': !item.timed,
              'is-expanding': detailOverlay.open && detailOverlay.returnCardId === item.anime.id,
            }"
            :data-anime-id="item.anime.id"
            :style="ready ? { '--i': Math.min(index, 12) } : undefined"
            :ref="(el) => setRowRef(item.anime.id, el)"
          >
            <button
              type="button"
              class="schedule-poster-card__btn"
              :aria-label="`查看 ${item.anime.title}`"
              @click="openItem(item)"
            >
              <span class="schedule-poster-card__cover" data-anime-poster aria-hidden="true">
                <img
                  v-if="item.anime.image"
                  :src="item.anime.image"
                  alt=""
                  width="214"
                  height="303"
                  loading="lazy"
                  decoding="async"
                />
                <span v-else class="schedule-poster-card__cover-fallback" />
                <span
                  v-if="item.anime.score"
                  class="schedule-poster-card__score"
                >
                  <PhStar :size="11" weight="fill" />
                  {{ item.anime.score.toFixed(1) }}
                </span>
              </span>
              <span class="schedule-poster-card__name">{{ item.anime.title }}</span>
              <span
                v-if="item.anime.originalTitle && item.anime.originalTitle !== item.anime.title"
                class="schedule-poster-card__original"
              >
                {{ item.anime.originalTitle }}
              </span>
              <time
                class="schedule-poster-card__time"
                :class="{ 'is-pending': !item.timed }"
              >
                {{ item.timed ? item.airTime : '待定' }}
              </time>
            </button>
          </article>
        </div>

        <p v-else class="schedule-flow__empty schedule-col__empty">这一天暂无放送</p>
      </div>
    </div>
  </section>
</template>
