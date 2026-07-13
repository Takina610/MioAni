<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhPlus, PhCheck, PhStar } from '@phosphor-icons/vue'
import type { Anime } from '../types/anime'
import { useLibraryStore } from '../stores/library'

const props = defineProps<{ anime: Anime; index?: number }>()
const store = useLibraryStore()
const failed = ref(false)
const inLibrary = computed(() => store.items.some((item) => item.id === props.anime.id))
</script>

<template>
  <article class="anime-card">
    <div class="poster-wrap">
      <div v-if="failed || !anime.image" class="poster-missing">暂无海报</div>
      <img v-else :src="anime.image" :alt="`${anime.title} 海报`" loading="lazy" @error="failed = true" />
      <span v-if="index" class="rank-number">{{ String(index).padStart(2, '0') }}</span>
      <button class="poster-action" type="button" :aria-label="inLibrary ? '已在追番库' : '加入追番库'" :title="inLibrary ? '已在追番库' : '加入追番库'" @click="store.add(anime)">
        <PhCheck v-if="inLibrary" :size="17" weight="bold" /><PhPlus v-else :size="17" weight="bold" />
      </button>
    </div>
    <div class="anime-meta">
      <h3 :title="anime.title">{{ anime.title }}</h3>
      <p><span class="source-label">{{ anime.source }}</span><span>{{ anime.year || '待定' }}</span><span v-if="anime.episodes">{{ anime.episodes }} 话</span><span v-if="anime.score" class="card-score"><PhStar :size="12" weight="fill" />{{ anime.score.toFixed(1) }}</span></p>
    </div>
  </article>
</template>
