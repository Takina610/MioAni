<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import gsap from 'gsap'
import { PhArrowRight, PhPause, PhPlay, PhSparkle, PhWarningCircle } from '@phosphor-icons/vue'
import AnimeCard from '../components/AnimeCard.vue'
import ProgressRow from '../components/ProgressRow.vue'
import { useCatalogStore } from '../stores/catalog'
import { useLibraryStore } from '../stores/library'
import type { Anime } from '../types/anime'

const catalog = useCatalogStore()
const library = useLibraryStore()
const activeTab = ref<'hot' | 'all'>('hot')
const activeIndex = ref(0)
const copyIndex = ref(0)
const isAnimating = ref(false)
const isAutoplayPaused = ref(false)
const pendingIndex = ref<number | null>(null)
const POSTER_EXIT_SCALE = 0.28

const heroRef = ref<HTMLElement | null>(null)
const foreRef = ref<HTMLElement | null>(null)
const posterRef = ref<HTMLElement | null>(null)
const posterImgRef = ref<HTMLImageElement | null>(null)
const nextLayerRef = ref<HTMLElement | null>(null)
const nextImgRef = ref<HTMLImageElement | null>(null)
const bridgeRef = ref<HTMLElement | null>(null)
const bridgeImgRef = ref<HTMLImageElement | null>(null)
const focusBridgeRef = ref<HTMLElement | null>(null)
const focusBridgeImgRef = ref<HTMLImageElement | null>(null)
const foreCopyRef = ref<HTMLElement | null>(null)
const ambientARef = ref<HTMLElement | null>(null)
const ambientBRef = ref<HTMLElement | null>(null)
const ambientActive = ref<'a' | 'b'>('a')
let autoplayTween: gsap.core.Tween | null = null
let wasPlayingBeforeHidden = false
let heroParallaxFrame: number | null = null
let reducedMotionQuery: MediaQueryList | null = null

const slides = computed(() => catalog.seasonal.slice(0, 8))
const feature = computed(() => slides.value[activeIndex.value] || catalog.featured)
const copyFeature = computed(() => slides.value[copyIndex.value] || catalog.featured)
const visualIndex = computed(() => pendingIndex.value ?? activeIndex.value)
const nextFeature = computed(() => {
  const list = slides.value
  if (list.length < 2) return null
  return list[(activeIndex.value + 1) % list.length]
})
const hotAnime = computed(() => catalog.seasonal.slice(0, 10))
const directory = computed(() => activeTab.value === 'hot' ? hotAnime.value : catalog.seasonal)
const quarter = computed(() => {
  const date = new Date()
  return `${date.getFullYear()} Q${Math.floor(date.getMonth() / 3) + 1}`
})

function mediaOf(anime: Anime | null | undefined) {
  if (!anime) return ''
  return anime.banner || anime.image
}

function updateHeroParallax() {
  heroParallaxFrame = null
  const hero = heroRef.value
  if (!hero) return

  if (reducedMotionQuery?.matches) {
    hero.style.setProperty('--hero-scroll-progress', '0')
    return
  }

  const rect = hero.getBoundingClientRect()
  const activeDistance = rect.height * 0.75
  const progress = activeDistance > 0
    ? Math.max(0, Math.min(1, window.scrollY / activeDistance))
    : 0
  hero.style.setProperty('--hero-scroll-progress', progress.toFixed(4))
}

function scheduleHeroParallax() {
  if (heroParallaxFrame !== null) return
  heroParallaxFrame = window.requestAnimationFrame(updateHeroParallax)
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function play(tl: gsap.core.Timeline) {
  return new Promise<void>((resolve) => {
    tl.eventCallback('onComplete', () => resolve())
  })
}

function loadImage(src: string) {
  return new Promise<void>((resolve) => {
    if (!src) {
      resolve()
      return
    }
    const img = new Image()
    const done = () => resolve()
    img.onload = done
    img.onerror = done
    img.src = src
    if (img.complete) resolve()
  })
}

async function waitImg(el: HTMLImageElement | null | undefined, timeout = 800) {
  if (!el) return
  if (el.complete && el.naturalWidth > 0) return
  await Promise.race([
    new Promise<void>((resolve) => {
      const done = () => {
        el.removeEventListener('load', done)
        el.removeEventListener('error', done)
        resolve()
      }
      el.addEventListener('load', done)
      el.addEventListener('error', done)
    }),
    wait(timeout),
  ])
}

function hideBridgeLayers() {
  const layers = [bridgeRef.value, focusBridgeRef.value]
  const images = [bridgeImgRef.value, focusBridgeImgRef.value]

  layers.forEach((layer, index) => {
    if (!layer) return
    gsap.set(layer, {
      autoAlpha: 0,
      left: 0,
      top: 0,
      width: '100%',
      height: '100%',
      borderRadius: 0,
      boxShadow: 'none',
      zIndex: index === 0 ? 2 : 5,
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      clearProps: 'transform,transformOrigin',
    })
  })

  images.forEach((image) => {
    if (!image) return
    gsap.set(image, { clearProps: 'opacity,visibility,filter' })
    image.removeAttribute('src')
  })
}

function collectCopyRevealTargets(copy = foreCopyRef.value) {
  if (!copy) return []
  return Array.from(copy.querySelectorAll<HTMLElement>('[data-hero-reveal]'))
}

function resetCopyRevealTargets(copy = foreCopyRef.value) {
  if (!copy) return
  const targets = collectCopyRevealTargets(copy)
  if (targets.length) {
    gsap.set(targets, {
      clearProps: 'opacity,visibility,transform,transformOrigin',
    })
  }
}

async function playPersistentCopySwitch(copy: HTMLElement, next: number) {
  const outgoing = collectCopyRevealTargets(copy)
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (!reducedMotion && outgoing.length) {
    const exit = gsap.timeline()
    exit.to(outgoing, {
      autoAlpha: 0,
      yPercent: -38,
      scale: 0.98,
      duration: 0.16,
      stagger: 0.01,
      ease: 'power2.in',
    }, 0)
    await play(exit)
  } else if (outgoing.length) {
    gsap.set(outgoing, { autoAlpha: 0 })
  }

  copyIndex.value = next
  await nextTick()

  const incoming = collectCopyRevealTargets(copy)
  if (!incoming.length) return

  if (reducedMotion) {
    resetCopyRevealTargets(copy)
    return
  }

  gsap.set(incoming, {
    autoAlpha: 0,
    yPercent: 55,
    scale: 0.92,
    transformOrigin: 'left bottom',
  })

  const enter = gsap.timeline()
  enter.to(incoming, {
    autoAlpha: 1,
    yPercent: 0,
    scale: 1,
    duration: 0.42,
    stagger: 0.045,
    ease: 'power3.out',
  }, 0)
  await play(enter)
  resetCopyRevealTargets(copy)
}

function progressFillAt(index: number) {
  return heroRef.value?.querySelector<HTMLElement>(
    `.hero-carousel-indicator[data-index="${index}"] .hero-carousel-progress`,
  ) || null
}

function resetAutoplayProgress() {
  heroRef.value?.querySelectorAll<HTMLElement>('.hero-carousel-progress').forEach((fill) => {
    gsap.set(fill, { scaleX: 0 })
  })
}

function stopAutoplayProgress(reset = false) {
  autoplayTween?.kill()
  autoplayTween = null
  if (reset) resetAutoplayProgress()
}

function startAutoplayProgress() {
  stopAutoplayProgress(true)
  if (
    slides.value.length < 2
    || isAutoplayPaused.value
    || isAnimating.value
    || document.hidden
  ) return

  const fill = progressFillAt(activeIndex.value)
  if (!fill) return

  autoplayTween = gsap.to(fill, {
    scaleX: 1,
    duration: 6.2,
    ease: 'none',
    onComplete: () => {
      autoplayTween = null
      nextSlide()
    },
  })
}

async function finishHeroTransition() {
  pendingIndex.value = null
  await nextTick()
  isAnimating.value = false
  startAutoplayProgress()
}

function toggleAutoplay() {
  isAutoplayPaused.value = !isAutoplayPaused.value
  if (isAutoplayPaused.value) {
    autoplayTween?.pause()
    return
  }

  if (autoplayTween) {
    if (!document.hidden) autoplayTween.resume()
    return
  }

  if (!isAnimating.value) startAutoplayProgress()
}

function handleVisibilityChange() {
  if (document.hidden) {
    wasPlayingBeforeHidden = Boolean(autoplayTween && !autoplayTween.paused())
    if (wasPlayingBeforeHidden) autoplayTween?.pause()
    return
  }

  const shouldResume = wasPlayingBeforeHidden
  wasPlayingBeforeHidden = false
  if (isAutoplayPaused.value) return

  if (shouldResume && autoplayTween) {
    autoplayTween.resume()
  } else if (!autoplayTween && !isAnimating.value) {
    startAutoplayProgress()
  }
}

function crossfadeAmbient(url: string): gsap.core.Timeline {
  const a = ambientARef.value
  const b = ambientBRef.value
  if (!a || !b || !url) return gsap.timeline()

  void loadImage(url)
  const showB = ambientActive.value === 'a'
  const incoming = showB ? b : a
  const outgoing = showB ? a : b

  incoming.style.backgroundImage = `url(${url})`
  gsap.set(incoming, { autoAlpha: 0 })
  gsap.set(outgoing, { autoAlpha: (gsap.getProperty(outgoing, 'autoAlpha') as number) || 1 })

  return gsap.timeline({
    onComplete: () => {
      ambientActive.value = showB ? 'b' : 'a'
    },
  })
    .to(incoming, { autoAlpha: 1, duration: 1.0, ease: 'power2.out' }, 0)
    .to(outgoing, { autoAlpha: 0, duration: 1.0, ease: 'power2.out' }, 0)
}

/** 预换 Next Layer 为新的 Upcoming；返回可并入 Leave 的时间轴（同步，不 await） */
function prepareNextLayer(nextAnime: Anime | null): gsap.core.Timeline | null {
  const layer = nextLayerRef.value
  const img = nextImgRef.value
  if (!layer || !img) return null

  if (!nextAnime) {
    return gsap.timeline().to(layer, { autoAlpha: 0, duration: 0.4, ease: 'power2.out' }, 0)
  }

  const url = mediaOf(nextAnime)
  void loadImage(url)
  img.src = url

  gsap.set(layer, { autoAlpha: 0 })

  return gsap.timeline()
    .to(layer, {
      autoAlpha: 1,
      duration: 1.0,
      ease: 'power2.out',
    }, 0)
}

async function goTo(index: number) {
  if (isAnimating.value || !slides.value.length) return
  const next = ((index % slides.value.length) + slides.value.length) % slides.value.length
  if (next === activeIndex.value) return
  const target = slides.value[next]
  if (!target) return

  stopAutoplayProgress(true)
  pendingIndex.value = next
  isAnimating.value = true
  await nextTick()

  const hero = heroRef.value
  const poster = posterRef.value
  const fore = foreRef.value
  const bridge = bridgeRef.value
  const bridgeImg = bridgeImgRef.value
  const focusBridge = focusBridgeRef.value
  const focusBridgeImg = focusBridgeImgRef.value
  const outgoingCopy = foreCopyRef.value
  if (!hero || !poster || !fore || !bridge || !bridgeImg || !focusBridge || !focusBridgeImg || !outgoingCopy) {
    copyIndex.value = next
    activeIndex.value = next
    await nextTick()
    resetCopyRevealTargets(outgoingCopy)
    if (poster) gsap.set(poster, { clearProps: 'opacity,visibility,transform,transformOrigin' })
    if (fore) gsap.set(fore, { clearProps: 'opacity,visibility,transform,zIndex' })
    hideBridgeLayers()
    await finishHeroTransition()
    return
  }

  const posterUrl = target.image
  const ambientUrl = mediaOf(target)
  const upcoming = slides.value[(next + 1) % slides.value.length] || null

  void Promise.all([
    loadImage(posterUrl),
    loadImage(ambientUrl),
    upcoming ? loadImage(mediaOf(upcoming)) : Promise.resolve(),
  ])

  gsap.set(poster, { clearProps: 'opacity,visibility,transform,transformOrigin' })
  const heroBox = hero.getBoundingClientRect()
  const posterBox = poster.getBoundingClientRect()
  const copyBox = outgoingCopy.getBoundingClientRect()
  const from = { left: 0, top: 0, width: heroBox.width, height: heroBox.height }
  const to = {
    left: posterBox.left - heroBox.left,
    top: posterBox.top - heroBox.top,
    width: posterBox.width,
    height: posterBox.height,
  }
  const scaledPosterInset = posterBox.width * (1 - POSTER_EXIT_SCALE) / 2
  const isStackedLayout = window.innerWidth <= 760
  const exitGap = isStackedLayout
    ? Math.max(16, Math.min(20, heroBox.width * 0.05))
    : Math.max(16, Math.min(24, heroBox.width * 0.016))
  const desiredPosterEdge = isStackedLayout
    ? heroBox.left + exitGap
    : copyBox.left - exitGap
  const posterExitX = isStackedLayout
    ? desiredPosterEdge - posterBox.left - scaledPosterInset
    : desiredPosterEdge - posterBox.right + scaledPosterInset

  // 两层 Bridge 使用相同图片和几何轨迹：Depth 保持后景质感，Focus 在后半程聚焦接管。
  bridgeImg.src = posterUrl
  focusBridgeImg.src = posterUrl
  const fromCx = from.left + from.width / 2
  const fromCy = from.top + from.height / 2
  const toCx = to.left + to.width / 2
  const toCy = to.top + to.height / 2
  const startScaleX = from.width / to.width
  const startScaleY = from.height / to.height
  const startX = fromCx - toCx
  const startY = fromCy - toCy
  const bridgeLayout = {
    left: to.left,
    top: to.top,
    width: to.width,
    height: to.height,
    borderRadius: 0,
    boxShadow: 'none',
    overflow: 'hidden',
    transformOrigin: '50% 50%',
    x: startX,
    y: startY,
    scaleX: startScaleX,
    scaleY: startScaleY,
  }
  gsap.set(bridge, {
    ...bridgeLayout,
    autoAlpha: 1,
    zIndex: 2,
  })
  gsap.set(focusBridge, {
    ...bridgeLayout,
    autoAlpha: 0,
    zIndex: 5,
  })
  gsap.set(bridgeImg, {
    autoAlpha: 1,
    filter: 'blur(3px) saturate(.95) brightness(.78)',
  })
  gsap.set(focusBridgeImg, {
    autoAlpha: 1,
    filter: 'blur(3px) saturate(.95) brightness(.78)',
  })

  if (nextLayerRef.value) gsap.set(nextLayerRef.value, { autoAlpha: 0 })

  const nextSwapTl = prepareNextLayer(upcoming)
  const ambientTl = crossfadeAmbient(ambientUrl)

  const leave = gsap.timeline({ defaults: { ease: 'power2.inOut' } })

  leave.to(poster, {
    xPercent: 0,
    x: posterExitX,
    scale: POSTER_EXIT_SCALE,
    transformOrigin: '50% 50%',
    duration: 0.78,
    ease: 'power2.inOut',
  }, 0)
  leave.to(poster, {
    autoAlpha: 0,
    duration: 0.36,
    ease: 'power2.in',
  }, 0.42)

  const bridgeMotion = {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    borderRadius: 12,
    duration: 1.0,
  }

  leave.to(bridge, {
    ...bridgeMotion,
    boxShadow: '0 40px 110px rgba(0,0,0,0.55)',
  }, 0)

  leave.to(focusBridge, bridgeMotion, 0)
  leave.to(focusBridge, {
    autoAlpha: 1,
    duration: 0.45,
    ease: 'sine.inOut',
  }, 0.55)
  leave.to(focusBridgeImg, {
    filter: 'blur(0px) saturate(1) brightness(1)',
    duration: 0.45,
    ease: 'sine.inOut',
  }, 0.55)

  if (nextSwapTl) {
    const nextSwapOffset = 0.08
    nextSwapTl.duration(1.0 - nextSwapOffset)
    leave.add(nextSwapTl as gsap.core.Timeline, nextSwapOffset)
  }
  if (ambientTl) leave.add(ambientTl as gsap.core.Timeline, 0)

  const bridgePromise = play(leave)
  const copyPromise = playPersistentCopySwitch(outgoingCopy, next)
  await Promise.all([bridgePromise, copyPromise])

  // Handoff 只更新正式海报与轮播语义；持久 Copy 已在同一批节点中完成切换。
  activeIndex.value = next
  await nextTick()

  const posterImg = posterImgRef.value
  if (posterImg && posterImg.src !== posterUrl && !posterImg.src.endsWith(posterUrl)) {
    posterImg.src = posterUrl
  }

  const newFore = foreRef.value
  const newPoster = posterRef.value

  if (newPoster) gsap.set(newPoster, { clearProps: 'opacity,visibility,transform,transformOrigin' })
  if (newFore) gsap.set(newFore, { clearProps: 'opacity,visibility,transform,zIndex' })
  resetCopyRevealTargets()

  hideBridgeLayers()
  await finishHeroTransition()
}

function nextSlide() {
  goTo(activeIndex.value + 1)
}

function initAmbient() {
  const url = mediaOf(feature.value)
  if (ambientARef.value && url) {
    ambientARef.value.style.backgroundImage = `url(${url})`
    gsap.set(ambientARef.value, { autoAlpha: 1 })
  }
  if (ambientBRef.value) gsap.set(ambientBRef.value, { autoAlpha: 0 })
  ambientActive.value = 'a'
}

function initNextLayer() {
  const anime = nextFeature.value
  const layer = nextLayerRef.value
  const img = nextImgRef.value
  if (!layer || !img || !anime) return
  const url = mediaOf(anime)
  img.src = url
  // 不阻塞：有缓存立刻显示；加载完再确保可见
  gsap.set(layer, { autoAlpha: 1, clearProps: 'filter' })
  void waitImg(img, 1200).then(() => {
    gsap.set(layer, { autoAlpha: 1 })
  })
}

watch(slides, (list) => {
  if (!list.length) return
  if (activeIndex.value >= list.length) activeIndex.value = 0
  if (copyIndex.value >= list.length) copyIndex.value = activeIndex.value
  // 数据到达后初始化后景（onMounted 时数据可能还没回来）
  nextTick(() => {
    initAmbient()
    initNextLayer()
    startAutoplayProgress()
  })
})

// 数据首次到达时初始化双缓冲底图 + Next Layer
watch(feature, (f) => {
  if (!f || isAnimating.value) return
  nextTick(() => {
    initAmbient()
    initNextLayer()
    scheduleHeroParallax()
  })
})

onMounted(() => {
  catalog.load()
  hideBridgeLayers()
  reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotionQuery.addEventListener('change', scheduleHeroParallax)
  window.addEventListener('scroll', scheduleHeroParallax, { passive: true })
  window.addEventListener('resize', scheduleHeroParallax)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  scheduleHeroParallax()
  // feature 可能尚未加载；watch 会在数据到达后补初始化
  nextTick(() => {
    if (feature.value) {
      initAmbient()
      initNextLayer()
      startAutoplayProgress()
    }
  })
})

onUnmounted(() => {
  stopAutoplayProgress(true)
  window.removeEventListener('scroll', scheduleHeroParallax)
  window.removeEventListener('resize', scheduleHeroParallax)
  reducedMotionQuery?.removeEventListener('change', scheduleHeroParallax)
  reducedMotionQuery = null
  if (heroParallaxFrame !== null) {
    window.cancelAnimationFrame(heroParallaxFrame)
    heroParallaxFrame = null
  }
  heroRef.value?.style.removeProperty('--hero-scroll-progress')
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<template>
  <div class="page home-page">
    <section v-if="catalog.loading && !feature" class="home-loading" aria-label="正在加载真实番剧数据">
      <div class="loading-copy"><span></span><i></i><i></i><i></i></div><div class="loading-poster"></div>
    </section>

    <section v-else-if="catalog.error && !feature" class="api-error">
      <PhWarningCircle :size="34" /><h1>暂时没有取到番剧数据</h1><p>{{ catalog.error }}</p><button type="button" @click="catalog.load(true)">重新连接</button>
    </section>

    <template v-else-if="feature">
      <section
        ref="heroRef"
        class="hero-carousel"
        aria-roledescription="carousel"
        :aria-label="`本季推荐轮播，第 ${activeIndex + 1} / ${Math.max(slides.length, 1)} 部`"
      >
        <!-- 环境底图双缓冲，交叉淡入避免硬切 -->
        <div class="hero-depth" aria-hidden="true">
          <div ref="ambientARef" class="hero-depth-current hero-ambient"></div>
          <div ref="ambientBRef" class="hero-depth-current hero-ambient"></div>
        </div>

        <!-- 静态后景：src 由 JS 控制，避免 Vue 绑定硬切 -->
        <div
          v-show="slides.length > 1"
          ref="nextLayerRef"
          class="hero-depth-next"
          aria-hidden="true"
        >
          <img ref="nextImgRef" class="hero-depth-next-img" alt="" />
        </div>

        <!-- Depth Bridge：Veil 下方保持后景质感 -->
        <div ref="bridgeRef" class="hero-bridge" aria-hidden="true">
          <img ref="bridgeImgRef" class="hero-bridge-img" alt="" />
        </div>

        <!-- Focus Bridge：Veil 上方在后半程渐入并恢复清晰 -->
        <div ref="focusBridgeRef" class="hero-focus-bridge" aria-hidden="true">
          <img ref="focusBridgeImgRef" class="hero-focus-bridge-img" alt="" />
        </div>

        <div class="hero-bg-veil" aria-hidden="true"></div>
        <div class="hero-grid-lines" aria-hidden="true"></div>

        <div class="hero-status">
          <span>{{ quarter }}</span>
          <span>{{ catalog.seasonal.length }} 部新番在线</span>
        </div>

        <div class="hero-stage">
          <article ref="foreRef" class="hero-fore">
            <div
              v-if="copyFeature"
              ref="foreCopyRef"
              class="hero-fore-copy"
              :inert="isAnimating"
              :aria-hidden="isAnimating ? 'true' : undefined"
            >
              <div class="hero-copy-window hero-copy-window--kicker">
                <p class="hero-kicker hero-copy-line" data-hero-reveal><PhSparkle :size="16" weight="fill" /> REAL-TIME ANIME INDEX</p>
              </div>
              <div class="hero-copy-window hero-copy-window--rank">
                <span class="hero-rank hero-copy-line" data-hero-reveal>NO. {{ String(copyIndex + 1).padStart(2, '0') }} / {{ copyFeature.source }}</span>
              </div>
              <div class="hero-copy-window hero-copy-window--title">
                <h1 class="hero-copy-line" data-hero-reveal>{{ copyFeature.title }}</h1>
              </div>
              <div
                class="hero-copy-window hero-copy-window--original"
                :class="{ 'hero-copy-window--empty': !copyFeature.originalTitle || copyFeature.originalTitle === copyFeature.title }"
              >
                <h2
                  v-show="copyFeature.originalTitle && copyFeature.originalTitle !== copyFeature.title"
                  class="hero-copy-line"
                  data-hero-reveal
                >{{ copyFeature.originalTitle }}</h2>
              </div>
              <div class="hero-copy-window hero-copy-window--summary">
                <p class="hero-summary hero-copy-line" data-hero-reveal>{{ copyFeature.summary || '这一季，别错过真正想看的故事。' }}</p>
              </div>
              <div class="hero-copy-window hero-copy-window--meta">
                <div class="hero-meta hero-copy-line" data-hero-reveal>
                  <small v-if="copyFeature.score">SCORE {{ copyFeature.score.toFixed(1) }}</small>
                  <small v-if="copyFeature.year">{{ copyFeature.year }}</small>
                  <small v-if="copyFeature.season">{{ copyFeature.season }}</small>
                  <small v-if="copyFeature.episodes">{{ copyFeature.episodes }} EP</small>
                </div>
              </div>
              <div class="hero-copy-window hero-copy-window--actions">
                <div class="hero-actions hero-copy-line" data-hero-reveal>
                  <RouterLink to="/discover">探索本季动画<PhArrowRight :size="18" /></RouterLink>
                </div>
              </div>
            </div>
            <div ref="posterRef" class="hero-fore-poster">
              <img ref="posterImgRef" :src="feature.image" :alt="`${feature.title} 海报`" />
            </div>
          </article>
        </div>

        <div v-if="slides.length > 1" class="hero-carousel-controls" role="group" aria-label="推荐轮播控制">
          <button
            type="button"
            class="hero-autoplay-toggle"
            :aria-label="isAutoplayPaused ? '继续自动轮播' : '暂停自动轮播'"
            :aria-pressed="isAutoplayPaused"
            @click="toggleAutoplay"
          >
            <PhPlay v-if="isAutoplayPaused" :size="16" weight="fill" aria-hidden="true" />
            <PhPause v-else :size="16" weight="fill" aria-hidden="true" />
          </button>
          <div class="hero-carousel-indicators" role="tablist" aria-label="选择推荐番剧">
            <button
              v-for="(item, index) in slides"
              :key="item.id"
              type="button"
              role="tab"
              class="hero-carousel-indicator"
              :class="{ active: index === visualIndex }"
              :data-index="index"
              :aria-selected="index === activeIndex"
              :aria-current="index === activeIndex ? 'true' : undefined"
              :aria-label="`切换到 ${item.title}`"
              :disabled="isAnimating"
              @click="goTo(index)"
            >
              <span class="hero-carousel-track" aria-hidden="true">
                <span class="hero-carousel-progress"></span>
              </span>
            </button>
          </div>
        </div>
      </section>

      <section v-if="library.watching.length" class="content-section continue-section reveal-section">
        <div class="section-heading"><div><span>YOUR QUEUE</span><h2>继续观看</h2></div><RouterLink to="/library">打开追番库<PhArrowRight :size="16" /></RouterLink></div>
        <div class="progress-list"><ProgressRow v-for="anime in library.watching.slice(0, 3)" :key="anime.id" :anime="anime" /></div>
      </section>

      <section class="season-directory reveal-section">
        <div class="directory-head">
          <div><span>SEASON DIRECTORY</span><h2>这一季的全部动画</h2><p>优先使用 Bangumi 当前季度放送目录，接口不可用时自动展示 AniList 同季度数据。</p></div>
          <div class="directory-tabs" role="tablist" aria-label="季度动画筛选">
            <button type="button" :class="{ active: activeTab === 'hot' }" @click="activeTab = 'hot'">热门 <sup>{{ hotAnime.length }}</sup></button>
            <button type="button" :class="{ active: activeTab === 'all' }" @click="activeTab = 'all'">全部新番 <sup>{{ catalog.seasonal.length }}</sup></button>
          </div>
        </div>
        <TransitionGroup name="list" tag="div" class="catalog-grid directory-grid">
          <AnimeCard v-for="(anime, index) in directory" :key="anime.id" :anime="anime" :index="index + 1" />
        </TransitionGroup>
      </section>

      <section class="closing-band reveal-section">
        <div><PhPlay :size="20" weight="fill" /><span>BUILD YOUR OWN QUEUE</span></div><h2>不跟着热度走。<br />只留下你想看的。</h2><RouterLink to="/library">进入我的追番库<PhArrowRight :size="18" /></RouterLink>
      </section>
    </template>
  </div>
</template>
