import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Anime, AnimeDetail, AnimeRelation } from '../types/anime'
import {
  fetchAnimeDetailExtras,
  fetchAnimeDetailOverview,
  type DetailExtraSection,
} from '../services/anime'

export interface ExpandRect {
  top: number
  left: number
  width: number
  height: number
}

/** One mounted detail page in the stack (never destroyed until fully closed). */
export interface DetailLayer {
  key: string
  seed: Anime
  detail: AnimeDetail | null
  loading: boolean
  loadingExtras: boolean
  error: string
  loadedExtras: DetailExtraSection[]
  /** Viewport rect this layer flew from (list card or relation thumb). */
  originRect: ExpandRect | null
}

function blankDetailFromSeed(anime: Anime): AnimeDetail {
  return {
    ...anime,
    summary: '',
    tags: anime.tags?.length ? [...anime.tags] : [],
    relations: undefined,
    characters: undefined,
    staff: undefined,
    studios: undefined,
    format: undefined,
    sourceMaterial: undefined,
    airDate: undefined,
    rank: undefined,
    scoreCount: undefined,
    duration: undefined,
  }
}

function animeFromRelation(rel: AnimeRelation): Anime {
  return {
    id: rel.id,
    source: rel.id.startsWith('anilist-') ? 'anilist' : 'bangumi',
    title: rel.title || '加载中…',
    originalTitle: '',
    image: rel.image || '',
    score: 0,
    year: 0,
    season: '',
    episodes: 0,
    watched: 0,
    status: 'planned',
    tags: [],
    summary: '',
  }
}

let layerKeySeq = 0
function nextLayerKey(id: string) {
  layerKeySeq += 1
  return `${id}#${layerKeySeq}`
}

export const useDetailOverlayStore = defineStore('detailOverlay', () => {
  const open = ref(false)
  /**
   * expanding — open from list card or related thumb (full flight + circle)
   * open — settled
   * collapsing — close all the way to list
   * returning — pop one layer back to previous detail (full reverse flight)
   */
  const phase = ref<'idle' | 'expanding' | 'open' | 'collapsing' | 'returning'>('idle')
  /** list = first open from card; related = push new layer; stack = pop */
  const expandMode = ref<'list' | 'related' | 'stack'>('list')

  /** All detail layers stay mounted; top is active. */
  const layers = ref<DetailLayer[]>([])

  const originRect = ref<ExpandRect | null>(null)
  const returnOriginRect = ref<ExpandRect | null>(null)
  const returnCardId = ref('')
  const returnPath = ref('/')
  const closeSignal = ref(0)

  /** Per-layer request tokens so buried layers ignore stale responses. */
  const overviewSeqByKey = new Map<string, number>()
  const extrasSeqByKey = new Map<string, number>()

  const topIndex = computed(() => Math.max(0, layers.value.length - 1))
  const topLayer = computed(() => layers.value[layers.value.length - 1] || null)
  const activeId = computed(() => topLayer.value?.seed.id || topLayer.value?.detail?.id || '')
  const canPopDetail = computed(() => layers.value.length > 1)

  // Convenience aliases for existing UI bindings.
  const seed = computed(() => topLayer.value?.seed || null)
  const detail = computed(() => topLayer.value?.detail || null)
  const loading = computed(() => topLayer.value?.loading || false)
  const loadingExtras = computed(() => topLayer.value?.loadingExtras || false)
  const error = computed(() => topLayer.value?.error || '')

  function requestClose() {
    if (!open.value) return
    closeSignal.value += 1
  }

  /** Force close entire stack (X button / leave list). */
  function requestDismissAll() {
    if (!open.value) return
    // Signal special close: consumer should collapse fully even if stack has depth.
    closeSignal.value += 1
    // Mark so close handler can distinguish — use expandMode temporarily.
    expandMode.value = 'list'
    // Stack depth cleared only in finishClose; pop flag via phase intent.
    ;(requestDismissAll as { _all?: boolean })._all = true
  }

  function captureRect(el: Element | null): ExpandRect | null {
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    return {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    }
  }

  function patchTop(partial: Partial<DetailLayer>) {
    const list = layers.value
    if (!list.length) return
    const i = list.length - 1
    const next = { ...list[i], ...partial }
    layers.value = [...list.slice(0, i), next]
  }

  function patchLayerByKey(key: string, partial: Partial<DetailLayer>) {
    const list = layers.value
    const i = list.findIndex((l) => l.key === key)
    if (i < 0) return
    const next = { ...list[i], ...partial }
    layers.value = [...list.slice(0, i), next, ...list.slice(i + 1)]
  }

  async function loadOverviewForLayer(key: string, id: string, anime?: Anime | null) {
    const seq = (overviewSeqByKey.get(key) || 0) + 1
    overviewSeqByKey.set(key, seq)
    patchLayerByKey(key, { loading: true, error: '' })
    try {
      const result = await fetchAnimeDetailOverview(id)
      if (overviewSeqByKey.get(key) !== seq) return
      const layer = layers.value.find((l) => l.key === key)
      if (!layer) return
      // Prefer richer remote art, but never drop an already-visible seed image mid-open.
      const image = result.image || layer.seed.image || anime?.image || ''
      const banner = result.banner || layer.seed.banner || anime?.banner || image
      const merged: AnimeDetail = {
        ...result,
        image,
        banner,
        watched: anime?.watched || result.watched,
        status: anime?.status || result.status,
      }
      patchLayerByKey(key, {
        detail: merged,
        seed: {
          ...layer.seed,
          ...result,
          image,
          banner,
          watched: anime?.watched || result.watched,
          status: anime?.status || result.status,
        },
        loading: false,
        loadedExtras: [],
      })
    } catch (reason) {
      if (overviewSeqByKey.get(key) !== seq) return
      const layer = layers.value.find((l) => l.key === key)
      if (anime && layer) {
        patchLayerByKey(key, {
          detail: { ...anime, summary: anime.summary || '' },
          error: reason instanceof Error ? reason.message : '详情加载失败',
          loading: false,
        })
      } else {
        patchLayerByKey(key, {
          error: reason instanceof Error ? reason.message : '详情加载失败',
          loading: false,
        })
      }
    }
  }

  async function ensureExtras(section: DetailExtraSection) {
    const layer = topLayer.value
    if (!layer || !open.value) return
    const id = layer.seed.id
    if (layer.loadedExtras.includes(section)) return
    if (section === 'relations' && layer.detail?.relations) {
      patchTop({ loadedExtras: [...layer.loadedExtras, section] })
      return
    }
    if (section === 'characters' && layer.detail?.characters) {
      patchTop({ loadedExtras: [...layer.loadedExtras, section] })
      return
    }
    if (section === 'staff' && layer.detail?.staff) {
      patchTop({ loadedExtras: [...layer.loadedExtras, section] })
      return
    }

    const key = layer.key
    const seq = (extrasSeqByKey.get(key) || 0) + 1
    extrasSeqByKey.set(key, seq)
    patchTop({ loadingExtras: true })
    try {
      const extras = await fetchAnimeDetailExtras(id, [section])
      if (extrasSeqByKey.get(key) !== seq) return
      const current = layers.value.find((l) => l.key === key)
      if (!current) return
      patchLayerByKey(key, {
        detail: {
          ...(current.detail || current.seed),
          ...extras,
        },
        loadedExtras: [...new Set([...current.loadedExtras, section])],
        loadingExtras: false,
      })
    } catch (reason) {
      if (extrasSeqByKey.get(key) !== seq) return
      const current = layers.value.find((l) => l.key === key)
      if (!current) return
      patchLayerByKey(key, {
        loadedExtras: [...new Set([...current.loadedExtras, section])],
        loadingExtras: false,
        error: current.error || (reason instanceof Error ? reason.message : '扩展信息加载失败'),
      })
    }
  }

  async function openFromCard(anime: Anime, el: Element | null, fromPath: string) {
    expandMode.value = 'list'
    const rect = captureRect(el)
    originRect.value = rect
    returnOriginRect.value = rect
    returnCardId.value = anime.id
    returnPath.value = fromPath || '/'
    const key = nextLayerKey(anime.id)
    layers.value = [{
      key,
      seed: anime,
      detail: blankDetailFromSeed(anime),
      loading: true,
      loadingExtras: false,
      error: '',
      loadedExtras: [],
      originRect: rect,
    }]
    open.value = true
    phase.value = 'expanding'
    void loadOverviewForLayer(key, anime.id, anime)
  }

  /**
   * Push a new detail layer on top. Previous layer stays mounted underneath.
   */
  async function openFromRelated(
    rel: AnimeRelation,
    el: Element | null,
    _currentPosterEl?: Element | null,
    _currentPosterRect?: ExpandRect | null,
  ) {
    if (!rel.id || rel.id === activeId.value) return
    expandMode.value = 'related'
    const rect = captureRect(el)
    originRect.value = rect
    const anime = animeFromRelation(rel)
    const key = nextLayerKey(rel.id)
    layers.value = [
      ...layers.value,
      {
        key,
        seed: anime,
        detail: blankDetailFromSeed(anime),
        loading: true,
        loadingExtras: false,
        error: '',
        loadedExtras: [],
        originRect: rect,
      },
    ]
    open.value = true
    phase.value = 'expanding'
    void loadOverviewForLayer(key, rel.id, anime)
  }

  function beginCollapse() {
    if (!open.value) return
    phase.value = 'collapsing'
  }

  function beginStackReturn() {
    if (!open.value || layers.value.length < 2) return false
    phase.value = 'returning'
    expandMode.value = 'stack'
    return true
  }

  /** After reverse flight: drop top layer; previous layer is already mounted. */
  function applyStackPop() {
    if (layers.value.length < 2) return null
    const removed = layers.value[layers.value.length - 1]
    layers.value = layers.value.slice(0, -1)
    // Stay on 'stack' mode until the overlay finishes the return handoff
    // so activeId watchers do not treat this as a fresh list open.
    expandMode.value = 'stack'
    const top = layers.value[layers.value.length - 1]
    originRect.value = top?.originRect || null
    // Keep phase=returning until the overlay clears the flight; caller sets open.
    return removed
  }

  /** Origin for reverse flight when popping the top layer. */
  function resolvePopOrigin(): ExpandRect | null {
    const top = topLayer.value
    return top?.originRect || originRect.value
  }

  function stackContains(id: string) {
    return layers.value.some((l) => l.seed.id === id)
  }

  function popsToReach(id: string) {
    const list = layers.value
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i].seed.id === id) return list.length - 1 - i
    }
    return 0
  }

  function restoreFromStackById(id: string) {
    const n = popsToReach(id)
    if (n <= 0) return false
    layers.value = layers.value.slice(0, layers.value.length - n)
    phase.value = 'open'
    expandMode.value = layers.value.length > 1 ? 'stack' : 'list'
    return activeId.value === id
  }

  function resolveCloseOrigin(): ExpandRect | null {
    const id = returnCardId.value
    if (id) {
      const el = document.querySelector(`[data-anime-id="${CSS.escape(id)}"] .poster-wrap`)
      const live = captureRect(el)
      if (live) return live
    }
    return returnOriginRect.value || originRect.value
  }

  function finishClose() {
    open.value = false
    phase.value = 'idle'
    expandMode.value = 'list'
    layers.value = []
    originRect.value = null
    returnOriginRect.value = null
    returnCardId.value = ''
    overviewSeqByKey.clear()
    extrasSeqByKey.clear()
  }

  async function reopenFromRoute(id: string, fromPath: string) {
    expandMode.value = 'list'
    returnPath.value = fromPath || '/'
    returnOriginRect.value = null
    returnCardId.value = ''
    originRect.value = null
    const anime: Anime = {
      id,
      source: id.startsWith('anilist-') ? 'anilist' : 'bangumi',
      title: '加载中…',
      originalTitle: '',
      image: '',
      score: 0,
      year: 0,
      season: '',
      episodes: 0,
      watched: 0,
      status: 'planned',
      tags: [],
      summary: '',
    }
    const key = nextLayerKey(id)
    layers.value = [{
      key,
      seed: anime,
      detail: { ...anime },
      loading: true,
      loadingExtras: false,
      error: '',
      loadedExtras: [],
      originRect: null,
    }]
    open.value = true
    phase.value = 'open'
    await loadOverviewForLayer(key, id)
  }

  return {
    open,
    phase,
    expandMode,
    layers,
    topIndex,
    topLayer,
    seed,
    detail,
    loading,
    loadingExtras,
    error,
    originRect,
    returnOriginRect,
    returnCardId,
    returnPath,
    activeId,
    canPopDetail,
    captureRect,
    openFromCard,
    openFromRelated,
    beginCollapse,
    beginStackReturn,
    applyStackPop,
    resolvePopOrigin,
    restoreFromStackById,
    stackContains,
    popsToReach,
    finishClose,
    resolveCloseOrigin,
    reopenFromRoute,
    ensureExtras,
    closeSignal,
    requestClose,
    requestDismissAll,
    patchTop,
  }
})
