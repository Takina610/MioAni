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
import type { ExpandRect } from './detailOverlay'
import type { PersonDetail } from '../types/anime'

export type PersonPhase = 'idle' | 'expanding' | 'open' | 'collapsing'

/** One person page under the current one (person → person navigation). */
export interface PersonStackEntry {
  detail: PersonDetail | null
  seed: Partial<PersonDetail> | null
  contextRole: string
  originRect: ExpandRect | null
  error: string
}

export const usePersonOverlayStore = defineStore('personOverlay', () => {
  // NOTE: after adding actions, hard-refresh if HMR leaves a stale store without new methods.
  const open = ref(false)
  const phase = ref<PersonPhase>('idle')
  const originRect = ref<ExpandRect | null>(null)
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
  /** Buried person pages for back navigation (person → person). */
  const stack = ref<PersonStackEntry[]>([])
  /**
   * Hidden but not destroyed — person opened an anime work on top.
   * Resume when that anime layer is popped/dismissed back to this person.
   */
  const suspended = ref(false)
  let loadSeq = 0

  const title = computed(() => detail.value?.name || seed.value?.name || '人物详情')
  const kind = computed(() => detail.value?.kind || seed.value?.kind || parsePersonId(seed.value?.id || '')?.kind || 'person')
  const canPopPerson = computed(() => stack.value.length > 0)
  const activeId = computed(() => detail.value?.id || seed.value?.id || '')
  const hasSuspendedPerson = computed(() => (
    suspended.value && Boolean(detail.value?.id || seed.value?.id)
  ))

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

  function snapshotCurrent(): PersonStackEntry {
    return {
      detail: detail.value ? { ...detail.value } : null,
      seed: seed.value ? { ...seed.value } : null,
      contextRole: contextRole.value,
      originRect: originRect.value ? { ...originRect.value } : null,
      error: error.value,
    }
  }

  function restoreEntry(entry: PersonStackEntry) {
    detail.value = entry.detail
    seed.value = entry.seed
    contextRole.value = entry.contextRole
    originRect.value = entry.originRect
    error.value = entry.error
    loading.value = false
    loadingProfile.value = false
    loadingComments.value = false
    loadingWorks.value = false
    loadingVoiceRoles.value = false
  }

  async function openPerson(opts: {
    id: string
    name?: string
    image?: string
    contextRole?: string
    returnAnimeId?: string
    originRect?: ExpandRect | null
    /** When true, never push (hard replace / route recovery). */
    replace?: boolean
  }) {
    const parsed = parsePersonId(opts.id)
    if (!parsed) {
      error.value = '无法打开该人物'
      return false
    }

    const currentId = seed.value?.id || detail.value?.id || ''
    const sameVisible =
      open.value
      && currentId === opts.id
      && (phase.value === 'expanding' || phase.value === 'open')

    // Fresh open while a person was suspended under an anime work: drop stale suspend.
    if (!open.value && suspended.value && !sameVisible) {
      stack.value = []
      suspended.value = false
    }

    // Person → person: bury the current page so back can restore it.
    // Only stack when the current page has settled (open) to avoid burying a half-loaded hop.
    if (
      open.value
      && !opts.replace
      && currentId
      && currentId !== opts.id
      && phase.value === 'open'
    ) {
      stack.value = [...stack.value, snapshotCurrent()]
    }

    const seq = ++loadSeq
    suspended.value = false
    open.value = true
    // Avoid restarting the circle reveal when the same person is already on screen
    // (e.g. route push after card open, or data refresh).
    if (!sameVisible) {
      phase.value = 'expanding'
      originRect.value = opts.originRect || null
    } else if (opts.originRect && !originRect.value) {
      originRect.value = opts.originRect
    }
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

    // Comments / works / voice roles load when their tabs are first opened.
    try {
      const result = await fetchPersonDetail(opts.id, { contextRole: opts.contextRole })
      if (seq !== loadSeq) return true
      const current = detail.value?.id === result.id ? detail.value : null
      detail.value = {
        ...result,
        // Preserve any tab data already loaded for the same person.
        works: current?.works,
        worksPage: current?.worksPage,
        worksTotal: current?.worksTotal,
        worksHasMore: current?.worksHasMore,
        voiceRoles: current?.voiceRoles,
        voiceRolesPage: current?.voiceRolesPage,
        voiceRolesTotal: current?.voiceRolesTotal,
        voiceRolesHasMore: current?.voiceRolesHasMore,
        comments: current?.comments,
        commentsPage: current?.commentsPage,
        commentsTotal: current?.commentsTotal,
        commentsHasMore: current?.commentsHasMore,
        // Keep seed image first so flight/handoff never blanks.
        image: result.image || opts.image || current?.image,
        contextRole: opts.contextRole || result.contextRole,
      }
      seed.value = { ...seed.value, ...detail.value }
      loading.value = false
      if (result.source === 'bangumi') {
        startProfileEnrichment(result.id, seq)
      } else {
        loadingProfile.value = false
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

  /** Restore previous person page; returns restored person id or null. */
  function popPerson(): string | null {
    if (!stack.value.length) return null
    loadSeq += 1
    const prev = stack.value[stack.value.length - 1]
    stack.value = stack.value.slice(0, -1)
    restoreEntry(prev)
    suspended.value = false
    phase.value = 'open'
    return prev.detail?.id || prev.seed?.id || null
  }

  /**
   * Hide person overlay but keep page + person-stack + returnAnimeId.
   * Used when opening an anime work from a person page so flight/back can return here.
   */
  function suspend(): boolean {
    if (!open.value && !suspended.value) return false
    if (!detail.value && !seed.value) return false
    loadSeq += 1
    open.value = false
    phase.value = 'idle'
    suspended.value = true
    loading.value = false
    loadingProfile.value = false
    loadingComments.value = false
    loadingWorks.value = false
    loadingVoiceRoles.value = false
    return true
  }

  /** Show suspended person again. Returns person id or null. */
  function resume(): string | null {
    if (!hasSuspendedPerson.value && !detail.value && !seed.value) return null
    const id = detail.value?.id || seed.value?.id || null
    if (!id) return null
    suspended.value = false
    open.value = true
    phase.value = 'open'
    loading.value = false
    loadingProfile.value = false
    loadingComments.value = false
    loadingWorks.value = false
    loadingVoiceRoles.value = false
    return id
  }

  async function ensureWorks() {
    const d = detail.value
    if (!d?.id || loadingWorks.value || loading.value) return
    if (d.works !== undefined) return
    loadingWorks.value = true
    const seq = loadSeq
    const id = d.id
    try {
      const page = await fetchPersonWorksPage(id, 1)
      if (seq !== loadSeq || !detail.value || detail.value.id !== id) return
      detail.value = {
        ...detail.value,
        works: page.items,
        worksPage: page.page,
        worksTotal: page.total,
        worksHasMore: page.hasMore,
      }
      seed.value = { ...seed.value, ...detail.value }
    } catch {
      if (seq === loadSeq && detail.value?.id === id) {
        detail.value = {
          ...detail.value,
          works: detail.value.works || [],
          worksPage: 1,
          worksTotal: detail.value.worksTotal || 0,
          worksHasMore: false,
        }
      }
    } finally {
      if (seq === loadSeq) loadingWorks.value = false
    }
  }

  async function ensureVoiceRoles() {
    const d = detail.value
    if (!d?.id || d.kind !== 'person' || loadingVoiceRoles.value || loading.value) return
    if (d.voiceRoles !== undefined) return
    loadingVoiceRoles.value = true
    const seq = loadSeq
    const id = d.id
    try {
      const page = await fetchPersonVoiceRolesPage(id, 1)
      if (seq !== loadSeq || !detail.value || detail.value.id !== id) return
      detail.value = {
        ...detail.value,
        voiceRoles: page.items,
        voiceRolesPage: page.page,
        voiceRolesTotal: page.total,
        voiceRolesHasMore: page.hasMore,
      }
      seed.value = { ...seed.value, ...detail.value }
    } catch {
      if (seq === loadSeq && detail.value?.id === id) {
        detail.value = {
          ...detail.value,
          voiceRoles: detail.value.voiceRoles || [],
          voiceRolesPage: 1,
          voiceRolesTotal: detail.value.voiceRolesTotal || 0,
          voiceRolesHasMore: false,
        }
      }
    } finally {
      if (seq === loadSeq) loadingVoiceRoles.value = false
    }
  }

  async function ensureComments() {
    const d = detail.value
    if (!d?.id || d.source !== 'bangumi' || loadingComments.value) return
    if (d.comments !== undefined) return
    startInitialComments(d.id, loadSeq)
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

  function markOpen() {
    if (open.value) phase.value = 'open'
  }

  function beginCollapse() {
    if (!open.value || phase.value === 'collapsing') return false
    phase.value = 'collapsing'
    return true
  }

  function finishClose() {
    loadSeq += 1
    open.value = false
    phase.value = 'idle'
    originRect.value = null
    loading.value = false
    loadingProfile.value = false
    loadingComments.value = false
    loadingWorks.value = false
    loadingVoiceRoles.value = false
    error.value = ''
    detail.value = null
    seed.value = null
    contextRole.value = ''
    stack.value = []
    suspended.value = false
    // Keep returnAnimeId until consumer navigates, then clear.
  }

  /** Immediate close without collapse animation (route hard-exit fallback). */
  function close() {
    finishClose()
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
    phase,
    originRect,
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
    stack,
    suspended,
    canPopPerson,
    hasSuspendedPerson,
    activeId,
    title,
    kind,
    openPerson,
    popPerson,
    suspend,
    resume,
    markOpen,
    beginCollapse,
    finishClose,
    ensureWorks,
    ensureVoiceRoles,
    ensureComments,
    loadMoreWorks,
    loadMoreVoiceRoles,
    loadMoreComments,
    close,
    clearReturn,
    routeNameFor,
  }
})
