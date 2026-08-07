import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

export interface LiquidGlassOptions {
  /** 玻璃厚度（px）。 */
  glassThickness?: number
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
    glassThickness = 12,
    ior = 3,
    blurAmount = 0.3,
    specularOpacity = 0.5,
    specularSaturation = 4,
    scaleRatio = 0.8,
    displacementBlur = 1.2,
    specularBlur = 1,
    maxDpr = 3,
  } = options

  const filterId = nextFilterId()
  const filterDefs = ref('')
  let svgEl: SVGSVGElement | null = null

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

    const radius = Math.min(w, h) / 2
    // 参数按 demo 默认值（300×200 玻璃、bezel 60、thickness 80）等比缩放到元素尺寸。
    const bezelWidth = Math.min(glassThickness, radius - 1, Math.min(w, h) / 2 - 1)
    // 贴图按设备像素比生成（上限 maxDpr），配合滤镜内高斯模糊消除小元素边缘锯齿。
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr)

    const profile = calculateRefractionProfile(glassThickness, bezelWidth, ior, 128)
    let maxDisp = 1
    for (const v of profile) maxDisp = Math.max(maxDisp, Math.abs(v))
    const dispUrl = generateDisplacementMap(w, h, radius, bezelWidth, profile, maxDisp, dpr)
    const specUrl = generateSpecularMap(w, h, radius, bezelWidth * 2.5, Math.PI / 3, dpr)
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

  // v-if 挂载/卸载导致 target 变化时重建（元素此时可能尚未布局完成，等下一帧）。
  watch(target, (el) => {
    if (el) nextTick(rebuild)
  })

  onMounted(() => {
    window.addEventListener('resize', onResize)
    nextTick(() => {
      if (target.value) rebuild()
    })
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', onResize)
    window.clearTimeout(resizeTimer)
    svgEl?.remove()
    svgEl = null
  })

  return { filterId, glassStyle, rebuild }
}
