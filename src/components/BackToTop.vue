<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PhArrowUp } from '@phosphor-icons/vue'
import { useLiquidGlass } from '../composables/useLiquidGlass'
import { getActiveLenis } from '../composables/useLenis'

const props = withDefaults(
  defineProps<{
    /** Scroll container; defaults to the window/document. */
    scrollEl?: HTMLElement | null
    /** Extra gate (e.g. only on the comments tab). */
    show?: boolean
  }>(),
  { show: true },
)

const visible = ref(false)
const btnRef = ref<HTMLButtonElement | null>(null)
let scrollRaf = 0

/** iOS 26 风格液态玻璃边缘折射，具体实现见 useLiquidGlass。 */
const { glassStyle } = useLiquidGlass(btnRef, {
  // Keep the small circular control's edge refraction aligned with its 56px surface.
  glassThickness: 43,
  bezelWidth: 43,
  scaleRatio: 0.8,
  displacementBlur: 1.2,
  specularBlur: 1,
})

function readScrollTop() {
  const el = props.scrollEl
  return el ? el.scrollTop : (window.scrollY || document.documentElement.scrollTop || 0)
}

function onScroll() {
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    visible.value = readScrollTop() > 240
  })
}

function bind(el: HTMLElement | null | undefined) {
  if (el) {
    el.addEventListener('scroll', onScroll, { passive: true })
  } else {
    window.addEventListener('scroll', onScroll, { passive: true })
  }
}

function unbind(el: HTMLElement | null | undefined) {
  if (el) {
    el.removeEventListener('scroll', onScroll)
  } else {
    window.removeEventListener('scroll', onScroll)
  }
}

function backToTop() {
  const el = props.scrollEl
  if (el) {
    el.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }
  const lenis = getActiveLenis()
  if (lenis) {
    lenis.scrollTo(0)
    return
  }
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

watch(
  () => props.scrollEl,
  (next, prev) => {
    unbind(prev)
    bind(next)
    onScroll()
  },
)

onMounted(() => {
  bind(props.scrollEl)
  onScroll()
})

onBeforeUnmount(() => {
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
  unbind(props.scrollEl)
})
</script>

<template>
  <Teleport to="body">
    <!-- Keep mounted while `show` so liquid-glass maps are not rebuilt on the 240px threshold. -->
    <button
      v-if="show"
      ref="btnRef"
      type="button"
      class="back-to-top"
      :class="{ 'is-visible': visible }"
      :style="glassStyle"
      :aria-hidden="visible ? undefined : 'true'"
      :tabindex="visible ? 0 : -1"
      aria-label="回到顶部"
      @click="backToTop"
    >
      <PhArrowUp :size="26" weight="bold" />
    </button>
  </Teleport>
</template>

<style scoped>
.back-to-top {
  position: fixed;
  right: 18px;
  bottom: calc(18px + env(safe-area-inset-bottom, 0px));
  z-index: 1000;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background-color: rgba(255, 255, 255, .06);
  box-shadow:
    inset 0 0 20px -5px rgba(255, 255, 255, .42),
    0 6px 24px rgba(0, 0, 0, .3);
  color: var(--accent);
  cursor: pointer;
  overflow: hidden;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(8px) scale(.9);
  transition:
    opacity .2s ease,
    transform .24s var(--ease),
    visibility .2s,
    background-color .2s ease;
}
.back-to-top.is-visible {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: translateY(0) scale(1);
}
.back-to-top:hover {
  background-color: rgba(255, 255, 255, .13);
}
.back-to-top:active {
  transform: scale(.94);
}
.back-to-top.is-visible:active {
  transform: scale(.94);
}
.back-to-top svg {
  transition: transform .22s var(--ease);
}
.back-to-top:hover svg {
  transform: translateY(-2px);
}

@media (max-width: 640px) {
  .back-to-top {
    width: 50px;
    height: 50px;
  }
  .back-to-top svg {
    width: 24px;
    height: 24px;
  }
}
</style>
