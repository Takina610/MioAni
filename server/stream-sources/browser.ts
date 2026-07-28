import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * Media URL patterns for intercept.
 * Includes ezdmw disguised playlists: `/index/listres/.../*.webp` (body is real #EXTM3U).
 */
const MEDIA_RE =
  /\.m3u8(\?|$)|\.mp4(\?|$)|\/m3u8|type=m3u8|playlist\.m3u8|\/index\/listres\//i

/** Default intercept budget — early-exit usually settles much sooner. */
const DEFAULT_INTERCEPT_MS = Number(process.env.PLAYBACK_INTERCEPT_MS || 16000)

let browserPromise: Promise<Browser> | null = null
let contextPromise: Promise<BrowserContext> | null = null

export function isMediaUrl(url: string): boolean {
  return MEDIA_RE.test(url)
}

export function isListresPlaylistUrl(url: string): boolean {
  return /\/index\/listres\//i.test(url)
}

export function classifyMediaUrl(url: string): 'hls' | 'progressive' {
  if (
    /\.m3u8(\?|$)|\/m3u8|type=m3u8|playlist\.m3u8|mpegurl|\/index\/listres\//i.test(url)
  ) {
    return 'hls'
  }
  return 'progressive'
}

function isMediaByContentType(ct: string, url: string): boolean {
  const lower = ct.toLowerCase()
  if (lower.includes('mpegurl') || lower.includes('application/vnd.apple.mpegurl')) return true
  // Disguised HLS (ezdmw listres often serves #EXTM3U as image/webp)
  if (isListresPlaylistUrl(url)) return true
  if (lower.includes('video/') && url.startsWith('http')) return true
  return false
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({
        headless: true,
        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
      })
      .catch((err) => {
        browserPromise = null
        throw err
      })
  }
  return browserPromise
}

export async function getSharedContext(): Promise<BrowserContext> {
  if (!contextPromise) {
    contextPromise = (async () => {
      const browser = await getBrowser()
      return browser.newContext({
        userAgent: UA,
        locale: 'zh-CN',
        viewport: { width: 1280, height: 800 },
      })
    })().catch((err) => {
      contextPromise = null
      throw err
    })
  }
  return contextPromise
}

/**
 * Launch Chromium + shared context at API boot so the first resolve is not cold.
 * Safe to call multiple times; failures are logged and non-fatal.
 */
export async function warmupBrowser(): Promise<void> {
  const t0 = Date.now()
  try {
    await getSharedContext()
    console.log(`[playback] browser warm in ${Date.now() - t0}ms`)
  } catch (e) {
    console.warn('[playback] browser warmup failed (resolve may cold-start):', e)
  }
}

export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const context = await getSharedContext()
  const page = await context.newPage()
  try {
    return await fn(page)
  } finally {
    await page.close().catch(() => {})
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Open episode page and intercept m3u8 / mp4 requests.
 * Settles on the **first** matching media (early exit) or when the deadline hits.
 * No fixed multi-second sleep after goto when media already appeared.
 */
export async function interceptMedia(
  page: Page,
  episodeUrl: string,
  timeoutMs = DEFAULT_INTERCEPT_MS,
): Promise<{ ok: boolean; found: string[]; error: string | null }> {
  const found: string[] = []
  let firstResolve: ((url: string) => void) | null = null
  const firstMedia = new Promise<string>((resolve) => {
    firstResolve = resolve
  })

  const tryAdd = (u: string) => {
    if (!u || !u.startsWith('http')) return
    if (found.includes(u)) return
    found.push(u)
    if (firstResolve) {
      const r = firstResolve
      firstResolve = null
      r(u)
    }
  }

  const onReq = (req: { url: () => string }) => {
    const u = req.url()
    if (MEDIA_RE.test(u)) tryAdd(u)
  }
  const onRes = (res: { url: () => string; headers: () => Record<string, string> }) => {
    const u = res.url()
    const ct = res.headers()['content-type'] || ''
    if (MEDIA_RE.test(u) || isMediaByContentType(ct, u)) tryAdd(u)
  }

  page.on('request', onReq)
  page.on('response', onRes)

  const deadline = Date.now() + timeoutMs
  const remaining = () => Math.max(0, deadline - Date.now())

  try {
    const gotoTimeout = Math.min(25000, timeoutMs)
    const gotoPromise = page
      .goto(episodeUrl, { waitUntil: 'domcontentloaded', timeout: gotoTimeout })
      .then(() => 'goto' as const)
      .catch((e: Error) => {
        // Navigation errors still allow intercept if media already fired.
        if (!found.length) throw e
        return 'goto' as const
      })

    // Race navigation against first media — do not wait out a fixed sleep after goto.
    const early = await Promise.race([
      firstMedia.then(() => 'media' as const),
      gotoPromise,
      sleep(remaining()).then(() => 'timeout' as const),
    ])

    if (early === 'media' || found.length) {
      return { ok: true, found: found.slice(0, 8), error: null }
    }
    if (early === 'timeout' || remaining() <= 0) {
      return {
        ok: false,
        found: [],
        error: 'no_media_intercepted',
      }
    }

    // Brief post-goto grace: many players fire media within 1–2s of DOM ready.
    // Abort as soon as the first media request appears.
    const graceMs = Math.min(2500, remaining())
    if (graceMs > 50) {
      const grace = await Promise.race([
        firstMedia.then(() => 'media' as const),
        sleep(graceMs).then(() => 'grace' as const),
      ])
      if (grace === 'media' || found.length) {
        return { ok: true, found: found.slice(0, 8), error: null }
      }
    }

    // Click-play fallback only if nothing found yet.
    for (const sel of [
      'text=播放',
      '.play',
      '#play',
      'button:has-text("播放")',
      '.mac_play',
      'iframe',
    ]) {
      if (found.length || remaining() <= 0) break
      try {
        const el = page.locator(sel).first()
        if (await el.count()) {
          if (sel !== 'iframe') await el.click({ timeout: 800 }).catch(() => {})
        }
      } catch {
        /* ignore */
      }
      if (found.length) break
      // Tiny yield so request handlers can run after click
      await Promise.race([
        firstMedia.then(() => undefined),
        sleep(Math.min(400, remaining())),
      ])
    }

    if (found.length) {
      return { ok: true, found: found.slice(0, 8), error: null }
    }

    // Final wait until deadline for late-loading players (no blind fixed 5s).
    const tail = remaining()
    if (tail > 100) {
      await Promise.race([firstMedia, sleep(tail)])
    }
  } catch (e) {
    return {
      ok: found.length > 0,
      found: found.slice(0, 8),
      error: found.length ? null : String((e as Error).message || e),
    }
  } finally {
    page.off('request', onReq)
    page.off('response', onRes)
  }

  return {
    ok: found.length > 0,
    found: found.slice(0, 8),
    error: found.length ? null : 'no_media_intercepted',
  }
}

export function pickBestMedia(urls: string[]): string | null {
  if (!urls.length) return null
  // Prefer ezdmw full playlist (without /first/true/ partial path) over other hls
  const listresFull = urls.find(
    (u) => isListresPlaylistUrl(u) && !/\/first\//i.test(u),
  )
  if (listresFull) return listresFull
  const listresAny = urls.find((u) => isListresPlaylistUrl(u))
  if (listresAny) return listresAny
  const hls = urls.find((u) => classifyMediaUrl(u) === 'hls')
  return hls || urls[0] || null
}

export { UA }
