import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Anime, AnimeDetail } from '../types/anime'
import { fetchAnimeDetail } from '../services/anime'

export interface ExpandRect {
  top: number
  left: number
  width: number
  height: number
}

export const useDetailOverlayStore = defineStore('detailOverlay', () => {
  const open = ref(false)
  const phase = ref<'idle' | 'expanding' | 'open' | 'collapsing'>('idle')
  const seed = ref<Anime | null>(null)
  const detail = ref<AnimeDetail | null>(null)
  const loading = ref(false)
  const error = ref('')
  const originRect = ref<ExpandRect | null>(null)
  const returnPath = ref('/')
  /** Bumps when browser back / external close needs animated collapse. */
  const closeSignal = ref(0)
  let requestSeq = 0

  const activeId = computed(() => seed.value?.id || detail.value?.id || '')

  function requestClose() {
    if (!open.value) return
    closeSignal.value += 1
  }

  function captureRect(el: Element | null): ExpandRect | null {
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    }
  }

  async function openFromCard(anime: Anime, el: Element | null, fromPath: string) {
    const seq = ++requestSeq
    seed.value = anime
    detail.value = null
    error.value = ''
    originRect.value = captureRect(el)
    returnPath.value = fromPath || '/'
    open.value = true
    phase.value = 'expanding'
    loading.value = true

    try {
      const result = await fetchAnimeDetail(anime.id)
      if (seq !== requestSeq) return
      detail.value = {
        ...result,
        // Preserve library progress if seed carried it.
        watched: anime.watched || result.watched,
        status: anime.status || result.status,
      }
    } catch (reason) {
      if (seq !== requestSeq) return
      // Fallback to seed so UI still shows something useful.
      detail.value = { ...anime, summary: anime.summary || '' }
      error.value = reason instanceof Error ? reason.message : '详情加载失败'
    } finally {
      if (seq === requestSeq) loading.value = false
    }
  }

  function beginCollapse() {
    if (!open.value) return
    phase.value = 'collapsing'
  }

  function finishClose() {
    open.value = false
    phase.value = 'idle'
    seed.value = null
    detail.value = null
    loading.value = false
    error.value = ''
    originRect.value = null
  }

  async function reopenFromRoute(id: string, fromPath: string) {
    // Direct URL open (no origin card rect): full-screen fade in.
    const seq = ++requestSeq
    seed.value = {
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
    detail.value = null
    error.value = ''
    originRect.value = null
    returnPath.value = fromPath || '/'
    open.value = true
    phase.value = 'open'
    loading.value = true
    try {
      detail.value = await fetchAnimeDetail(id)
      if (seq === requestSeq) seed.value = detail.value
    } catch (reason) {
      if (seq !== requestSeq) return
      error.value = reason instanceof Error ? reason.message : '详情加载失败'
    } finally {
      if (seq === requestSeq) loading.value = false
    }
  }

  return {
    open,
    phase,
    seed,
    detail,
    loading,
    error,
    originRect,
    returnPath,
    activeId,
    openFromCard,
    beginCollapse,
    finishClose,
    reopenFromRoute,
    closeSignal,
    requestClose,
  }
})
