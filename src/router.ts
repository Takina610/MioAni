import { createRouter, createWebHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'
import DiscoverView from './views/DiscoverView.vue'
import LibraryView from './views/LibraryView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/discover', name: 'discover', component: DiscoverView },
    { path: '/library', name: 'library', component: LibraryView },
    // Overlay route: keeps list under the expanded card detail.
    {
      path: '/anime/:id',
      name: 'anime-detail',
      component: { template: '<div class="anime-detail-route" aria-hidden="true"></div>' },
    },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
