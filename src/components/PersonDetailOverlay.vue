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

type PersonTab = 'profile' | 'works' | 'voices' | 'comments'
const tab = ref<PersonTab>('profile')
const tabsRef = ref<HTMLElement | null>(null)
const indicatorStyle = ref({ width: '0px', transform: 'translateX(0px)' })
const metaExpanded = ref(false)
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
const personSurfaceRef = ref<HTMLElement | null>(null)
const personScrimRef = ref<HTMLElement | null>(null)
const personRevealOrigin = ref({ x: 50, y: 42 })
const PERSON_REVEAL_MS = 720
const EXTRA_ENTER_BATCH = 12
let personAnimTimer: ReturnType<typeof window.setTimeout> | null = null
let personClosing = false
let personExpandToken = 0
let personExpandRunning = false
let extraObserver: IntersectionObserver | null = null
let userScrollEpoch = 0
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
/** Only newly appended cards play enter animation (stable keys keep old ones still). */
const worksEnterFrom = ref(0)
const rolesEnterFrom = ref(0)
const commentsEnterFrom = ref(0)

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

const works = computed(() => store.detail?.works || [])
const voiceRoles = computed(() => store.detail?.voiceRoles || [])
const comments = computed(() => store.detail?.comments || [])
const personTabs = computed(() => {
  const tabs: { id: PersonTab; label: string }[] = [
    { id: 'profile', label: '简介' },
    { id: 'works', label: store.kind === 'character' ? '出演' : '作品' },
  ]
  if (store.kind === 'person') tabs.push({ id: 'voices', label: '演出角色' })
  if (display.value?.source === 'bangumi') tabs.push({ id: 'comments', label: '吐槽' })
  return tabs
})
const emptySummaryMessage = computed(() => (
  display.value?.source === 'bangumi' && facts.value.length > 1
    ? 'Bangumi 官网暂无独立简介，已有资料已完整整理在「基本资料」中。'
    : `该${kindLabel.value}暂无简介资料。`
))
const worksHeading = computed(() => (store.kind === 'character' ? '出演番剧' : '制作作品'))
const worksKicker = computed(() => (store.kind === 'character' ? 'APPEARANCES' : 'WORKS'))
const summaryCanTranslate = computed(() => shouldOfferTranslation(store.detail?.summary))
/** Soft-enter panel key: re-animates on tab switch / first payload, not every infinite-scroll append. */
const personPanelKey = computed(() => {
  const id = display.value?.id || 'person'
  if (tab.value === 'profile') {
    return `${id}-profile-${store.loading || store.loadingProfile ? 'x' : 'd'}`
  }
  if (tab.value === 'works') {
    const pending = store.loadingWorks && !works.value.length
    return `${id}-works-${pending ? 'x' : 'd'}`
  }
  if (tab.value === 'voices') {
    const pending = store.loadingVoiceRoles && !voiceRoles.value.length
    return `${id}-voices-${pending ? 'x' : 'd'}`
  }
  const pending = store.loadingComments && !comments.value.length
  return `${id}-comments-${pending ? 'x' : 'd'}`
})

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

function updateTabIndicator() {
  const root = tabsRef.value
  if (!root) return
  const active = root.querySelector<HTMLElement>('button.active')
  if (!active) {
    indicatorStyle.value = { width: '0px', transform: 'translateX(0px)' }
    return
  }
  indicatorStyle.value = {
    width: `${active.offsetWidth}px`,
    transform: `translateX(${active.offsetLeft}px)`,
  }
}

function ensureTabData(next: PersonTab) {
  if (next === 'works') void store.ensureWorks()
  else if (next === 'voices') void store.ensureVoiceRoles()
  else if (next === 'comments') void store.ensureComments()
}

function selectTab(next: PersonTab) {
  if (tab.value === next) return
  if (!personTabs.value.some((item) => item.id === next)) return
  tab.value = next
  if (next !== 'profile') metaExpanded.value = false
  ensureTabData(next)
  void nextTick().then(() => {
    updateTabIndicator()
    resetExtraObserver()
  })
}

function resetExtraObserver() {
  extraObserver?.disconnect()
  extraObserver = null
  const root = personScrollRef.value || document.querySelector('.person-scroll') as HTMLElement | null
  extraObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting) && root) {
      onPersonScroll({ currentTarget: root } as unknown as Event)
    }
  }, { root, rootMargin: '160px 0px 160px 0px' })
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

function maybeLoadMore(
  kind: 'works' | 'roles' | 'comments',
  node: HTMLElement | null,
  root: HTMLElement | null,
  top: number,
  action: () => void | Promise<void>,
) {
  if (!isNearScrollRoot(node, root)) return
  if (userScrollEpoch <= lastExtraTriggerEpoch[kind]) return
  if (Math.abs(top - lastExtraTriggerTop[kind]) <= 80) return
  lastExtraTriggerTop[kind] = top
  lastExtraTriggerEpoch[kind] = userScrollEpoch
  void action()
}

async function loadMoreWorksWithEnter() {
  if (store.loadingWorks || !store.detail?.worksHasMore) return
  worksEnterFrom.value = works.value.length
  await store.loadMoreWorks()
  // Sentinel may still be in view after append; force another pass (same as anime detail).
  await nextTick()
  const root = personScrollRef.value
  if (isNearScrollRoot(worksSentinelRef.value, root)) {
    lastExtraTriggerEpoch.works = Math.max(0, lastExtraTriggerEpoch.works - 1)
    void loadMoreWorksWithEnter()
  }
}

async function loadMoreVoiceRolesWithEnter() {
  if (store.loadingVoiceRoles || !store.detail?.voiceRolesHasMore) return
  rolesEnterFrom.value = voiceRoles.value.length
  await store.loadMoreVoiceRoles()
  await nextTick()
  const root = personScrollRef.value
  if (isNearScrollRoot(rolesSentinelRef.value, root)) {
    lastExtraTriggerEpoch.roles = Math.max(0, lastExtraTriggerEpoch.roles - 1)
    void loadMoreVoiceRolesWithEnter()
  }
}

async function loadMoreCommentsWithEnter() {
  if (store.loadingComments || !store.detail?.commentsHasMore) return
  commentsEnterFrom.value = comments.value.length
  await store.loadMoreComments()
  await nextTick()
  const root = personScrollRef.value
  if (isNearScrollRoot(commentsSentinelRef.value, root)) {
    lastExtraTriggerEpoch.comments = Math.max(0, lastExtraTriggerEpoch.comments - 1)
    void loadMoreCommentsWithEnter()
  }
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
  const top = root?.scrollTop || 0
  if (tab.value === 'works') {
    maybeLoadMore(
      'works',
      worksSentinelRef.value || document.querySelector('.person-panel--works .person-infinite-sentinel') as HTMLElement | null,
      root,
      top,
      loadMoreWorksWithEnter,
    )
  } else if (tab.value === 'voices') {
    maybeLoadMore(
      'roles',
      rolesSentinelRef.value || document.querySelector('.person-panel--voices .person-infinite-sentinel') as HTMLElement | null,
      root,
      top,
      loadMoreVoiceRolesWithEnter,
    )
  } else if (tab.value === 'comments') {
    maybeLoadMore(
      'comments',
      commentsSentinelRef.value || document.querySelector('.person-panel--comments .person-infinite-sentinel') as HTMLElement | null,
      root,
      top,
      loadMoreCommentsWithEnter,
    )
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

function thumbFromEvent(event?: Event): Element | null {
  const root = (event?.currentTarget as HTMLElement | null) || null
  if (!root) return null
  return root.querySelector?.('img, .person-work__ph, .person-role__ph') || root
}

/** Hide person without wiping state. Handles stale Pinia HMR instances missing suspend(). */
function suspendPersonForAnimeWork() {
  const s = usePersonOverlayStore()
  if (typeof s.suspend === 'function') {
    s.suspend()
    return
  }
  // Fallback for hot-reload before store methods rebind: hide only, keep detail/stack.
  s.$patch({
    open: false,
    phase: 'idle',
    loading: false,
    loadingProfile: false,
    loadingComments: false,
    loadingWorks: false,
    loadingVoiceRoles: false,
    suspended: true,
  })
}

async function openWork(work: AnimeRelation, event?: Event) {
  if (!work.id) return
  const thumb = thumbFromEvent(event)
  // Keep CV/person page + stack for back; do not finishClose (that wiped state and broke flight).
  suspendPersonForAnimeWork()
  await detailStore.openFromRelated(work, thumb)
  if (route.name !== 'anime-detail' || route.params.id !== work.id) {
    await router.push({ name: 'anime-detail', params: { id: work.id } })
  }
}

async function openVoiceRole(role: PersonVoiceRole, event?: Event) {
  event?.stopPropagation?.()
  if (!role.id) return
  // Same person: no-op. Different person: store pushes current onto stack.
  if (role.id === (store.detail?.id || store.seed?.id)) return
  const routeName = store.routeNameFor(role.id)
  const ok = await store.openPerson({
    id: role.id,
    name: role.name,
    image: role.image,
    contextRole: [role.role, role.subjectTitle].filter(Boolean).join(' · '),
    returnAnimeId: store.returnAnimeId,
    originRect: detailStore.captureRect(thumbFromEvent(event)),
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
    tab.value = 'profile'
    metaExpanded.value = false
    worksEnterFrom.value = 0
    rolesEnterFrom.value = 0
    commentsEnterFrom.value = 0
    resetTranslationState()
    resetExtraTriggerState()
    await nextTick()
    updateTabIndicator()
    resetExtraObserver()
  },
)

// First paint of a tab: animate the whole first page once.
watch(
  () => [tab.value, works.value.length, voiceRoles.value.length, comments.value.length] as const,
  ([nextTab, worksLen, rolesLen, commentsLen], prev) => {
    if (nextTab === 'works' && worksLen > 0 && (prev?.[0] !== 'works' || prev?.[1] === 0)) {
      worksEnterFrom.value = 0
    }
    if (nextTab === 'voices' && rolesLen > 0 && (prev?.[0] !== 'voices' || prev?.[2] === 0)) {
      rolesEnterFrom.value = 0
    }
    if (nextTab === 'comments' && commentsLen > 0 && (prev?.[0] !== 'comments' || prev?.[3] === 0)) {
      commentsEnterFrom.value = 0
    }
  },
)

watch(tab, async (next) => {
  ensureTabData(next)
  await nextTick()
  updateTabIndicator()
  resetExtraObserver()
})

watch(personTabs, (tabs) => {
  if (!tabs.some((item) => item.id === tab.value)) tab.value = 'profile'
  void nextTick().then(updateTabIndicator)
})

watch(
  () => [
    store.detail?.worksHasMore,
    store.detail?.voiceRolesHasMore,
    store.detail?.commentsHasMore,
    store.loading,
    works.value.length,
    voiceRoles.value.length,
    comments.value.length,
    tab.value,
  ] as const,
  async () => {
    await nextTick()
    if (store.open) {
      bindPersonScroll()
      resetExtraObserver()
    }
  },
)

watch(
  () => store.open,
  async (open) => {
    if (!open) {
      if (personAnimTimer) {
        window.clearTimeout(personAnimTimer)
        personAnimTimer = null
      }
      personClosing = false
      personExpandRunning = false
      personExpandToken += 1
      return
    }
    await nextTick()
    bindPersonScroll()
    resetExtraObserver()
    updateTabIndicator()
    // Resume from anime work: surface must be fully open without replaying circle to 0.
    if (store.phase === 'open') {
      setPersonRevealOriginFromRect(store.originRect)
      applyPersonSurfaceReveal(true, false)
    }
  },
)

// One expand per open cycle only — dual watches / data reloads must not re-trigger the circle.
watch(
  () => [store.open, store.phase, store.seed?.id || store.detail?.id || ''] as const,
  async ([open, phase, id], prev) => {
    if (!open || phase !== 'expanding' || personClosing || !id) return
    const prevId = prev?.[2]
    // Same person still expanding (e.g. detail payload arrived) — do not restart reveal.
    if (personExpandRunning && prevId === id) return
    await nextTick()
    void runPersonExpand()
  },
)

function setPersonRevealOriginFromRect(rect: { top: number; left: number; width: number; height: number } | null) {
  if (!rect) {
    personRevealOrigin.value = { x: 50, y: 42 }
    return
  }
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const vw = Math.max(window.innerWidth, 1)
  const vh = Math.max(window.innerHeight, 1)
  personRevealOrigin.value = {
    x: Math.min(100, Math.max(0, (cx / vw) * 100)),
    y: Math.min(100, Math.max(0, (cy / vh) * 100)),
  }
}

function applyPersonSurfaceReveal(open: boolean, withTransition: boolean) {
  const el = personSurfaceRef.value
  if (!el) return
  const { x, y } = personRevealOrigin.value
  el.style.setProperty('--reveal-x', `${x}%`)
  el.style.setProperty('--reveal-y', `${y}%`)
  const ms = PERSON_REVEAL_MS
  const ease = 'cubic-bezier(.16,.84,.24,1)'
  const opacityMs = open ? Math.round(ms * 0.55) : Math.round(ms * 0.72)
  const opacityDelay = open ? 0 : Math.round(ms * 0.18)
  el.style.transition = withTransition
    ? [
        `opacity ${opacityMs}ms ${ease} ${opacityDelay}ms`,
        `transform ${ms}ms ${ease}`,
        `--reveal-r ${ms}ms ${ease}`,
        `box-shadow ${ms}ms ${ease}`,
      ].join(', ')
    : 'none'
  if (open) {
    el.style.opacity = '1'
    el.style.transform = 'scale(1)'
    el.style.setProperty('--reveal-r', '150%')
    el.style.boxShadow = 'inset 0 0 0 0 rgba(184,240,95,0)'
  } else {
    el.style.opacity = '0'
    el.style.transform = 'scale(.994)'
    el.style.setProperty('--reveal-r', '0%')
    el.style.boxShadow = 'inset 0 0 140px 0 rgba(184,240,95,.08)'
  }
  const scrim = personScrimRef.value
  if (scrim) {
    scrim.style.transition = withTransition ? `opacity ${ms}ms ${ease}` : 'none'
    scrim.style.opacity = open ? '1' : '0'
  }
}

async function runPersonExpand() {
  if (!store.open || personClosing || personExpandRunning) return
  personExpandRunning = true
  const token = ++personExpandToken
  setPersonRevealOriginFromRect(store.originRect)
  await nextTick()
  if (token !== personExpandToken || !store.open) return
  // Park closed without transition, then open on next frame (single circle only).
  applyPersonSurfaceReveal(false, false)
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
  if (token !== personExpandToken || !store.open) return
  applyPersonSurfaceReveal(true, true)
  if (personAnimTimer) window.clearTimeout(personAnimTimer)
  personAnimTimer = window.setTimeout(() => {
    if (token === personExpandToken) {
      store.markOpen()
      personExpandRunning = false
    }
    personAnimTimer = null
  }, PERSON_REVEAL_MS + 20)
}

async function closePerson() {
  if (!store.open || personClosing) return

  // Person → person: restore previous person while keeping the surface fully open.
  // Full circle collapse would shrink to 0 and flash the anime detail underlay first.
  if (store.canPopPerson) {
    personClosing = true
    if (personAnimTimer) {
      window.clearTimeout(personAnimTimer)
      personAnimTimer = null
    }
    personExpandRunning = false
    personExpandToken += 1
    const restoredId = store.popPerson()
    if (restoredId) {
      const routeName = store.routeNameFor(restoredId)
      if (routeName && (route.name !== routeName || route.params.id !== restoredId)) {
        await router.replace({ name: routeName, params: { id: restoredId } })
      }
      await nextTick()
      // Stay fully revealed; only swap content under the open mask.
      setPersonRevealOriginFromRect(store.originRect)
      applyPersonSurfaceReveal(true, false)
      updateTabIndicator()
      resetExtraObserver()
      bindPersonScroll()
    }
    personClosing = false
    return
  }

  personClosing = true
  const animeId = store.returnAnimeId
  setPersonRevealOriginFromRect(store.originRect)
  store.beginCollapse()
  await nextTick()
  applyPersonSurfaceReveal(false, true)
  if (personAnimTimer) window.clearTimeout(personAnimTimer)
  await new Promise<void>((resolve) => {
    personAnimTimer = window.setTimeout(() => {
      personAnimTimer = null
      resolve()
    }, PERSON_REVEAL_MS + 30)
  })
  store.finishClose()
  personClosing = false
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
    if (store.open && (store.detail?.id === id || (store.seed?.id === id && store.loading))) return
    const parsed = parsePersonId(id)
    if (!parsed) return

    // Browser back / in-app pop: prefer restoring a buried person page over reloading.
    if (store.open && store.canPopPerson && store.activeId !== id) {
      while (store.canPopPerson) {
        const restored = store.popPerson()
        if (restored === id) {
          await nextTick()
          void runPersonExpand()
          return
        }
        if (!restored) break
      }
      if (store.activeId === id) return
    }

    if (!store.open || store.seed?.id !== id) {
      await store.openPerson({
        id,
        returnAnimeId: store.returnAnimeId,
        // History / deep-link recovery must not invent stack edges.
        replace: true,
      })
    }
  },
)

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  if (
    (route.name === 'character-detail' || route.name === 'person-detail')
    && typeof route.params.id === 'string'
    && !store.open
  ) {
    void store.openPerson({ id: route.params.id })
  }
  void nextTick().then(() => {
    bindPersonScroll()
    resetExtraObserver()
    updateTabIndicator()
  })
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  personScrollRef.value?.removeEventListener('scroll', onPersonScroll)
  personScrollRef.value?.removeEventListener('wheel', markUserScrollIntent)
  personScrollRef.value?.removeEventListener('touchmove', markUserScrollIntent)
  if (personAnimTimer) window.clearTimeout(personAnimTimer)
  extraObserver?.disconnect()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="store.open && display"
      class="person-overlay"
      :class="{
        'is-loading': store.loading,
        [`is-${store.phase}`]: true,
      }"
      role="dialog"
      aria-modal="true"
      :aria-label="store.title"
    >
      <button
        ref="personScrimRef"
        class="person-scrim"
        type="button"
        aria-label="关闭人物详情"
        @click="closePerson"
      />

      <div ref="personSurfaceRef" class="person-surface">
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
            :class="{ 'is-meta-expanded': metaExpanded }"
          >
            <!-- Same order as anime detail-content: main first, meta second; mobile reorders via CSS. -->
            <div class="person-main">
              <div ref="tabsRef" class="person-tabs sliding-tabs" role="tablist" aria-label="人物详情分区">
                <button
                  v-for="item in personTabs"
                  :key="item.id"
                  type="button"
                  role="tab"
                  :aria-selected="tab === item.id"
                  :class="{ active: tab === item.id }"
                  @click="selectTab(item.id)"
                >
                  {{ item.label }}
                </button>
                <span class="sliding-tabs__indicator" :style="indicatorStyle" aria-hidden="true" />
              </div>

            <Transition name="detail-soft" mode="out-in">
            <div :key="personPanelKey" class="person-main__panel">
            <!-- Profile tab -->
            <section
              v-if="tab === 'profile'"
              class="person-panel person-panel--profile"
              aria-labelledby="person-profile-title"
            >
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
                <div class="person-bio">
                  <p
                    v-for="(para, idx) in summaryParagraphs"
                    :key="`${idx}-${para.slice(0, 12)}`"
                    class="person-bio__p"
                  >
                    {{ para }}
                  </p>
                </div>
                <div v-if="summaryTranslation || summaryTranslateError" class="person-translation">
                  <p v-if="summaryTranslation">{{ summaryTranslation }}</p>
                  <p v-else class="person-translation__error">{{ summaryTranslateError }}</p>
                </div>
              </template>

              <p v-else class="person-empty">{{ emptySummaryMessage }}</p>
            </section>

            <section
              v-else-if="tab === 'works'"
              class="person-panel person-panel--works"
              aria-labelledby="person-works-title"
            >
              <header class="person-panel__head">
                <div>
                  <span>{{ worksKicker }}</span>
                  <h2 id="person-works-title">{{ worksHeading }}</h2>
                </div>
                <p v-if="works.length" class="person-panel__count">{{ worksCountLabel }}</p>
              </header>

              <div
                v-if="(store.loading || store.loadingWorks) && !works.length"
                class="person-card-skeleton"
                aria-hidden="true"
              >
                <i /><i /><i />
              </div>
              <div
                v-else-if="works.length"
                class="person-track-shell"
              >
                <div
                  id="person-works-grid"
                  class="person-work-grid is-expanded"
                  :aria-label="worksHeading"
                >
                  <article
                    v-for="(work, idx) in works"
                    :key="work.id"
                    class="person-work-card"
                    :class="{ 'person-extra-item': idx >= worksEnterFrom }"
                    :style="idx >= worksEnterFrom ? { '--enter-i': (idx - worksEnterFrom) % EXTRA_ENTER_BATCH } : undefined"
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
                </div>
                <div
                  v-if="store.detail?.worksHasMore"
                  ref="worksSentinelRef"
                  class="person-infinite-sentinel"
                  aria-hidden="true"
                />
                <div
                  v-if="store.loadingWorks && works.length"
                  class="person-card-skeleton person-card-skeleton--append"
                  aria-hidden="true"
                >
                  <i /><i /><i />
                </div>
              </div>
              <p v-else-if="!store.loading && !store.loadingWorks" class="person-empty">
                暂无{{ worksHeading }}资料。
              </p>
            </section>

            <section
              v-else-if="tab === 'voices'"
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

              <div
                v-if="(store.loading || store.loadingVoiceRoles) && !voiceRoles.length"
                class="person-card-skeleton"
                aria-hidden="true"
              >
                <i /><i /><i />
              </div>
              <div
                v-else-if="voiceRoles.length"
                class="person-track-shell"
              >
                <div
                  id="person-roles-grid"
                  class="person-role-grid is-expanded"
                  aria-label="演出角色"
                >
                  <article
                    v-for="(role, idx) in voiceRoles"
                    :key="`${role.id}-${role.subjectId || ''}`"
                    class="person-role"
                    :class="{ 'person-extra-item': idx >= rolesEnterFrom }"
                    :style="idx >= rolesEnterFrom ? { '--enter-i': (idx - rolesEnterFrom) % EXTRA_ENTER_BATCH } : undefined"
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
                </div>
                <div
                  v-if="store.detail?.voiceRolesHasMore"
                  ref="rolesSentinelRef"
                  class="person-infinite-sentinel"
                  aria-hidden="true"
                />
                <div
                  v-if="store.loadingVoiceRoles && voiceRoles.length"
                  class="person-card-skeleton person-card-skeleton--append"
                  aria-hidden="true"
                >
                  <i /><i /><i />
                </div>
              </div>
              <p v-else-if="!store.loading && !store.loadingVoiceRoles" class="person-empty">暂无演出角色资料。</p>
            </section>

            <section
              v-else-if="tab === 'comments'"
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
              <div v-else-if="comments.length" class="person-comments is-chat">
                <article
                  v-for="(comment, index) in comments"
                  :key="comment.id"
                  class="person-comment"
                  :class="[
                    index % 2 === 0 ? 'is-left' : 'is-right',
                    { 'person-extra-item': index >= commentsEnterFrom },
                  ]"
                  :style="index >= commentsEnterFrom ? { '--enter-i': (index - commentsEnterFrom) % EXTRA_ENTER_BATCH } : undefined"
                >
                  <header class="person-comment__head">
                    <strong>{{ comment.author }}</strong>
                    <time v-if="comment.time">{{ comment.time }}</time>
                  </header>
                  <p v-if="comment.replyTo" class="person-comment__reply-to">回复 @{{ comment.replyTo }}</p>
                  <p class="person-comment__body">{{ comment.text }}</p>
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
                  <div v-if="comment.replies?.length" class="person-comment-replies">
                    <article
                      v-for="reply in comment.replies"
                      :key="reply.id"
                      class="person-comment-reply"
                    >
                      <header class="person-comment__head">
                        <strong>{{ reply.author }}</strong>
                        <time v-if="reply.time">{{ reply.time }}</time>
                      </header>
                      <p v-if="reply.replyTo" class="person-comment__reply-to">回复 @{{ reply.replyTo }}</p>
                      <p class="person-comment__body">{{ reply.text }}</p>
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
                </article>
              </div>
              <div
                v-if="store.detail?.commentsHasMore"
                ref="commentsSentinelRef"
                class="person-infinite-sentinel"
                aria-hidden="true"
              />
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
              <p v-if="!store.loading && !store.loadingComments && !comments.length" class="person-empty">暂时没有抓到用户吐槽。</p>
            </section>
            </div>
            </Transition>
            </div>

            <!-- Side rail: structured facts (mirrors anime detail meta board) -->
            <div class="person-meta" :class="{ 'is-expanded': metaExpanded }" aria-label="基本资料">
              <button
                type="button"
                class="person-meta__toggle"
                :aria-expanded="metaExpanded"
                @click="metaExpanded = !metaExpanded"
              >
                <span>基本资料</span>
                <em v-for="chip in facts.slice(0, 2)" :key="`meta-chip-${chip.label}`">{{ chip.value }}</em>
                <PhCaretDown class="person-meta__caret" :size="16" weight="bold" />
              </button>
              <div class="person-meta__panel">
                <aside class="person-panel person-panel--meta">
                  <header class="person-panel__head person-meta__head">
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
      </div>

    </div>
  </Teleport>
</template>
