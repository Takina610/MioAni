import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  fetchPersonComments,
  fetchPersonDetail,
  fetchPersonProfileEnrichment,
  fetchPersonVoiceRolesPage,
  fetchPersonWorksPage,
} from '../services/person'
import { parsePersonId, personRouteName } from '../services/personIds'
import type { PersonDetail } from '../types/anime'

export const usePersonOverlayStore = defineStore('personOverlay', () => {
  const open = ref(false)
  const loading = ref(false)
  const loadingProfile = ref(false)
  const loadingComments = ref(false)
  const loadingWorks = ref(false)
  const loadingVoiceRoles = ref(false)
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

  function mergeFacts(
    current: PersonDetail['extraFacts'],
    incoming: PersonDetail['extraFacts'],
  ): NonNullable<PersonDetail['extraFacts']> | undefined {
    const rows = new Map<string, NonNullable<PersonDetail['extraFacts']>[number]>()
    ;(current || []).forEach((fact) => rows.set(fact.label, fact))
    ;(incoming || []).forEach((fact) => {
      if (!rows.has(fact.label)) rows.set(fact.label, fact)
    })
    return rows.size ? [...rows.values()] : undefined
  }

  function mergeProfileEnrichment(current: PersonDetail, incoming: Partial<PersonDetail>): PersonDetail {
    return {
      ...current,
      name: current.name && current.name !== '加载中…' ? current.name : incoming.name || current.name,
      nameAlt: current.nameAlt || incoming.nameAlt,
      image: current.image || incoming.image,
      summary: current.summary || incoming.summary,
      gender: current.gender || incoming.gender,
      birthday: current.birthday || incoming.birthday,
      bloodType: current.bloodType || incoming.bloodType,
      extraFacts: mergeFacts(current.extraFacts, incoming.extraFacts),
    }
  }

  function startInitialComments(id: string, seq: number) {
    loadingComments.value = true
    void fetchPersonComments(id, 1)
      .then((page) => {
        if (seq !== loadSeq || !detail.value || detail.value.id !== id) return
        detail.value = {
          ...detail.value,
          comments: page.items,
          commentsPage: page.page,
          commentsTotal: page.total,
          commentsHasMore: page.hasMore,
        }
        seed.value = { ...seed.value, ...detail.value }
      })
      .catch(() => undefined)
      .finally(() => {
        if (seq === loadSeq) loadingComments.value = false
      })
  }

  function startProfileEnrichment(id: string, seq: number) {
    if (!detail.value || detail.value.id !== id) return
    loadingProfile.value = !detail.value.summary
    void fetchPersonProfileEnrichment(id)
      .then((profile) => {
        if (seq !== loadSeq || !detail.value || detail.value.id !== id) return
        detail.value = mergeProfileEnrichment(detail.value, profile)
        seed.value = { ...seed.value, ...detail.value }
      })
      .catch(() => undefined)
      .finally(() => {
        if (seq === loadSeq) loadingProfile.value = false
      })
  }

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
    loadingProfile.value = false
    loadingComments.value = false
    loadingWorks.value = false
    loadingVoiceRoles.value = false
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

    // Bangumi comments use the same public HTML as profile enrichment, but they
    // must start immediately instead of waiting for every profile/list request.
    if (parsed.source === 'bangumi') startInitialComments(parsed.id, seq)

    try {
      const result = await fetchPersonDetail(opts.id, { contextRole: opts.contextRole })
      if (seq !== loadSeq) return true
      const current = detail.value?.id === result.id ? detail.value : null
      const commentState = current?.comments !== undefined
        ? {
            comments: current.comments,
            commentsPage: current.commentsPage,
            commentsTotal: current.commentsTotal,
            commentsHasMore: current.commentsHasMore,
          }
        : {}
      detail.value = {
        ...result,
        ...commentState,
        contextRole: opts.contextRole || result.contextRole,
      }
      seed.value = { ...seed.value, ...detail.value }
      loading.value = false
      if (result.source === 'bangumi') {
        startProfileEnrichment(result.id, seq)
      } else {
        loadingProfile.value = false
        loadingComments.value = false
      }
      return true
    } catch (reason) {
      if (seq !== loadSeq) return false
      error.value = reason instanceof Error ? reason.message : '加载失败'
      loading.value = false
      loadingProfile.value = false
      return false
    }
  }

  function mergeById<T extends { id: string }>(current: T[] | undefined, incoming: T[]): T[] {
    const map = new Map<string, T>()
    ;(current || []).forEach((item) => map.set(item.id, item))
    incoming.forEach((item) => map.set(item.id, item))
    return [...map.values()]
  }

  function mergeVoiceRoles(current: PersonDetail['voiceRoles'] | undefined, incoming: NonNullable<PersonDetail['voiceRoles']>) {
    const map = new Map<string, NonNullable<PersonDetail['voiceRoles']>[number]>()
    ;(current || []).forEach((item) => map.set(`${item.id}:${item.subjectId || ''}`, item))
    incoming.forEach((item) => map.set(`${item.id}:${item.subjectId || ''}`, item))
    return [...map.values()]
  }

  async function loadMoreWorks() {
    const d = detail.value
    if (!d?.id || !d.worksHasMore || loadingWorks.value || loading.value) return
    loadingWorks.value = true
    const seq = loadSeq
    try {
      const page = await fetchPersonWorksPage(d.id, (d.worksPage || 1) + 1)
      if (seq !== loadSeq || !detail.value || detail.value.id !== d.id) return
      detail.value = {
        ...detail.value,
        works: mergeById(detail.value.works, page.items),
        worksPage: page.page,
        worksTotal: page.total,
        worksHasMore: page.hasMore,
      }
      seed.value = { ...seed.value, ...detail.value }
    } catch {
      // Keep the already loaded page visible; the user can retry by scrolling or clicking again.
    } finally {
      if (seq === loadSeq) loadingWorks.value = false
    }
  }

  async function loadMoreVoiceRoles() {
    const d = detail.value
    if (!d?.id || !d.voiceRolesHasMore || loadingVoiceRoles.value || loading.value) return
    loadingVoiceRoles.value = true
    const seq = loadSeq
    try {
      const page = await fetchPersonVoiceRolesPage(d.id, (d.voiceRolesPage || 1) + 1)
      if (seq !== loadSeq || !detail.value || detail.value.id !== d.id) return
      detail.value = {
        ...detail.value,
        voiceRoles: mergeVoiceRoles(detail.value.voiceRoles, page.items),
        voiceRolesPage: page.page,
        voiceRolesTotal: page.total,
        voiceRolesHasMore: page.hasMore,
      }
      seed.value = { ...seed.value, ...detail.value }
    } catch {
      // Keep the already loaded page visible; the user can retry by scrolling or clicking again.
    } finally {
      if (seq === loadSeq) loadingVoiceRoles.value = false
    }
  }

  async function loadMoreComments() {
    const d = detail.value
    if (!d?.id || !d.commentsHasMore || loadingComments.value || loading.value) return
    loadingComments.value = true
    const seq = loadSeq
    try {
      const page = await fetchPersonComments(d.id, (d.commentsPage || 1) + 1)
      if (seq !== loadSeq || !detail.value || detail.value.id !== d.id) return
      detail.value = {
        ...detail.value,
        comments: mergeById(detail.value.comments, page.items),
        commentsPage: page.page,
        commentsTotal: page.total,
        commentsHasMore: page.hasMore,
      }
      seed.value = { ...seed.value, ...detail.value }
    } catch {
      // Keep the already loaded page visible; the user can retry by scrolling or clicking again.
    } finally {
      if (seq === loadSeq) loadingComments.value = false
    }
  }

  function close() {
    loadSeq += 1
    open.value = false
    loading.value = false
    loadingProfile.value = false
    loadingComments.value = false
    loadingWorks.value = false
    loadingVoiceRoles.value = false
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
    loadingProfile,
    loadingComments,
    loadingWorks,
    loadingVoiceRoles,
    error,
    detail,
    seed,
    returnAnimeId,
    contextRole,
    title,
    kind,
    openPerson,
    loadMoreWorks,
    loadMoreVoiceRoles,
    loadMoreComments,
    close,
    clearReturn,
    routeNameFor,
  }
})
