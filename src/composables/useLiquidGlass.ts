import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

export interface LiquidGlassOptions {
  /** 玻璃厚度（px）。 */
  glassThickness?: number
  bezelWidth?: number
  /** 折射率，越大折射越强。 */
  ior?: number
  /** 背景模糊量。 */
  blurAmount?: number
  /** 高光不透明度。 */
  specularOpacity?: number
  /** 高光饱和度。 */
  specularSaturation?: number
  /** 位移强度比例（相对折射最大位移），小于 1 可减弱边缘拉扯。 */
  scaleRatio?: number
  /** 位移贴图高斯模糊半径，用于消除小尺寸下的边缘锯齿。 */
  displacementBlur?: number
  /** 高光贴图高斯模糊半径。 */
  specularBlur?: number
  /** 贴图生成时使用的最大 DPR 倍数（与物理像素对齐，避免放大采样产生锯齿）。 */
  maxDpr?: number
}

/** 凸起圆角方形截面：边缘陡峭、向中心趋于平缓。 */
const SURFACE_FN = (x: number): number => Math.pow(1 - Math.pow(1 - x, 4), 0.25)

let filterSeq = 0

/** 模块级自增 id：同组件内多次调用也能拿到互不冲突的 filter id。 */
function nextFilterId(): string {
  filterSeq += 1
  return `liquid-glass-${filterSeq}`
}

/**
 * Read the element's actual corner radius in px.
 * Percentages / oversized values fall back to a circle; sharp corners use a
 * small fallback radius so the glass edge stays visible.
 */
function readCornerRadius(el: HTMLElement, w: number, h: number): number {
  const max = Math.min(w, h) / 2
  const first = getComputedStyle(el).borderRadius.split(/\s+/)[0] || ''
  if (first.endsWith('%')) return max
  const px = parseFloat(first)
  if (!Number.isFinite(px) || px <= 0) return Math.min(16, max)
  return Math.min(px, max)
}

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

/**
 * 生成位移贴图：红/绿通道编码 X/Y 位移方向，仅玻璃边缘环内生效。
 * 贴图按 scaleFactor 放大，配合 feImage 缩放到元素尺寸，可让位移值随设备像素平滑变化。
 */
interface RoundedRectEdge {
  depth: number
  nx: number
  ny: number
}

/** Return the inward edge depth and outward normal for a rounded rectangle. */
function getRoundedRectEdge(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): RoundedRectEdge | null {
  const halfW = w / 2
  const halfH = h / 2
  const cornerW = Math.max(halfW - radius, 0)
  const cornerH = Math.max(halfH - radius, 0)
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  const qx = ax - cornerW
  const qy = ay - cornerH

  if (qx > 0 && qy > 0) {
    const distance = Math.hypot(qx, qy)
    if (distance > radius || distance < 0.001) return null
    return {
      depth: radius - distance,
      nx: ((Math.sign(x) || 1) * qx) / distance,
      ny: ((Math.sign(y) || 1) * qy) / distance,
    }
  }

  if (qx > 0) {
    const depth = halfW - ax
    return depth >= 0 ? { depth, nx: Math.sign(x) || 1, ny: 0 } : null
  }

  if (qy > 0) {
    const depth = halfH - ay
    return depth >= 0 ? { depth, nx: 0, ny: Math.sign(y) || 1 } : null
  }

  const horizontalDepth = halfW - ax
  const verticalDepth = halfH - ay
  if (horizontalDepth <= verticalDepth) {
    return { depth: horizontalDepth, nx: Math.sign(x) || 1, ny: 0 }
  }
  return { depth: verticalDepth, nx: 0, ny: Math.sign(y) || 1 }
}

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

  const W = canvas.width
  const H = canvas.height
  const R = radius * scaleFactor
  const BW = Math.max(bezelWidth * scaleFactor, 1)
  const samples = profile.length

  for (let y1 = 0; y1 < H; y1++) {
    for (let x1 = 0; x1 < W; x1++) {
      const edge = getRoundedRectEdge(x1 + 0.5 - W / 2, y1 + 0.5 - H / 2, W, H, R)
      if (!edge || edge.depth > BW) continue
      const bi = Math.min(Math.max((edge.depth / BW) * samples, 0) | 0, samples - 1)
      const disp = profile[bi] || 0
      const idx = (y1 * W + x1) * 4
      d[idx] = (128 + (-edge.nx * disp * 127) / maxDisp + 0.5) | 0
      d[idx + 1] = (128 + (-edge.ny * disp * 127) / maxDisp + 0.5) | 0
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

  const W = canvas.width
  const H = canvas.height
  const R = radius * scaleFactor
  const BW = Math.max(bezelWidth * scaleFactor, 1)
  const sv = [Math.cos(angle), Math.sin(angle)]

  for (let y1 = 0; y1 < H; y1++) {
    for (let x1 = 0; x1 < W; x1++) {
      const geometry = getRoundedRectEdge(x1 + 0.5 - W / 2, y1 + 0.5 - H / 2, W, H, R)
      if (!geometry || geometry.depth > BW) continue
      const dot = Math.abs(geometry.nx * sv[0] - geometry.ny * sv[1])
      const edge = Math.sqrt(Math.max(0, 1 - geometry.depth / BW))
      const coeff = dot * edge
      const col = (255 * coeff) | 0
      const alpha = (col * coeff) | 0
      const idx = (y1 * W + x1) * 4
      d[idx] = col
      d[idx + 1] = col
      d[idx + 2] = col
      d[idx + 3] = alpha
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL()
}

/**
 * iOS 26 风格液态玻璃（liquid glass）组合式函数。
 *
 * 实现参照 https://github.com/archisvaze/liquid-glass 的 SVG 版本：
 * Canvas 生成折射位移贴图 + 镜面高光贴图，配合 `backdrop-filter: url(#svg-filter)`
 * 做边缘折射。效果仅 Chromium 内核浏览器可渲染，其余浏览器退化为无滤镜样式。
 *
 * 用法：把目标元素的 ref 传入，将返回的 glassStyle 绑定到该元素即可。
 * 组合式函数会自动把隐藏的 SVG filter 注入 document.body，并在组件卸载时清理；
 * 元素尺寸变化（含窗口 resize）与 v-if 挂载后都会自动重建贴图。
 */
export function useLiquidGlass(
  target: Ref<HTMLElement | null | undefined>,
  options: LiquidGlassOptions = {},
) {
  const {
    // Match the reference controls: 200x200, thickness 80, bezel 60.
    glassThickness = 80,
    bezelWidth: referenceBezelWidth = 60,
    ior = 3,
    blurAmount = 0.3,
    specularOpacity = 0.5,
    specularSaturation = 4,
    // Slightly amplify the reference refraction on small UI surfaces.
    scaleRatio = 1.25,
    displacementBlur = 0.55,
    specularBlur = 0.75,
    maxDpr = 3,
  } = options

  const filterId = nextFilterId()
  const filterDefs = ref('')
  let svgEl: SVGSVGElement | null = null
  let resizeObserver: ResizeObserver | null = null

  const glassStyle = computed(() => ({
    backdropFilter: `url(#${filterId})`,
    WebkitBackdropFilter: `url(#${filterId})`,
  }))

  /** 把最新 filter 定义写入 document.body 里隐藏的 SVG defs。 */
  function syncDefs() {
    if (!document.body || !filterDefs.value) return
    if (!svgEl) {
      svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svgEl.setAttribute('width', '0')
      svgEl.setAttribute('height', '0')
      svgEl.setAttribute('aria-hidden', 'true')
      svgEl.setAttribute('color-interpolation-filters', 'sRGB')
      svgEl.style.position = 'absolute'
      svgEl.style.overflow = 'hidden'
      document.body.appendChild(svgEl)
    }
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
    defs.innerHTML = filterDefs.value
    svgEl.replaceChildren(defs)
  }

  /** 按元素当前尺寸重新生成位移/高光贴图并写入 SVG filter。 */
  function rebuild() {
    const el = target.value
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    if (w < 2 || h < 2) return

    const radius = readCornerRadius(el, w, h)
    // Keep the reference proportions when the target differs from 200x200.
    const sizeRatio = Math.min(w, h) / 200
    const scaledThickness = glassThickness * sizeRatio
    const scaledBezelWidth = referenceBezelWidth * sizeRatio
    const bezelWidth = Math.min(scaledBezelWidth, radius - 1, Math.min(w, h) / 2 - 1)
    // 贴图按设备像素比生成（上限 maxDpr），配合滤镜内高斯模糊消除小元素边缘锯齿。
    // Large elements (e.g. the full-width topbar) cap the map's longest edge
    // at 1280px so rebuilds stay cheap.
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr, 1280 / Math.max(w, h, 1))

    const profile = calculateRefractionProfile(scaledThickness, bezelWidth, ior, 128)
    let maxDisp = 1
    for (const v of profile) maxDisp = Math.max(maxDisp, Math.abs(v))
    const dispUrl = generateDisplacementMap(w, h, radius, bezelWidth, profile, maxDisp, dpr)
    const specUrl = generateSpecularMap(w, h, radius, bezelWidth, Math.PI / 3, dpr)
    // 略降位移强度，避免边缘过强的像素级拉扯造成的锯齿感。
    const scale = maxDisp * scaleRatio

    filterDefs.value = `
      <filter id="${filterId}" x="0%" y="0%" width="100%" height="100%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="${blurAmount}" result="blurred_source" />
        <feImage href="${dispUrl}" x="0" y="0" width="${w}" height="${h}" result="disp_map" />
        <feGaussianBlur in="disp_map" stdDeviation="${displacementBlur}" result="disp_map_sm" />
        <feDisplacementMap in="blurred_source" in2="disp_map_sm" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="displaced" />
        <feColorMatrix in="displaced" type="saturate" values="${specularSaturation}" result="displaced_sat" />
        <feImage href="${specUrl}" x="0" y="0" width="${w}" height="${h}" result="spec_layer" />
        <feGaussianBlur in="spec_layer" stdDeviation="${specularBlur}" result="spec_layer_sm" />
        <feComposite in="displaced_sat" in2="spec_layer_sm" operator="in" result="spec_masked" />
        <feComponentTransfer in="spec_layer_sm" result="spec_faded">
          <feFuncA type="linear" slope="${specularOpacity}" />
        </feComponentTransfer>
        <feBlend in="spec_masked" in2="displaced" mode="normal" result="with_sat" />
        <feBlend in="spec_faded" in2="with_sat" mode="normal" />
      </filter>
    `
    syncDefs()
  }

  let resizeTimer: ReturnType<typeof setTimeout> | undefined
  function onResize() {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(rebuild, 150)
  }

  function observeTarget(el: HTMLElement | null | undefined) {
    resizeObserver?.disconnect()
    resizeObserver = null
    if (!el || typeof ResizeObserver === 'undefined') return

    resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(rebuild)
    })
    resizeObserver.observe(el)
  }

  // v-if 挂载/卸载导致 target 变化时重建（元素此时可能尚未布局完成，等下一帧）。
  watch(target, (el) => {
    observeTarget(el)
    if (el) nextTick(rebuild)
  })

  onMounted(() => {
    window.addEventListener('resize', onResize)
    observeTarget(target.value)
    nextTick(() => {
      if (target.value) rebuild()
    })
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', onResize)
    window.clearTimeout(resizeTimer)
    resizeObserver?.disconnect()
    resizeObserver = null
    svgEl?.remove()
    svgEl = null
  })

  return { filterId, glassStyle, rebuild }
}
