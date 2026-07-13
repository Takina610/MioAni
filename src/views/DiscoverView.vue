<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PhMagnifyingGlass, PhWarningCircle } from '@phosphor-icons/vue'
import AnimeCard from '../components/AnimeCard.vue'
import { searchAnime } from '../services/anime'
import { useCatalogStore } from '../stores/catalog'
import type { Anime } from '../types/anime'

const catalog = useCatalogStore()
const query = ref('')
const results = ref<Anime[]>([])
const loading = ref(false)
const error = ref('')
const hasSearch = ref(false)
const displayed = computed(() => hasSearch.value ? results.value : catalog.trending)
onMounted(() => catalog.load())

async function search() {
  if (!query.value.trim()) { hasSearch.value = false; results.value = []; return }
  loading.value = true; error.value = ''; hasSearch.value = true
  try { results.value = await searchAnime(query.value.trim()) }
  catch (reason) { error.value = reason instanceof Error ? reason.message : '搜索失败' }
  finally { loading.value = false }
}
</script>

<template>
  <div class="page discover-page">
    <section class="discover-masthead">
      <div><span>DISCOVER / DATABASE</span><h1>从数万部动画里，<br />找到下一部。</h1></div>
      <form class="search-box" @submit.prevent="search"><PhMagnifyingGlass :size="22" /><input v-model="query" aria-label="搜索动画" placeholder="输入中文、日文或英文标题" /><button type="submit">跨源搜索</button></form>
    </section>

    <section class="content-section search-results">
      <div class="results-title"><div><span>{{ hasSearch ? 'SEARCH RESULT' : 'ANILIST TRENDING' }}</span><h2>{{ hasSearch ? `“${query}”` : '全球趋势榜' }}</h2></div><p>{{ displayed.length }} 条真实数据</p></div>
      <div v-if="loading || (!catalog.loaded && !hasSearch)" class="catalog-grid skeleton-grid"><div v-for="index in 12" :key="index" class="skeleton-card"><span></span><i></i><i></i></div></div>
      <div v-else-if="error || catalog.error" class="error-state"><PhWarningCircle :size="32" /><h3>暂时无法获取目录</h3><p>{{ error || catalog.error }}</p><button type="button" @click="hasSearch ? search() : catalog.load(true)">重新尝试</button></div>
      <TransitionGroup v-else-if="displayed.length" name="list" tag="div" class="catalog-grid"><AnimeCard v-for="(anime, index) in displayed" :key="anime.id" :anime="anime" :index="index + 1" /></TransitionGroup>
      <div v-else class="empty-state"><PhMagnifyingGlass :size="30" /><h3>没有找到对应作品</h3><p>试试原文标题，或减少搜索关键词。</p></div>
    </section>
  </div>
</template>
