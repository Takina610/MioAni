import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './style.css'

// Re-warm intro panels if HTML preload raced the cache (idempotent with browser disk cache).
;['/intro/panel-anime-portrait.webp', '/intro/panel-anime-beach.webp', '/intro/panel-manga-figure.webp'].forEach((src) => {
  const img = new Image()
  img.decoding = 'async'
  img.src = src
})

createApp(App).use(createPinia()).use(router).mount('#app')
