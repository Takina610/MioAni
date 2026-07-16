import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  DEFAULT_DISCOVER_FILTERS,
  DISCOVER_PAGE_SIZE,
  FALLBACK_ANILIST_GENRES,
  FALLBACK_BANGUMI_GENRES,
  filterKey,
} from '../constants/discover'
import { browseAnime, fetchGenresForSource } from '../services/anime'
import type { Anime } from '../types/anime'
import type { DiscoverFilters, DiscoverGenreOption, DiscoverSource } from '../types/discover'

export const useDiscoverStore = defineStore('discover', () => {
  const keyword = ref('')
  const filters = ref<DiscoverFilters>({
    ...DEFAULT_DISCOVER_FILTERS,
    genres: [...DEFAULT_DISCOVER_FILTERS.genres],
  })
  const items = ref<Anime[]>([])
  const page = ref(0)
  const hasMore = ref(true)
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref('')
  const activeSource = ref<DiscoverSource | null>(null)
  const stickyKey = ref('')
  const total = ref<number | undefined>(undefined)

  /** Genre catalog for the active source (fetched from that source). */
  const genreOptions = ref<DiscoverGenreOption[]>([...FALLBACK_BANGUMI_GENRES])
  const genresLoading = ref(false)
  const genresSource = ref<DiscoverSource | null>(null)
  let genreSeq = 0
  /** Bumps on each reset so stale responses are ignored. */
  let requestSeq = 0

  const sourceLabel = computed(() => {
    if (activeSource.value === 'bangumi') return 'Bangumi'
    if (activeSource.value === 'anilist') return 'AniList'
    return '跨源'
  })

  const resultLabel = computed(() => {
    const q = keyword.value.trim()
    if (q) return `“${q}”`
    return '浏览发现'
  })

  function currentKey() {
    return filterKey(keyword.value, filters.value)
  }

  async function loadGenresFor(source: DiscoverSource) {
    if (genresSource.value === source && genreOptions.value.length) return
    const seq = ++genreSeq
    genresLoading.value = true
    try {
      const list = await fetchGenresForSource(source)
      if (seq !== genreSeq) return
      genreOptions.value = list
      genresSource.value = source
      // Drop selections that no longer exist on this source.
      const valid = new Set(list.map((g) => g.id))
      const nextGenres = filters.value.genres.filter((id) => valid.has(id))
      if (nextGenres.length !== filters.value.genres.length) {
        filters.value = { ...filters.value, genres: nextGenres }
      }
    } catch {
      if (seq !== genreSeq) return
      genreOptions.value = source === 'anilist' ? [...FALLBACK_ANILIST_GENRES] : [...FALLBACK_BANGUMI_GENRES]
      genresSource.value = source
    } finally {
      if (seq === genreSeq) genresLoading.value = false
    }
  }

  async function fetchPage(nextPage: number, append: boolean, seq: number) {
    const keyAtStart = currentKey()
    // Sticky source only for subsequent pages of the same filter key.
    // Reset/page-1 always re-resolves Bangumi → AniList (no stale hint).
    const sourceHint = append && stickyKey.value === keyAtStart
      ? (activeSource.value ?? undefined)
      : undefined

    if (!append) {
      activeSource.value = null
      stickyKey.value = keyAtStart
    }

    if (append) loadingMore.value = true
    else loading.value = true
    error.value = ''

    try {
      const result = await browseAnime({
        keyword: keyword.value,
        filters: {
          ...filters.value,
          genres: [...filters.value.genres],
        },
        page: nextPage,
        pageSize: DISCOVER_PAGE_SIZE,
        sourceHint,
      })

      if (seq !== requestSeq) return

      activeSource.value = result.source
      stickyKey.value = keyAtStart
      page.value = nextPage
      hasMore.value = result.hasMore
      total.value = result.total
      void loadGenresFor(result.source)

      if (append) {
        const seen = new Set(items.value.map((item) => item.id))
        const unique = result.items.filter((item) => !seen.has(item.id))
        items.value = [...items.value, ...unique]
      } else {
        items.value = result.items
      }
    } catch (reason) {
      if (seq !== requestSeq) return
      error.value = reason instanceof Error ? reason.message : '加载失败'
      if (!append) {
        items.value = []
        hasMore.value = false
      }
    } finally {
      if (seq === requestSeq) {
        loading.value = false
        loadingMore.value = false
      }
    }
  }

  async function resetAndLoad() {
    const seq = ++requestSeq
    page.value = 0
    hasMore.value = true
    items.value = []
    activeSource.value = null
    stickyKey.value = currentKey()
    loadingMore.value = false
    error.value = ''
    await fetchPage(1, false, seq)
  }

  async function loadMore() {
    if (loading.value || loadingMore.value || !hasMore.value || error.value) return
    const seq = requestSeq
    await fetchPage(page.value + 1, true, seq)
  }

  async function retry() {
    if (!items.value.length || page.value <= 0) {
      await resetAndLoad()
      return
    }
    if (error.value) {
      const seq = requestSeq
      error.value = ''
      await fetchPage(page.value + 1, true, seq)
      return
    }
    await resetAndLoad()
  }

  function setKeyword(value: string) {
    keyword.value = value
  }

  function setFilters(partial: Partial<DiscoverFilters>) {
    filters.value = { ...filters.value, ...partial }
  }

  function replaceFilters(next: DiscoverFilters) {
    filters.value = { ...next }
  }

  function clearKeyword() {
    keyword.value = ''
  }

  // Prefetch Bangumi genres (primary source) on first store use.
  void loadGenresFor('bangumi')

  watch(activeSource, (source) => {
    if (source) void loadGenresFor(source)
  })

  return {
    keyword,
    filters,
    items,
    page,
    hasMore,
    loading,
    loadingMore,
    error,
    activeSource,
    total,
    genreOptions,
    genresLoading,
    genresSource,
    sourceLabel,
    resultLabel,
    setKeyword,
    setFilters,
    replaceFilters,
    clearKeyword,
    resetAndLoad,
    loadMore,
    retry,
    loadGenresFor,
  }
})
