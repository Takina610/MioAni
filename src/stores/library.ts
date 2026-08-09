import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { Anime, ImportResult, WatchStatus } from '../types/anime'
import { normalizeWatchStatus } from '../types/anime'
import { findMatchingAnime, isSameAnime } from '../utils/animeIdentity'
import { isAnimeReleasing } from '../services/libraryProgress'

const STORAGE_KEY = 'mioani-library-v1'
const PROFILE_KEY = 'mioani-profile-v1'

function mergeLinkedIds(...lists: Array<string[] | undefined>): string[] {
  return [...new Set(lists.flatMap((list) => list || []).filter(Boolean))]
}

function todayStamp(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function applyStatusDates(anime: Anime, status: WatchStatus): void {
  if (status === 'watching' || status === 'completed') {
    anime.startedAt ||= todayStamp()
  }
  if (status === 'completed') anime.completedAt ||= todayStamp()
  else anime.completedAt = undefined
}

function normalizeUserScore(value: number): number {
  const clamped = Math.max(0, Math.min(10, value))
  return Math.round(clamped)
}

function normalizeLibraryItem(item: Anime): Anime {
  const status = normalizeWatchStatus(item.status)
  const userScore = item.userScore == null ? undefined : normalizeUserScore(item.userScore)
  if (status === item.status && userScore === item.userScore) return item
  return { ...item, status, userScore }
}

function mergeAnimeRecord(existing: Anime, incoming: Anime): Anime {
  const linkedIds = mergeLinkedIds(existing.linkedIds, incoming.linkedIds, [existing.id, incoming.id])
  return {
    ...existing,
    ...incoming,
    // Keep richer bilingual title fields from both sources.
    titles: {
      cn: incoming.titles?.cn || existing.titles?.cn,
      en: incoming.titles?.en || existing.titles?.en,
      romaji: incoming.titles?.romaji || existing.titles?.romaji,
      native: incoming.titles?.native || existing.titles?.native,
    },
    title: existing.source === 'bangumi'
      ? (existing.title || incoming.title)
      : (incoming.titles?.cn || existing.titles?.cn || incoming.title || existing.title),
    originalTitle: existing.originalTitle || incoming.originalTitle,
    // Prefer imported progress/status from the latest import, else keep local.
    status: normalizeWatchStatus(incoming.status || existing.status),
    watched: Math.max(existing.watched || 0, incoming.watched || 0),
    score: incoming.score || existing.score,
    image: incoming.image || existing.image,
    banner: incoming.banner || existing.banner,
    summary: existing.summary || incoming.summary,
    tags: existing.tags?.length ? existing.tags : incoming.tags,
    linkedIds,
    // Keep a stable primary id: prefer bangumi when either side is bangumi.
    id: existing.source === 'bangumi' || incoming.source === 'bangumi'
      ? (existing.source === 'bangumi' ? existing.id : incoming.id)
      : existing.id,
    source: existing.source === 'bangumi' || incoming.source === 'bangumi' ? 'bangumi' : incoming.source,
    airingStatus: incoming.airingStatus || existing.airingStatus,
    nextEpisode: incoming.airingStatus === 'finished'
      ? undefined
      : (incoming.nextEpisode || existing.nextEpisode),
    userScore: incoming.userScore == null && existing.userScore == null
      ? undefined
      : normalizeUserScore(incoming.userScore ?? existing.userScore ?? 0),
    startedAt: incoming.startedAt ?? existing.startedAt,
    completedAt: incoming.completedAt ?? existing.completedAt,
  }
}

export const useLibraryStore = defineStore('library', () => {
  const saved = localStorage.getItem(STORAGE_KEY)
  const savedProfile = localStorage.getItem(PROFILE_KEY)
  const items = ref<Anime[]>(saved ? JSON.parse(saved).map(normalizeLibraryItem) : [])
  const profile = ref<{ name: string; sources: string[] }>(
    savedProfile ? JSON.parse(savedProfile) : { name: '未登录', sources: [] },
  )
  const watching = computed(() => items.value.filter((item) => item.status === 'watching'))
  const completed = computed(() => items.value.filter((item) => item.status === 'completed'))
  const planned = computed(() => items.value.filter((item) => item.status === 'planned'))
  const watchedEpisodes = computed(() => items.value.reduce((sum, item) => sum + item.watched, 0))
  const libraryIdIndex = computed(() => {
    const index = new Map<string, Anime>()
    for (const item of items.value) {
      index.set(item.id, item)
      for (const linkedId of item.linkedIds || []) index.set(linkedId, item)
    }
    return index
  })

  function findInLibrary(anime: Pick<Anime, 'id' | 'title' | 'originalTitle' | 'titles' | 'year' | 'episodes' | 'linkedIds'>) {
    const direct = libraryIdIndex.value.get(anime.id)
    if (direct) return direct
    for (const linkedId of anime.linkedIds || []) {
      const linked = libraryIdIndex.value.get(linkedId)
      if (linked) return linked
    }
    return findMatchingAnime(items.value, anime)
  }

  function isInLibrary(anime: Pick<Anime, 'id' | 'title' | 'originalTitle' | 'titles' | 'year' | 'episodes' | 'linkedIds'>) {
    return Boolean(findInLibrary(anime))
  }

  function add(anime: Anime, status: WatchStatus = 'planned') {
    status = normalizeWatchStatus(status)
    const existing = findInLibrary(anime)
    if (existing) {
      existing.status = status
      applyStatusDates(existing, status)
      existing.linkedIds = mergeLinkedIds(existing.linkedIds, anime.linkedIds, [existing.id, anime.id])
      if (status === 'completed' && anime.episodes) {
        existing.watched = Math.max(existing.watched || 0, anime.episodes)
      }
      // Enrich missing bilingual titles when adding from the other source.
      existing.titles = {
        cn: existing.titles?.cn || anime.titles?.cn,
        en: existing.titles?.en || anime.titles?.en,
        romaji: existing.titles?.romaji || anime.titles?.romaji,
        native: existing.titles?.native || anime.titles?.native,
      }
      return
    }
    const item: Anime = {
      ...anime,
      status,
      watched: status === 'completed' ? (anime.episodes || 0) : 0,
      linkedIds: mergeLinkedIds(anime.linkedIds, [anime.id]),
    }
    applyStatusDates(item, status)
    items.value.unshift(item)
  }

  function updateProgress(id: string, value: number) {
    const anime = items.value.find((item) => item.id === id || item.linkedIds?.includes(id))
    if (!anime) return
    const numericValue = Number.isFinite(value) ? Math.floor(value) : 0
    anime.watched = Math.max(0, Math.min(numericValue, anime.episodes || numericValue))
    if (anime.watched > 0) anime.startedAt ||= todayStamp()
    if (anime.status === 'planned' && anime.watched > 0) anime.status = 'watching'
    if (
      anime.episodes
      && anime.watched >= anime.episodes
      && !isAnimeReleasing(anime)
    ) {
      anime.status = 'completed'
      anime.completedAt ||= todayStamp()
    } else if (anime.status === 'completed') {
      anime.status = 'watching'
      anime.completedAt = undefined
    }
  }

  function setStatus(id: string, status: WatchStatus) {
    const anime = items.value.find((item) => item.id === id || item.linkedIds?.includes(id))
    if (anime) {
      const normalizedStatus = normalizeWatchStatus(status)
      anime.status = normalizedStatus
      applyStatusDates(anime, normalizedStatus)
    }
  }

  function setUserScore(id: string, value: number | null) {
    const anime = items.value.find((item) => item.id === id || item.linkedIds?.includes(id))
    if (!anime) return
    if (value === null || !Number.isFinite(value)) {
      delete anime.userScore
      return
    }
    anime.userScore = normalizeUserScore(value)
  }

  function setWatchDates(id: string, startedAt?: string, completedAt?: string) {
    const anime = items.value.find((item) => item.id === id || item.linkedIds?.includes(id))
    if (!anime) return
    anime.startedAt = startedAt || undefined
    anime.completedAt = completedAt || undefined
  }

  function remove(id: string) {
    const next = items.value.filter(
      (item) => item.id !== id && !item.linkedIds?.includes(id),
    )
    items.value = next
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  function mergeImport(result: ImportResult) {
    const next = [...items.value]
    for (const incoming of result.items) {
      const index = next.findIndex(
        (item) =>
          item.id === incoming.id
          || item.linkedIds?.includes(incoming.id)
          || incoming.linkedIds?.includes(item.id)
          || isSameAnime(item, incoming),
      )
      if (index >= 0) {
        next[index] = mergeAnimeRecord(next[index], incoming)
      } else {
        next.unshift({
          ...normalizeLibraryItem(incoming),
          linkedIds: mergeLinkedIds(incoming.linkedIds, [incoming.id]),
        })
      }
    }
    items.value = next
    profile.value.name = result.username
    profile.value.sources = [...new Set([...profile.value.sources, result.source])]
  }

  watch(items, (value) => localStorage.setItem(STORAGE_KEY, JSON.stringify(value)), { deep: true })
  watch(profile, (value) => localStorage.setItem(PROFILE_KEY, JSON.stringify(value)), { deep: true })

  return {
    items,
    profile,
    watching,
    completed,
    planned,
    watchedEpisodes,
    findInLibrary,
    isInLibrary,
    add,
    updateProgress,
    setStatus,
    setUserScore,
    setWatchDates,
    remove,
    mergeImport,
  }
})
