<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  PhMagnifyingGlass,
  PhWarningCircle,
  PhX,
  PhCaretDown,
  PhCheck,
} from '@phosphor-icons/vue'
import AnimeCard from '../components/AnimeCard.vue'
import {
  SEASON_OPTIONS,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  buildYearOptions,
} from '../constants/discover'
import { useDiscoverStore } from '../stores/discover'
import type { AirStatus, DiscoverSeason, DiscoverSort } from '../types/discover'

type DropdownKey = 'genre' | 'year' | 'season' | 'status' | 'sort'

const store = useDiscoverStore()
const draftKeyword = ref('')
const scoreMinDraft = ref(store.filters.scoreMin)
const scoreMaxDraft = ref(store.filters.scoreMax)
const scoreActiveThumb = ref<'min' | 'max'>('max')
const yearOptions = buildYearOptions()
const sentinel = ref<HTMLElement | null>(null)
const openDropdown = ref<DropdownKey | null>(null)
let observer: IntersectionObserver | null = null
let scoreTimer: ReturnType<typeof setTimeout> | null = null
let genreTimer: ReturnType<typeof setTimeout> | null = null

const countLabel = computed(() => {
  if (store.total != null) return `${store.items.length} / ${store.total} 条`
  return `${store.items.length} 条`
})

const showInitialSkeleton = computed(() => store.loading && !store.items.length)

const selectedGenreLabels = computed(() =>
  store.genreOptions
    .filter((g) => store.filters.genres.includes(g.id))
    .map((g) => g.label),
)

const genreLabel = computed(() => {
  const labels = selectedGenreLabels.value
  if (!labels.length) return '全部类型'
  if (labels.length === 1) return labels[0]
  if (labels.length === 2) return labels.join(' · ')
  return `${labels[0]} 等 ${labels.length} 项`
})

const genreSourceHint = computed(() => {
  if (store.genresSource === 'bangumi') return 'Bangumi 标签'
  if (store.genresSource === 'anilist') return 'AniList genres'
  return '类型'
})

const yearLabel = computed(() =>
  store.filters.year == null ? '全部年份' : String(store.filters.year),
)
const seasonLabel = computed(
  () => SEASON_OPTIONS.find((o) => o.value === (store.filters.season ?? ''))?.label ?? '全部季度',
)
const statusLabel = computed(
  () => STATUS_OPTIONS.find((o) => o.value === store.filters.status)?.label ?? '全部状态',
)
const sortLabel = computed(
  () => SORT_OPTIONS.find((o) => o.value === store.filters.sort)?.label ?? '排序',
)

const scoreFillStyle = computed(() => {
  const min = Math.min(scoreMinDraft.value, scoreMaxDraft.value)
  const max = Math.max(scoreMinDraft.value, scoreMaxDraft.value)
  return {
    left: `${(min / 10) * 100}%`,
    width: `${((max - min) / 10) * 100}%`,
  }
})

function submitSearch() {
  const next = draftKeyword.value.trim()
  store.setKeyword(next)
  if (next && store.filters.sort === 'heat') {
    store.setFilters({ sort: 'match' })
  } else if (!next && store.filters.sort === 'match') {
    store.setFilters({ sort: 'heat' })
  }
  void store.resetAndLoad()
}

function clearKeyword() {
  draftKeyword.value = ''
  store.clearKeyword()
  void store.resetAndLoad()
}

function scheduleGenreReload() {
  if (genreTimer) clearTimeout(genreTimer)
  genreTimer = setTimeout(() => {
    void store.resetAndLoad()
  }, 220)
}

function toggleGenre(id: string) {
  const current = store.filters.genres
  const next = current.includes(id)
    ? current.filter((g) => g !== id)
    : [...current, id]
  store.setFilters({ genres: next })
  scheduleGenreReload()
}

function clearGenres() {
  if (!store.filters.genres.length) return
  store.setFilters({ genres: [] })
  scheduleGenreReload()
}

function toggleDropdown(key: DropdownKey) {
  openDropdown.value = openDropdown.value === key ? null : key
}

function closeDropdown() {
  openDropdown.value = null
}

function pickYear(value: number | null) {
  store.setFilters({ year: value })
  closeDropdown()
  void store.resetAndLoad()
}

function pickSeason(value: DiscoverSeason | null) {
  store.setFilters({ season: value })
  closeDropdown()
  void store.resetAndLoad()
}

function pickStatus(value: AirStatus) {
  store.setFilters({ status: value })
  closeDropdown()
  void store.resetAndLoad()
}

function pickSort(value: DiscoverSort) {
  store.setFilters({ sort: value })
  closeDropdown()
  void store.resetAndLoad()
}

function clampScore(value: number) {
  return Math.min(10, Math.max(0, Math.round(value * 10) / 10))
}

function onScoreMinInput(event: Event) {
  const raw = clampScore(Number((event.target as HTMLInputElement).value))
  scoreMinDraft.value = Math.min(raw, scoreMaxDraft.value)
}

function onScoreMaxInput(event: Event) {
  const raw = clampScore(Number((event.target as HTMLInputElement).value))
  scoreMaxDraft.value = Math.max(raw, scoreMinDraft.value)
}

function onScorePointerDown(which: 'min' | 'max') {
  scoreActiveThumb.value = which
}

/** Apply filters only on release — dragging stays 60fps without refetch stutter. */
function commitScoreRange() {
  if (scoreTimer) clearTimeout(scoreTimer)
  scoreTimer = setTimeout(() => {
    if (
      store.filters.scoreMin === scoreMinDraft.value
      && store.filters.scoreMax === scoreMaxDraft.value
    ) return
    store.setFilters({ scoreMin: scoreMinDraft.value, scoreMax: scoreMaxDraft.value })
    void store.resetAndLoad()
  }, 80)
}

function setupObserver() {
  observer?.disconnect()
  if (!sentinel.value) return
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void store.loadMore()
    },
    { rootMargin: '240px 0px' },
  )
  observer.observe(sentinel.value)
}

function onDocPointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement | null
  if (!target?.closest?.('.filter-dropdown')) closeDropdown()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeDropdown()
}

onMounted(() => {
  draftKeyword.value = store.keyword
  scoreMinDraft.value = store.filters.scoreMin
  scoreMaxDraft.value = store.filters.scoreMax
  if (!store.items.length && !store.loading) void store.resetAndLoad()
  setupObserver()
  document.addEventListener('pointerdown', onDocPointerDown)
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  observer?.disconnect()
  if (scoreTimer) clearTimeout(scoreTimer)
  if (genreTimer) clearTimeout(genreTimer)
  document.removeEventListener('pointerdown', onDocPointerDown)
  document.removeEventListener('keydown', onKeydown)
})

watch(sentinel, () => setupObserver())
</script>

<template>
  <div class="page discover-page">
    <div class="discover-bg" aria-hidden="true">
      <span class="discover-bg__orb discover-bg__orb--a" />
      <span class="discover-bg__orb discover-bg__orb--b" />
      <span class="discover-bg__grid" />
      <span class="discover-bg__glow" />
    </div>

    <section class="discover-masthead">
      <div class="discover-masthead__inner">
        <span class="discover-kicker">DISCOVER / DATABASE</span>
        <h1 class="discover-title">从数万部动画里，找到下一部。</h1>
        <form class="search-box" role="search" @submit.prevent="submitSearch">
          <PhMagnifyingGlass class="search-box__icon" :size="20" weight="bold" aria-hidden="true" />
          <input
            v-model="draftKeyword"
            type="search"
            aria-label="搜索动画"
            placeholder="输入中文、日文或英文标题"
            autocomplete="off"
            enterkeyhint="search"
          />
          <button
            v-if="draftKeyword"
            type="button"
            class="search-box__clear"
            aria-label="清空关键词"
            @click="clearKeyword"
          >
            <PhX :size="16" weight="bold" />
          </button>
          <button type="submit" class="search-box__submit">搜索</button>
        </form>
      </div>
    </section>

    <section class="content-section search-results" aria-live="polite">
      <div class="filter-bar" aria-label="筛选条件">
        <div class="filter-row">
          <div class="filter-field">
            <span class="filter-label">类型</span>
            <div class="filter-dropdown filter-dropdown--genre" :class="{ open: openDropdown === 'genre' }">
              <button
                type="button"
                class="filter-dropdown__trigger"
                :aria-expanded="openDropdown === 'genre'"
                aria-haspopup="listbox"
                @click="toggleDropdown('genre')"
              >
                <span>{{ genreLabel }}</span>
                <PhCaretDown :size="14" aria-hidden="true" />
              </button>
              <div
                v-if="openDropdown === 'genre'"
                class="filter-dropdown__menu filter-dropdown__menu--genre"
                role="listbox"
                aria-label="类型（可多选）"
                aria-multiselectable="true"
              >
                <div class="genre-menu-head">
                  <button
                    type="button"
                    class="genre-menu-all"
                    :class="{ active: !store.filters.genres.length }"
                    role="option"
                    :aria-selected="!store.filters.genres.length"
                    @click="clearGenres"
                  >
                    <span>全部类型</span>
                    <PhCheck v-if="!store.filters.genres.length" :size="14" weight="bold" />
                  </button>
                  <span class="genre-menu-source">{{ genreSourceHint }}</span>
                  <button
                    v-if="store.filters.genres.length"
                    type="button"
                    class="genre-menu-clear"
                    @click="clearGenres"
                  >
                    清空
                  </button>
                </div>
                <div v-if="store.genresLoading && !store.genreOptions.length" class="genre-menu-loading">
                  加载类型中…
                </div>
                <div v-else class="genre-menu-grid">
                  <button
                    v-for="genre in store.genreOptions"
                    :key="genre.id"
                    type="button"
                    role="option"
                    :aria-selected="store.filters.genres.includes(genre.id)"
                    :class="{ active: store.filters.genres.includes(genre.id) }"
                    @click="toggleGenre(genre.id)"
                  >
                    <span>{{ genre.label }}</span>
                    <PhCheck v-if="store.filters.genres.includes(genre.id)" :size="14" weight="bold" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="filter-field">
            <span class="filter-label">年份</span>
            <div class="filter-dropdown" :class="{ open: openDropdown === 'year' }">
              <button
                type="button"
                class="filter-dropdown__trigger"
                :aria-expanded="openDropdown === 'year'"
                aria-haspopup="listbox"
                @click="toggleDropdown('year')"
              >
                <span>{{ yearLabel }}</span>
                <PhCaretDown :size="14" aria-hidden="true" />
              </button>
              <ul v-if="openDropdown === 'year'" class="filter-dropdown__menu" role="listbox" aria-label="年份">
                <li>
                  <button
                    type="button"
                    role="option"
                    :aria-selected="store.filters.year == null"
                    :class="{ active: store.filters.year == null }"
                    @click="pickYear(null)"
                  >
                    <span>全部年份</span>
                    <PhCheck v-if="store.filters.year == null" :size="14" weight="bold" />
                  </button>
                </li>
                <li v-for="year in yearOptions" :key="year">
                  <button
                    type="button"
                    role="option"
                    :aria-selected="store.filters.year === year"
                    :class="{ active: store.filters.year === year }"
                    @click="pickYear(year)"
                  >
                    <span>{{ year }}</span>
                    <PhCheck v-if="store.filters.year === year" :size="14" weight="bold" />
                  </button>
                </li>
              </ul>
            </div>
          </div>

          <div class="filter-field">
            <span class="filter-label">季度</span>
            <div class="filter-dropdown" :class="{ open: openDropdown === 'season' }">
              <button
                type="button"
                class="filter-dropdown__trigger"
                :aria-expanded="openDropdown === 'season'"
                aria-haspopup="listbox"
                @click="toggleDropdown('season')"
              >
                <span>{{ seasonLabel }}</span>
                <PhCaretDown :size="14" aria-hidden="true" />
              </button>
              <ul v-if="openDropdown === 'season'" class="filter-dropdown__menu" role="listbox" aria-label="季度">
                <li v-for="opt in SEASON_OPTIONS" :key="opt.label">
                  <button
                    type="button"
                    role="option"
                    :aria-selected="(store.filters.season ?? '') === opt.value"
                    :class="{ active: (store.filters.season ?? '') === opt.value }"
                    @click="pickSeason((opt.value || null) as DiscoverSeason | null)"
                  >
                    <span>{{ opt.label }}</span>
                    <PhCheck v-if="(store.filters.season ?? '') === opt.value" :size="14" weight="bold" />
                  </button>
                </li>
              </ul>
            </div>
          </div>

          <div class="filter-field">
            <span class="filter-label">状态</span>
            <div class="filter-dropdown" :class="{ open: openDropdown === 'status' }">
              <button
                type="button"
                class="filter-dropdown__trigger"
                :aria-expanded="openDropdown === 'status'"
                aria-haspopup="listbox"
                @click="toggleDropdown('status')"
              >
                <span>{{ statusLabel }}</span>
                <PhCaretDown :size="14" aria-hidden="true" />
              </button>
              <ul v-if="openDropdown === 'status'" class="filter-dropdown__menu" role="listbox" aria-label="状态">
                <li v-for="opt in STATUS_OPTIONS" :key="opt.value">
                  <button
                    type="button"
                    role="option"
                    :aria-selected="store.filters.status === opt.value"
                    :class="{ active: store.filters.status === opt.value }"
                    @click="pickStatus(opt.value)"
                  >
                    <span>{{ opt.label }}</span>
                    <PhCheck v-if="store.filters.status === opt.value" :size="14" weight="bold" />
                  </button>
                </li>
              </ul>
            </div>
          </div>

          <div class="filter-field">
            <span class="filter-label">排序</span>
            <div class="filter-dropdown" :class="{ open: openDropdown === 'sort' }">
              <button
                type="button"
                class="filter-dropdown__trigger"
                :aria-expanded="openDropdown === 'sort'"
                aria-haspopup="listbox"
                @click="toggleDropdown('sort')"
              >
                <span>{{ sortLabel }}</span>
                <PhCaretDown :size="14" aria-hidden="true" />
              </button>
              <ul v-if="openDropdown === 'sort'" class="filter-dropdown__menu" role="listbox" aria-label="排序">
                <li v-for="opt in SORT_OPTIONS" :key="opt.value">
                  <button
                    type="button"
                    role="option"
                    :aria-selected="store.filters.sort === opt.value"
                    :class="{ active: store.filters.sort === opt.value }"
                    @click="pickSort(opt.value)"
                  >
                    <span>{{ opt.label }}</span>
                    <PhCheck v-if="store.filters.sort === opt.value" :size="14" weight="bold" />
                  </button>
                </li>
              </ul>
            </div>
          </div>

          <div class="filter-field score-field">
            <span class="filter-label">
              评分
              <em>{{ scoreMinDraft.toFixed(1) }} – {{ scoreMaxDraft.toFixed(1) }}</em>
            </span>
            <div
              class="dual-range"
              role="group"
              :aria-label="`评分区间 ${scoreMinDraft} 到 ${scoreMaxDraft}`"
            >
              <div class="dual-range__rail">
                <div class="dual-range__fill" :style="scoreFillStyle" />
              </div>
              <input
                type="range"
                min="0"
                max="10"
                step="0.1"
                :value="scoreMinDraft"
                class="dual-range__input dual-range__input--min"
                :class="{ 'is-active': scoreActiveThumb === 'min' }"
                aria-label="最低评分"
                :aria-valuemin="0"
                :aria-valuemax="10"
                :aria-valuenow="scoreMinDraft"
                @pointerdown="onScorePointerDown('min')"
                @input="onScoreMinInput"
                @change="commitScoreRange"
                @pointerup="commitScoreRange"
                @touchend="commitScoreRange"
              />
              <input
                type="range"
                min="0"
                max="10"
                step="0.1"
                :value="scoreMaxDraft"
                class="dual-range__input dual-range__input--max"
                :class="{ 'is-active': scoreActiveThumb === 'max' }"
                aria-label="最高评分"
                :aria-valuemin="0"
                :aria-valuemax="10"
                :aria-valuenow="scoreMaxDraft"
                @pointerdown="onScorePointerDown('max')"
                @input="onScoreMaxInput"
                @change="commitScoreRange"
                @pointerup="commitScoreRange"
                @touchend="commitScoreRange"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="results-title">
        <div>
          <span>{{ store.keyword.trim() ? 'SEARCH RESULT' : 'BROWSE' }} · {{ store.sourceLabel }}</span>
          <h2>{{ store.resultLabel }}</h2>
        </div>
        <p>{{ countLabel }}</p>
      </div>

      <div v-if="showInitialSkeleton" class="discover-loading" aria-busy="true" aria-label="加载中">
        <div class="catalog-grid skeleton-grid discover-skeleton-grid" aria-hidden="true">
          <div
            v-for="index in 8"
            :key="index"
            class="skeleton-card discover-skeleton-card"
            :style="{ '--stagger': index }"
          >
            <span /><i /><i />
          </div>
        </div>

        <div class="discover-loader-overlay">
          <div class="discover-radar" aria-hidden="true">
            <span class="discover-radar__glow" />
            <span class="discover-radar__ring" />
            <span class="discover-radar__ring discover-radar__ring--mid" />
            <span class="discover-radar__ring discover-radar__ring--inner" />
            <span class="discover-radar__sweep" />
            <span class="discover-radar__cross discover-radar__cross--h" />
            <span class="discover-radar__cross discover-radar__cross--v" />
            <span
              v-for="n in 6"
              :key="n"
              class="discover-radar__blip"
              :style="{ '--i': n }"
            />
            <span class="discover-radar__core">
              <PhMagnifyingGlass :size="22" weight="bold" />
            </span>
          </div>

          <div class="discover-loader-copy">
            <span class="discover-loader-copy__kicker">LIVE SCAN</span>
            <p class="discover-loader-copy__title">
              <span class="discover-loader-copy__word">正在定位</span>
              <span class="discover-loader-copy__cursor">下一部动画</span>
            </p>
            <div class="discover-loader-copy__meters" aria-hidden="true">
              <span /><span /><span /><span /><span /><span />
            </div>
            <p class="discover-loader-copy__hint">
              {{ store.sourceLabel }} · 信号锁定中
            </p>
          </div>

          <div class="discover-loader-tickets" aria-hidden="true">
            <span class="discover-loader-ticket" style="--i: 0">EP 01</span>
            <span class="discover-loader-ticket" style="--i: 1">SCORE</span>
            <span class="discover-loader-ticket" style="--i: 2">SEASON</span>
          </div>
        </div>
      </div>

      <div v-else-if="store.error && !store.items.length" class="error-state">
        <PhWarningCircle :size="32" />
        <h3>暂时无法获取结果</h3>
        <p>{{ store.error }}</p>
        <button type="button" @click="store.retry()">重新尝试</button>
      </div>

      <template v-else-if="store.items.length">
        <TransitionGroup name="list" tag="div" class="catalog-grid">
          <AnimeCard
            v-for="(anime, index) in store.items"
            :key="anime.id"
            :anime="anime"
            :index="index + 1"
          />
        </TransitionGroup>

        <div v-if="store.error" class="load-more-error">
          <p>{{ store.error }}</p>
          <button type="button" @click="store.retry()">重试本页</button>
        </div>

        <div v-else-if="store.loadingMore" class="load-more-status" aria-busy="true">
          <span class="load-more-dot" />
          加载更多…
        </div>

        <div v-else-if="!store.hasMore" class="load-more-status muted">已加载全部结果</div>
      </template>

      <div v-else class="empty-state">
        <PhMagnifyingGlass :size="30" />
        <h3>没有找到对应作品</h3>
        <p>试试调整关键词、类型或评分区间。</p>
      </div>

      <div ref="sentinel" class="infinite-sentinel" aria-hidden="true" />
    </section>
  </div>
</template>
