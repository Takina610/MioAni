import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  emptyWeekSchedule,
  fetchAniListSeasonalDetailed,
  fetchBangumiCalendarDetailed,
  scheduleFromAniListSeasonal,
} from '../services/anime'
import type { Anime } from '../types/anime'
import type { ScheduleDay } from '../types/schedule'
import { enrichScheduleWithAiringTimes, scheduleHasContent } from '../services/schedule'

/** Extra AniList rows help match Bangumi calendar titles for HH:mm enrichment. */
const ANILIST_SEASONAL_LIMIT = 100

export const useCatalogStore = defineStore('catalog', () => {
  const bangumi = ref<Anime[]>([])
  const trending = ref<Anime[]>([])
  const schedule = ref<ScheduleDay[]>(emptyWeekSchedule())
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref('')
  const featured = computed(() => bangumi.value[0] || trending.value[0])
  const seasonal = computed(() => (bangumi.value.length ? bangumi.value : trending.value))

  async function load(force = false) {
    if ((loaded.value && !force) || loading.value) return
    loading.value = true
    error.value = ''

    const [bangumiResult, aniListResult] = await Promise.allSettled([
      fetchBangumiCalendarDetailed(),
      fetchAniListSeasonalDetailed(ANILIST_SEASONAL_LIMIT),
    ])

    let nextSchedule = emptyWeekSchedule()

    if (bangumiResult.status === 'fulfilled') {
      bangumi.value = bangumiResult.value.flat
      if (scheduleHasContent(bangumiResult.value.schedule)) {
        nextSchedule = bangumiResult.value.schedule
      }
    }

    if (aniListResult.status === 'fulfilled') {
      trending.value = aniListResult.value.items
      if (scheduleHasContent(nextSchedule)) {
        // Bangumi calendar has weekday only; fill HH:mm from AniList next airing.
        nextSchedule = enrichScheduleWithAiringTimes(
          nextSchedule,
          aniListResult.value.items,
        )
      } else {
        nextSchedule = scheduleFromAniListSeasonal(
          aniListResult.value.items,
          aniListResult.value.airingAtById,
        )
      }
    }

    schedule.value = nextSchedule

    if (!bangumi.value.length && !trending.value.length) {
      error.value = '暂时无法连接 Bangumi 与 AniList，请检查网络或 API 配置。'
    }
    loaded.value = true
    loading.value = false
  }

  return {
    bangumi,
    trending,
    seasonal,
    featured,
    schedule,
    loading,
    loaded,
    error,
    load,
  }
})
