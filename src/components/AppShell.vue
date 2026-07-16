<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { PhCompass, PhHouse, PhBooks, PhMagnifyingGlass, PhDownloadSimple, PhList, PhX } from '@phosphor-icons/vue'
import ImportModal from './ImportModal.vue'
import AnimeDetailOverlay from './AnimeDetailOverlay.vue'
import brandLogo from '../assets/MioAni2.png'
import { useDetailOverlayStore } from '../stores/detailOverlay'
import HomeView from '../views/HomeView.vue'
import DiscoverView from '../views/DiscoverView.vue'
import LibraryView from '../views/LibraryView.vue'

const importOpen = ref(false)
const mobileOpen = ref(false)
const route = useRoute()
const detailOverlay = useDetailOverlayStore()

/** Keep the last non-detail page mounted so expand/collapse never destroys the list. */
const activeList = shallowRef<'home' | 'discover' | 'library'>('home')
const scrollY = ref(0)

const listMap = {
  home: HomeView,
  discover: DiscoverView,
  library: LibraryView,
} as const

function listKeyFromRouteName(name: unknown): 'home' | 'discover' | 'library' {
  if (name === 'discover') return 'discover'
  if (name === 'library') return 'library'
  return 'home'
}

watch(
  () => route.name,
  (name, prev) => {
    if (name === 'home' || name === 'discover' || name === 'library') {
      activeList.value = listKeyFromRouteName(name)
    }

    // Enter detail: freeze list scroll position.
    if (name === 'anime-detail' && prev !== 'anime-detail') {
      scrollY.value = window.scrollY
      document.body.style.top = `-${scrollY.value}px`
      document.body.classList.add('detail-scroll-lock')
    }

    // Leave detail via browser back: run full reverse animation first.
    if (prev === 'anime-detail' && name !== 'anime-detail') {
      if (detailOverlay.open && detailOverlay.phase !== 'collapsing') {
        detailOverlay.requestClose()
      }
    }
  },
  { immediate: true },
)

// Unlock list scroll only after overlay fully closed.
watch(
  () => detailOverlay.open,
  (isOpen, wasOpen) => {
    if (wasOpen && !isOpen) {
      document.body.classList.remove('detail-scroll-lock')
      document.body.style.top = ''
      requestAnimationFrame(() => {
        window.scrollTo({ top: scrollY.value, behavior: 'instant' as ScrollBehavior })
      })
    }
  },
)

onMounted(() => {
  // If app boots on detail URL, remember a sensible list underlay.
  if (route.name === 'anime-detail') {
    activeList.value = listKeyFromRouteName(detailOverlay.returnPath.includes('/library')
      ? 'library'
      : detailOverlay.returnPath.includes('/discover')
        ? 'discover'
        : 'home')
  }
})

onUnmounted(() => {
  document.body.classList.remove('detail-scroll-lock')
  document.body.style.top = ''
})

// Keep returnPath list component in sync when opening from a card.
watch(
  () => detailOverlay.returnPath,
  (path) => {
    if (!path || route.name === 'anime-detail') {
      if (path.includes('/library')) activeList.value = 'library'
      else if (path.includes('/discover')) activeList.value = 'discover'
      else if (path === '/' || path.startsWith('/?')) activeList.value = 'home'
    }
  },
)
</script>

<template>
  <div class="app-shell" :class="{ 'has-detail-overlay': detailOverlay.open || route.name === 'anime-detail' }">
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <header class="topbar">
      <RouterLink class="brand" to="/" aria-label="MioAni 首页">
        <img class="brand-logo" :src="brandLogo" alt="MioAni" height="56" />
      </RouterLink>

      <nav :class="['main-nav', { 'is-open': mobileOpen }]" aria-label="主导航">
        <RouterLink to="/" @click="mobileOpen = false"><PhHouse :size="18" />首页</RouterLink>
        <RouterLink to="/discover" @click="mobileOpen = false"><PhCompass :size="18" />发现</RouterLink>
        <RouterLink to="/library" @click="mobileOpen = false"><PhBooks :size="18" />追番库</RouterLink>
      </nav>

      <div class="top-actions">
        <RouterLink class="search-shortcut" to="/discover"><PhMagnifyingGlass :size="18" /><span>搜索</span><kbd>/</kbd></RouterLink>
        <button class="import-button" type="button" @click="importOpen = true"><PhDownloadSimple :size="18" />导入</button>
        <button class="menu-button" type="button" aria-label="切换菜单" @click="mobileOpen = !mobileOpen"><PhX v-if="mobileOpen" :size="22" /><PhList v-else :size="22" /></button>
      </div>
    </header>

    <main id="main-content">
      <!-- Always keep one list page mounted (even under /anime/:id) so cards never unmount. -->
      <KeepAlive :max="3">
        <component :is="listMap[activeList]" :key="activeList" />
      </KeepAlive>
    </main>
    <footer class="site-footer"><span>MioAni</span><p>数据来自 Bangumi 与 AniList</p><div><a href="https://bangumi.tv" target="_blank">Bangumi</a><a href="https://anilist.co" target="_blank">AniList</a></div></footer>
    <ImportModal :open="importOpen" @close="importOpen = false" />
    <AnimeDetailOverlay />
  </div>
</template>
