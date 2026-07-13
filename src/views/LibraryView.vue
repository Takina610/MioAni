<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { PhBooks, PhCheck, PhClock, PhPlay, PhArrowRight } from '@phosphor-icons/vue'
import AnimeCard from '../components/AnimeCard.vue'
import { useLibraryStore } from '../stores/library'

const store = useLibraryStore()
const tab = ref<'all' | 'watching' | 'completed' | 'planned'>('all')
const displayed = computed(() => tab.value === 'all' ? store.items : store.items.filter((item) => item.status === tab.value))
const tabs = [
  { id: 'all', label: '全部' }, { id: 'watching', label: '在看' }, { id: 'completed', label: '看过' }, { id: 'planned', label: '想看' },
] as const
</script>

<template>
  <div class="page library-page">
    <section class="library-masthead">
      <div class="library-identity"><span>PERSONAL ARCHIVE</span><h1>{{ store.profile.name === '未登录' ? '我的追番库' : `${store.profile.name} 的追番库` }}</h1><p>{{ store.profile.sources.length ? `已连接 ${store.profile.sources.join(' / ')}` : '导入 Bangumi 或 AniList 账号，开始建立自己的动画档案。' }}</p></div>
      <div class="library-stats">
        <div><PhPlay :size="19" /><strong>{{ store.watching.length }}</strong><span>在看</span></div>
        <div><PhCheck :size="19" /><strong>{{ store.completed.length }}</strong><span>看过</span></div>
        <div><PhClock :size="19" /><strong>{{ store.watchedEpisodes }}</strong><span>集数</span></div>
      </div>
    </section>

    <section class="content-section library-content">
      <div class="library-toolbar"><div class="library-tabs" role="tablist"><button v-for="item in tabs" :key="item.id" type="button" :class="{ active: tab === item.id }" @click="tab = item.id">{{ item.label }}<sup>{{ item.id === 'all' ? store.items.length : store.items.filter(anime => anime.status === item.id).length }}</sup></button></div><span>{{ displayed.length }} 部作品</span></div>
      <div v-if="displayed.length" class="catalog-grid library-grid"><AnimeCard v-for="(anime, index) in displayed" :key="anime.id" :anime="anime" :index="index + 1" /></div>
      <div v-else class="library-empty"><div class="empty-symbol"><PhBooks :size="42" /></div><span>NO ENTRIES</span><h2>{{ store.items.length ? '这个分类还是空的' : '这里还没有你的动画' }}</h2><p>{{ store.items.length ? '切换其他分类查看收藏。' : '通过右上角导入账号，或从发现页逐部加入。' }}</p><RouterLink to="/discover">浏览真实番剧数据<PhArrowRight :size="17" /></RouterLink></div>
    </section>
  </div>
</template>
