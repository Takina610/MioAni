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
  /**
   * Gate the whole effect. While false no maps are generated, no observers run
   * and `glassStyle` is empty — lets long card grids only pay for the glass
   * that is actually on screen (hovered / open menu).
   */
  active?: Ref<boolean>
}

/** 凸起圆角方形截面：边缘陡峭、向中心趋于平缓。 */
const SURFACE_FN = (x: number): number => Math.pow(1 - Math.pow(1 - x, 4), 0.25)

/** Minimum gap between two full map regenerations while an element is mid-resize. */
const REBUILD_THROTTLE_MS = 100
/** Quiet period after the last resize event before the final (cached) build. */
const SETTLE_MS = 120

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

/**
 * Visit only the pixels that can carry glass data: the outer band of
 * `bandWidth` device pixels (bezel + corner radius). Everything inside stays at
 * the neutral fill, so a wide topbar costs the same as a small button.
 */
function forEachBandPixel(
  W: number,
  H: number,
  bandWidth: number,
  visit: (x: number, y: number) => void,
) {
  const band = Math.min(Math.ceil(bandWidth) + 1, Math.ceil(Math.max(W, H) / 2))
  const innerTop = band
  const innerBottom = H - band
  for (let y1 = 0; y1 < H; y1++) {
    if (y1 < innerTop || y1 >= innerBottom) {
      for (let x1 = 0; x1 < W; x1++) visit(x1, y1)
      continue
    }
    const leftEnd = Math.min(band, W)
    for (let x1 = 0; x1 < leftEnd; x1++) visit(x1, y1)
    for (let x1 = Math.max(W - band, leftEnd); x1 < W; x1++) visit(x1, y1)
  }
}

interface MapBitmaps {
  width: number
  height: number
  /** RGBA, row-major. */
  displacement: Uint8Array
  specular: Uint8Array
}

/**
 * 生成位移贴图 + 镜面高光贴图。
 * 位移贴图：红/绿通道编码 X/Y 位移方向，仅玻璃边缘环内生效；
 * 高光贴图：沿光源方向强化边缘反光。
 * 贴图按 scaleFactor 放大，配合 feImage 缩放到元素尺寸，可让位移值随设备像素平滑变化。
 */
function generateMaps(
  w: number,
  h: number,
  radius: number,
  bezelWidth: number,
  profile: Float64Array,
  maxDisp: number,
  scaleFactor: number,
  specularAngle = Math.PI / 3,
): MapBitmaps {
  const W = Math.max(1, Math.round(w * scaleFactor))
  const H = Math.max(1, Math.round(h * scaleFactor))
  const d = new Uint8Array(W * H * 4)
  const s = new Uint8Array(W * H * 4)
  // Neutral displacement (128,128) everywhere; specular fully transparent.
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 128
    d[i + 1] = 128
    d[i + 3] = 255
  }

  const R = radius * scaleFactor
  const BW = Math.max(bezelWidth * scaleFactor, 1)
  const samples = profile.length
  const sv0 = Math.cos(specularAngle)
  const sv1 = Math.sin(specularAngle)

  forEachBandPixel(W, H, BW + R, (x1, y1) => {
    const edge = getRoundedRectEdge(x1 + 0.5 - W / 2, y1 + 0.5 - H / 2, W, H, R)
    if (!edge || edge.depth > BW) return
    const idx = (y1 * W + x1) * 4

    const bi = Math.min(Math.max((edge.depth / BW) * samples, 0) | 0, samples - 1)
    const disp = profile[bi] || 0
    d[idx] = (128 + (-edge.nx * disp * 127) / maxDisp + 0.5) | 0
    d[idx + 1] = (128 + (-edge.ny * disp * 127) / maxDisp + 0.5) | 0

    const dot = Math.abs(edge.nx * sv0 - edge.ny * sv1)
    const rim = Math.sqrt(Math.max(0, 1 - edge.depth / BW))
    const coeff = dot * rim
    const col = (255 * coeff) | 0
    s[idx] = col
    s[idx + 1] = col
    s[idx + 2] = col
    s[idx + 3] = (col * coeff) | 0
  })

  return { width: W, height: H, displacement: d, specular: s }
}

// ---------------------------------------------------------------------------
// Minimal PNG writer (RGBA8, zlib "stored" blocks, no compression).
//
// `canvas.toDataURL()` / `toBlob()` both PNG-encode with deflate on the main
// thread (toBlob only *looks* async) and showed up as 100–250ms stalls while
// the topbar morphs. Writing an uncompressed PNG is a straight copy plus two
// checksums: ~1ms for a 1280×58 map, negligible for buttons. Browsers decode
// stored PNGs as fast as they can memcpy.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array, start: number, end: number): number {
  let a = 1
  let b = 0
  let i = start
  // Process in chunks so the sums stay below 2^32 before the modulo.
  while (i < end) {
    const chunkEnd = Math.min(end, i + 3800)
    for (; i < chunkEnd; i++) {
      a += bytes[i]!
      b += a
    }
    a %= 65521
    b %= 65521
  }
  return ((b << 16) | a) >>> 0
}

function writeU32(out: Uint8Array, offset: number, value: number) {
  out[offset] = (value >>> 24) & 0xff
  out[offset + 1] = (value >>> 16) & 0xff
  out[offset + 2] = (value >>> 8) & 0xff
  out[offset + 3] = value & 0xff
}

function writeChunk(out: Uint8Array, offset: number, type: string, payloadLength: number): number {
  writeU32(out, offset, payloadLength)
  for (let i = 0; i < 4; i++) out[offset + 4 + i] = type.charCodeAt(i)
  // payload is expected to already sit at offset + 8
  const crc = crc32(out, offset + 4, offset + 8 + payloadLength)
  writeU32(out, offset + 8 + payloadLength, crc)
  return offset + 12 + payloadLength
}

function encodePngRgba(width: number, height: number, rgba: Uint8Array): Uint8Array<ArrayBuffer> {
  const rowLen = width * 4 + 1
  const rawLen = rowLen * height
  const blockCount = Math.ceil(rawLen / 65535)
  const idatLen = 2 + rawLen + blockCount * 5 + 4
  const total = 8 + (12 + 13) + (12 + idatLen) + 12
  const out = new Uint8Array(new ArrayBuffer(total))
  let o = 0

  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  o = 8

  // IHDR
  writeU32(out, o + 8, width)
  writeU32(out, o + 12, height)
  out[o + 16] = 8 // bit depth
  out[o + 17] = 6 // RGBA
  out[o + 18] = 0
  out[o + 19] = 0
  out[o + 20] = 0
  o = writeChunk(out, o, 'IHDR', 13)

  // Filtered scanlines: filter byte 0 (None) followed by the row's RGBA bytes.
  const raw = new Uint8Array(rawLen)
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * rowLen + 1)
  }

  // IDAT: zlib header + stored deflate blocks + adler32
  const idatStart = o + 8
  let p = idatStart
  out[p++] = 0x78
  out[p++] = 0x01
  let offset = 0
  while (offset < rawLen) {
    const len = Math.min(65535, rawLen - offset)
    const last = offset + len >= rawLen
    out[p++] = last ? 1 : 0
    out[p++] = len & 0xff
    out[p++] = (len >>> 8) & 0xff
    out[p++] = ~len & 0xff
    out[p++] = (~len >>> 8) & 0xff
    out.set(raw.subarray(offset, offset + len), p)
    p += len
    offset += len
  }
  writeU32(out, p, adler32(raw, 0, rawLen))
  p += 4
  o = writeChunk(out, o, 'IDAT', p - idatStart)

  // IEND
  o = writeChunk(out, o, 'IEND', 0)
  return out.subarray(0, o)
}

function bitmapToUrl(width: number, height: number, rgba: Uint8Array): string {
  const png = encodePngRgba(width, height, rgba)
  return URL.createObjectURL(new Blob([png], { type: 'image/png' }))
}

interface GlassGeometry {
  w: number
  h: number
  radius: number
  dpr: number
}

interface ResolvedOptions {
  glassThickness: number
  bezelWidth: number
  ior: number
  blurAmount: number
  specularOpacity: number
  specularSaturation: number
  scaleRatio: number
  displacementBlur: number
  specularBlur: number
  maxDpr: number
}

/**
 * One rendered SVG filter, shared by every element with identical geometry and
 * options (e.g. all poster buttons in a grid). Reference counted.
 */
interface GlassEntry {
  key: string
  id: string
  refs: number
  /** Device-pixel area of the maps; drives the idle-cache budget. */
  area: number
  /** Built for an in-flight size during a transition: never worth caching. */
  transient: boolean
  svg: SVGSVGElement
  dispImage: SVGFEImageElement | null
  specImage: SVGFEImageElement | null
  /** Object URLs owned by this entry (revoked on dispose). */
  urls: string[]
}

const registry = new Map<string, GlassEntry>()
/**
 * Unreferenced entries kept warm, oldest first, so toggling the topbar or
 * re-hovering a card never regenerates maps. Bounded by total map area.
 */
const idle: GlassEntry[] = []
const IDLE_AREA_BUDGET = 1_500_000
let idleArea = 0

function optionsKey(o: ResolvedOptions): string {
  return [
    o.glassThickness, o.bezelWidth, o.ior, o.blurAmount, o.specularOpacity,
    o.specularSaturation, o.scaleRatio, o.displacementBlur, o.specularBlur,
  ].join(',')
}

function geometryKey(g: GlassGeometry, o: ResolvedOptions): string {
  return `${g.w}x${g.h}|r${g.radius.toFixed(2)}|d${g.dpr.toFixed(3)}|${optionsKey(o)}`
}

function createEntry(key: string, geometry: GlassGeometry, o: ResolvedOptions): GlassEntry {
  const id = nextFilterId()
  const { w, h } = geometry
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('color-interpolation-filters', 'sRGB')
  svg.style.position = 'absolute'
  svg.style.overflow = 'hidden'
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
  // Map hrefs are filled in once the bitmaps are encoded.
  defs.innerHTML = `
    <filter id="${id}" x="0%" y="0%" width="100%" height="100%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="${o.blurAmount}" result="blurred_source" />
      <feImage data-role="disp" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="disp_map" />
      <feGaussianBlur in="disp_map" stdDeviation="${o.displacementBlur}" result="disp_map_sm" />
      <feDisplacementMap data-role="displace" in="blurred_source" in2="disp_map_sm" scale="0" xChannelSelector="R" yChannelSelector="G" result="displaced" />
      <feColorMatrix in="displaced" type="saturate" values="${o.specularSaturation}" result="displaced_sat" />
      <feImage data-role="spec" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="spec_layer" />
      <feGaussianBlur in="spec_layer" stdDeviation="${o.specularBlur}" result="spec_layer_sm" />
      <feComposite in="displaced_sat" in2="spec_layer_sm" operator="in" result="spec_masked" />
      <feComponentTransfer in="spec_layer_sm" result="spec_faded">
        <feFuncA type="linear" slope="${o.specularOpacity}" />
      </feComponentTransfer>
      <feBlend in="spec_masked" in2="displaced" mode="normal" result="with_sat" />
      <feBlend in="spec_faded" in2="with_sat" mode="normal" />
    </filter>
  `
  svg.appendChild(defs)
  document.body.appendChild(svg)
  return {
    key,
    id,
    refs: 0,
    area: Math.round(w * geometry.dpr) * Math.round(h * geometry.dpr),
    transient: false,
    svg,
    dispImage: svg.querySelector<SVGFEImageElement>('feImage[data-role="disp"]'),
    specImage: svg.querySelector<SVGFEImageElement>('feImage[data-role="spec"]'),
    urls: [],
  }
}

function removeFromIdle(entry: GlassEntry) {
  const idx = idle.indexOf(entry)
  if (idx === -1) return
  idle.splice(idx, 1)
  idleArea -= entry.area
}

function disposeEntry(entry: GlassEntry) {
  registry.delete(entry.key)
  removeFromIdle(entry)
  entry.svg.remove()
  for (const url of entry.urls) URL.revokeObjectURL(url)
  entry.urls = []
}

function retainEntry(entry: GlassEntry) {
  entry.refs += 1
  removeFromIdle(entry)
}

/** Drop a reference; unreferenced entries park in the idle cache (LRU by area). */
function releaseEntry(entry: GlassEntry | null) {
  if (!entry) return
  entry.refs -= 1
  if (entry.refs > 0) return
  if (entry.transient || entry.area > IDLE_AREA_BUDGET) {
    disposeEntry(entry)
    return
  }
  idle.push(entry)
  idleArea += entry.area
  while (idleArea > IDLE_AREA_BUDGET && idle.length > 1) {
    const oldest = idle[0]!
    disposeEntry(oldest)
  }
}

function setImageHref(image: SVGFEImageElement | null, url: string) {
  if (!image) return
  image.setAttribute('href', url)
  image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url)
}

/** Point the entry's maps at freshly encoded bitmaps and drop the old ones. */
function applyMapUrls(entry: GlassEntry, dispUrl: string, specUrl: string, scale: number, w: number, h: number) {
  const old = entry.urls
  entry.urls = []
  setImageHref(entry.dispImage, dispUrl)
  setImageHref(entry.specImage, specUrl)
  entry.dispImage?.setAttribute('width', String(w))
  entry.dispImage?.setAttribute('height', String(h))
  entry.specImage?.setAttribute('width', String(w))
  entry.specImage?.setAttribute('height', String(h))
  entry.svg.querySelector('feDisplacementMap')?.setAttribute('scale', String(scale))
  if (dispUrl.startsWith('blob:')) entry.urls.push(dispUrl)
  if (specUrl.startsWith('blob:')) entry.urls.push(specUrl)
  for (const url of old) URL.revokeObjectURL(url)
}

/** Stretch an entry's existing maps to a new box (cheap mid-transition stand-in). */
function stretchEntry(entry: GlassEntry, w: number, h: number) {
  entry.dispImage?.setAttribute('width', String(w))
  entry.dispImage?.setAttribute('height', String(h))
  entry.specImage?.setAttribute('width', String(w))
  entry.specImage?.setAttribute('height', String(h))
}

/** Generate and attach the maps for an entry (synchronous, ~1ms for a topbar). */
function populateEntry(entry: GlassEntry, geometry: GlassGeometry, o: ResolvedOptions) {
  const { w, h, radius, dpr } = geometry
  // Keep the reference proportions when the target differs from 200x200.
  const sizeRatio = Math.min(w, h) / 200
  const scaledThickness = o.glassThickness * sizeRatio
  const scaledBezelWidth = o.bezelWidth * sizeRatio
  const bezelWidth = Math.min(scaledBezelWidth, radius - 1, Math.min(w, h) / 2 - 1)

  const profile = calculateRefractionProfile(scaledThickness, bezelWidth, o.ior, 128)
  let maxDisp = 1
  for (const v of profile) maxDisp = Math.max(maxDisp, Math.abs(v))
  const maps = generateMaps(w, h, radius, bezelWidth, profile, maxDisp, dpr)
  // 略降位移强度，避免边缘过强的像素级拉扯造成的锯齿感。
  const scale = maxDisp * o.scaleRatio

  applyMapUrls(
    entry,
    bitmapToUrl(maps.width, maps.height, maps.displacement),
    bitmapToUrl(maps.width, maps.height, maps.specular),
    scale,
    w,
    h,
  )
}

/**
 * iOS 26 风格液态玻璃（liquid glass）组合式函数。
 *
 * 实现参照 https://github.com/archisvaze/liquid-glass 的 SVG 版本：
 * 在内存中生成折射位移贴图 + 镜面高光贴图（直接写成未压缩 PNG，避开 canvas 编码开销），
 * 配合 `backdrop-filter: url(#svg-filter)` 做边缘折射。效果仅 Chromium 内核浏览器可渲染，
 * 其余浏览器退化为无滤镜样式。
 *
 * 用法：把目标元素的 ref 传入，将返回的 glassStyle 绑定到该元素即可。
 * 相同尺寸/参数的元素共享同一个 SVG filter（引用计数），组件卸载时自动释放；
 * 元素尺寸变化（含窗口 resize）与 v-if 挂载后都会自动重建贴图。
 * 传入 `active` 可把整套效果做成按需开启（例如卡片仅在 hover 时启用）。
 */
export function useLiquidGlass(
  target: Ref<HTMLElement | null | undefined>,
  options: LiquidGlassOptions = {},
) {
  const resolved: ResolvedOptions = {
    // Match the reference controls: 200x200, thickness 80, bezel 60.
    glassThickness: options.glassThickness ?? 80,
    bezelWidth: options.bezelWidth ?? 60,
    ior: options.ior ?? 3,
    blurAmount: options.blurAmount ?? 0.3,
    specularOpacity: options.specularOpacity ?? 0.5,
    specularSaturation: options.specularSaturation ?? 4,
    // Slightly amplify the reference refraction on small UI surfaces.
    scaleRatio: options.scaleRatio ?? 1.25,
    displacementBlur: options.displacementBlur ?? 0.55,
    specularBlur: options.specularBlur ?? 0.75,
    maxDpr: options.maxDpr ?? 3,
  }
  const active = options.active

  const filterId = ref<string | null>(null)
  let entry: GlassEntry | null = null
  let resizeObserver: ResizeObserver | null = null
  let lastRebuildAt = -Infinity
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let mounted = false

  const glassStyle = computed(() => {
    if (!filterId.value) return undefined
    return {
      backdropFilter: `url(#${filterId.value})`,
      WebkitBackdropFilter: `url(#${filterId.value})`,
    }
  })

  function isActive(): boolean {
    return active ? active.value : true
  }

  function readGeometry(el: HTMLElement): GlassGeometry | null {
    const w = el.offsetWidth
    const h = el.offsetHeight
    if (w < 2 || h < 2) return null
    const radius = readCornerRadius(el, w, h)
    // 贴图按设备像素比生成（上限 maxDpr），配合滤镜内高斯模糊消除小元素边缘锯齿。
    // Large elements (e.g. the full-width topbar) cap the map's longest edge
    // at 1280px so rebuilds stay cheap.
    const dpr = Math.min(window.devicePixelRatio || 1, resolved.maxDpr, 1280 / Math.max(w, h, 1))
    return { w, h, radius, dpr }
  }

  function adopt(next: GlassEntry | null) {
    if (next === entry) return
    if (next) retainEntry(next)
    releaseEntry(entry)
    entry = next
    filterId.value = next ? next.id : null
  }

  /**
   * 按元素当前尺寸重新生成位移/高光贴图并写入（或复用）共享 SVG filter。
   * `transient` marks a build for an in-flight size mid-transition so it is
   * dropped as soon as it is superseded instead of parked in the idle cache.
   */
  function rebuild(transient = false) {
    const el = target.value
    if (!el || !isActive()) return
    const geometry = readGeometry(el)
    if (!geometry) return
    lastRebuildAt = performance.now()

    const key = geometryKey(geometry, resolved)
    const shared = registry.get(key)
    if (shared) {
      if (!transient) shared.transient = false
      adopt(shared)
      return
    }
    const created = createEntry(key, geometry, resolved)
    created.transient = transient
    registry.set(key, created)
    populateEntry(created, geometry, resolved)
    adopt(created)
  }

  /**
   * ResizeObserver fires every frame while the element is transitioning (e.g.
   * the topbar morphing into its compact capsule). Stretch the current maps to
   * the live box immediately, regenerate at most every 100ms while the size is
   * still moving, and do one final cached build once it has settled.
   */
  function onResized() {
    const el = target.value
    if (!el || !isActive()) return
    if (entry && entry.refs === 1) {
      stretchEntry(entry, el.offsetWidth, el.offsetHeight)
    }
    window.clearTimeout(settleTimer)
    settleTimer = window.setTimeout(() => {
      settleTimer = undefined
      rebuild(false)
    }, SETTLE_MS)
    if (performance.now() - lastRebuildAt >= REBUILD_THROTTLE_MS) rebuild(true)
  }

  function observeTarget(el: HTMLElement | null | undefined) {
    resizeObserver?.disconnect()
    resizeObserver = null
    if (!el || !isActive() || typeof ResizeObserver === 'undefined') return
    resizeObserver = new ResizeObserver(onResized)
    resizeObserver.observe(el)
  }

  function activate() {
    observeTarget(target.value)
    nextTick(() => {
      if (mounted && target.value) rebuild()
    })
  }

  function deactivate() {
    resizeObserver?.disconnect()
    resizeObserver = null
    window.clearTimeout(settleTimer)
    settleTimer = undefined
    adopt(null)
  }

  // v-if 挂载/卸载导致 target 变化时重建（元素此时可能尚未布局完成，等下一帧）。
  watch(target, (el) => {
    if (!isActive()) return
    if (el) activate()
    else deactivate()
  })

  if (active) {
    watch(active, (on) => {
      if (!mounted) return
      if (on) activate()
      else deactivate()
    })
  }

  onMounted(() => {
    mounted = true
    window.addEventListener('resize', onResized)
    if (isActive()) activate()
  })

  onBeforeUnmount(() => {
    mounted = false
    window.removeEventListener('resize', onResized)
    deactivate()
  })

  return { filterId, glassStyle, rebuild }
}
