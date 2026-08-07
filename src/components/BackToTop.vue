<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PhArrowUp } from '@phosphor-icons/vue'

const props = defineProps<{
  /** Scroll container; defaults to the window/document. */
  scrollEl?: HTMLElement | null
  /** Extra gate (e.g. only on the comments tab). */
  show?: boolean
}>()

const visible = ref(false)

function onScroll() {
  const el = props.scrollEl
  const top = el ? el.scrollTop : (window.scrollY || document.documentElement.scrollTop || 0)
  visible.value = top > 240
}

function backToTop() {
  const el = props.scrollEl
  if (el) {
    el.scrollTo({ top: 0, behavior: 'smooth' })
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

watch(
  () => props.scrollEl,
  (next, prev) => {
    prev?.removeEventListener('scroll', onScroll)
    next?.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
  },
)

onMounted(() => {
  props.scrollEl?.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})

onBeforeUnmount(() => {
  props.scrollEl?.removeEventListener('scroll', onScroll)
})
</script>

<template>
  <Transition name="backtop">
    <button
      v-if="show !== false && visible"
      type="button"
      class="back-to-top"
      aria-label="回到顶部"
      @click="backToTop"
    >
      <PhArrowUp :size="20" weight="bold" />
    </button>
  </Transition>
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
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-ink);
  box-shadow: 0 10px 28px rgba(184, 240, 95, .32);
  cursor: pointer;
  transition:
    transform .18s var(--ease),
    background .2s ease;
}
.back-to-top:hover {
  background: color-mix(in srgb, var(--accent) 88%, #fff);
}
.back-to-top:active {
  transform: scale(.94);
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
</style>
