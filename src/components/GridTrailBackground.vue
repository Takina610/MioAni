<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

const CELL_CSS = 32
const GAP_CSS = 1.5
const MAX_DPR = 2
const SAMPLE_CAP = 16
const SAMPLE_TTL_MS = 560
const TRAIL_RADIUS_CELLS = 3.2
const BASE_ALPHA = 0.045
const TRAIL_ALPHA = 0.26
const ENERGY_EPS = 0.004
/** Accent green #b8f05f */
const CELL_RGB = '184, 240, 95'
const COARSE_MQ = '(pointer: coarse)'
const REDUCE_MQ = '(prefers-reduced-motion: reduce)'
const HOVER_MQ = '(hover: hover) and (pointer: fine)'

type Sample = { x: number; y: number; t: number }

const canvasRef = ref<HTMLCanvasElement | null>(null)

let ctx: CanvasRenderingContext2D | null = null
let dpr = 1
let cssW = 0
let cssH = 0
let cell = CELL_CSS
let gap = GAP_CSS
let cols = 0
let rows = 0
let samples: Sample[] = []
let raf = 0
let running = false
let staticOnly = false
let trailEnabled = false
let coarseMq: MediaQueryList | null = null
let reduceMq: MediaQueryList | null = null
let hoverMq: MediaQueryList | null = null
let ro: ResizeObserver | null = null

function now() {
  return performance.now()
}

function readPolicy() {
  const coarse = coarseMq?.matches ?? false
  const reduce = reduceMq?.matches ?? false
  const hoverFine = hoverMq?.matches ?? true
  staticOnly = reduce
  trailEnabled = !reduce && !coarse && hoverFine
}

function sizeCanvas() {
  const el = canvasRef.value
  if (!el) return
  const w = window.innerWidth
  const h = window.innerHeight
  dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
  cssW = w
  cssH = h
  el.width = Math.max(1, Math.floor(w * dpr))
  el.height = Math.max(1, Math.floor(h * dpr))
  el.style.width = `${w}px`
  el.style.height = `${h}px`
  ctx = el.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  // Snap cell/gap to device pixels for crisp edges
  const cellDev = Math.max(1, Math.round(CELL_CSS * dpr))
  const gapDev = Math.max(1, Math.round(GAP_CSS * dpr))
  cell = cellDev / dpr
  gap = gapDev / dpr
  const pitch = cell + gap
  cols = Math.ceil(w / pitch) + 1
  rows = Math.ceil(h / pitch) + 1
}

function pruneSamples(t: number) {
  const cutoff = t - SAMPLE_TTL_MS
  while (samples.length && samples[0]!.t < cutoff) samples.shift()
}

function energyAt(cx: number, cy: number, t: number): number {
  if (!samples.length) return 0
  const pitch = cell + gap
  const cellCx = cx * pitch + cell * 0.5
  const cellCy = cy * pitch + cell * 0.5
  const radius = TRAIL_RADIUS_CELLS * pitch
  const radius2 = radius * radius
  let e = 0
  for (const s of samples) {
    const age = t - s.t
    if (age < 0 || age > SAMPLE_TTL_MS) continue
    const dx = cellCx - s.x
    const dy = cellCy - s.y
    const d2 = dx * dx + dy * dy
    if (d2 > radius2) continue
    const spatial = Math.exp(-d2 / (radius2 * 0.28))
    const temporal = 1 - age / SAMPLE_TTL_MS
    e += spatial * temporal * temporal
  }
  return e > 1.35 ? 1.35 : e
}

function paint(t: number) {
  if (!ctx || !cssW || !cssH) return
  ctx.clearRect(0, 0, cssW, cssH)
  const pitch = cell + gap
  let anyEnergy = false

  for (let r = 0; r < rows; r++) {
    const y = r * pitch
    for (let c = 0; c < cols; c++) {
      const x = c * pitch
      let alpha = BASE_ALPHA
      if (trailEnabled && samples.length) {
        const e = energyAt(c, r, t)
        if (e > ENERGY_EPS) {
          anyEnergy = true
          alpha = BASE_ALPHA + Math.min(1, e) * (TRAIL_ALPHA - BASE_ALPHA)
        }
      }
      ctx.fillStyle = `rgba(${CELL_RGB}, ${alpha})`
      ctx.fillRect(x, y, cell, cell)
    }
  }

  return anyEnergy
}

function stopLoop() {
  if (raf) {
    cancelAnimationFrame(raf)
    raf = 0
  }
  running = false
}

function frame(t: number) {
  raf = 0
  pruneSamples(t)
  const anyEnergy = paint(t) === true
  const needContinue = trailEnabled && (samples.length > 0 || anyEnergy)
  if (needContinue) {
    raf = requestAnimationFrame(frame)
    running = true
  } else {
    running = false
    // Final static base frame when trail dies
    if (!samples.length) paint(t)
  }
}

function ensureLoop() {
  if (staticOnly || !trailEnabled) return
  if (running) return
  running = true
  raf = requestAnimationFrame(frame)
}

function paintStatic() {
  stopLoop()
  samples = []
  paint(now())
}

function onPointerMove(ev: PointerEvent) {
  if (!trailEnabled || staticOnly) return
  if (ev.pointerType === 'touch') return
  const t = now()
  samples.push({ x: ev.clientX, y: ev.clientY, t })
  if (samples.length > SAMPLE_CAP) samples.splice(0, samples.length - SAMPLE_CAP)
  ensureLoop()
}

function onPointerLeave() {
  // Let existing samples decay via rAF; do not clear instantly
  ensureLoop()
}

function onBlur() {
  samples = []
  paintStatic()
}

function onResize() {
  sizeCanvas()
  if (staticOnly || !trailEnabled) {
    paintStatic()
    return
  }
  paint(now())
  if (samples.length) ensureLoop()
}

function onPolicyChange() {
  readPolicy()
  sizeCanvas()
  if (staticOnly || !trailEnabled) {
    paintStatic()
  } else {
    paint(now())
  }
}

function bindMq(mq: MediaQueryList | null, handler: () => void) {
  if (!mq) return
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', handler)
  else mq.addListener(handler)
}

function unbindMq(mq: MediaQueryList | null, handler: () => void) {
  if (!mq) return
  if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', handler)
  else mq.removeListener(handler)
}

onMounted(() => {
  coarseMq = window.matchMedia(COARSE_MQ)
  reduceMq = window.matchMedia(REDUCE_MQ)
  hoverMq = window.matchMedia(HOVER_MQ)
  readPolicy()
  sizeCanvas()
  if (!ctx) return

  paintStatic()

  window.addEventListener('pointermove', onPointerMove, { passive: true })
  document.addEventListener('pointerleave', onPointerLeave)
  window.addEventListener('blur', onBlur)
  window.addEventListener('resize', onResize, { passive: true })
  bindMq(coarseMq, onPolicyChange)
  bindMq(reduceMq, onPolicyChange)
  bindMq(hoverMq, onPolicyChange)

  ro = new ResizeObserver(() => onResize())
  ro.observe(document.documentElement)
})

onUnmounted(() => {
  stopLoop()
  window.removeEventListener('pointermove', onPointerMove)
  document.removeEventListener('pointerleave', onPointerLeave)
  window.removeEventListener('blur', onBlur)
  window.removeEventListener('resize', onResize)
  unbindMq(coarseMq, onPolicyChange)
  unbindMq(reduceMq, onPolicyChange)
  unbindMq(hoverMq, onPolicyChange)
  ro?.disconnect()
  ro = null
  ctx = null
  samples = []
})
</script>

<template>
  <canvas
    ref="canvasRef"
    class="grid-trail-bg"
    aria-hidden="true"
  />
</template>

<style scoped>
.grid-trail-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  display: block;
}
</style>
