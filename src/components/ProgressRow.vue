<script setup lang="ts">
import { ref } from 'vue'
import { PhMinus, PhPlus, PhPlay } from '@phosphor-icons/vue'
import type { Anime } from '../types/anime'
import { useLibraryStore } from '../stores/library'

defineProps<{ anime: Anime }>()
const store = useLibraryStore()
const failed = ref(false)
</script>

<template>
  <article class="progress-row">
    <div v-if="failed || !anime.image" class="row-poster-missing">暂无海报</div>
    <img v-else :src="anime.image" :alt="`${anime.title} 海报`" @error="failed = true" />
    <div class="progress-copy">
      <div><p class="airing">{{ anime.nextEpisode || '继续观看' }}</p><h3>{{ anime.title }}</h3></div>
      <div class="progress-track" role="progressbar" :aria-valuenow="anime.watched" aria-valuemin="0" :aria-valuemax="anime.episodes">
        <span :style="{ width: `${anime.episodes ? (anime.watched / anime.episodes) * 100 : 0}%` }"></span>
      </div>
      <p class="episode-count">已看 {{ anime.watched }} / {{ anime.episodes || '?' }} 集</p>
    </div>
    <div class="stepper" aria-label="更新观看进度">
      <button type="button" aria-label="减少一集" title="减少一集" @click="store.updateProgress(anime.id, anime.watched - 1)"><PhMinus :size="16" /></button>
      <button class="play-next" type="button" aria-label="标记下一集" title="标记下一集" @click="store.updateProgress(anime.id, anime.watched + 1)"><PhPlay :size="17" weight="fill" /></button>
      <button type="button" aria-label="增加一集" title="增加一集" @click="store.updateProgress(anime.id, anime.watched + 1)"><PhPlus :size="16" /></button>
    </div>
  </article>
</template>
