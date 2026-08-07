<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PhRocket } from '@phosphor-icons/vue'

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
const flying = ref(false)

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
  if (flying.value) return
  flying.value = true
  // Launch the rocket first; scroll back after the flight finishes.
  window.setTimeout(() => {
    if (el) {
      el.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    window.setTimeout(() => {
      flying.value = false
      visible.value = false
    }, 480)
  }, 260)
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
  <Transition name="backtop">
    <button
      v-if="show && visible"
      type="button"
      class="back-to-top"
      :class="{ 'is-flying': flying }"
      aria-label="回到顶部"
      @click="backToTop"
    >
      <PhRocket class="back-to-top__rocket" :size="20" weight="fill" />
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
  border: 1px solid rgba(255, 255, 255, .16);
  border-radius: 999px;
  background:
    radial-gradient(120% 120% at 28% 18%, rgba(255, 255, 255, .22), rgba(255, 255, 255, .05) 48%, rgba(255, 255, 255, .02)),
    rgba(16, 20, 17, .46);
  -webkit-backdrop-filter: blur(16px) saturate(170%);
  backdrop-filter: blur(16px) saturate(170%);
  color: var(--accent);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, .38),
    inset 0 1px 0 rgba(255, 255, 255, .22),
    inset 0 -1px 0 rgba(255, 255, 255, .05);
  cursor: pointer;
  transition:
    transform .18s var(--ease),
    border-color .2s ease,
    box-shadow .2s ease;
  overflow: hidden;
}
.back-to-top:hover {
  border-color: rgba(184, 240, 95, .45);
  box-shadow:
    0 10px 36px rgba(0, 0, 0, .44),
    0 0 24px rgba(184, 240, 95, .22),
    inset 0 1px 0 rgba(255, 255, 255, .28),
    inset 0 -1px 0 rgba(255, 255, 255, .06);
}
.back-to-top:active {
  transform: scale(.94);
}
.back-to-top__rocket {
  transition: transform .22s var(--ease);
}
.back-to-top:hover .back-to-top__rocket {
  transform: translateY(-2px) rotate(-8deg);
}
.back-to-top.is-flying .back-to-top__rocket {
  animation: backtop-launch .72s cubic-bezier(.16, 1, .3, 1) forwards;
}
@keyframes backtop-launch {
  0% {
    transform: translateY(0) rotate(0) scale(1);
    opacity: 1;
  }
  35% {
    opacity: 1;
  }
  100% {
    transform: translateY(-64vh) rotate(22deg) scale(.88);
    opacity: 0;
  }
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
