import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { Anime, ImportResult, WatchStatus } from '../types/anime'

const STORAGE_KEY = 'mioani-library-v1'
const PROFILE_KEY = 'mioani-profile-v1'

export const useLibraryStore = defineStore('library', () => {
  const saved = localStorage.getItem(STORAGE_KEY)
  const savedProfile = localStorage.getItem(PROFILE_KEY)
  const items = ref<Anime[]>(saved ? JSON.parse(saved) : [])
  const profile = ref<{ name: string; sources: string[] }>(savedProfile ? JSON.parse(savedProfile) : { name: '未登录', sources: [] })
  const watching = computed(() => items.value.filter((item) => item.status === 'watching'))
  const completed = computed(() => items.value.filter((item) => item.status === 'completed'))
  const planned = computed(() => items.value.filter((item) => item.status === 'planned'))
  const watchedEpisodes = computed(() => items.value.reduce((sum, item) => sum + item.watched, 0))

  function add(anime: Anime) {
    if (!items.value.some((item) => item.id === anime.id)) items.value.unshift({ ...anime, status: 'planned', watched: 0 })
  }
  function updateProgress(id: string, value: number) {
    const anime = items.value.find((item) => item.id === id)
    if (!anime) return
    anime.watched = Math.max(0, Math.min(value, anime.episodes || value))
    if (anime.episodes && anime.watched >= anime.episodes) anime.status = 'completed'
  }
  function setStatus(id: string, status: WatchStatus) {
    const anime = items.value.find((item) => item.id === id)
    if (anime) anime.status = status
  }
  function mergeImport(result: ImportResult) {
    const map = new Map(items.value.map((item) => [item.id, item]))
    result.items.forEach((item) => map.set(item.id, item))
    items.value = [...map.values()]
    profile.value.name = result.username
    profile.value.sources = [...new Set([...profile.value.sources, result.source])]
  }

  watch(items, (value) => localStorage.setItem(STORAGE_KEY, JSON.stringify(value)), { deep: true })
  watch(profile, (value) => localStorage.setItem(PROFILE_KEY, JSON.stringify(value)), { deep: true })
  return { items, profile, watching, completed, planned, watchedEpisodes, add, updateProgress, setStatus, mergeImport }
})
