import { onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'

const LOCK_CLASSES = ['intro-active', 'detail-scroll-lock'] as const

const LIST_ROUTE_NAMES = new Set([
  'home',
  'discover',
  'schedule',
  'library',
  'stats',
])

let activeLenis: Lenis | null = null

function isScrollLocked(): boolean {
  const { classList } = document.body
  return LOCK_CLASSES.some((name) => classList.contains(name))
}

function isListRouteName(name: unknown): boolean {
  return LIST_ROUTE_NAMES.has(String(name))
}

/** Active window Lenis instance for list pages, if any. */
export function getActiveLenis(): Lenis | null {
  return activeLenis
}

/**
 * Window Lenis for AppShell list pages (home/discover/schedule/library/stats).
 * Call once from AppShell — list views stay mounted and must not each own a Lenis.
 */
export function useLenis() {
  const route = useRoute()
  let bodyObserver: MutationObserver | null = null

  function syncLockState() {
    if (!activeLenis) return
    if (isScrollLocked()) {
      activeLenis.stop()
      return
    }
    activeLenis.start()
    // AppShell unlocks with window.scrollTo(instant); realign Lenis to that Y.
    activeLenis.scrollTo(window.scrollY, { immediate: true })
  }

  function destroyLenis() {
    bodyObserver?.disconnect()
    bodyObserver = null
    if (!activeLenis) return
    activeLenis.destroy()
    activeLenis = null
  }

  function ensureLenis() {
    if (activeLenis) {
      syncLockState()
      return
    }
    activeLenis = new Lenis({
      autoRaf: true,
      anchors: true,
      allowNestedScroll: true,
      respectReducedMotion: true,
      stopInertiaOnNavigate: true,
    })
    bodyObserver = new MutationObserver(syncLockState)
    bodyObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    })
    syncLockState()
  }

  function syncForRoute(name: unknown) {
    if (isListRouteName(name)) {
      ensureLenis()
      return
    }
    destroyLenis()
  }

  watch(
    () => route.name,
    (name) => {
      syncForRoute(name)
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    destroyLenis()
  })
}
