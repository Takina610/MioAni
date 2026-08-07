<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { PhCalendarBlank, PhWarningCircle } from '@phosphor-icons/vue'
import ScheduleSection from '../components/ScheduleSection.vue'
import BackToTop from '../components/BackToTop.vue'
import { useCatalogStore } from '../stores/catalog'
import { scheduleHasContent } from '../services/schedule'

const catalog = useCatalogStore()

const days = computed(() => catalog.schedule)
const hasContent = computed(() => scheduleHasContent(days.value))
const totalCount = computed(() =>
  days.value.reduce((sum, day) => sum + day.items.length, 0),
)
const todayCount = computed(() => days.value.find((d) => d.isToday)?.items.length ?? 0)
const quarter = computed(() => {
  const date = new Date()
  return `${date.getFullYear()} Q${Math.floor(date.getMonth() / 3) + 1}`
})

onMounted(() => {
  void catalog.load()
})
</script>

<template>
  <div class="schedule-page">
    <header class="schedule-masthead">
      <div class="schedule-identity">
        <span>WEEKLY AIRING</span>
        <h1>番剧时间表</h1>
      </div>
      <div class="schedule-stats" aria-hidden="true">
        <div>
          <PhCalendarBlank :size="20" weight="duotone" />
          <strong>{{ totalCount || '—' }}</strong>
          <span>本周条目</span>
        </div>
        <div>
          <PhCalendarBlank :size="20" weight="duotone" />
          <strong>{{ todayCount || '—' }}</strong>
          <span>今日放送</span>
        </div>
        <div>
          <PhCalendarBlank :size="20" weight="duotone" />
          <strong>{{ quarter }}</strong>
          <span>当前季度</span>
        </div>
      </div>
    </header>

    <div class="schedule-page__body">
      <div v-if="catalog.loading && !catalog.loaded" class="schedule-page__state" role="status">
        正在同步放送数据…
      </div>
      <div v-else-if="catalog.error && !hasContent" class="schedule-page__state schedule-page__state--error" role="alert">
        <PhWarningCircle :size="22" weight="fill" />
        <p>{{ catalog.error }}</p>
      </div>
      <div v-else-if="!hasContent" class="schedule-page__state">
        本周暂无可用时间表，请稍后再试。
      </div>
      <ScheduleSection v-else :days="days" page />
    </div>
    <BackToTop />
  </div>
</template>
