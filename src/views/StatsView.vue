<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { PhArrowLeft, PhChartLineUp, PhCheckCircle, PhFilmStrip, PhHourglass, PhStar } from '@phosphor-icons/vue'
import { useLibraryStore } from '../stores/library'
import { buildLibraryStats } from '../services/libraryStats'
import { getLibraryProgress } from '../services/libraryProgress'

const store = useLibraryStore()
const stats = computed(() => buildLibraryStats(store.items))

const sourceLabels: Record<string, string> = {
  anilist: 'AniList',
  bangumi: 'Bangumi',
  local: '本地',
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function sourceLabel(value: string): string {
  return sourceLabels[value] || value
}

function progressPercent(item: typeof store.items[number]): number {
  const progress = getLibraryProgress(item)
  return progress.available ? Math.min(100, (progress.watched / progress.available) * 100) : 0
}
</script>

<template>
  <div class="page stats-page">
    <header class="stats-masthead">
      <div>
        <span class="stats-kicker">PERSONAL METRICS</span>
        <h1>观看统计</h1>
        <p>把你的追番记录整理成一张轻量的观看地图。</p>
      </div>
      <RouterLink class="stats-back-link" to="/library">
        <PhArrowLeft :size="17" />
        <span>回到追番库</span>
      </RouterLink>
    </header>

    <div v-if="stats.totalTitles" class="stats-content">
      <section class="stats-summary" aria-label="核心数据">
        <article>
          <PhFilmStrip :size="20" />
          <strong>{{ stats.totalTitles }}</strong>
          <span>收藏作品</span>
        </article>
        <article>
          <PhCheckCircle :size="20" />
          <strong>{{ stats.watchedEpisodes }}</strong>
          <span>已看集数</span>
        </article>
        <article>
          <PhHourglass :size="20" />
          <strong>{{ stats.pendingEpisodes }}</strong>
          <span>待看更新</span>
        </article>
        <article>
          <PhStar :size="20" />
          <strong>{{ stats.averageScore ? stats.averageScore.toFixed(1) : '—' }}</strong>
          <span>平均评分</span>
        </article>
      </section>

      <section class="stats-grid">
        <article class="stats-panel stats-panel--wide">
          <header class="stats-panel__header">
            <div>
              <span>WATCH STATUS</span>
              <h2>你的观看分布</h2>
            </div>
            <strong>{{ formatPercent(stats.completionRate) }} 已完成进度</strong>
          </header>
          <div class="stats-bars">
            <div v-for="item in stats.statusBreakdown" :key="item.label" class="stats-bar-row">
              <div class="stats-bar-row__meta">
                <span>{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
              </div>
              <div class="stats-bar-row__track">
                <span :style="{ width: `${Math.max(4, item.share * 100)}%` }" />
              </div>
            </div>
          </div>
        </article>

        <article class="stats-panel">
          <header class="stats-panel__header">
            <div>
              <span>CATALOG MIX</span>
              <h2>来源构成</h2>
            </div>
          </header>
          <ul class="stats-list">
            <li v-for="item in stats.sourceBreakdown" :key="item.label">
              <span>{{ sourceLabel(item.label) }}</span>
              <strong>{{ item.value }} <small>{{ formatPercent(item.share) }}</small></strong>
            </li>
          </ul>
        </article>

        <article class="stats-panel">
          <header class="stats-panel__header">
            <div>
              <span>FREQUENT TAGS</span>
              <h2>常看类型</h2>
            </div>
          </header>
          <div class="stats-tag-cloud">
            <span v-for="item in stats.tagBreakdown" :key="item.label" :style="{ '--tag-share': item.share }">
              {{ item.label }} <small>{{ item.value }}</small>
            </span>
          </div>
        </article>

        <article class="stats-panel stats-panel--wide">
          <header class="stats-panel__header">
            <div>
              <span>PROGRESS LEADERS</span>
              <h2>投入最多的作品</h2>
            </div>
            <strong>{{ stats.availableEpisodes }} 集可统计</strong>
          </header>
          <ol class="stats-leaderboard">
            <li v-for="item in stats.progressLeaders" :key="item.id">
              <div class="stats-leaderboard__copy">
                <strong>{{ item.title }}</strong>
                <span>已看 {{ item.watched }} / {{ item.episodes || '?' }} 集</span>
              </div>
              <div class="stats-leaderboard__track">
                <span :style="{ width: `${progressPercent(item)}%` }" />
              </div>
              <b>{{ formatPercent(progressPercent(item) / 100) }}</b>
            </li>
          </ol>
        </article>

        <article class="stats-panel">
          <header class="stats-panel__header">
            <div>
              <span>RELEASE YEARS</span>
              <h2>收藏年份</h2>
            </div>
          </header>
          <ul class="stats-list">
            <li v-for="item in stats.yearBreakdown" :key="item.label">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }} <small>部</small></strong>
            </li>
          </ul>
        </article>
      </section>
    </div>

    <section v-else class="stats-empty">
      <PhChartLineUp :size="42" />
      <span>NO DATA YET</span>
      <h2>先收藏几部动画</h2>
      <p>你的观看集数、类型偏好和进度会在这里慢慢形成。</p>
      <RouterLink to="/discover">去发现动画</RouterLink>
    </section>
  </div>
</template>
