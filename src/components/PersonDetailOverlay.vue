<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  PhArrowLeft,
  PhX,
  PhUser,
  PhCalendarBlank,
  PhDrop,
  PhBriefcase,
  PhCaretDown,
  PhIdentificationCard,
  PhTranslate,
  PhFilmSlate,
  PhArrowSquareOut,
} from '@phosphor-icons/vue'
import { useDetailOverlayStore } from '../stores/detailOverlay'
import { usePersonOverlayStore } from '../stores/personOverlay'
import { parsePersonId } from '../services/personIds'
import { shouldOfferTranslation, translateToChinese } from '../services/translate'
import type { AnimeRelation, PersonVoiceRole } from '../types/anime'

const store = usePersonOverlayStore()
const detailStore = useDetailOverlayStore()
const route = useRoute()
const router = useRouter()

const summaryExpanded = ref(false)
const worksExpanded = ref(false)
const voiceRolesExpanded = ref(false)
const sectionAnimating = ref<Record<'works' | 'roles', boolean>>({ works: false, roles: false })
const summaryTranslation = ref('')
const summaryTranslating = ref(false)
const summaryTranslateError = ref('')
const commentTranslations = ref<Record<string, string>>({})
const commentTranslating = ref<Record<string, boolean>>({})
const commentTranslateErrors = ref<Record<string, string>>({})
const dataTranslations = ref<Record<string, string>>({})
const dataTranslating = ref<Record<string, boolean>>({})
const dataTranslateErrors = ref<Record<string, string>>({})
const worksSentinelRef = ref<HTMLElement | null>(null)
const rolesSentinelRef = ref<HTMLElement | null>(null)
const commentsSentinelRef = ref<HTMLElement | null>(null)
const personScrollRef = ref<HTMLElement | null>(null)
const worksTrackRef = ref<HTMLElement | null>(null)
const rolesTrackRef = ref<HTMLElement | null>(null)
type HorizontalKind = 'works' | 'roles'
const horizontalEdges = ref<Record<HorizontalKind, { left: boolean; right: boolean }>>({
  works: { left: false, right: false },
  roles: { left: false, right: false },
})
const COLLAPSED_CARD_COUNT = 8
let extraObserver: IntersectionObserver | null = null
let scrollPollTimer: ReturnType<typeof window.setInterval> | null = null
let lastObservedScrollTop = 0
let lastObservedScrollHeight = 0
const lastExtraTriggerTop = {
  works: -9999,
  roles: -9999,
  comments: -9999,
}
const lastExtraTriggerEpoch = {
  works: 0,
  roles: 0,
  comments: 0,
}
const horizontalIntentReady = {
  works: false,
  roles: false,
}
const lastHorizontalIntentAt = {
  works: 0,
  roles: 0,
}
let userScrollEpoch = 0

const display = computed(() => store.detail || store.seed)
const kindLabel = computed(() => (store.kind === 'character' ? '角色' : '人物'))
const sourceLabel = computed(() => {
  const s = display.value?.source
  if (s === 'bangumi') return 'Bangumi'
  if (s === 'anilist') return 'AniList'
  return s || '—'
})

const GENDER_ZH: Record<string, string> = {
  male: '男',
  female: '女',
  男: '男',
  女: '女',
  unknown: '未知',
  other: '其他',
}

function displayText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function formatGender(value?: unknown) {
  const text = displayText(value)
  if (!text) return ''
  const key = text.toLowerCase()
  return GENDER_ZH[key] || GENDER_ZH[text] || text
}

const facts = computed(() => {
  const d = store.detail
  if (!d) return [] as Array<{ label: string; value: string; icon: 'user' | 'calendar' | 'drop' | 'briefcase' | 'id' }>
  const rows: Array<{ label: string; value: string; icon: 'user' | 'calendar' | 'drop' | 'briefcase' | 'id' }> = []
  const add = (label: string, value: unknown, icon: 'user' | 'calendar' | 'drop' | 'briefcase' | 'id') => {
    const text = displayText(value)
    if (text && !rows.some((row) => row.label === label)) rows.push({ label, value: text, icon })
  }
  add('性别', formatGender(d.gender), 'user')
  add('生日', d.birthday, 'calendar')
  add('血型', d.bloodType, 'drop')
  if (Array.isArray(d.careers)) {
    add('职业', d.careers.map(displayText).filter(Boolean).join(' · '), 'briefcase')
  }
  const role = displayText(d.contextRole) || displayText(store.contextRole)
  if (role) {
    rows.push({
      label: store.kind === 'character' ? '作品中身份' : '本职',
      value: role,
      icon: 'id',
    })
  }
  if (Array.isArray(d.extraFacts)) {
    d.extraFacts.forEach((fact) => add(fact.label, fact.value, 'id'))
  }
  add('数据源', sourceLabel.value, 'briefcase')
  return rows
})

/** Split long bios into readable paragraphs (BGM often uses \r\n or long run-on JP text). */
const summaryParagraphs = computed(() => {
  const raw = displayText(store.detail?.summary)
  if (!raw) return [] as string[]
  const normalized = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u3000/g, ' ')
  const byBreak = normalized.split(/\n+/).map((p) => p.trim()).filter(Boolean)
  if (byBreak.length > 1) return byBreak
  // Single blob: soft-split on JP sentence enders when very long
  if (normalized.length > 220) {
    const parts = normalized
      .split(/(?<=[。！？!?])\s*/)
      .map((p) => p.trim())
      .filter(Boolean)
    if (parts.length > 1) return parts
  }
  return [normalized]
})

const summaryLong = computed(() => {
  const text = summaryParagraphs.value.join('')
  return text.length > 280 || summaryParagraphs.value.length > 3
})

const summaryPreview = computed(() => {
  if (!summaryLong.value || summaryExpanded.value) return summaryParagraphs.value
  const joined = summaryParagraphs.value
  if (joined.length > 2) return joined.slice(0, 2)
  const first = joined[0] || ''
  if (first.length <= 220) return joined
  return [`${first.slice(0, 220).trim()}…`]
})

const works = computed(() => store.detail?.works || [])
const voiceRoles = computed(() => store.detail?.voiceRoles || [])
const comments = computed(() => store.detail?.comments || [])
const emptySummaryMessage = computed(() => (
  display.value?.source === 'bangumi' && facts.value.length > 1
    ? 'Bangumi 官网暂无独立简介，已有资料已完整整理在「基本资料」中。'
    : `该${kindLabel.value}暂无简介资料。`
))
const worksCanCollapse = computed(() => works.value.length > COLLAPSED_CARD_COUNT)
const voiceRolesCanCollapse = computed(() => voiceRoles.value.length > COLLAPSED_CARD_COUNT)
const worksToggleLabel = computed(() => {
  if (worksExpanded.value) return '收起'
  const total = store.detail?.worksTotal || works.value.length
  return `展开更多${total > COLLAPSED_CARD_COUNT ? ` · 共 ${total} 部` : ''}`
})
const voiceRolesToggleLabel = computed(() => {
  if (voiceRolesExpanded.value) return '收起'
  const total = store.detail?.voiceRolesTotal || voiceRoles.value.length
  return `展开更多${total > COLLAPSED_CARD_COUNT ? ` · 共 ${total} 个` : ''}`
})
const worksHeading = computed(() => (store.kind === 'character' ? '出演番剧' : '制作作品'))
const worksKicker = computed(() => (store.kind === 'character' ? 'APPEARANCES' : 'WORKS'))
const summaryCanTranslate = computed(() => shouldOfferTranslation(store.detail?.summary))

function joinContent(values: unknown[]): string {
  return [...new Set(values.map(displayText).filter(Boolean))]
    .join(' · ')
}

function canTranslateBlock(values: unknown[], assumeForeign = false): boolean {
  const text = joinContent(values)
  if (!text) return false
  return values.some((value) => shouldOfferTranslation(value)) || (assumeForeign && text.length > 1)
}

const identityTranslationText = computed(() => joinContent([
  display.value?.name,
  display.value?.nameAlt,
  display.value?.contextRole || store.contextRole,
]))
const identityCanTranslate = computed(() => canTranslateBlock(
  [display.value?.name, display.value?.nameAlt, display.value?.contextRole || store.contextRole],
  display.value?.source === 'bangumi' && !display.value?.nameAlt,
))

function workTranslationKey(work: AnimeRelation) {
  return `work:${work.id}`
}

function workTranslationText(work: AnimeRelation) {
  return joinContent([work.title, work.originalTitle, work.role || work.type])
}

function shouldTranslateWork(work: AnimeRelation) {
  return canTranslateBlock([work.title, work.originalTitle, work.role || work.type])
}

function roleTranslationKey(role: PersonVoiceRole) {
  return `role:${role.id}:${role.subjectId || ''}`
}

function roleTranslationText(role: PersonVoiceRole) {
  return joinContent([role.name, role.role, role.subjectTitle])
}

function shouldTranslateRole(role: PersonVoiceRole) {
  return canTranslateBlock(
    [role.name, role.role, role.subjectTitle],
    display.value?.source === 'bangumi',
  )
}

function shouldTranslateFact(label: string, value: unknown) {
  return label !== '数据源' && shouldOfferTranslation(value)
}
const worksCountLabel = computed(() => {
  const total = store.detail?.worksTotal || works.value.length
  return total > works.value.length ? `${works.value.length}/${total}` : String(works.value.length)
})
const voiceRolesCountLabel = computed(() => {
  const total = store.detail?.voiceRolesTotal || voiceRoles.value.length
  return total > voiceRoles.value.length ? `${voiceRoles.value.length}/${total}` : String(voiceRoles.value.length)
})
const commentsCountLabel = computed(() => {
  const total = store.detail?.commentsTotal || comments.value.length
  return total > comments.value.length ? `${comments.value.length}/${total}` : String(comments.value.length)
})

function resetTranslationState() {
  summaryTranslation.value = ''
  summaryTranslating.value = false
  summaryTranslateError.value = ''
  commentTranslations.value = {}
  commentTranslating.value = {}
  commentTranslateErrors.value = {}
  dataTranslations.value = {}
  dataTranslating.value = {}
  dataTranslateErrors.value = {}
}

function resetExtraTriggerState() {
  lastExtraTriggerTop.works = -9999
  lastExtraTriggerTop.roles = -9999
  lastExtraTriggerTop.comments = -9999
  lastExtraTriggerEpoch.works = 0
  lastExtraTriggerEpoch.roles = 0
  lastExtraTriggerEpoch.comments = 0
  userScrollEpoch = 0
  lastObservedScrollTop = 0
  lastObservedScrollHeight = 0
  horizontalIntentReady.works = false
  horizontalIntentReady.roles = false
  lastHorizontalIntentAt.works = 0
  lastHorizontalIntentAt.roles = 0
  horizontalEdges.value = {
    works: { left: false, right: false },
    roles: { left: false, right: false },
  }
}

function markUserScrollIntent() {
  userScrollEpoch += 1
}

async function translateSummary() {
  const text = displayText(store.detail?.summary)
  if (!text || summaryTranslating.value) return
  if (summaryTranslation.value) {
    summaryTranslation.value = ''
    return
  }
  summaryTranslating.value = true
  summaryTranslateError.value = ''
  try {
    summaryTranslation.value = await translateToChinese(text)
  } catch (reason) {
    summaryTranslateError.value = reason instanceof Error ? reason.message : '翻译失败'
  } finally {
    summaryTranslating.value = false
  }
}

async function translateComment(id: string, text: string) {
  if (!text || commentTranslating.value[id]) return
  if (commentTranslations.value[id]) {
    const next = { ...commentTranslations.value }
    delete next[id]
    commentTranslations.value = next
    return
  }
  commentTranslating.value = { ...commentTranslating.value, [id]: true }
  commentTranslateErrors.value = { ...commentTranslateErrors.value, [id]: '' }
  try {
    const translated = await translateToChinese(text)
    commentTranslations.value = { ...commentTranslations.value, [id]: translated }
  } catch (reason) {
    commentTranslateErrors.value = {
      ...commentTranslateErrors.value,
      [id]: reason instanceof Error ? reason.message : '翻译失败',
    }
  } finally {
    commentTranslating.value = { ...commentTranslating.value, [id]: false }
  }
}

async function translateData(key: string, text: unknown) {
  const value = displayText(text)
  if (!value || dataTranslating.value[key]) return
  if (dataTranslations.value[key]) {
    const next = { ...dataTranslations.value }
    delete next[key]
    dataTranslations.value = next
    return
  }
  dataTranslating.value = { ...dataTranslating.value, [key]: true }
  dataTranslateErrors.value = { ...dataTranslateErrors.value, [key]: '' }
  try {
    const translated = await translateToChinese(value)
    dataTranslations.value = { ...dataTranslations.value, [key]: translated }
  } catch (reason) {
    dataTranslateErrors.value = {
      ...dataTranslateErrors.value,
      [key]: reason instanceof Error ? reason.message : '翻译失败',
    }
  } finally {
    dataTranslating.value = { ...dataTranslating.value, [key]: false }
  }
}

async function toggleWorksExpanded() {
  await animateSectionToggle('works')
}

async function toggleVoiceRolesExpanded() {
  await animateSectionToggle('roles')
}

async function animateSectionToggle(kind: HorizontalKind) {
  if (sectionAnimating.value[kind]) return
  const state = kind === 'works' ? worksExpanded : voiceRolesExpanded
  const track = trackForKind(kind)
  const nextExpanded = !state.value
  if (
    !track
    || typeof track.animate !== 'function'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    state.value = nextExpanded
    await nextTick()
    resetExtraObserver()
    return
  }

  sectionAnimating.value = { ...sectionAnimating.value, [kind]: true }
  const from = track.getBoundingClientRect().height
  try {
    if (nextExpanded) {
      state.value = true
      await nextTick()
    } else {
      state.value = false
      await nextTick()
      const collapsedHeight = track.getBoundingClientRect().height
      state.value = true
      await nextTick()
      track.style.overflow = 'hidden'
      const animation = track.animate(
        [{ height: `${from}px` }, { height: `${collapsedHeight}px` }],
        { duration: 380, easing: 'cubic-bezier(.22,.8,.24,1)' },
      )
      await animation.finished.catch(() => undefined)
      state.value = false
      return
    }

    const expandedHeight = track.getBoundingClientRect().height
    track.style.overflow = 'hidden'
    const animation = track.animate(
      [{ height: `${from}px` }, { height: `${expandedHeight}px` }],
      { duration: 380, easing: 'cubic-bezier(.22,.8,.24,1)' },
    )
    await animation.finished.catch(() => undefined)
  } finally {
    track.style.removeProperty('height')
    track.style.removeProperty('overflow')
    sectionAnimating.value = { ...sectionAnimating.value, [kind]: false }
    await nextTick()
    resetExtraObserver()
  }
}

function trackForKind(kind: HorizontalKind) {
  return kind === 'works' ? worksTrackRef.value : rolesTrackRef.value
}

function updateHorizontalEdges(kind: HorizontalKind, target = trackForKind(kind)) {
  if (!target) return
  const maxScrollLeft = Math.max(0, target.scrollWidth - target.clientWidth)
  const next = {
    left: target.scrollLeft > 2,
    right: maxScrollLeft - target.scrollLeft > 2,
  }
  const current = horizontalEdges.value[kind]
  if (current.left === next.left && current.right === next.right) return
  horizontalEdges.value = { ...horizontalEdges.value, [kind]: next }
}

function refreshHorizontalEdges() {
  updateHorizontalEdges('works')
  updateHorizontalEdges('roles')
}

function onViewportResize() {
  void nextTick(refreshHorizontalEdges)
}

function markHorizontalIntent(kind: HorizontalKind, event: Event) {
  if ((kind === 'works' && store.loadingWorks) || (kind === 'roles' && store.loadingVoiceRoles)) return
  const now = Date.now()
  if (event.type === 'wheel' && now - lastHorizontalIntentAt[kind] < 650) return
  lastHorizontalIntentAt[kind] = now
  horizontalIntentReady[kind] = true
  // At the hard right edge a new wheel/keyboard gesture may not emit another scroll event.
  // Reuse the same boundary check here so every deliberate gesture can request exactly one page.
  onHorizontalTrackScroll(kind, event)
}

function onHorizontalTrackScroll(kind: HorizontalKind, event: Event) {
  if (typeof window === 'undefined' || !window.matchMedia('(max-width: 640px)').matches) return
  const track = event.currentTarget as HTMLElement | null
  if (!track) return
  updateHorizontalEdges(kind, track)
  const remaining = track.scrollWidth - track.scrollLeft - track.clientWidth
  if (remaining > Math.max(120, track.clientWidth * .35)) return
  if (!horizontalIntentReady[kind]) return
  horizontalIntentReady[kind] = false
  if (kind === 'works') void store.loadMoreWorks()
  else void store.loadMoreVoiceRoles()
}

function resetExtraObserver() {
  extraObserver?.disconnect()
  extraObserver = null
  const root = document.querySelector('.person-scroll') as HTMLElement | null
  extraObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting) && root) {
      onPersonScroll({ currentTarget: root } as unknown as Event)
    }
  }, { root, rootMargin: '120px 0px 120px 0px' })
  ;[worksSentinelRef.value, rolesSentinelRef.value, commentsSentinelRef.value]
    .filter((el): el is HTMLElement => Boolean(el))
    .forEach((el) => extraObserver?.observe(el))
}

function isNearScrollRoot(el: HTMLElement | null, root: HTMLElement | null) {
  if (!el || !root) return false
  const target = el.getBoundingClientRect()
  const area = root.getBoundingClientRect()
  return target.top < area.bottom + 180 && target.bottom > area.top - 40
}

function onPersonScroll(event: Event) {
  const root = event.currentTarget as HTMLElement | null
  if (root && root.scrollHeight === lastObservedScrollHeight && Math.abs(root.scrollTop - lastObservedScrollTop) > 10) {
    markUserScrollIntent()
  }
  if (root) {
    lastObservedScrollTop = root.scrollTop
    lastObservedScrollHeight = root.scrollHeight
  }
  const worksNode = worksSentinelRef.value || document.querySelector('.person-panel--works .person-load-more') as HTMLElement | null
  const rolesNode = rolesSentinelRef.value || document.querySelector('.person-panel--voices .person-load-more') as HTMLElement | null
  const commentsNode = commentsSentinelRef.value || document.querySelector('.person-panel--comments .person-load-more') as HTMLElement | null
  const top = root?.scrollTop || 0
  if (
    isNearScrollRoot(worksNode, root)
    && userScrollEpoch > lastExtraTriggerEpoch.works
    && Math.abs(top - lastExtraTriggerTop.works) > 80
  ) {
    lastExtraTriggerTop.works = top
    lastExtraTriggerEpoch.works = userScrollEpoch
    void store.loadMoreWorks()
  }
  if (
    isNearScrollRoot(rolesNode, root)
    && userScrollEpoch > lastExtraTriggerEpoch.roles
    && Math.abs(top - lastExtraTriggerTop.roles) > 80
  ) {
    lastExtraTriggerTop.roles = top
    lastExtraTriggerEpoch.roles = userScrollEpoch
    void store.loadMoreVoiceRoles()
  }
  if (
    isNearScrollRoot(commentsNode, root)
    && userScrollEpoch > lastExtraTriggerEpoch.comments
    && Math.abs(top - lastExtraTriggerTop.comments) > 80
  ) {
    lastExtraTriggerTop.comments = top
    lastExtraTriggerEpoch.comments = userScrollEpoch
    void store.loadMoreComments()
  }
}

function bindPersonScroll() {
  const el = personScrollRef.value
  if (!el) return
  lastObservedScrollTop = el.scrollTop
  lastObservedScrollHeight = el.scrollHeight
  el.removeEventListener('scroll', onPersonScroll)
  el.removeEventListener('wheel', markUserScrollIntent)
  el.removeEventListener('touchmove', markUserScrollIntent)
  el.addEventListener('scroll', onPersonScroll, { passive: true })
  el.addEventListener('wheel', markUserScrollIntent, { passive: true })
  el.addEventListener('touchmove', markUserScrollIntent, { passive: true })
}

function startScrollPolling() {
  if (scrollPollTimer) window.clearInterval(scrollPollTimer)
  scrollPollTimer = window.setInterval(() => {
    const root = personScrollRef.value
    if (!store.open || !root) return
    onPersonScroll({ currentTarget: root } as unknown as Event)
  }, 450)
}

function thumbFromEvent(event?: Event): Element | null {
  const root = (event?.currentTarget as HTMLElement | null) || null
  if (!root) return null
  return root.querySelector?.('img, .person-work__ph, .person-role__ph') || root
}

async function openWork(work: AnimeRelation, event?: Event) {
  if (!work.id) return
  const thumb = thumbFromEvent(event)
  await detailStore.openFromRelated(work, thumb)
  store.close()
  store.clearReturn()
  if (route.name !== 'anime-detail' || route.params.id !== work.id) {
    await router.push({ name: 'anime-detail', params: { id: work.id } })
  }
}

async function openVoiceRole(role: PersonVoiceRole, event?: Event) {
  event?.stopPropagation?.()
  if (!role.id) return
  const routeName = store.routeNameFor(role.id)
  const ok = await store.openPerson({
    id: role.id,
    name: role.name,
    image: role.image,
    contextRole: [role.role, role.subjectTitle].filter(Boolean).join(' · '),
    returnAnimeId: store.returnAnimeId,
  })
  if (ok && routeName && (route.name !== routeName || route.params.id !== role.id)) {
    await router.push({ name: routeName, params: { id: role.id } })
  }
}

async function openVoiceRoleSubject(role: PersonVoiceRole, event?: Event) {
  event?.stopPropagation?.()
  if (!role.subjectId) return
  await openWork({
    id: role.subjectId,
    title: role.subjectTitle || '动画',
    type: role.role || '出演',
    role: role.role,
    image: role.subjectImage,
  }, event)
}

watch(
  () => store.detail?.id,
  async () => {
    summaryExpanded.value = false
    worksExpanded.value = false
    voiceRolesExpanded.value = false
    sectionAnimating.value = { works: false, roles: false }
    resetTranslationState()
    resetExtraTriggerState()
    await nextTick()
    resetExtraObserver()
  },
)

watch(
  () => [
    store.detail?.worksHasMore,
    store.detail?.voiceRolesHasMore,
    store.detail?.commentsHasMore,
    store.loading,
    works.value.length,
    voiceRoles.value.length,
  ] as const,
  async () => {
    await nextTick()
    if (store.open) {
      bindPersonScroll()
      startScrollPolling()
      resetExtraObserver()
      refreshHorizontalEdges()
    }
  },
)

watch(
  () => store.open,
  async (open) => {
    if (!open) {
      if (scrollPollTimer) window.clearInterval(scrollPollTimer)
      scrollPollTimer = null
      return
    }
    await nextTick()
    bindPersonScroll()
    startScrollPolling()
    resetExtraObserver()
    refreshHorizontalEdges()
  },
)

async function closePerson() {
  const animeId = store.returnAnimeId
  store.close()
  if (animeId && (route.name === 'character-detail' || route.name === 'person-detail')) {
    await router.replace({ name: 'anime-detail', params: { id: animeId } })
    store.clearReturn()
    return
  }
  if (route.name === 'character-detail' || route.name === 'person-detail') {
    await router.replace(store.returnAnimeId ? { name: 'anime-detail', params: { id: store.returnAnimeId } } : '/')
  }
  store.clearReturn()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && store.open) void closePerson()
}

watch(
  () => [route.name, route.params.id] as const,
  async ([name, id]) => {
    if (name !== 'character-detail' && name !== 'person-detail') return
    if (typeof id !== 'string' || !id) return
    if (store.open && store.detail?.id === id) return
    if (store.open && store.seed?.id === id && store.loading) return
    const parsed = parsePersonId(id)
    if (!parsed) return
    if (!store.open || store.seed?.id !== id) {
      await store.openPerson({
        id,
        returnAnimeId: store.returnAnimeId,
      })
    }
  },
)

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onViewportResize, { passive: true })
  if (
    (route.name === 'character-detail' || route.name === 'person-detail')
    && typeof route.params.id === 'string'
    && !store.open
  ) {
    void store.openPerson({ id: route.params.id })
  }
  void nextTick().then(() => {
    bindPersonScroll()
    startScrollPolling()
    resetExtraObserver()
    refreshHorizontalEdges()
  })
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onViewportResize)
  personScrollRef.value?.removeEventListener('scroll', onPersonScroll)
  personScrollRef.value?.removeEventListener('wheel', markUserScrollIntent)
  personScrollRef.value?.removeEventListener('touchmove', markUserScrollIntent)
  if (scrollPollTimer) window.clearInterval(scrollPollTimer)
  extraObserver?.disconnect()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="store.open && display"
      class="person-overlay"
      :class="{ 'is-loading': store.loading }"
      role="dialog"
      aria-modal="true"
      :aria-label="store.title"
    >
      <button class="person-scrim" type="button" aria-label="关闭人物详情" @click="closePerson" />

      <div class="person-surface">
        <div
          class="person-banner"
          :style="display.image ? { backgroundImage: `url(${display.image})` } : undefined"
        />
        <div class="person-banner__shade" />

        <button class="person-close" type="button" aria-label="关闭" @click="closePerson">
          <PhX :size="18" weight="bold" />
        </button>
        <button class="person-back" type="button" aria-label="返回" @click="closePerson">
          <PhArrowLeft :size="16" weight="bold" />
          返回
        </button>

        <div
          ref="personScrollRef"
          class="person-scroll"
          @scroll="onPersonScroll"
          @wheel.passive="markUserScrollIntent"
          @touchmove.passive="markUserScrollIntent"
        >
          <!-- Hero: portrait + identity (mirrors anime detail header) -->
          <header class="person-hero">
            <div class="person-portrait" :class="{ 'is-skeleton': store.loading }">
              <div v-if="store.loading" class="person-portrait-skeleton" aria-hidden="true" />
              <template v-else>
                <img
                  v-if="display.image"
                  class="person-portrait__backdrop"
                  :src="display.image"
                  alt=""
                  aria-hidden="true"
                />
                <img
                  v-if="display.image"
                  class="person-portrait__image"
                  :src="display.image"
                  :alt="display.name || ''"
                  decoding="async"
                />
                <div v-else class="person-portrait__ph"><PhUser :size="42" /></div>
              </template>
            </div>

            <div v-if="store.loading" class="person-hero__body person-hero-skeleton" aria-label="正在加载人物资料" aria-busy="true">
              <i class="person-hero-skeleton__kicker" />
              <i class="person-hero-skeleton__title" />
              <i class="person-hero-skeleton__alt" />
              <span class="person-hero-skeleton__chips"><i /><i /><i /></span>
              <span class="person-hero-skeleton__lead"><i /><i /><i /></span>
            </div>

            <div v-else class="person-hero__body">
              <p class="person-kicker">
                <span>{{ kindLabel }}</span>
                <i aria-hidden="true">·</i>
                <span>{{ sourceLabel }}</span>
              </p>
              <div class="person-title-row">
                <h1 class="person-title">{{ display.name }}</h1>
                <button
                  v-if="identityCanTranslate"
                  type="button"
                  class="person-translate person-translate--compact"
                  :disabled="dataTranslating['identity']"
                  aria-label="翻译人物名称与身份"
                  @click="translateData('identity', identityTranslationText)"
                >
                  <PhTranslate :size="14" weight="bold" />
                  {{ dataTranslating['identity'] ? '翻译中' : dataTranslations['identity'] ? '隐藏翻译' : '翻译身份' }}
                </button>
              </div>
              <p
                v-if="display.nameAlt && display.nameAlt !== display.name"
                class="person-alt"
              >
                {{ display.nameAlt }}
              </p>
              <p
                v-if="dataTranslations['identity'] || dataTranslateErrors['identity']"
                class="person-inline-translation"
                :class="{ 'is-error': dataTranslateErrors['identity'] }"
              >
                {{ dataTranslations['identity'] || dataTranslateErrors['identity'] }}
              </p>

              <div class="person-chips">
                <span v-if="display.contextRole || store.contextRole" class="person-chip person-chip--accent">
                  {{ display.contextRole || store.contextRole }}
                </span>
                <span v-if="store.detail?.gender" class="person-chip">
                  {{ formatGender(store.detail.gender) }}
                </span>
                <span v-if="store.detail?.birthday" class="person-chip">
                  {{ store.detail.birthday }}
                </span>
                <span v-if="store.detail?.bloodType" class="person-chip">
                  {{ store.detail.bloodType }}
                </span>
              </div>

              <p v-if="!store.error && summaryParagraphs.length" class="person-lead">
                {{ summaryParagraphs[0] }}
              </p>
            </div>
          </header>

          <div v-if="store.error" class="person-error">
            <p>{{ store.error }}</p>
            <button
              type="button"
              @click="store.openPerson({
                id: display.id!,
                name: display.name,
                image: display.image,
                contextRole: store.contextRole,
                returnAnimeId: store.returnAnimeId,
              })"
            >
              重试
            </button>
          </div>

          <div
            v-else
            class="person-body"
            :class="{
              'has-secondary': store.kind === 'person' || display.source === 'bangumi',
            }"
          >
            <!-- Main column: full profile -->
            <section class="person-panel person-panel--profile" aria-labelledby="person-profile-title">
              <header class="person-panel__head">
                <div>
                  <span>PROFILE</span>
                  <h2 id="person-profile-title">人物简介</h2>
                </div>
                <button
                  v-if="summaryCanTranslate"
                  type="button"
                  class="person-translate"
                  :disabled="summaryTranslating"
                  @click="translateSummary"
                >
                  <PhTranslate :size="15" weight="bold" />
                  {{ summaryTranslating ? '翻译中' : summaryTranslation ? '隐藏翻译' : '翻译' }}
                </button>
              </header>

              <div
                v-if="store.loading || store.loadingProfile"
                class="person-bio-skeleton"
                aria-label="正在加载人物简介"
                aria-busy="true"
              >
                <i /><i /><i /><i />
              </div>

              <template v-else-if="summaryParagraphs.length">
                <div
                  class="person-bio"
                  :class="{ 'is-collapsed': summaryLong && !summaryExpanded }"
                >
                  <p
                    v-for="(para, idx) in summaryPreview"
                    :key="`${idx}-${para.slice(0, 12)}`"
                    class="person-bio__p"
                  >
                    {{ para }}
                  </p>
                </div>
                <button
                  v-if="summaryLong"
                  type="button"
                  class="person-bio-toggle"
                  :aria-expanded="summaryExpanded"
                  @click="summaryExpanded = !summaryExpanded"
                >
                  {{ summaryExpanded ? '收起简介' : '展开全部简介' }}
                  <PhCaretDown :size="14" weight="bold" :class="{ 'is-open': summaryExpanded }" />
                </button>
                <div v-if="summaryTranslation || summaryTranslateError" class="person-translation">
                  <p v-if="summaryTranslation">{{ summaryTranslation }}</p>
                  <p v-else class="person-translation__error">{{ summaryTranslateError }}</p>
                </div>
              </template>

              <p v-else class="person-empty">{{ emptySummaryMessage }}</p>
            </section>

            <section class="person-panel person-panel--works" aria-labelledby="person-works-title">
              <header class="person-panel__head">
                <div>
                  <span>{{ worksKicker }}</span>
                  <h2 id="person-works-title">{{ worksHeading }}</h2>
                </div>
                <p v-if="works.length" class="person-panel__count">{{ worksCountLabel }}</p>
              </header>

              <div v-if="store.loading" class="person-card-skeleton" aria-hidden="true">
                <i /><i /><i />
              </div>
              <div
                v-if="!store.loading && works.length"
                class="person-track-shell"
                :class="{
                  'has-left-overflow': horizontalEdges.works.left,
                  'has-right-overflow': horizontalEdges.works.right,
                }"
              >
                <div
                  id="person-works-grid"
                  ref="worksTrackRef"
                  class="person-work-grid"
                  :class="{ 'is-expanded': worksExpanded }"
                  tabindex="0"
                  :aria-label="`${worksHeading}横向列表`"
                  @wheel.passive="markHorizontalIntent('works', $event)"
                  @touchstart.passive="markHorizontalIntent('works', $event)"
                  @pointerdown="markHorizontalIntent('works', $event)"
                  @keydown="markHorizontalIntent('works', $event)"
                  @scroll.passive="onHorizontalTrackScroll('works', $event)"
                >
                  <article
                    v-for="work in works"
                    :key="work.id"
                    class="person-work-card"
                  >
                    <button
                      type="button"
                      class="person-work"
                      @click="openWork(work, $event)"
                    >
                      <img v-if="work.image" :src="work.image" :alt="work.title" loading="lazy" />
                      <div v-else class="person-work__ph"><PhFilmSlate :size="24" /></div>
                      <span class="person-work__body">
                        <strong>{{ work.title }}</strong>
                        <small v-if="work.originalTitle">{{ work.originalTitle }}</small>
                        <em>{{ work.role || work.type || '关联作品' }}</em>
                      </span>
                      <PhArrowSquareOut class="person-card-arrow" :size="16" weight="bold" />
                    </button>
                    <button
                      v-if="shouldTranslateWork(work)"
                      type="button"
                      class="person-translate person-translate--card"
                      :disabled="dataTranslating[workTranslationKey(work)]"
                      @click="translateData(workTranslationKey(work), workTranslationText(work))"
                    >
                      <PhTranslate :size="13" weight="bold" />
                      {{ dataTranslating[workTranslationKey(work)] ? '翻译中' : dataTranslations[workTranslationKey(work)] ? '隐藏翻译' : '翻译卡片' }}
                    </button>
                    <p
                      v-if="dataTranslations[workTranslationKey(work)] || dataTranslateErrors[workTranslationKey(work)]"
                      class="person-card-translation"
                      :class="{ 'is-error': dataTranslateErrors[workTranslationKey(work)] }"
                    >
                      {{ dataTranslations[workTranslationKey(work)] || dataTranslateErrors[workTranslationKey(work)] }}
                    </p>
                  </article>
                  <article v-if="store.loadingWorks" class="person-track-skeleton" aria-label="正在继续加载作品">
                    <i /><span><i /><i /><i /></span>
                  </article>
                  <button
                    v-if="store.detail?.worksHasMore"
                    type="button"
                    class="person-track-more"
                    :disabled="store.loadingWorks"
                    @click="store.loadMoreWorks"
                  >
                    {{ store.loadingWorks ? '加载中…' : '继续滑动加载' }}
                  </button>
                </div>
              </div>
              <button
                v-if="!store.loading && worksCanCollapse"
                type="button"
                class="person-section-toggle"
                :aria-expanded="worksExpanded"
                :aria-busy="sectionAnimating.works"
                :disabled="sectionAnimating.works"
                aria-controls="person-works-grid"
                @click="toggleWorksExpanded"
              >
                {{ worksToggleLabel }}
                <PhCaretDown :size="15" weight="bold" :class="{ 'is-open': worksExpanded }" />
              </button>
              <button
                v-if="store.detail?.worksHasMore && worksExpanded"
                ref="worksSentinelRef"
                type="button"
                class="person-load-more"
                :aria-busy="store.loadingWorks"
                :disabled="store.loadingWorks"
                @click="store.loadMoreWorks"
              >
                {{ store.loadingWorks ? '正在继续加载…' : '向下滚动加载更多' }}
              </button>
              <p v-if="!store.loading && !works.length" class="person-empty">
                暂无{{ worksHeading }}资料。
              </p>
            </section>

            <section
              v-if="store.kind === 'person' && (store.loading || voiceRoles.length)"
              class="person-panel person-panel--voices"
              aria-labelledby="person-voices-title"
            >
              <header class="person-panel__head">
                <div>
                  <span>ROLES</span>
                  <h2 id="person-voices-title">演出角色</h2>
                </div>
                <p v-if="voiceRoles.length" class="person-panel__count">{{ voiceRolesCountLabel }}</p>
              </header>

              <div v-if="store.loading" class="person-card-skeleton" aria-hidden="true">
                <i /><i /><i />
              </div>
              <div
                v-if="!store.loading && voiceRoles.length"
                class="person-track-shell"
                :class="{
                  'has-left-overflow': horizontalEdges.roles.left,
                  'has-right-overflow': horizontalEdges.roles.right,
                }"
              >
                <div
                  id="person-roles-grid"
                  ref="rolesTrackRef"
                  class="person-role-grid"
                  :class="{ 'is-expanded': voiceRolesExpanded }"
                  tabindex="0"
                  aria-label="演出角色横向列表"
                  @wheel.passive="markHorizontalIntent('roles', $event)"
                  @touchstart.passive="markHorizontalIntent('roles', $event)"
                  @pointerdown="markHorizontalIntent('roles', $event)"
                  @keydown="markHorizontalIntent('roles', $event)"
                  @scroll.passive="onHorizontalTrackScroll('roles', $event)"
                >
                  <article
                    v-for="role in voiceRoles"
                    :key="`${role.id}-${role.subjectId || ''}`"
                    class="person-role"
                  >
                  <button type="button" class="person-role__main" @click="openVoiceRole(role, $event)">
                    <span class="person-role__media">
                      <template v-if="role.image">
                        <img
                          class="person-role__backdrop"
                          :src="role.image"
                          alt=""
                          aria-hidden="true"
                          loading="lazy"
                        />
                        <img
                          class="person-role__image"
                          :src="role.image"
                          :alt="role.name"
                          loading="lazy"
                        />
                      </template>
                      <span v-else class="person-role__ph"><PhUser :size="22" /></span>
                    </span>
                    <span>
                      <strong>{{ role.name }}</strong>
                      <em>{{ role.role || '出演' }}</em>
                    </span>
                  </button>
                  <button
                    v-if="role.subjectId"
                    type="button"
                    class="person-role__subject"
                    @click="openVoiceRoleSubject(role, $event)"
                  >
                    <span>{{ role.subjectTitle || '关联动画' }}</span>
                  </button>
                  <button
                    v-if="shouldTranslateRole(role)"
                    type="button"
                    class="person-translate person-translate--card"
                    :disabled="dataTranslating[roleTranslationKey(role)]"
                    @click="translateData(roleTranslationKey(role), roleTranslationText(role))"
                  >
                    <PhTranslate :size="13" weight="bold" />
                    {{ dataTranslating[roleTranslationKey(role)] ? '翻译中' : dataTranslations[roleTranslationKey(role)] ? '隐藏翻译' : '翻译卡片' }}
                  </button>
                  <p
                    v-if="dataTranslations[roleTranslationKey(role)] || dataTranslateErrors[roleTranslationKey(role)]"
                    class="person-card-translation"
                    :class="{ 'is-error': dataTranslateErrors[roleTranslationKey(role)] }"
                  >
                    {{ dataTranslations[roleTranslationKey(role)] || dataTranslateErrors[roleTranslationKey(role)] }}
                  </p>
                  </article>
                  <article v-if="store.loadingVoiceRoles" class="person-track-skeleton" aria-label="正在继续加载角色">
                    <i /><span><i /><i /><i /></span>
                  </article>
                  <button
                    v-if="store.detail?.voiceRolesHasMore"
                    type="button"
                    class="person-track-more"
                    :disabled="store.loadingVoiceRoles"
                    @click="store.loadMoreVoiceRoles"
                  >
                    {{ store.loadingVoiceRoles ? '加载中…' : '继续滑动加载' }}
                  </button>
                </div>
              </div>
              <button
                v-if="!store.loading && voiceRolesCanCollapse"
                type="button"
                class="person-section-toggle"
                :aria-expanded="voiceRolesExpanded"
                :aria-busy="sectionAnimating.roles"
                :disabled="sectionAnimating.roles"
                aria-controls="person-roles-grid"
                @click="toggleVoiceRolesExpanded"
              >
                {{ voiceRolesToggleLabel }}
                <PhCaretDown :size="15" weight="bold" :class="{ 'is-open': voiceRolesExpanded }" />
              </button>
              <button
                v-if="store.detail?.voiceRolesHasMore && voiceRolesExpanded"
                ref="rolesSentinelRef"
                type="button"
                class="person-load-more"
                :aria-busy="store.loadingVoiceRoles"
                :disabled="store.loadingVoiceRoles"
                @click="store.loadMoreVoiceRoles"
              >
                {{ store.loadingVoiceRoles ? '正在继续加载…' : '向下滚动加载更多' }}
              </button>
              <p v-if="!store.loading && !voiceRoles.length" class="person-empty">暂无演出角色资料。</p>
            </section>

            <section
              v-if="display.source === 'bangumi'"
              class="person-panel person-panel--comments"
              aria-labelledby="person-comments-title"
            >
              <header class="person-panel__head">
                <div>
                  <span>COMMENTS</span>
                  <h2 id="person-comments-title">用户吐槽</h2>
                </div>
                <p v-if="comments.length" class="person-panel__count">{{ commentsCountLabel }}</p>
              </header>

              <div
                v-if="store.loading || (store.loadingComments && !comments.length)"
                class="person-comment-skeletons"
                aria-label="正在读取 Bangumi 吐槽箱"
                aria-busy="true"
              >
                <article v-for="index in 4" :key="index" class="person-comment-skeleton">
                  <i class="person-comment-skeleton__avatar" />
                  <span>
                    <i class="person-comment-skeleton__name" />
                    <i class="person-comment-skeleton__line" />
                    <i class="person-comment-skeleton__line person-comment-skeleton__line--short" />
                  </span>
                </article>
              </div>
              <div v-else-if="comments.length" class="person-comments">
                <article v-for="comment in comments" :key="comment.id" class="person-comment">
                  <header>
                    <strong>{{ comment.author }}</strong>
                    <time v-if="comment.time">{{ comment.time }}</time>
                  </header>
                  <p>{{ comment.text }}</p>
                  <button
                    v-if="shouldOfferTranslation(comment.text)"
                    type="button"
                    class="person-translate person-translate--inline"
                    :disabled="commentTranslating[comment.id]"
                    @click="translateComment(comment.id, comment.text)"
                  >
                    <PhTranslate :size="14" weight="bold" />
                    {{ commentTranslating[comment.id] ? '翻译中' : commentTranslations[comment.id] ? '隐藏翻译' : '翻译' }}
                  </button>
                  <div
                    v-if="commentTranslations[comment.id] || commentTranslateErrors[comment.id]"
                    class="person-translation person-translation--comment"
                  >
                    <p v-if="commentTranslations[comment.id]">{{ commentTranslations[comment.id] }}</p>
                    <p v-else class="person-translation__error">{{ commentTranslateErrors[comment.id] }}</p>
                  </div>
                  <details v-if="comment.replies?.length" class="person-comment-replies">
                    <summary>查看 {{ comment.replies.length }} 条回复</summary>
                    <div class="person-comment-replies__list">
                      <article v-for="reply in comment.replies" :key="reply.id" class="person-comment-reply">
                      <header>
                        <strong>{{ reply.author }}</strong>
                        <span>回复</span>
                        <time v-if="reply.time">{{ reply.time }}</time>
                      </header>
                      <p>{{ reply.text }}</p>
                      <button
                        v-if="shouldOfferTranslation(reply.text)"
                        type="button"
                        class="person-translate person-translate--inline"
                        :disabled="commentTranslating[reply.id]"
                        @click="translateComment(reply.id, reply.text)"
                      >
                        <PhTranslate :size="13" weight="bold" />
                        {{ commentTranslating[reply.id] ? '翻译中' : commentTranslations[reply.id] ? '隐藏翻译' : '翻译回复' }}
                      </button>
                      <div
                        v-if="commentTranslations[reply.id] || commentTranslateErrors[reply.id]"
                        class="person-translation person-translation--comment"
                      >
                        <p v-if="commentTranslations[reply.id]">{{ commentTranslations[reply.id] }}</p>
                        <p v-else class="person-translation__error">{{ commentTranslateErrors[reply.id] }}</p>
                      </div>
                      </article>
                    </div>
                  </details>
                </article>
              </div>
              <div
                v-if="store.loadingComments && comments.length"
                class="person-comment-skeletons person-comment-skeletons--append"
                aria-label="正在继续加载 Bangumi 吐槽"
                aria-busy="true"
              >
                <article v-for="index in 2" :key="`append-${index}`" class="person-comment-skeleton">
                  <i class="person-comment-skeleton__avatar" />
                  <span>
                    <i class="person-comment-skeleton__name" />
                    <i class="person-comment-skeleton__line" />
                  </span>
                </article>
              </div>
              <button
                v-if="store.detail?.commentsHasMore && !store.loadingComments"
                ref="commentsSentinelRef"
                type="button"
                class="person-load-more"
                :aria-busy="store.loadingComments"
                @click="store.loadMoreComments"
              >
                继续加载吐槽（每次 20 条）
              </button>
              <p v-if="!store.loading && !store.loadingComments && !comments.length" class="person-empty">暂时没有抓到用户吐槽。</p>
            </section>

            <!-- Side rail: structured facts (mirrors anime detail meta board) -->
            <aside class="person-panel person-panel--meta" aria-label="基本资料">
              <header class="person-panel__head">
                <span>META</span>
                <h2>基本资料</h2>
              </header>

              <div v-if="store.loading" class="person-meta-skeleton" aria-hidden="true">
                <i /><i /><i /><i />
              </div>

              <dl v-else class="person-meta-list">
                <div v-for="fact in facts" :key="fact.label" class="person-meta-row">
                  <dt>
                    <PhUser v-if="fact.icon === 'user'" :size="14" />
                    <PhCalendarBlank v-else-if="fact.icon === 'calendar'" :size="14" />
                    <PhDrop v-else-if="fact.icon === 'drop'" :size="14" />
                    <PhIdentificationCard v-else-if="fact.icon === 'id'" :size="14" />
                    <PhBriefcase v-else :size="14" />
                    {{ fact.label }}
                  </dt>
                  <dd>
                    <span>{{ fact.value }}</span>
                    <button
                      v-if="shouldTranslateFact(fact.label, fact.value)"
                      type="button"
                      class="person-translate person-translate--meta"
                      :disabled="dataTranslating[`fact:${fact.label}`]"
                      @click="translateData(`fact:${fact.label}`, fact.value)"
                    >
                      <PhTranslate :size="12" weight="bold" />
                      {{ dataTranslating[`fact:${fact.label}`] ? '翻译中' : dataTranslations[`fact:${fact.label}`] ? '隐藏翻译' : '翻译' }}
                    </button>
                    <small
                      v-if="dataTranslations[`fact:${fact.label}`] || dataTranslateErrors[`fact:${fact.label}`]"
                      class="person-meta-translation"
                      :class="{ 'is-error': dataTranslateErrors[`fact:${fact.label}`] }"
                    >
                      {{ dataTranslations[`fact:${fact.label}`] || dataTranslateErrors[`fact:${fact.label}`] }}
                    </small>
                  </dd>
                </div>
              </dl>
            </aside>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
