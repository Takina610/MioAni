<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { PhCompass, PhHouse, PhBooks, PhMagnifyingGlass, PhDownloadSimple } from '@phosphor-icons/vue'
import ImportModal from './ImportModal.vue'
import AnimeDetailOverlay from './AnimeDetailOverlay.vue'
import PersonDetailOverlay from './PersonDetailOverlay.vue'
import brandLogo from '../assets/MioAni2.png'
import { useDetailOverlayStore } from '../stores/detailOverlay'
import { usePersonOverlayStore } from '../stores/personOverlay'
import HomeView from '../views/HomeView.vue'
import DiscoverView from '../views/DiscoverView.vue'
import LibraryView from '../views/LibraryView.vue'

type ListKey = 'home' | 'discover' | 'library'

const importOpen = ref(false)
const mobileOpen = ref(false)
const route = useRoute()
const detailOverlay = useDetailOverlayStore()
const personOverlay = usePersonOverlayStore()

const PERSON_ROUTES = new Set(['character-detail', 'person-detail'])
const DETAIL_ROUTES = new Set(['anime-detail', 'character-detail', 'person-detail'])

/** Last non-detail list page shown under the overlay. */
const activeList = shallowRef<ListKey>('home')
/** Once visited, stay mounted forever so open/close detail never destroys list state. */
const mountedLists = reactive<Record<ListKey, boolean>>({
  home: false,
  discover: false,
  library: false,
})
/** Scroll Y frozen when entering detail; restored only after overlay fully closes. */
const scrollY = ref(0)
const scrollByList = reactive<Record<ListKey, number>>({
  home: 0,
  discover: 0,
  library: 0,
})
/** Soft topbar re-entry when leaving anime detail for a list page. */
const returningFromDetail = ref(false)
let returnChromeTimer: ReturnType<typeof setTimeout> | null = null

function markReturningFromDetail() {
  returningFromDetail.value = true
  if (returnChromeTimer) clearTimeout(returnChromeTimer)
  returnChromeTimer = setTimeout(() => {
    returningFromDetail.value = false
    returnChromeTimer = null
  }, 560)
}

function listKeyFromRouteName(name: unknown): ListKey {
  if (name === 'discover') return 'discover'
  if (name === 'library') return 'library'
  return 'home'
}

function listKeyFromPath(path: string): ListKey {
  if (path.includes('/library')) return 'library'
  if (path.includes('/discover')) return 'discover'
  return 'home'
}

function ensureMounted(key: ListKey) {
  mountedLists[key] = true
}

function showList(key: ListKey) {
  if (activeList.value !== key && !document.body.classList.contains('detail-scroll-lock')) {
    scrollByList[activeList.value] = window.scrollY
  }
  activeList.value = key
  ensureMounted(key)
}

function lockListScroll() {
  scrollY.value = window.scrollY
  scrollByList[activeList.value] = scrollY.value
  document.body.style.top = `-${scrollY.value}px`
  document.body.classList.add('detail-scroll-lock')
}

function unlockListScroll() {
  document.body.classList.remove('detail-scroll-lock')
  document.body.style.top = ''
  const y = scrollByList[activeList.value] || scrollY.value || 0
  requestAnimationFrame(() => {
    window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior })
  })
}

watch(
  () => route.name,
  (name, prev) => {
    if (name === 'home' || name === 'discover' || name === 'library') {
      // While overlay is still closing after browser back, keep underlay list fixed.
      if (!(detailOverlay.open && prev === 'anime-detail')) {
        showList(listKeyFromRouteName(name))
      }
    }

    // Enter anime detail (not from person sub-page): freeze list scroll.
    if (name === 'anime-detail' && prev !== 'anime-detail' && !PERSON_ROUTES.has(String(prev))) {
      const underlay = listKeyFromPath(detailOverlay.returnPath || '')
      showList(underlay)
      lockListScroll()
    }

    // Enter person detail while anime is open: keep list locked; do not close anime.
    if (PERSON_ROUTES.has(String(name)) && !PERSON_ROUTES.has(String(prev))) {
      if (!document.body.classList.contains('detail-scroll-lock')) {
        lockListScroll()
      }
    }

    // Leave person back to anime: keep anime overlay; ignore as list leave.
    if (PERSON_ROUTES.has(String(prev)) && name === 'anime-detail') {
      return
    }

    // Leave person to list without anime: close person overlay.
    if (PERSON_ROUTES.has(String(prev)) && !DETAIL_ROUTES.has(String(name))) {
      if (personOverlay.open) personOverlay.close()
    }

    // Leave anime detail via browser back to a list page only (not person).
    if (prev === 'anime-detail' && !DETAIL_ROUTES.has(String(name))) {
      if (name === 'home' || name === 'discover' || name === 'library') {
        ensureMounted(listKeyFromRouteName(name))
        activeList.value = listKeyFromRouteName(name)
      }
      if (
        detailOverlay.open
        && detailOverlay.phase !== 'collapsing'
        && detailOverlay.phase !== 'returning'
      ) {
        detailOverlay.requestClose()
      }
    }
  },
  { immediate: true },
)

// Unlock list scroll + soft topbar re-entry only after overlay fully closed.
watch(
  () => detailOverlay.open,
  (isOpen, wasOpen) => {
    if (wasOpen && !isOpen) {
      markReturningFromDetail()
      unlockListScroll()
    }
  },
)

// Keep underlay list pinned to the page the card opened from.
watch(
  () => detailOverlay.returnPath,
  (path) => {
    if (!path) return
    if (route.name === 'anime-detail' || detailOverlay.open) {
      showList(listKeyFromPath(path))
    }
  },
)

onMounted(() => {
  if (route.name === 'anime-detail') {
    showList(listKeyFromPath(detailOverlay.returnPath || '/'))
  } else if (route.name === 'home' || route.name === 'discover' || route.name === 'library') {
    showList(listKeyFromRouteName(route.name))
  } else {
    ensureMounted('home')
  }
})

onUnmounted(() => {
  document.body.classList.remove('detail-scroll-lock')
  document.body.style.top = ''
  if (returnChromeTimer) clearTimeout(returnChromeTimer)
})
</script>

<template>
  <div
    class="app-shell"
    :class="{
      'has-detail-overlay': detailOverlay.open || personOverlay.open || DETAIL_ROUTES.has(String(route.name)),
      'is-returning-from-detail': returningFromDetail,
    }"
  >
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <header class="topbar">
      <RouterLink class="brand" to="/" aria-label="MioAni 首页">
        <img class="brand-logo" :src="brandLogo" alt="MioAni" height="56" />
      </RouterLink>

      <nav :class="['main-nav', { 'is-open': mobileOpen }]" aria-label="主导航">
        <div class="main-nav__panel">
          <RouterLink to="/" @click="mobileOpen = false"><PhHouse :size="18" />首页</RouterLink>
          <RouterLink to="/discover" @click="mobileOpen = false"><PhCompass :size="18" />发现</RouterLink>
          <RouterLink to="/library" @click="mobileOpen = false"><PhBooks :size="18" />追番库</RouterLink>
        </div>
      </nav>

      <div class="top-actions">
        <RouterLink class="search-shortcut" to="/discover"><PhMagnifyingGlass :size="18" /><span>搜索</span><kbd>/</kbd></RouterLink>
        <button class="import-button" type="button" @click="importOpen = true"><PhDownloadSimple :size="18" />导入</button>
        <button
          class="menu-button"
          type="button"
          :class="{ 'is-open': mobileOpen }"
          :aria-expanded="mobileOpen"
          :aria-label="mobileOpen ? '关闭菜单' : '打开菜单'"
          @click="mobileOpen = !mobileOpen"
        >
          <span class="menu-button__icon" aria-hidden="true">
            <i class="menu-button__line menu-button__line--top" />
            <i class="menu-button__line menu-button__line--mid" />
            <i class="menu-button__line menu-button__line--bot" />
          </span>
        </button>
      </div>
    </header>

    <main id="main-content" class="list-stage">
      <!-- Visited list pages stay mounted; CSS opacity crossfade on switch. -->
      <div
        class="list-layer"
        data-list="home"
        :class="{ 'is-active': activeList === 'home' }"
        :aria-hidden="activeList !== 'home'"
      >
        <HomeView v-if="mountedLists.home" />
      </div>
      <div
        class="list-layer"
        data-list="discover"
        :class="{ 'is-active': activeList === 'discover' }"
        :aria-hidden="activeList !== 'discover'"
      >
        <DiscoverView v-if="mountedLists.discover" />
      </div>
      <div
        class="list-layer"
        data-list="library"
        :class="{ 'is-active': activeList === 'library' }"
        :aria-hidden="activeList !== 'library'"
      >
        <LibraryView v-if="mountedLists.library" />
      </div>
    </main>
    <footer class="site-footer"><span>MioAni</span><p>数据来自 Bangumi 与 AniList</p><div><a href="https://bangumi.tv" target="_blank">Bangumi</a><a href="https://anilist.co" target="_blank">AniList</a></div></footer>
    <ImportModal :open="importOpen" @close="importOpen = false" />
    <AnimeDetailOverlay />
    <PersonDetailOverlay />
  </div>
</template>
