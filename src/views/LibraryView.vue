<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { PhBooks, PhCheck, PhClock, PhPlay, PhArrowRight } from '@phosphor-icons/vue'
import AnimeCard from '../components/AnimeCard.vue'
import { useLibraryStore } from '../stores/library'
const store = useLibraryStore()
type LibraryTab = 'all' | 'watching' | 'completed' | 'planned'

const PAGE_SIZE = 24
const tab = ref<LibraryTab>('all')
const visibleCount = ref(PAGE_SIZE)
const loadingMore = ref(false)
const tabsRef = ref<HTMLElement | null>(null)
const sentinelRef = ref<HTMLElement | null>(null)
const indicatorStyle = ref({ width: '0px', transform: 'translateX(0px)' })
let observer: IntersectionObserver | null = null
let loadTimer: ReturnType<typeof setTimeout> | null = null

const filtered = computed(() =>
  tab.value === 'all' ? store.items : store.items.filter((item) => item.status === tab.value),
)
const displayed = computed(() => filtered.value.slice(0, visibleCount.value))
const hasMore = computed(() => visibleCount.value < filtered.value.length)

const tabs = [
  { id: 'all', label: '全部' },
  { id: 'watching', label: '在看' },
  { id: 'completed', label: '看过' },
  { id: 'planned', label: '想看' },
] as const

function tabCount(id: LibraryTab) {
  if (id === 'all') return store.items.length
  return store.items.filter((anime) => anime.status === id).length
}

function updateIndicator() {
  const root = tabsRef.value
  if (!root) return
  const active = root.querySelector<HTMLElement>('button.active')
  if (!active) {
    indicatorStyle.value = { width: '0px', transform: 'translateX(0px)' }
    return
  }
  indicatorStyle.value = {
    width: `${active.offsetWidth}px`,
    transform: `translateX(${active.offsetLeft}px)`,
  }
}

function setTab(next: LibraryTab) {
  if (next === tab.value) return
  if (loadTimer) {
    clearTimeout(loadTimer)
    loadTimer = null
  }
  loadingMore.value = false
  tab.value = next
  visibleCount.value = PAGE_SIZE
}

function loadMore() {
  if (!hasMore.value || loadingMore.value) return
  loadingMore.value = true
  // Brief visual feedback; data is local so keep it short.
  loadTimer = setTimeout(() => {
    visibleCount.value = Math.min(visibleCount.value + PAGE_SIZE, filtered.value.length)
    loadingMore.value = false
    loadTimer = null
  }, 220)
}

function setupObserver() {
  observer?.disconnect()
  if (!sentinelRef.value) return
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore()
    },
    { rootMargin: '280px 0px' },
  )
  observer.observe(sentinelRef.value)
}

watch(tab, async () => {
  await nextTick()
  updateIndicator()
  setupObserver()
})

watch(
  () => store.items.length,
  async () => {
    // Keep current window if possible when list mutates (add/remove).
    visibleCount.value = Math.min(
      Math.max(visibleCount.value, PAGE_SIZE),
      Math.max(filtered.value.length, PAGE_SIZE),
    )
    if (visibleCount.value > filtered.value.length) {
      visibleCount.value = Math.max(filtered.value.length, PAGE_SIZE)
    }
    await nextTick()
    updateIndicator()
    setupObserver()
  },
)

watch(sentinelRef, () => setupObserver())

onMounted(() => {
  updateIndicator()
  setupObserver()
  window.addEventListener('resize', updateIndicator)
})

onUnmounted(() => {
  observer?.disconnect()
  if (loadTimer) clearTimeout(loadTimer)
  window.removeEventListener('resize', updateIndicator)
})
</script>

<template>
  <div class="page library-page">
    <section class="library-masthead">
      <div class="library-identity">
        <span>PERSONAL ARCHIVE</span>
        <h1>{{ store.profile.name === '未登录' ? '我的追番库' : `${store.profile.name} 的追番库` }}</h1>
        <p>
          {{
            store.profile.sources.length
              ? `已连接 ${store.profile.sources.join(' / ')}`
              : '导入 Bangumi 或 AniList 账号，开始建立自己的动画档案。'
          }}
        </p>
      </div>
      <div class="library-stats">
        <div>
          <PhPlay :size="18" />
          <strong>{{ store.watching.length }}</strong>
          <span>在看</span>
        </div>
        <div>
          <PhCheck :size="18" />
          <strong>{{ store.completed.length }}</strong>
          <span>看过</span>
        </div>
        <div>
          <PhClock :size="18" />
          <strong>{{ store.watchedEpisodes }}</strong>
          <span>集数</span>
        </div>
      </div>
    </section>

    <section class="content-section library-content">
      <div class="library-toolbar">
        <div ref="tabsRef" class="library-tabs" role="tablist" aria-label="追番分类">
          <button
            v-for="item in tabs"
            :key="item.id"
            type="button"
            role="tab"
            :aria-selected="tab === item.id"
            :class="{ active: tab === item.id }"
            @click="setTab(item.id)"
          >
            {{ item.label }}
            <sup>{{ tabCount(item.id) }}</sup>
          </button>
          <span class="library-tabs__indicator" :style="indicatorStyle" aria-hidden="true" />
        </div>
        <span>{{ displayed.length }}{{ hasMore ? ` / ${filtered.length}` : '' }} 部作品</span>
      </div>

      <div v-if="filtered.length" :key="tab" class="catalog-grid library-grid">
        <AnimeCard
          v-for="(anime, index) in displayed"
          :key="anime.id"
          :anime="anime"
          :index="index + 1"
        />
      </div>
      <div v-else class="library-empty">
        <div class="empty-symbol"><PhBooks :size="42" /></div>
        <span>NO ENTRIES</span>
        <h2>{{ store.items.length ? '这个分类还是空的' : '这里还没有你的动画' }}</h2>
        <p>
          {{
            store.items.length
              ? '切换其他分类查看收藏。'
              : '通过右上角导入账号，或从发现页逐部加入。'
          }}
        </p>
        <RouterLink to="/discover">浏览真实番剧数据<PhArrowRight :size="17" /></RouterLink>
      </div>

      <div
        v-if="filtered.length && hasMore"
        ref="sentinelRef"
        class="library-sentinel"
        aria-hidden="true"
      />

      <div v-if="loadingMore" class="load-more-status" aria-busy="true">
        <span class="load-more-dot" />
        加载更多…
      </div>
      <div v-else-if="filtered.length && !hasMore" class="load-more-status muted">
        已显示全部 {{ filtered.length }} 部
      </div>
    </section>
  </div>
</template>
