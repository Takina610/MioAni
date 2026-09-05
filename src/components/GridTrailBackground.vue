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
/** Inclusive cell-index rectangle. */
type CellBox = { c0: number; c1: number; r0: number; r1: number }

const canvasRef = ref<HTMLCanvasElement | null>(null)

let ctx: CanvasRenderingContext2D | null = null
/** Pre-rendered base grid (every cell at BASE_ALPHA); blitted instead of ~2k fillRects a frame. */
let staticCanvas: HTMLCanvasElement | null = null
/** Cell-index box that carried trail energy last frame; must be restored to base this frame. */
let dirty: CellBox | null = null
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
  buildStatic(el.width, el.height)
  dirty = null
}

function buildStatic(devW: number, devH: number) {
  if (!staticCanvas) staticCanvas = document.createElement('canvas')
  staticCanvas.width = devW
  staticCanvas.height = devH
  const sctx = staticCanvas.getContext('2d')
  if (!sctx) {
    staticCanvas = null
    return
  }
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  sctx.fillStyle = `rgba(${CELL_RGB}, ${BASE_ALPHA})`
  const pitch = cell + gap
  for (let r = 0; r < rows; r++) {
    const y = r * pitch
    for (let c = 0; c < cols; c++) sctx.fillRect(c * pitch, y, cell, cell)
  }
}

/** Cells whose centre can be within the trail radius of any live sample. */
function affectedCells(t: number): CellBox | null {
  const pitch = cell + gap
  const radiusCells = Math.ceil(TRAIL_RADIUS_CELLS) + 1
  let box: CellBox | null = null
  for (const s of samples) {
    const age = t - s.t
    if (age < 0 || age > SAMPLE_TTL_MS) continue
    const cc = Math.floor(s.x / pitch)
    const cr = Math.floor(s.y / pitch)
    const c0 = Math.max(0, cc - radiusCells)
    const c1 = Math.min(cols - 1, cc + radiusCells)
    const r0 = Math.max(0, cr - radiusCells)
    const r1 = Math.min(rows - 1, cr + radiusCells)
    if (c1 < c0 || r1 < r0) continue
    if (!box) box = { c0, c1, r0, r1 }
    else {
      box.c0 = Math.min(box.c0, c0)
      box.c1 = Math.max(box.c1, c1)
      box.r0 = Math.min(box.r0, r0)
      box.r1 = Math.max(box.r1, r1)
    }
  }
  return box
}

function unionBox(a: CellBox | null, b: CellBox | null): CellBox | null {
  if (!a) return b
  if (!b) return a
  return {
    c0: Math.min(a.c0, b.c0),
    c1: Math.max(a.c1, b.c1),
    r0: Math.min(a.r0, b.r0),
    r1: Math.max(a.r1, b.r1),
  }
}

/** Restore a cell-box to the base grid (clear + blit from the static canvas). */
function restoreBox(box: CellBox) {
  if (!ctx) return
  const pitch = cell + gap
  const x = box.c0 * pitch
  const y = box.r0 * pitch
  const w = (box.c1 - box.c0 + 1) * pitch
  const h = (box.r1 - box.r0 + 1) * pitch
  ctx.clearRect(x, y, w, h)
  if (staticCanvas) {
    ctx.drawImage(staticCanvas, x * dpr, y * dpr, w * dpr, h * dpr, x, y, w, h)
  } else {
    ctx.fillStyle = `rgba(${CELL_RGB}, ${BASE_ALPHA})`
    for (let r = box.r0; r <= box.r1; r++) {
      for (let c = box.c0; c <= box.c1; c++) ctx.fillRect(c * pitch, r * pitch, cell, cell)
    }
  }
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

/**
 * Repaint. Only the cells near live pointer samples (plus whatever glowed last
 * frame) are touched; the rest of the viewport is left as the base grid. Cell
 * colours are identical to a full repaint: energised cells are cleared and
 * refilled at their final alpha rather than layered on top of the base.
 */
function paint(t: number) {
  if (!ctx || !cssW || !cssH) return
  const pitch = cell + gap

  if (!trailEnabled || !samples.length) {
    restoreBox({ c0: 0, c1: cols - 1, r0: 0, r1: rows - 1 })
    dirty = null
    return false
  }

  const region = affectedCells(t)
  const toRestore = unionBox(dirty, region)
  if (toRestore) restoreBox(toRestore)
  dirty = null
  if (!region) return false

  let anyEnergy = false
  for (let r = region.r0; r <= region.r1; r++) {
    const y = r * pitch
    for (let c = region.c0; c <= region.c1; c++) {
      const e = energyAt(c, r, t)
      if (e <= ENERGY_EPS) continue
      anyEnergy = true
      const alpha = BASE_ALPHA + Math.min(1, e) * (TRAIL_ALPHA - BASE_ALPHA)
      const x = c * pitch
      ctx.clearRect(x, y, cell, cell)
      ctx.fillStyle = `rgba(${CELL_RGB}, ${alpha})`
      ctx.fillRect(x, y, cell, cell)
    }
  }
  if (anyEnergy) dirty = region
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
  staticCanvas = null
  dirty = null
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
