<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { PhArrowUp } from '@phosphor-icons/vue'

/**
 * iOS 26 风格液态玻璃（liquid glass）。
 * 实现参照 https://github.com/archisvaze/liquid-glass 的 SVG 版本：
 * Canvas 生成折射位移贴图 + 镜面高光贴图，配合 backdrop-filter: url(#svg-filter)
 * 做边缘折射。该效果仅 Chromium 内核浏览器可渲染，其余浏览器退化为半透明白色玻璃。
 */

const filterId = useId()

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
const filterDefs = ref('')

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
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

watch(
  () => props.scrollEl,
  (next, prev) => {
    unbind(prev)
    bind(next)
    onScroll()
  },
)

/* ---------------- liquid glass（SVG feDisplacementMap + backdrop-filter） ---------------- */

/** 凸起圆角方形截面：边缘陡峭、向中心趋于平缓。 */
const SURFACE_FN = (x: number): number => Math.pow(1 - Math.pow(1 - x, 4), 0.25)

/** 基于斯涅尔折射近似计算玻璃边缘各处的水平位移量。 */
function calculateRefractionProfile(
  glassThickness: number,
  bezelWidth: number,
  ior: number,
  samples = 128,
): Float64Array {
  const eta = 1 / ior
  function refract(nx: number, ny: number): number[] | null {
    const k = 1 - eta * eta * (1 - ny * ny)
    if (k < 0) return null
    const sq = Math.sqrt(k)
    return [-(eta * ny + sq) * nx, eta - (eta * ny + sq) * ny]
  }
  const profile = new Float64Array(samples)
  for (let i = 0; i < samples; i++) {
    const x = i / samples
    const y = SURFACE_FN(x)
    const dx = x < 1 ? 0.0001 : -0.0001
    const y2 = SURFACE_FN(x + dx)
    const deriv = (y2 - y) / dx
    const mag = Math.sqrt(deriv * deriv + 1)
    const ref = refract(-deriv / mag, -1 / mag)
    profile[i] = ref ? ref[0] * ((y * bezelWidth + glassThickness) / ref[1]) : 0
  }
  return profile
}

/** 生成位移贴图：红/绿通道编码 X/Y 位移方向，仅玻璃边缘环内生效。 */
function generateDisplacementMap(
  w: number,
  h: number,
  radius: number,
  bezelWidth: number,
  profile: Float64Array,
  maxDisp: number,
  scaleFactor = 1,
): string {
  const canvas = document.createElement('canvas')
  // 按设备像素比放大贴图，避免小按钮在高 DPR 屏幕被放大采样产生锯齿边缘。
  canvas.width = w * scaleFactor
  canvas.height = h * scaleFactor
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(canvas.width, canvas.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 128
    d[i + 1] = 128
    d[i + 2] = 0
    d[i + 3] = 255
  }

  const R = radius * scaleFactor
  const BW = bezelWidth * scaleFactor
  const rSq = R * R
  const r1Sq = (R + 1) ** 2
  const rBSq = Math.max(R - BW, 0) ** 2
  const wB = canvas.width - R * 2
  const hB = canvas.height - R * 2
  const samples = profile.length

  for (let y1 = 0; y1 < canvas.height; y1++) {
    for (let x1 = 0; x1 < canvas.width; x1++) {
      const x = x1 < R ? x1 - R : x1 >= canvas.width - R ? x1 - R - wB : 0
      const y = y1 < R ? y1 - R : y1 >= canvas.height - R ? y1 - R - hB : 0
      const dSq = x * x + y * y
      if (dSq > r1Sq || dSq < rBSq) continue
      const dist = Math.sqrt(dSq)
      const fromSide = R - dist
      const op = dSq < rSq ? 1 : 1 - (dist - Math.sqrt(rSq)) / (Math.sqrt(r1Sq) - Math.sqrt(rSq))
      if (op <= 0 || dist === 0) continue
      const cos = x / dist
      const sin = y / dist
      const bi = Math.min(((fromSide / BW) * samples) | 0, samples - 1)
      const disp = profile[bi] || 0
      const idx = (y1 * canvas.width + x1) * 4
      d[idx] = (128 + (-cos * disp * 127 * op) / maxDisp + 0.5) | 0
      d[idx + 1] = (128 + (-sin * disp * 127 * op) / maxDisp + 0.5) | 0
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL()
}

/** 生成镜面高光贴图：沿光源方向强化边缘反光。 */
function generateSpecularMap(
  w: number,
  h: number,
  radius: number,
  bezelWidth: number,
  angle = Math.PI / 3,
  scaleFactor = 1,
): string {
  const canvas = document.createElement('canvas')
  canvas.width = w * scaleFactor
  canvas.height = h * scaleFactor
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(canvas.width, canvas.height)
  const d = img.data
  d.fill(0)

  const R = radius * scaleFactor
  const BW = bezelWidth * scaleFactor
  const rSq = R * R
  const r1Sq = (R + 1) ** 2
  const rBSq = Math.max(R - BW, 0) ** 2
  const wB = canvas.width - R * 2
  const hB = canvas.height - R * 2
  const sv = [Math.cos(angle), Math.sin(angle)]

  for (let y1 = 0; y1 < canvas.height; y1++) {
    for (let x1 = 0; x1 < canvas.width; x1++) {
      const x = x1 < R ? x1 - R : x1 >= canvas.width - R ? x1 - R - wB : 0
      const y = y1 < R ? y1 - R : y1 >= canvas.height - R ? y1 - R - hB : 0
      const dSq = x * x + y * y
      if (dSq > r1Sq || dSq < rBSq) continue
      const dist = Math.sqrt(dSq)
      const fromSide = R - dist
      const op = dSq < rSq ? 1 : 1 - (dist - Math.sqrt(rSq)) / (Math.sqrt(r1Sq) - Math.sqrt(rSq))
      if (op <= 0 || dist === 0) continue
      const cos = x / dist
      const sin = -y / dist
      const dot = Math.abs(cos * sv[0] + sin * sv[1])
      const edge = Math.sqrt(Math.max(0, 1 - (1 - fromSide) ** 2))
      const coeff = dot * edge
      const col = (255 * coeff) | 0
      const alpha = (col * coeff * op) | 0
      const idx = (y1 * canvas.width + x1) * 4
      d[idx] = col
      d[idx + 1] = col
      d[idx + 2] = col
      d[idx + 3] = alpha
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL()
}

/** 按按钮当前尺寸生成位移/高光贴图并注入 SVG filter。 */
function rebuildLiquidGlass() {
  const btn = btnRef.value
  if (!btn) return
  const w = btn.offsetWidth
  const h = btn.offsetHeight
  if (w < 2 || h < 2) return

  const radius = Math.min(w, h) / 2
  // 参数按 demo 默认值（300×200 玻璃、bezel 60、thickness 80）等比缩放到按钮尺寸。
  const glassThickness = 12
  const bezelWidth = Math.min(glassThickness, radius - 1, Math.min(w, h) / 2 - 1)
  const ior = 3
  const blurAmount = 0.3
  const specularOpacity = 0.5
  const specularSaturation = 4
  // 贴图按设备像素比生成（上限 3x），配合滤镜内高斯模糊消除小按钮边缘锯齿。
  const dpr = Math.min(window.devicePixelRatio || 1, 3)

  const profile = calculateRefractionProfile(glassThickness, bezelWidth, ior, 128)
  let maxDisp = 1
  for (const v of profile) maxDisp = Math.max(maxDisp, Math.abs(v))
  const dispUrl = generateDisplacementMap(w, h, radius, bezelWidth, profile, maxDisp, dpr)
  const specUrl = generateSpecularMap(w, h, radius, bezelWidth * 2.5, Math.PI / 3, dpr)
  // 略降位移强度，避免边缘过强的像素级拉扯造成的锯齿感。
  const scale = maxDisp * 0.8

  filterDefs.value = `
    <filter id="${filterId}" x="0%" y="0%" width="100%" height="100%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="${blurAmount}" result="blurred_source" />
      <feImage href="${dispUrl}" x="0" y="0" width="${w}" height="${h}" result="disp_map" />
      <feGaussianBlur in="disp_map" stdDeviation="1.2" result="disp_map_sm" />
      <feDisplacementMap in="blurred_source" in2="disp_map_sm" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="displaced" />
      <feColorMatrix in="displaced" type="saturate" values="${specularSaturation}" result="displaced_sat" />
      <feImage href="${specUrl}" x="0" y="0" width="${w}" height="${h}" result="spec_layer" />
      <feGaussianBlur in="spec_layer" stdDeviation="1" result="spec_layer_sm" />
      <feComposite in="displaced_sat" in2="spec_layer_sm" operator="in" result="spec_masked" />
      <feComponentTransfer in="spec_layer_sm" result="spec_faded">
        <feFuncA type="linear" slope="${specularOpacity}" />
      </feComponentTransfer>
      <feBlend in="spec_masked" in2="displaced" mode="normal" result="with_sat" />
      <feBlend in="spec_faded" in2="with_sat" mode="normal" />
    </filter>
  `
}

const glassStyle = computed(() => ({
  backdropFilter: `url(#${filterId})`,
  WebkitBackdropFilter: `url(#${filterId})`,
}))

let resizeTimer: ReturnType<typeof setTimeout> | undefined
function onResize() {
  window.clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(rebuildLiquidGlass, 150)
}

watch([visible, () => props.show], ([shown, gate]) => {
  if (shown && gate) nextTick(rebuildLiquidGlass)
})

onMounted(() => {
  bind(props.scrollEl)
  onScroll()
  window.addEventListener('resize', onResize)
  nextTick(() => {
    if (btnRef.value) rebuildLiquidGlass()
  })
})

onBeforeUnmount(() => {
  unbind(props.scrollEl)
  window.removeEventListener('resize', onResize)
  window.clearTimeout(resizeTimer)
})
</script>

<template>
  <Teleport to="body">
    <svg
      width="0"
      height="0"
      aria-hidden="true"
      style="position: absolute; overflow: hidden"
      color-interpolation-filters="sRGB"
    >
      <defs v-html="filterDefs" />
    </svg>
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
  background-color: rgba(255, 255, 255, .08);
  box-shadow:
    inset 0 0 20px -6px rgba(255, 255, 255, .42),
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
