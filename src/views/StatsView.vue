<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import {
  PhArrowLeft,
  PhChartLineUp,
  PhCheckCircle,
  PhFlame,
  PhHourglass,
  PhPercent,
  PhStar,
} from '@phosphor-icons/vue'
import G2PlotChart from '../components/stats/G2PlotChart.vue'
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

const statusChartData = computed(() =>
  stats.value.statusBreakdown.map((item) => ({
    type: item.label,
    value: item.value,
  })),
)

const yearChartData = computed(() =>
  stats.value.yearBreakdown
    .slice()
    .reverse()
    .map((item) => ({
      year: item.label,
      value: item.value,
    })),
)

const sourceChartData = computed(() =>
  stats.value.sourceBreakdown.map((item) => ({
    type: sourceLabel(item.label),
    value: item.value,
  })),
)

const durationChartData = computed(() =>
  stats.value.finishDurationBuckets.filter((item) => item.value > 0),
)

const showDurationChart = computed(() => stats.value.finishDurationSampleSize >= 3)

const contrastChartData = computed(() =>
  stats.value.scoreContrast.map((item) => ({
    title: item.title,
    userScore: item.userScore,
    catalogScore: Number(item.catalogScore.toFixed(1)),
    delta: item.delta,
  })),
)

const showContrastChart = computed(() => stats.value.scoreContrast.length >= 3)

const tagLoyaltyChartData = computed(() => {
  const rows: { tag: string; kind: string; value: number }[] = []
  for (const row of stats.value.tagLoyalty) {
    rows.push({ tag: row.tag, kind: '开坑', value: row.started })
    rows.push({ tag: row.tag, kind: '看完', value: row.completed })
  }
  return rows
})

const showTagLoyaltyChart = computed(() => stats.value.tagLoyalty.length >= 2)

const timelineChartData = computed(() => {
  const rows: { month: string; kind: string; value: number }[] = []
  for (const point of stats.value.timeline) {
    rows.push({ month: point.month, kind: '开坑', value: point.started })
    rows.push({ month: point.month, kind: '看完', value: point.completed })
  }
  return rows
})

const showTimelineChart = computed(() => stats.value.timeline.length >= 2)

const contrastBlurb = computed(() => {
  const bias = stats.value.scoreContrastBias
  if (bias == null) return '样本不足 3 部同时有个人分与社区分。'
  if (bias > 0.4) return `你整体比社区更宽容（平均偏高 ${bias.toFixed(1)} 分）。`
  if (bias < -0.4) return `你整体比社区更挑剔（平均偏低 ${Math.abs(bias).toFixed(1)} 分）。`
  return '你的打分与社区口味大体同频。'
})

const pieOptions = {
  angleField: 'value',
  colorField: 'type',
  radius: 0.9,
  innerRadius: 0.62,
  label: false,
  legend: {
    position: 'bottom' as const,
  },
  statistic: {
    title: false,
    content: {
      style: {
        color: '#e8ece7',
        fontSize: '18px',
        fontWeight: 700,
      },
      content: '状态',
    },
  },
  interactions: [{ type: 'element-active' }],
}

const columnOptions = {
  xField: 'year',
  yField: 'value',
  columnStyle: { radius: [4, 4, 0, 0] },
  meta: { value: { alias: '作品数' } },
}

const sourcePieOptions = {
  ...pieOptions,
  statistic: {
    title: false,
    content: {
      style: {
        color: '#e8ece7',
        fontSize: '16px',
        fontWeight: 700,
      },
      content: '来源',
    },
  },
}

const durationColumnOptions = {
  xField: 'label',
  yField: 'value',
  columnStyle: { radius: [4, 4, 0, 0] },
  meta: { value: { alias: '部数' }, label: { alias: '耗时' } },
  label: {
    position: 'top' as const,
    style: { fill: '#8f9791', fontSize: 11 },
  },
}

const scatterOptions = {
  xField: 'catalogScore',
  yField: 'userScore',
  size: 6,
  shape: 'circle',
  pointStyle: { fillOpacity: 0.85 },
  meta: {
    catalogScore: { alias: '社区分', min: 0, max: 10 },
    userScore: { alias: '你的分', min: 0, max: 10 },
  },
  xAxis: {
    title: { text: '社区分', style: { fill: '#8f9791' } },
  },
  yAxis: {
    title: { text: '你的分', style: { fill: '#8f9791' } },
  },
  tooltip: {
    fields: ['title', 'userScore', 'catalogScore', 'delta'],
    formatter: (datum: Record<string, unknown>) => ({
      name: String(datum.title || ''),
      value: `你 ${datum.userScore} · 社区 ${datum.catalogScore}（Δ ${Number(datum.delta).toFixed(1)}）`,
    }),
  },
  quadrant: {
    xBaseline: 7,
    yBaseline: 7,
    lineStyle: { stroke: 'rgba(255,255,255,.12)' },
  },
}

const tagBarOptions = {
  isGroup: true,
  xField: 'value',
  yField: 'tag',
  seriesField: 'kind',
  marginRatio: 0.1,
  meta: { value: { alias: '部数' } },
  legend: { position: 'top-left' as const },
}

const timelineColumnOptions = {
  isGroup: true,
  xField: 'month',
  yField: 'value',
  seriesField: 'kind',
  columnStyle: { radius: [3, 3, 0, 0] },
  meta: { value: { alias: '部数' } },
  legend: { position: 'top-left' as const },
}
</script>

<template>
  <div class="page stats-page">
    <header class="stats-masthead">
      <div>
        <span class="stats-kicker">PERSONAL METRICS</span>
        <h1>观看统计</h1>
        <p>把追番记录读成一张有脾气的观看画像——先结论，再展开分布。</p>
      </div>
      <RouterLink class="stats-back-link" to="/library">
        <PhArrowLeft :size="17" />
        <span>回到追番库</span>
      </RouterLink>
    </header>

    <div v-if="stats.totalTitles" class="stats-content">
      <section v-if="stats.persona" class="stats-persona" aria-label="追番人格">
        <div class="stats-persona__eyebrow">WATCHER ARCHETYPE</div>
        <h2 class="stats-persona__label">{{ stats.persona.label }}</h2>
        <p class="stats-persona__blurb">{{ stats.persona.blurb }}</p>
        <ul class="stats-persona__supports">
          <li v-for="line in stats.persona.supports" :key="line">{{ line }}</li>
        </ul>
        <p v-if="stats.tagBetrayal" class="stats-persona__aside">
          半途画像：你在「{{ stats.tagBetrayal.tag }}」开坑最多、看完最少
          （完结率 {{ formatPercent(stats.tagBetrayal.finishRate) }}）。
        </p>
      </section>
      <section v-else class="stats-persona stats-persona--weak" aria-label="追番人格">
        <div class="stats-persona__eyebrow">WATCHER ARCHETYPE</div>
        <h2 class="stats-persona__label">画像还在成型</h2>
        <p class="stats-persona__blurb">
          收藏满 5 部后会生成更鲜明的追番人格标签；当前先看下方故事指标与分布。
        </p>
      </section>

      <section class="stats-summary" aria-label="故事指标">
        <article>
          <PhPercent :size="20" />
          <strong>{{ formatPercent(stats.completionTitleRate) }}</strong>
          <span>作品完结率</span>
        </article>
        <article>
          <PhFlame :size="20" />
          <strong>{{ formatPercent(stats.dropRate) }}</strong>
          <span>弃番率</span>
        </article>
        <article>
          <PhHourglass :size="20" />
          <strong>{{ stats.medianFinishDays != null ? `${stats.medianFinishDays} 天` : '—' }}</strong>
          <span>
            开完中位耗时
            <small v-if="stats.finishDurationSampleSize">
              · {{ stats.finishDurationSampleSize }} 部有日期
            </small>
          </span>
        </article>
        <article>
          <PhStar :size="20" />
          <strong>
            {{ stats.averageUserScore != null ? stats.averageUserScore.toFixed(1) : '—' }}
          </strong>
          <span>
            个人均分
            <small v-if="stats.userScoreSampleSize">· {{ stats.userScoreSampleSize }} 部</small>
            <small v-else>· 暂无个人分</small>
          </span>
        </article>
      </section>

      <section class="stats-grid stats-grid--signature" aria-label="招牌洞察">
        <article v-if="showDurationChart" class="stats-panel">
          <header class="stats-panel__header">
            <div>
              <span>FINISH PACE</span>
              <h2>开坑到看完要多久</h2>
            </div>
            <strong>中位 {{ stats.medianFinishDays }} 天</strong>
          </header>
          <G2PlotChart kind="column" :data="durationChartData" :options="durationColumnOptions" :height="220" />
        </article>
        <article v-else class="stats-panel stats-panel--muted">
          <header class="stats-panel__header">
            <div>
              <span>FINISH PACE</span>
              <h2>开坑到看完要多久</h2>
            </div>
          </header>
          <p class="stats-fallback">
            需要至少 3 部同时填写开始与完结日期。站内把作品标为「看过」时会自动记日期；AniList 导入也会带上。
          </p>
        </article>

        <article v-if="showContrastChart" class="stats-panel">
          <header class="stats-panel__header">
            <div>
              <span>TASTE DELTA</span>
              <h2>你 vs 社区</h2>
            </div>
            <strong>{{ contrastBlurb }}</strong>
          </header>
          <G2PlotChart kind="scatter" :data="contrastChartData" :options="scatterOptions" :height="240" />
        </article>
        <article v-else class="stats-panel stats-panel--muted">
          <header class="stats-panel__header">
            <div>
              <span>TASTE DELTA</span>
              <h2>你 vs 社区</h2>
            </div>
          </header>
          <p class="stats-fallback">
            {{ contrastBlurb }}
            重新同步 AniList，或在详情里为自己打分，即可点亮反差散点。
          </p>
        </article>

        <article v-if="showTagLoyaltyChart" class="stats-panel stats-panel--wide">
          <header class="stats-panel__header">
            <div>
              <span>GENRE LOYALTY</span>
              <h2>类型忠诚与半途</h2>
            </div>
            <strong v-if="stats.tagBetrayal">最半途：{{ stats.tagBetrayal.tag }}</strong>
          </header>
          <G2PlotChart kind="bar" :data="tagLoyaltyChartData" :options="tagBarOptions" :height="260" />
        </article>
      </section>

      <section class="stats-section-label" aria-hidden="true">DETAIL MAP</section>

      <section class="stats-grid" aria-label="分布明细">
        <article class="stats-panel">
          <header class="stats-panel__header">
            <div>
              <span>WATCH STATUS</span>
              <h2>观看分布</h2>
            </div>
            <strong>{{ formatPercent(stats.completionRate) }} 集数进度</strong>
          </header>
          <G2PlotChart kind="pie" :data="statusChartData" :options="pieOptions" :height="240" />
        </article>

        <article class="stats-panel">
          <header class="stats-panel__header">
            <div>
              <span>CATALOG MIX</span>
              <h2>来源构成</h2>
            </div>
          </header>
          <G2PlotChart kind="pie" :data="sourceChartData" :options="sourcePieOptions" :height="240" />
        </article>

        <article v-if="yearChartData.length" class="stats-panel">
          <header class="stats-panel__header">
            <div>
              <span>RELEASE YEARS</span>
              <h2>收藏年份</h2>
            </div>
          </header>
          <G2PlotChart kind="column" :data="yearChartData" :options="columnOptions" :height="220" />
        </article>

        <article v-if="stats.seasonPreference.length" class="stats-panel">
          <header class="stats-panel__header">
            <div>
              <span>SEASON BIAS</span>
              <h2>季节偏好</h2>
            </div>
            <strong>AniList 季度</strong>
          </header>
          <ul class="stats-list">
            <li v-for="item in stats.seasonPreference" :key="item.season">
              <span>{{ item.season }}</span>
              <strong>{{ item.value }} <small>{{ formatPercent(item.share) }}</small></strong>
            </li>
          </ul>
        </article>

        <article v-if="showTimelineChart" class="stats-panel stats-panel--wide">
          <header class="stats-panel__header">
            <div>
              <span>TIMELINE</span>
              <h2>开坑 / 看完时间轴</h2>
            </div>
            <strong>{{ stats.timeline.length }} 个月有记录</strong>
          </header>
          <G2PlotChart kind="column" :data="timelineChartData" :options="timelineColumnOptions" :height="240" />
        </article>

        <article class="stats-panel">
          <header class="stats-panel__header">
            <div>
              <span>FREQUENT TAGS</span>
              <h2>常看类型</h2>
            </div>
          </header>
          <div class="stats-tag-cloud">
            <span
              v-for="item in stats.tagBreakdown"
              :key="item.label"
              :style="{ '--tag-share': item.share }"
            >
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
            <strong>
              <PhCheckCircle :size="14" />
              {{ stats.watchedEpisodes }} / {{ stats.availableEpisodes }} 集
            </strong>
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
      </section>
    </div>

    <section v-else class="stats-empty">
      <PhChartLineUp :size="42" />
      <span>NO DATA YET</span>
      <h2>先收藏几部动画</h2>
      <p>你的观看节奏、口味反差和类型忠诚会在这里慢慢成形。</p>
      <RouterLink to="/discover">去发现动画</RouterLink>
    </section>
  </div>
</template>
