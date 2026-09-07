/**
 * One shared IntersectionObserver for every scroll-reveal element.
 *
 * Long grids used to create one observer per card (hundreds of observers, each
 * with its own root-margin geometry to evaluate on scroll). A single observer
 * with a per-element callback map does the same work once per frame.
 */
type RevealCallback = () => void

const OPTIONS: IntersectionObserverInit = { rootMargin: '0px 0px -8% 0px', threshold: 0.12 }

let observer: IntersectionObserver | null = null
const callbacks = new WeakMap<Element, RevealCallback>()

function getObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null
  if (observer) return observer
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const cb = callbacks.get(entry.target)
      if (!cb) continue
      callbacks.delete(entry.target)
      observer?.unobserve(entry.target)
      cb()
    }
  }, OPTIONS)
  return observer
}

/**
 * Fire `onReveal` once the element scrolls into view. Returns an unsubscribe;
 * when IntersectionObserver is unavailable the callback runs immediately.
 */
export function observeReveal(el: Element, onReveal: RevealCallback): () => void {
  const io = getObserver()
  if (!io) {
    onReveal()
    return () => {}
  }
  callbacks.set(el, onReveal)
  io.observe(el)
  return () => {
    callbacks.delete(el)
    io.unobserve(el)
  }
}

type VisibilityCallback = (visible: boolean) => void

let visibilityObserver: IntersectionObserver | null = null
const visibilityCallbacks = new WeakMap<Element, VisibilityCallback>()

function getVisibilityObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null
  if (visibilityObserver) return visibilityObserver
  visibilityObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      visibilityCallbacks.get(entry.target)?.(entry.isIntersecting)
    }
  }, { rootMargin: '25% 0px 25% 0px' })
  return visibilityObserver
}

/**
 * Continuously report whether the element is in (or just outside) the viewport.
 * Shared observer; used to keep per-card GPU effects bounded to what is on
 * screen. Without IntersectionObserver the element is reported as visible.
 */
export function observeVisibility(el: Element, onChange: VisibilityCallback): () => void {
  const io = getVisibilityObserver()
  if (!io) {
    onChange(true)
    return () => {}
  }
  visibilityCallbacks.set(el, onChange)
  io.observe(el)
  return () => {
    visibilityCallbacks.delete(el)
    io.unobserve(el)
  }
}
