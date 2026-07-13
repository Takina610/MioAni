import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { fetchAniListSeasonal, fetchBangumiCalendar } from '../services/anime'
import type { Anime } from '../types/anime'

export const useCatalogStore = defineStore('catalog', () => {
  const bangumi = ref<Anime[]>([])
  const trending = ref<Anime[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref('')
  const featured = computed(() => bangumi.value[0] || trending.value[0])
  const seasonal = computed(() => bangumi.value.length ? bangumi.value : trending.value)

  async function load(force = false) {
    if ((loaded.value && !force) || loading.value) return
    loading.value = true
    error.value = ''
    const [bangumiResult, aniListResult] = await Promise.allSettled([
      fetchBangumiCalendar(),
      fetchAniListSeasonal(50),
    ])
    if (bangumiResult.status === 'fulfilled') bangumi.value = bangumiResult.value
    if (aniListResult.status === 'fulfilled') trending.value = aniListResult.value
    if (!bangumi.value.length && !trending.value.length) error.value = '暂时无法连接 Bangumi 与 AniList，请检查网络或 API 配置。'
    loaded.value = true
    loading.value = false
  }

  return { bangumi, trending, seasonal, featured, loading, loaded, error, load }
})
