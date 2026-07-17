<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import gsap from 'gsap'
import { PhArrowRight, PhPause, PhPlay, PhSparkle, PhWarningCircle } from '@phosphor-icons/vue'
import AnimeCard from '../components/AnimeCard.vue'
import { useCatalogStore } from '../stores/catalog'
import { useLibraryStore } from '../stores/library'
import type { Anime } from '../types/anime'
import brandMark from '../assets/MioAni1.png'
import brandLogo from '../assets/MioAni2.png'
import mangaPanelAnimePortrait from '../assets/manga-intro/panel-anime-portrait.png'
import mangaPanelAnimeBeach from '../assets/manga-intro/panel-anime-beach.jpg'
import mangaPanelMangaFigure from '../assets/manga-intro/panel-manga-figure.jpg'

type IntroVariant = 'signal' | 'manga'

const INTRO_VARIANTS: readonly IntroVariant[] = ['signal', 'manga']
const INTRO_COPY: Record<IntroVariant, readonly string[]> = {
  signal: ['BOOTING VISUAL CORE', 'CONNECTING BANGUMI / ANILIST', 'INDEXING CURRENT SEASON', 'SIGNAL LOCKED'],
  manga: ['INKING FRAME 01', 'CUTTING IMPACT PANELS', 'SYNCING KEY FRAMES', 'READY / IMPACT'],
}
const INTRO_WAIT_COPY = [
  'VERIFYING REMOTE CATALOG',
  'DECODING SEASON ARTWORK',
  'SYNCING BANGUMI / ANILIST',
  'STABILIZING VISUAL CHANNEL',
] as const
const INTRO_WAIT_PROGRESS_LIMIT = 98.4
const INTRO_WAIT_STATUS_INTERVAL = 2200
const SIGNAL_SHARD_ENTRY_X = [-82, 66, -26] as const
const SIGNAL_SHARD_ENTRY_Y = [18, -36, 56] as const
const SIGNAL_SHARD_ENTRY_ROTATION = [-12, 9, -4] as const
// Free anime/manga-style panels from Wikimedia Commons (CC BY-SA) so the intro never waits on the catalog API.
const MANGA_INTRO_PANELS = [
  { src: mangaPanelAnimePortrait, label: 'ANIME / PORTRAIT' },
  { src: mangaPanelAnimeBeach, label: 'ANIME / SUMMER FRAME' },
  { src: mangaPanelMangaFigure, label: 'MANGA / FIGURE' },
] as const
const INTRO_CRITICAL_ASSETS = [
  brandLogo,
  brandMark,
  ...MANGA_INTRO_PANELS.map((item) => item.src),
] as const

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
const introVariant = ref<IntroVariant>('signal')
const introStatus = ref(INTRO_COPY.signal[0])
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
const hotAnime = computed(() => catalog.seasonal.slice(0, 12))
const quarter = computed(() => {
  const date = new Date()
  return `${date.getFullYear()} Q${Math.floor(date.getMonth() / 3) + 1}`
})

function chooseRandomIntroVariant(): IntroVariant {
  return Math.random() < 0.5 ? 'signal' : 'manga'
}

function setIntroDocumentState(active: boolean) {
  document.body.classList.toggle('intro-active', active)
  const shell = document.querySelector<HTMLElement>('.app-shell')
  if (shell) shell.inert = active
}

function focusIntroVariantControl() {
  introRootRef.value
    ?.querySelector<HTMLButtonElement>('.intro-variant-switch button.active')
    ?.focus({ preventScroll: true })
}

function restoreIntroTriggerFocus() {
  document
    .querySelector<HTMLButtonElement>('.intro-lab button.active')
    ?.focus({ preventScroll: true })
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
  introStatus.value = INTRO_COPY[introVariant.value][step] || INTRO_COPY[introVariant.value][0]
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

function createSignalEntryTimeline(generation: number) {
  const timeline = gsap.timeline({
    defaults: { ease: 'power3.out' },
    onComplete: () => markIntroEntryDone(generation),
  })
  timeline
    .fromTo('.signal-grid', { autoAlpha: 0, scale: 1.12 }, { autoAlpha: 0.72, scale: 1, duration: 1.1 }, 0)
    .fromTo('.signal-axis', { scaleX: 0 }, { scaleX: 1, duration: 0.72, stagger: 0.09 }, 0.08)
    .fromTo('.signal-orbit', { autoAlpha: 0, scale: 0.45, rotate: -110 }, { autoAlpha: 1, scale: 1, rotate: 0, duration: 1.15, stagger: 0.08 }, 0.18)
    .fromTo('.signal-shard', {
      autoAlpha: 0,
      xPercent: (index) => SIGNAL_SHARD_ENTRY_X[index] ?? 0,
      yPercent: (index) => SIGNAL_SHARD_ENTRY_Y[index] ?? 0,
      rotate: (index) => SIGNAL_SHARD_ENTRY_ROTATION[index] ?? 0,
      filter: 'blur(14px) brightness(2)',
    }, {
      autoAlpha: 1,
      xPercent: 0,
      yPercent: 0,
      rotate: 0,
      filter: 'blur(0px) brightness(1)',
      duration: 0.9,
      stagger: 0.08,
    }, 0.48)
    .fromTo('.signal-lock', { scale: 1.7, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.46 }, 1.12)
    .fromTo('.intro-signal .intro-scene-copy > *', { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.62, stagger: 0.08 }, 1.08)
    .fromTo('.signal-scan', { yPercent: -120, autoAlpha: 0 }, { yPercent: 140, autoAlpha: 0.9, duration: 1.35, ease: 'power1.inOut' }, 0.34)
    .call(() => setIntroStatus(1), [], 0.82)
    .call(() => setIntroStatus(2), [], 1.72)
  addIntroProgressTween(timeline, 84, 0.14, 2.65)
  return timeline
}

function createMangaEntryTimeline(generation: number) {
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

function createIntroEntryTimeline(variant: IntroVariant, generation: number) {
  if (variant === 'manga') return createMangaEntryTimeline(generation)
  return createSignalEntryTimeline(generation)
}

function createIntroFinishTimeline(variant: IntroVariant, generation: number) {
  const root = introRootRef.value
  const timeline = gsap.timeline({
    defaults: { ease: 'power3.inOut' },
    onComplete: () => {
      if (generation !== introGeneration) return
      introVisible.value = false
      introIsFinishing.value = false
      setIntroDocumentState(false)
      void nextTick(restoreIntroTriggerFocus)
    },
  })
  setIntroStatus(3)
  addIntroProgressTween(timeline, 100, 0, 0.42)

  if (variant === 'signal') {
    timeline
      .to('.intro-signal .intro-scene-copy > *', {
        y: 24,
        autoAlpha: 0,
        duration: 0.38,
        stagger: { each: 0.06, from: 'end' },
      }, 0.04)
      .to('.signal-scan', {
        yPercent: -120,
        autoAlpha: 0,
        duration: 0.65,
        ease: 'power1.inOut',
      }, 0.18)
      .to('.signal-lock', { scale: 1.7, autoAlpha: 0, duration: 0.32 }, 0.28)
      .to('.signal-shard', {
        autoAlpha: 0,
        xPercent: (index) => SIGNAL_SHARD_ENTRY_X[index] ?? 0,
        yPercent: (index) => SIGNAL_SHARD_ENTRY_Y[index] ?? 0,
        rotate: (index) => SIGNAL_SHARD_ENTRY_ROTATION[index] ?? 0,
        filter: 'blur(14px) brightness(2)',
        duration: 0.62,
        stagger: { each: 0.08, from: 'end' },
      }, 0.42)
      .to('.signal-orbit', {
        autoAlpha: 0,
        scale: 0.45,
        rotate: -110,
        duration: 0.72,
        stagger: { each: 0.08, from: 'end' },
      }, 0.46)
      .to('.signal-axis', {
        scaleX: 0,
        duration: 0.52,
        stagger: { each: 0.09, from: 'end' },
      }, 0.86)
      .to('.signal-grid', { autoAlpha: 0, scale: 1.12, duration: 0.58 }, 0.96)
      .to('.intro-hud, .intro-telemetry', { autoAlpha: 0, duration: 0.32 }, 1.02)
      .to(root, { autoAlpha: 0, duration: 0.18 }, 1.48)
  } else {
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
  }
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
    await nextTick()
    restoreIntroTriggerFocus()
    return
  }

  introTimeline = createIntroFinishTimeline(introVariant.value, generation)
}

async function playIntroVariant(variant: IntroVariant) {
  const generation = ++introGeneration
  stopIntroWaitingState()
  introTimeline?.kill()
  introContext?.revert()
  introContext = null
  introTimeline = null
  introVariant.value = variant
  introStatus.value = INTRO_COPY[variant][0]
  introEntryDone.value = false
  introIsFinishing.value = false
  introVisible.value = true
  setIntroDocumentState(true)

  // Prefetch critical bitmaps before animating so deploy/CDN latency doesn't show empty panels.
  await waitIntroAssets(variant)
  if (generation !== introGeneration) return

  await nextTick()
  if (generation !== introGeneration || !introRootRef.value) return
  updateIntroProgress(0)
  focusIntroVariantControl()

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    updateIntroProgress(84)
    markIntroEntryDone(generation)
    return
  }

  introContext = gsap.context(() => {
    introTimeline = createIntroEntryTimeline(variant, generation)
  }, introRootRef.value)
}

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

async function waitIntroAssets(variant: IntroVariant) {
  // Always warm all intro assets; manga waits harder so panels don't pop in mid-animation.
  const results = await preloadIntroAssets()
  if (variant !== 'manga') return
  // If still missing, give one more short pass for the three panels.
  await Promise.all(
    MANGA_INTRO_PANELS.map((item) => loadImage(item.src, 1800)),
  )
  void results
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
  // 与 .hero-depth-next 对齐：inset -72px + 同向 scroll parallax，避免 bridge 出现时先跳一帧。
  const depthBleed = 72
  const scrollProgress = Number.parseFloat(
    hero.style.getPropertyValue('--hero-scroll-progress') || '0',
  ) || 0
  const from = {
    left: 0,
    top: -depthBleed + scrollProgress * depthBleed,
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
    scheduleHeroParallax()
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
  const randomIntroVariant = chooseRandomIntroVariant()
  catalog.load()
  if (shouldPlayIntro) {
    void playIntroVariant(randomIntroVariant)
  } else {
    introVisible.value = false
  }
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
  introGeneration += 1
  stopIntroWaitingState()
  introTimeline?.kill()
  introContext?.revert()
  introTimeline = null
  introContext = null
  setIntroDocumentState(false)
  document.body.classList.remove('home-page-active')
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
  <div class="home-view-root">
    <Teleport to="body">
      <section
      v-if="introVisible"
      ref="introRootRef"
      class="intro-overlay"
      :class="[`intro-${introVariant}`, { 'intro-is-waiting': introWaiting }]"
      role="dialog"
      aria-modal="true"
      aria-label="MioAni 开屏动画效果预览"
    >
      <header class="intro-hud">
        <div class="intro-node-label">
          <span>MIO / VISUAL NODE</span>
          <small>{{ quarter }}</small>
        </div>
        <div class="intro-variant-switch" role="group" aria-label="切换开屏动画效果">
          <button
            v-for="variant in INTRO_VARIANTS"
            :key="variant"
            type="button"
            :class="{ active: introVariant === variant }"
            :aria-pressed="introVariant === variant"
            @click="playIntroVariant(variant)"
          >
            <b>{{ variant === 'signal' ? 'A' : 'B' }}</b>
            <span>{{ variant === 'signal' ? '信号' : '漫画' }}</span>
          </button>
        </div>
      </header>

      <div v-if="introVariant === 'signal'" class="intro-scene intro-signal" aria-hidden="true">
        <div class="signal-grid"></div>
        <div class="signal-scan"></div>
        <div class="signal-axis signal-axis--horizontal"></div>
        <div class="signal-axis signal-axis--vertical"></div>
        <div class="signal-core">
          <span class="signal-orbit signal-orbit--outer"></span>
          <span class="signal-orbit signal-orbit--inner"></span>
          <span class="signal-orbit signal-orbit--dash"></span>
          <div class="signal-shards">
            <img v-for="index in 3" :key="index" :src="brandMark" :class="`signal-shard signal-shard--${index}`" alt="" />
          </div>
          <span class="signal-lock"></span>
        </div>
        <div class="intro-scene-copy">
          <p>SEASONAL DATABASE / LIVE</p>
          <img :src="brandLogo" alt="" />
          <strong>FOLLOW YOUR SEASON</strong>
        </div>
      </div>

      <div v-else class="intro-scene intro-manga" aria-hidden="true">
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
    <aside v-if="!introVisible" class="intro-lab" aria-label="开屏动画效果实验室">
      <span>OPENING FX</span>
      <button
        v-for="variant in INTRO_VARIANTS"
        :key="variant"
        type="button"
        :class="{ active: introVariant === variant }"
        :aria-label="`播放方案 ${variant === 'signal' ? 'A 信号启动' : 'B 漫画冲击'}`"
        @click="playIntroVariant(variant)"
      >{{ variant === 'signal' ? 'A' : 'B' }}</button>
    </aside>

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
