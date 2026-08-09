import { createRouter, createWebHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'

const DiscoverView = () => import('./views/DiscoverView.vue')
const LibraryView = () => import('./views/LibraryView.vue')
const ScheduleView = () => import('./views/ScheduleView.vue')
const StatsView = () => import('./views/StatsView.vue')

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/discover', name: 'discover', component: DiscoverView },
    { path: '/schedule', name: 'schedule', component: ScheduleView },
    { path: '/library', name: 'library', component: LibraryView },
    { path: '/stats', name: 'stats', component: StatsView },
    // Overlay route: keeps list under the expanded card detail.
    {
      path: '/anime/:id',
      name: 'anime-detail',
      component: { template: '<div class="anime-detail-route" aria-hidden="true"></div>' },
    },
    {
      path: '/character/:id',
      name: 'character-detail',
      component: { template: '<div class="person-detail-route" aria-hidden="true"></div>' },
    },
    {
      path: '/person/:id',
      name: 'person-detail',
      component: { template: '<div class="person-detail-route" aria-hidden="true"></div>' },
    },
  ],
  scrollBehavior(to, from) {
    // Detail open/close must not reset the underlay list scroll position.
    const detailNames = new Set(['anime-detail', 'character-detail', 'person-detail'])
    if (detailNames.has(String(to.name)) || detailNames.has(String(from.name))) {
      return false
    }
    return { top: 0 }
  },
})
