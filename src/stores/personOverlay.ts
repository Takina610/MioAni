import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { fetchPersonDetail } from '../services/person'
import { parsePersonId, personRouteName } from '../services/personIds'
import type { PersonDetail } from '../types/anime'

export const usePersonOverlayStore = defineStore('personOverlay', () => {
  const open = ref(false)
  const loading = ref(false)
  const error = ref('')
  const detail = ref<PersonDetail | null>(null)
  const seed = ref<Partial<PersonDetail> | null>(null)
  /** Anime id to return to (e.g. bgm-123). */
  const returnAnimeId = ref('')
  /** Role context shown under the name (from the anime list). */
  const contextRole = ref('')
  let loadSeq = 0

  const title = computed(() => detail.value?.name || seed.value?.name || '人物详情')
  const kind = computed(() => detail.value?.kind || seed.value?.kind || parsePersonId(seed.value?.id || '')?.kind || 'person')

  async function openPerson(opts: {
    id: string
    name?: string
    image?: string
    contextRole?: string
    returnAnimeId?: string
  }) {
    const parsed = parsePersonId(opts.id)
    if (!parsed) {
      error.value = '无法打开该人物'
      return false
    }

    const seq = ++loadSeq
    open.value = true
    loading.value = true
    error.value = ''
    contextRole.value = opts.contextRole || ''
    returnAnimeId.value = opts.returnAnimeId || returnAnimeId.value || ''
    seed.value = {
      id: opts.id,
      kind: parsed.kind,
      source: parsed.source,
      name: opts.name || '加载中…',
      image: opts.image,
      contextRole: opts.contextRole,
    }
    detail.value = {
      id: opts.id,
      kind: parsed.kind,
      source: parsed.source,
      name: opts.name || '加载中…',
      image: opts.image,
      contextRole: opts.contextRole,
    }

    try {
      const result = await fetchPersonDetail(opts.id, { contextRole: opts.contextRole })
      if (seq !== loadSeq) return true
      detail.value = {
        ...result,
        contextRole: opts.contextRole || result.contextRole,
      }
      seed.value = { ...seed.value, ...detail.value }
      loading.value = false
      return true
    } catch (reason) {
      if (seq !== loadSeq) return false
      error.value = reason instanceof Error ? reason.message : '加载失败'
      loading.value = false
      return false
    }
  }

  function close() {
    loadSeq += 1
    open.value = false
    loading.value = false
    error.value = ''
    detail.value = null
    seed.value = null
    contextRole.value = ''
    // Keep returnAnimeId until consumer navigates, then clear.
  }

  function clearReturn() {
    returnAnimeId.value = ''
  }

  function routeNameFor(id: string) {
    const parsed = parsePersonId(id)
    if (!parsed) return null
    return personRouteName(parsed.kind)
  }

  return {
    open,
    loading,
    error,
    detail,
    seed,
    returnAnimeId,
    contextRole,
    title,
    kind,
    openPerson,
    close,
    clearReturn,
    routeNameFor,
  }
})
