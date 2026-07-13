<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import { PhCompass, PhHouse, PhBooks, PhMagnifyingGlass, PhDownloadSimple, PhList, PhX } from '@phosphor-icons/vue'
import ImportModal from './ImportModal.vue'
import brandLogo from '../assets/MioAni2.png'

const importOpen = ref(false)
const mobileOpen = ref(false)
</script>

<template>
  <div class="app-shell">
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

    <main id="main-content"><RouterView v-slot="{ Component, route }"><Transition name="page" mode="out-in"><component :is="Component" :key="route.fullPath" /></Transition></RouterView></main>
    <footer class="site-footer"><span>MioAni</span><p>数据来自 Bangumi 与 AniList</p><div><a href="https://bangumi.tv" target="_blank">Bangumi</a><a href="https://anilist.co" target="_blank">AniList</a></div></footer>
    <ImportModal :open="importOpen" @close="importOpen = false" />
  </div>
</template>
