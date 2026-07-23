<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import gsap from 'gsap'
import { PhArrowRight, PhPause, PhPlay, PhSparkle, PhWarningCircle } from '@phosphor-icons/vue'
import AnimeCard from '../components/AnimeCard.vue'
import { useCatalogStore } from '../stores/catalog'
import { useLibraryStore } from '../stores/library'
import type { Anime } from '../types/anime'
import mangaPanelAnimePortrait from '../assets/manga-intro/panel-anime-portrait.png'
import mangaPanelAnimeBeach from '../assets/manga-intro/panel-anime-beach.jpg'
import mangaPanelMangaFigure from '../assets/manga-intro/panel-manga-figure.jpg'

const INTRO_COPY = [
  'INKING FRAME 01',
  'CUTTING IMPACT PANELS',
  'SYNCING KEY FRAMES',
  'READY / IMPACT',
] as const
const INTRO_WAIT_COPY = [
  'VERIFYING REMOTE CATALOG',
  'DECODING SEASON ARTWORK',
  'SYNCING BANGUMI / ANILIST',
  'STABILIZING VISUAL CHANNEL',
] as const
const INTRO_WAIT_PROGRESS_LIMIT = 98.4
const INTRO_WAIT_STATUS_INTERVAL = 2200
// Free anime/manga-style panels from Wikimedia Commons (CC BY-SA) so the intro never waits on the catalog API.
const MANGA_INTRO_PANELS = [
  { src: mangaPanelAnimePortrait, label: 'ANIME / PORTRAIT' },
  { src: mangaPanelAnimeBeach, label: 'ANIME / SUMMER FRAME' },
  { src: mangaPanelMangaFigure, label: 'MANGA / FIGURE' },
] as const
const INTRO_CRITICAL_ASSETS = MANGA_INTRO_PANELS.map((item) => item.src)

const catalog = useCatalogStore()
const library = useLibraryStore()
const route = useRoute()
const activeIndex = ref(0)
const copyIndex = ref(0)
const isAnimating = ref(false)
const isAutoplayPaused = ref(false)
const pendingIndex = ref<number | null>(null)
const POSTER_EXIT_SCALE = 0.28
const IMAGE_READY_TIMEOUT = 8000
const INTRO_ASSET_TIMEOUT = 4500
let introAssetsPromise: Promise<boolean[]> | null = null

const introVisible = ref(true)
const introStatus = ref<string>(INTRO_COPY[0])
const introEntryDone = ref(false)
const introIsFinishing = ref(false)
const introWaiting = ref(false)
const introRootRef = ref<HTMLElement | null>(null)
const introProgressBarRef = ref<HTMLElement | null>(null)
const introPercentRef = ref<HTMLOutputElement | null>(null)
let introTimeline: gsap.core.Timeline | null = null
let introContext: gsap.Context | null = null
let introWaitingTween: gsap.core.Tween | null = null
let introWaitingStatusTimer: number | null = null
let introWaitingStatusIndex = 0
let introGeneration = 0

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

const slides = computed(() => catalog.seasonal.slice(0, 8))
const feature = computed(() => slides.value[activeIndex.value] || catalog.featured)
const copyFeature = computed(() => slides.value[copyIndex.value] || catalog.featured)
const visualIndex = computed(() => pendingIndex.value ?? activeIndex.value)
const nextFeature = computed(() => {
  const list = slides.value
  if (list.length < 2) return null
  return list[(activeIndex.value + 1) % list.length]
})
const hotAnime = computed(() => catalog.seasonal.slice(0, 12))
const quarter = computed(() => {
  const date = new Date()
  return `${date.getFullYear()} Q${Math.floor(date.getMonth() / 3) + 1}`
})

function setIntroDocumentState(active: boolean) {
  document.body.classList.toggle('intro-active', active)
  const shell = document.querySelector<HTMLElement>('.app-shell')
  if (shell) shell.inert = active
}

function updateIntroProgress(value: number) {
  const progress = Math.max(0, Math.min(100, value))
  if (introProgressBarRef.value) {
    introProgressBarRef.value.dataset.progress = String(progress)
    gsap.set(introProgressBarRef.value, { scaleX: progress / 100 })
  }
  if (introPercentRef.value) {
    introPercentRef.value.value = `${Math.round(progress).toString().padStart(3, '0')}%`
  }
}

function addIntroProgressTween(
  timeline: gsap.core.Timeline,
  target: number,
  position: number | string,
  duration: number,
) {
  const progress = {
    value: Number(introProgressBarRef.value?.dataset.progress || 0),
  }
  timeline.to(progress, {
    value: target,
    duration,
    ease: 'power2.out',
    onUpdate: () => updateIntroProgress(progress.value),
  }, position)
}

function setIntroStatus(step: number) {
  introStatus.value = INTRO_COPY[step] || INTRO_COPY[0]
}

function stopIntroWaitingState() {
  introWaiting.value = false
  introWaitingTween?.kill()
  introWaitingTween = null
  if (introWaitingStatusTimer !== null) {
    window.clearInterval(introWaitingStatusTimer)
    introWaitingStatusTimer = null
  }
  introWaitingStatusIndex = 0
}

function scheduleIntroWaitingProgress(generation: number) {
  if (
    generation !== introGeneration
    || !introWaiting.value
    || catalog.loaded
    || introIsFinishing.value
  ) return

  const current = Number(introProgressBarRef.value?.dataset.progress || 84)
  const remaining = Math.max(0, INTRO_WAIT_PROGRESS_LIMIT - current)
  const target = Math.min(
    INTRO_WAIT_PROGRESS_LIMIT,
    current + Math.max(0.08, remaining * 0.18),
  )

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    updateIntroProgress(target)
    introWaitingTween = gsap.delayedCall(1.4, () => scheduleIntroWaitingProgress(generation))
    return
  }

  const progress = { value: current }
  introWaitingTween = gsap.to(progress, {
    value: target,
    duration: 1.2,
    delay: 0.18,
    ease: 'sine.inOut',
    onUpdate: () => updateIntroProgress(progress.value),
    onComplete: () => {
      introWaitingTween = null
      scheduleIntroWaitingProgress(generation)
    },
  })
}

function startIntroWaitingState(generation: number) {
  if (
    generation !== introGeneration
    || introWaiting.value
    || catalog.loaded
    || introIsFinishing.value
  ) return

  introWaiting.value = true
  introWaitingStatusIndex = 0
  const rotateStatus = () => {
    if (generation !== introGeneration || !introWaiting.value || catalog.loaded) return
    introStatus.value = INTRO_WAIT_COPY[introWaitingStatusIndex % INTRO_WAIT_COPY.length]
    introWaitingStatusIndex += 1
  }
  rotateStatus()
  introWaitingStatusTimer = window.setInterval(rotateStatus, INTRO_WAIT_STATUS_INTERVAL)
  scheduleIntroWaitingProgress(generation)
}

function createIntroEntryTimeline(generation: number) {
  const timeline = gsap.timeline({
    defaults: { ease: 'expo.out' },
    onComplete: () => markIntroEntryDone(generation),
  })
  timeline
    .fromTo('.manga-speedlines', { autoAlpha: 0, scale: 1.4 }, { autoAlpha: 0.72, scale: 1, duration: 0.52 }, 0)
    .fromTo('.manga-panel', {
      autoAlpha: 0,
      xPercent: (index) => [-120, 0, 120][index] || 0,
      yPercent: (index) => [18, -100, 24][index] || 0,
      rotate: (index) => [-8, 4, 7][index] || 0,
      scale: 1.12,
    }, {
      autoAlpha: 1,
      xPercent: 0,
      yPercent: 0,
      rotate: 0,
      scale: 1,
      duration: 0.72,
      stagger: 0.09,
    }, 0.18)
    .fromTo('.manga-impact-word span', { xPercent: -120, skewX: -18 }, { xPercent: 0, skewX: 0, duration: 0.55 }, 0.68)
    .fromTo('.manga-impact-word strong', { xPercent: 120, skewX: 18 }, { xPercent: 0, skewX: 0, duration: 0.55 }, 0.72)
    .fromTo('.manga-slash', { scaleX: 0, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.48 }, 1.08)
    .fromTo('.intro-manga .intro-scene-copy', { y: 22, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5 }, 1.26)
    .call(() => setIntroStatus(1), [], 0.66)
    .call(() => setIntroStatus(2), [], 1.52)
  addIntroProgressTween(timeline, 84, 0.08, 2.45)
  return timeline
}

function createIntroFinishTimeline(generation: number) {
  const root = introRootRef.value
  const timeline = gsap.timeline({
    defaults: { ease: 'power3.inOut' },
    onComplete: () => {
      if (generation !== introGeneration) return
      introVisible.value = false
      introIsFinishing.value = false
      setIntroDocumentState(false)
    },
  })
  setIntroStatus(3)
  addIntroProgressTween(timeline, 100, 0, 0.42)
  timeline
    .to('.manga-panel', {
      xPercent: (index) => [-145, 0, 145][index] || 0,
      yPercent: (index) => [25, -150, 28][index] || 0,
      rotate: (index) => [-10, 5, 10][index] || 0,
      duration: 0.66,
      stagger: 0.035,
    }, 0.32)
    .to('.manga-impact-word span', { xPercent: -130, duration: 0.48 }, 0.38)
    .to('.manga-impact-word strong', { xPercent: 130, duration: 0.48 }, 0.38)
    .to('.manga-slash', {
      filter: 'brightness(1.65)',
      boxShadow: '0 0 90px rgba(184,240,95,.72)',
      duration: 0.1,
      yoyo: true,
      repeat: 1,
    }, 0.62)
    .to(root, { autoAlpha: 0, scale: 1.04, duration: 0.34 }, 0.78)
  return timeline
}

function markIntroEntryDone(generation: number) {
  if (generation !== introGeneration) return
  introEntryDone.value = true
  if (!catalog.loaded) startIntroWaitingState(generation)
  void maybeFinishIntro(generation)
}

async function maybeFinishIntro(generation: number) {
  if (
    generation !== introGeneration
    || !introVisible.value
    || !introEntryDone.value
    || !catalog.loaded
    || introIsFinishing.value
  ) return

  introIsFinishing.value = true
  stopIntroWaitingState()
  await nextTick()
  if (generation !== introGeneration || !introRootRef.value) return

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    setIntroStatus(3)
    updateIntroProgress(100)
    introVisible.value = false
    introIsFinishing.value = false
    setIntroDocumentState(false)
    return
  }

  introTimeline = createIntroFinishTimeline(generation)
}

async function playIntro() {
  const generation = ++introGeneration
  stopIntroWaitingState()
  introTimeline?.kill()
  introContext?.revert()
  introContext = null
  introTimeline = null
  introStatus.value = INTRO_COPY[0]
  introEntryDone.value = false
  introIsFinishing.value = false
  introVisible.value = true
  setIntroDocumentState(true)

  // Prefetch critical bitmaps before animating so deploy/CDN latency doesn't show empty panels.
  await waitIntroAssets()
  if (generation !== introGeneration) return

  await nextTick()
  if (generation !== introGeneration || !introRootRef.value) return
  updateIntroProgress(0)

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    updateIntroProgress(84)
    markIntroEntryDone(generation)
    return
  }

  introContext = gsap.context(() => {
    introTimeline = createIntroEntryTimeline(generation)
  }, introRootRef.value)
}

function mediaOf(anime: Anime | null | undefined) {
  if (!anime) return ''
  return anime.banner || anime.image
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

async function loadImage(src: string, timeout = IMAGE_READY_TIMEOUT) {
  if (!src) return false
  const img = new Image()
  img.decoding = 'async'
  const ready = waitImg(img, timeout)
  img.src = src
  return ready
}

/** Warm cache for intro assets as early as possible (call once). */
function preloadIntroAssets() {
  if (!introAssetsPromise) {
    introAssetsPromise = Promise.all(
      INTRO_CRITICAL_ASSETS.map((src) => loadImage(src, INTRO_ASSET_TIMEOUT)),
    )
  }
  return introAssetsPromise
}

async function waitIntroAssets() {
  // Warm intro assets so panels don't pop in mid-animation.
  await preloadIntroAssets()
  // If still missing, give one more short pass for the three panels.
  await Promise.all(
    MANGA_INTRO_PANELS.map((item) => loadImage(item.src, 1800)),
  )
}

async function waitImg(el: HTMLImageElement | null | undefined, timeout = 800) {
  if (!el) return false
  if (!el.complete || el.naturalWidth <= 0) {
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

  if (!el.complete || el.naturalWidth <= 0) return false
  if (typeof el.decode === 'function') {
    const decoded = await Promise.race([
      el.decode().then(() => true).catch(() => el.naturalWidth > 0),
      wait(timeout).then(() => false),
    ])
    if (!decoded) return false
  }

  return el.complete && el.naturalWidth > 0
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
      scale: 1,
      clearProps: 'transform,transformOrigin',
    })
  })

  images.forEach((image) => {
    if (!image) return
    gsap.set(image, { clearProps: 'opacity,visibility,filter,transform,transformOrigin' })
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

function crossfadeAmbient(url: string, ready: boolean): gsap.core.Timeline {
  const a = ambientARef.value
  const b = ambientBRef.value
  if (!a || !b || !url || !ready) return gsap.timeline()

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
function prepareNextLayer(nextAnime: Anime | null, ready: boolean): gsap.core.Timeline | null {
  const layer = nextLayerRef.value
  const img = nextImgRef.value
  if (!layer || !img) return null

  if (!nextAnime) {
    return gsap.timeline().to(layer, { autoAlpha: 0, duration: 0.4, ease: 'power2.out' }, 0)
  }

  const url = mediaOf(nextAnime)
  if (!ready) {
    gsap.set(layer, { autoAlpha: 0 })
    return null
  }
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
  const nextLayer = nextLayerRef.value
  const nextImg = nextImgRef.value
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

  const [posterReady, ambientReady, upcomingReady] = await Promise.all([
    loadImage(posterUrl),
    loadImage(ambientUrl),
    upcoming ? loadImage(mediaOf(upcoming)) : Promise.resolve(false),
  ])
  if (!posterReady) {
    await finishHeroTransition()
    return
  }

  gsap.set(poster, { clearProps: 'opacity,visibility,transform,transformOrigin' })
  const heroBox = hero.getBoundingClientRect()
  const posterBox = poster.getBoundingClientRect()
  const copyBox = outgoingCopy.getBoundingClientRect()
  const nextLayerBox = nextLayer?.getBoundingClientRect()
  const nextImgBox = nextImg?.getBoundingClientRect()
  const bridgeImageStartScale = nextLayerBox && nextImgBox && nextLayerBox.width > 0
    ? nextImgBox.width / nextLayerBox.width
    : 1
  // 与 .hero-depth-next 对齐：inset -72px，避免 bridge 出现时先跳一帧。
  const depthBleed = 72
  const from = {
    left: 0,
    top: -depthBleed,
    width: heroBox.width,
    height: heroBox.height + depthBleed,
  }
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
  const bridgeImagesReady = await Promise.all([
    waitImg(bridgeImg, IMAGE_READY_TIMEOUT),
    waitImg(focusBridgeImg, IMAGE_READY_TIMEOUT),
  ])
  if (bridgeImagesReady.some((ready) => !ready)) {
    hideBridgeLayers()
    await finishHeroTransition()
    return
  }
  const bridgeStart = {
    left: from.left,
    top: from.top,
    width: from.width,
    height: from.height,
    borderRadius: 0,
    boxShadow: 'none',
    overflow: 'hidden',
    x: 0,
    y: 0,
    scale: 1,
  }
  gsap.set(bridge, {
    ...bridgeStart,
    autoAlpha: 1,
    zIndex: 2,
  })
  gsap.set(focusBridge, {
    ...bridgeStart,
    autoAlpha: 0,
    zIndex: 5,
  })
  gsap.set([bridgeImg, focusBridgeImg], {
    autoAlpha: 1,
    scale: bridgeImageStartScale,
    transformOrigin: '50% 50%',
    filter: 'blur(3px) saturate(.95) brightness(.78)',
  })

  // 先铺好与后景同几何的 bridge，再藏 next layer，避免“先跳再收束”。
  if (nextLayer) gsap.set(nextLayer, { autoAlpha: 0 })

  const nextSwapTl = prepareNextLayer(upcoming, upcomingReady)
  const ambientTl = crossfadeAmbient(ambientUrl, ambientReady)

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

  const bridgeDestination = {
    left: to.left,
    top: to.top,
    width: to.width,
    height: to.height,
    borderRadius: 12,
    duration: 1.0,
  }

  leave.to(bridge, {
    ...bridgeDestination,
    boxShadow: '0 40px 110px rgba(0,0,0,0.55)',
  }, 0)

  leave.to(focusBridge, bridgeDestination, 0)
  leave.to([bridgeImg, focusBridgeImg], {
    scale: 1,
    duration: 1.0,
    ease: 'power2.inOut',
  }, 0)
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
  await waitImg(posterImg, IMAGE_READY_TIMEOUT)

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
  gsap.set(layer, { autoAlpha: 0, clearProps: 'filter' })
  void waitImg(img, IMAGE_READY_TIMEOUT).then((ready) => {
    gsap.set(layer, { autoAlpha: ready ? 1 : 0 })
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
  })
})

watch(() => catalog.loaded, (loaded) => {
  if (loaded) void maybeFinishIntro(introGeneration)
})

// Home stays mounted under detail; only mark body while home route is active.
watch(
  () => route.name,
  (name) => {
    document.body.classList.toggle('home-page-active', name === 'home')
  },
  { immediate: true },
)

onMounted(() => {
  // Kick off asset warm-up immediately, in parallel with catalog fetch.
  void preloadIntroAssets()
  const shouldPlayIntro = !catalog.loaded
  catalog.load()
  if (shouldPlayIntro) {
    void playIntro()
  } else {
    introVisible.value = false
  }
  hideBridgeLayers()
  document.addEventListener('visibilitychange', handleVisibilityChange)
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
  introGeneration += 1
  stopIntroWaitingState()
  introTimeline?.kill()
  introContext?.revert()
  introTimeline = null
  introContext = null
  setIntroDocumentState(false)
  document.body.classList.remove('home-page-active')
  stopAutoplayProgress(true)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<template>
  <div class="home-view-root">
    <Teleport to="body">
      <section
      v-if="introVisible"
      ref="introRootRef"
      class="intro-overlay"
      :class="{ 'intro-is-waiting': introWaiting }"
      role="dialog"
      aria-modal="true"
      aria-label="MioAni 开屏"
    >
      <header class="intro-hud">
        <div class="intro-node-label">
          <span>MIO / VISUAL NODE</span>
          <small>{{ quarter }}</small>
        </div>
      </header>

      <div class="intro-scene intro-manga" aria-hidden="true">
        <div class="manga-speedlines"></div>
        <div class="manga-panel-grid">
          <article v-for="(item, index) in MANGA_INTRO_PANELS" :key="item.src" :class="`manga-panel manga-panel--${index + 1}`">
            <img
              :src="item.src"
              alt=""
              decoding="async"
              fetchpriority="high"
              loading="eager"
            />
            <span>{{ item.label }}</span>
          </article>
        </div>
        <div class="manga-impact-word"><span>MIO</span><strong>ANI</strong></div>
        <div class="manga-slash"></div>
        <div class="intro-scene-copy">
          <p>SEASON CUT / IMPACT SYNC</p>
          <strong>每一帧，都在等待开场。</strong>
        </div>
      </div>

      <footer class="intro-telemetry" aria-live="polite">
        <div>
          <span>{{ introStatus }}</span>
          <small>{{ catalog.loaded ? 'DATA CHANNEL READY' : 'AWAITING REMOTE CATALOG' }}</small>
        </div>
        <div class="intro-progress" aria-hidden="true"><i ref="introProgressBarRef"></i></div>
        <output ref="introPercentRef">000%</output>
      </footer>
      </section>
    </Teleport>

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

      <section class="season-directory reveal-section">
        <div class="directory-head directory-head--solo">
          <div>
            <span>SEASON HOT</span>
            <h2>这一季的热门动画</h2>
          </div>
          <p class="directory-count">{{ hotAnime.length }} 部精选</p>
        </div>
        <TransitionGroup name="list" tag="div" class="catalog-grid directory-grid">
          <AnimeCard v-for="(anime, index) in hotAnime" :key="anime.id" :anime="anime" :index="index + 1" />
        </TransitionGroup>
      </section>

      <section class="closing-band reveal-section">
        <div class="closing-band__bg" aria-hidden="true">
          <span class="closing-band__orb closing-band__orb--a" />
          <span class="closing-band__orb closing-band__orb--b" />
          <span class="closing-band__grid" />
          <span class="closing-band__beam" />
        </div>
        <div class="closing-band__content">
          <div class="closing-band__kicker">
            <PhSparkle :size="18" weight="fill" />
            <span>BUILD YOUR OWN QUEUE</span>
          </div>
          <h2>不跟着热度走。<br />只留下你想看的。</h2>
          <p class="closing-band__desc">把想追的动画收进自己的队列，按你的节奏继续下一集。</p>
          <div class="closing-band__actions">
            <RouterLink class="closing-band__primary" to="/library">
              进入我的追番库
              <PhArrowRight :size="18" />
            </RouterLink>
            <RouterLink class="closing-band__ghost" to="/discover">
              去发现更多
              <PhArrowRight :size="16" />
            </RouterLink>
          </div>
          <div class="closing-band__stats" aria-hidden="true">
            <div><strong>{{ hotAnime.length }}</strong><span>本季热门</span></div>
            <div><strong>{{ library.items.length || '—' }}</strong><span>我的收藏</span></div>
            <div><strong>{{ quarter }}</strong><span>当前季度</span></div>
          </div>
        </div>
      </section>
    </template>
    </div>
  </div>
</template>
