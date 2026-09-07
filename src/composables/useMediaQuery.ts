import { readonly, ref, type Ref } from 'vue'

const cache = new Map<string, Readonly<Ref<boolean>>>()

/**
 * Shared reactive `matchMedia` result. One MediaQueryList per query for the
 * whole app, so hundreds of cards asking the same question cost one listener.
 */
export function useMediaQuery(query: string): Readonly<Ref<boolean>> {
  const cached = cache.get(query)
  if (cached) return cached
  const state = ref(false)
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mq = window.matchMedia(query)
    state.value = mq.matches
    const onChange = (event: MediaQueryListEvent) => {
      state.value = event.matches
    }
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange)
    else mq.addListener(onChange)
  }
  const result = readonly(state)
  cache.set(query, result)
  return result
}

/** Mirrors the `@media (max-width: 760px)` breakpoint in styles/responsive/breakpoints.css. */
export const COMPACT_LAYOUT_QUERY = '(max-width: 760px)'
