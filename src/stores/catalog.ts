import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  emptyWeekSchedule,
  fetchAniListSeasonalDetailed,
  fetchBangumiCalendarDetailed,
  scheduleFromAniListSeasonal,
  type AniListSeasonalResult,
  type BangumiCalendarResult,
} from '../services/anime'
import { readCatalogCache, writeCatalogCache } from '../services/catalogCache'
import type { Anime } from '../types/anime'
import type { ScheduleDay } from '../types/schedule'
import { enrichScheduleWithAiringTimes, scheduleHasContent } from '../services/schedule'

const HOME_SOURCE_TIMEOUT_MS = 5000
const ANILIST_FIRST_WAVE_LIMIT = 50
const ANILIST_ENRICH_LIMIT = 100

function createTimeoutSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  }
}

function hasDisplayableCatalog(bangumiList: Anime[], trendingList: Anime[]) {
  return bangumiList.length > 0 || trendingList.length > 0
}

export const useCatalogStore = defineStore('catalog', () => {
  const bangumi = ref<Anime[]>([])
  const trending = ref<Anime[]>([])
  const schedule = ref<ScheduleDay[]>(emptyWeekSchedule())
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref('')
  /**
   * Only prefer Bangumi in the UI after a **live** calendar success this session.
   * Cached BGM often carries lain.bgm.tv covers that break without a proxy in CN.
   */
  const bangumiLive = ref(false)

  const featured = computed(() =>
    bangumiLive.value && bangumi.value[0] ? bangumi.value[0] : trending.value[0],
  )
  const seasonal = computed(() =>
    bangumiLive.value && bangumi.value.length ? bangumi.value : trending.value,
  )

  function markReady() {
    if (
      !loaded.value
      && (trending.value.length > 0 || (bangumiLive.value && bangumi.value.length > 0))
    ) {
      loaded.value = true
    }
  }

  function applyBangumi(result: BangumiCalendarResult, aniListItems?: Anime[]) {
    bangumi.value = result.flat
    bangumiLive.value = result.flat.length > 0 || scheduleHasContent(result.schedule)
    if (scheduleHasContent(result.schedule)) {
      schedule.value = aniListItems?.length
        ? enrichScheduleWithAiringTimes(result.schedule, aniListItems)
        : result.schedule
    }
    markReady()
  }

  function applyAniList(result: AniListSeasonalResult) {
    trending.value = result.items
    if (bangumiLive.value && scheduleHasContent(schedule.value) && bangumi.value.length) {
      schedule.value = enrichScheduleWithAiringTimes(schedule.value, result.items)
    } else {
      schedule.value = scheduleFromAniListSeasonal(result.items, result.airingAtById)
    }
    markReady()
  }

  /** Live Bangumi unreachable — never keep preferring cached BGM covers. */
  function dropUnreachableBangumi(aniList?: AniListSeasonalResult | null) {
    bangumiLive.value = false
    bangumi.value = []
    if (aniList?.items.length) {
      applyAniList(aniList)
      return
    }
    if (trending.value.length) {
      // Drop BGM-backed schedule slots so the rail does not keep dead CDN images.
      schedule.value = emptyWeekSchedule()
      markReady()
    }
  }

  function persistCache() {
    if (!hasDisplayableCatalog(bangumi.value, trending.value)) return
    writeCatalogCache({
      bangumi: bangumiLive.value ? bangumi.value : [],
      trending: trending.value,
      schedule: schedule.value,
    })
  }

  function hydrateFromCache() {
    const cached = readCatalogCache()
    if (!cached) return false
    // Keep cached bangumi for potential live merge, but do not mark live —
    // seasonal/featured use AniList until BGM calendar succeeds this session.
    bangumi.value = cached.bangumi
    bangumiLive.value = false
    trending.value = cached.trending
    if (cached.trending.length) {
      // Prefer schedule that does not depend on BGM image hosts when we only hydrate.
      const fromCache = cached.schedule.length ? cached.schedule : emptyWeekSchedule()
      const scheduleLooksBangumi = fromCache.some((day) =>
        day.items.some((item) => item.anime.source === 'bangumi'),
      )
      schedule.value =
        scheduleLooksBangumi && cached.trending.length ? emptyWeekSchedule() : fromCache
    } else {
      schedule.value = cached.schedule.length ? cached.schedule : emptyWeekSchedule()
    }
    if (trending.value.length || bangumi.value.length) {
      // loaded for intro: need displayable seasonal — trending or we'll wait for network
      if (trending.value.length) loaded.value = true
    }
    error.value = ''
    return true
  }

  async function runBackgroundEnrich(hadBangumi: boolean) {
    try {
      if (hadBangumi) {
        const merged = await fetchBangumiCalendarDetailed({ mergeOnAir: true })
        if (merged.flat.length) {
          bangumi.value = merged.flat
          bangumiLive.value = true
          if (scheduleHasContent(merged.schedule)) {
            schedule.value = trending.value.length
              ? enrichScheduleWithAiringTimes(merged.schedule, trending.value)
              : merged.schedule
          }
        }
      }

      if (trending.value.length > 0 && trending.value.length < ANILIST_ENRICH_LIMIT) {
        const enrich = await fetchAniListSeasonalDetailed(ANILIST_ENRICH_LIMIT)
        if (enrich.items.length) {
          trending.value = enrich.items
          if (bangumiLive.value && scheduleHasContent(schedule.value) && bangumi.value.length) {
            schedule.value = enrichScheduleWithAiringTimes(schedule.value, enrich.items)
          } else if (!bangumiLive.value) {
            schedule.value = scheduleFromAniListSeasonal(enrich.items, enrich.airingAtById)
          }
        }
      }

      persistCache()
    } catch {
      // Background enrich is best-effort.
    }
  }

  async function revalidate() {
    loading.value = true
    error.value = ''

    const bgmTimeout = createTimeoutSignal(HOME_SOURCE_TIMEOUT_MS)
    const alTimeout = createTimeoutSignal(HOME_SOURCE_TIMEOUT_MS)

    const bangumiPromise = fetchBangumiCalendarDetailed({
      mergeOnAir: false,
      signal: bgmTimeout.signal,
    }).finally(bgmTimeout.clear)

    const aniListPromise = fetchAniListSeasonalDetailed(ANILIST_FIRST_WAVE_LIMIT, {
      signal: alTimeout.signal,
    }).finally(alTimeout.clear)

    let bangumiApplied = false
    let lastAniList: AniListSeasonalResult | null = null

    const onBangumi = bangumiPromise.then(
      (result) => {
        bangumiApplied = result.flat.length > 0 || scheduleHasContent(result.schedule)
        applyBangumi(result, trending.value.length ? trending.value : undefined)
        return result
      },
      () => {
        dropUnreachableBangumi(lastAniList)
        bangumiApplied = false
        return null
      },
    )

    const onAniList = aniListPromise.then(
      (result) => {
        lastAniList = result
        applyAniList(result)
        return result
      },
      () => null,
    )

    await Promise.allSettled([onBangumi, onAniList])

    if (!bangumiApplied) {
      dropUnreachableBangumi(lastAniList)
    }

    if (!trending.value.length && !(bangumiLive.value && bangumi.value.length)) {
      error.value = '暂时无法连接 Bangumi 与 AniList，请检查网络或 API 配置。'
      loaded.value = true
    } else {
      error.value = ''
      markReady()
      persistCache()
      void runBackgroundEnrich(bangumiApplied)
    }

    loading.value = false
  }

  async function load(force = false) {
    if (loading.value) return
    // In-memory hit: skip network. SWR revalidate only on cold start (cache hydrate path).
    if (loaded.value && !force) return

    if (!loaded.value) {
      hydrateFromCache()
    }

    await revalidate()
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
