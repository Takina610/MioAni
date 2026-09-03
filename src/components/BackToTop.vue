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

/** iOS 26 风格液态玻璃边缘折射，具体实现见 useLiquidGlass。 */
const { glassStyle } = useLiquidGlass(btnRef, {
  // Keep the small circular control's edge refraction aligned with its 56px surface.
  glassThickness: 43,
  bezelWidth: 43,
  scaleRatio: 0.8,
  displacementBlur: 1.2,
  specularBlur: 1,
})

function onScroll() {
  const el = props.scrollEl
  const top = el ? el.scrollTop : (window.scrollY || document.documentElement.scrollTop || 0)
  visible.value = top > 240
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
  unbind(props.scrollEl)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="backtop">
      <button
        v-if="show && visible"
        ref="btnRef"
        type="button"
        class="back-to-top"
        :style="glassStyle"
        aria-label="回到顶部"
        @click="backToTop"
      >
        <PhArrowUp :size="26" weight="bold" />
      </button>
    </Transition>
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
  transition:
    transform .18s var(--ease),
    background-color .2s ease;
}
.back-to-top:hover {
  background-color: rgba(255, 255, 255, .13);
}
.back-to-top:active {
  transform: scale(.94);
}
.back-to-top svg {
  transition: transform .22s var(--ease);
}
.back-to-top:hover svg {
  transform: translateY(-2px);
}
.backtop-enter-active,
.backtop-leave-active {
  transition: opacity .2s ease, transform .24s var(--ease);
}
.backtop-enter-from,
.backtop-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(.9);
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
