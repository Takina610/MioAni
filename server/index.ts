import cors from 'cors'
import express from 'express'
import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { warmupBrowser, withPage } from './stream-sources/browser.js'
import {
  isProviderId,
  isProxyHostAllowed,
  listPlaybackEpisodes,
  listProviders,
  resolvePlayback,
} from './stream-sources/index.js'

const app = express()
const PORT = Number(process.env.PORT || 8787)
const IS_PROD = process.env.NODE_ENV === 'production'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Load local secrets (e.g. BANGUMI_COOKIE) without a dotenv dependency.
// .env.local is git-ignored and should never hold committed credentials.
try {
  const envPath = new URL('../.env.local', import.meta.url)
  const envText = readFileSync(envPath, 'utf8')
  for (const line of envText.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
    }
  }
} catch {
  // .env.local is optional
}

/** Comma-separated allowlist; empty → reflect request origin (dev-friendly). */
function resolveCorsOrigin(): boolean | string | string[] {
  const raw = (process.env.CORS_ORIGIN || '').trim()
  if (!raw) return true
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (list.length === 0) return true
  if (list.length === 1) return list[0]
  return list
}

app.use(
  cors({
    origin: resolveCorsOrigin(),
    credentials: true,
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 204,
  }),
)
app.set('trust proxy', 1)
app.use(express.json({ limit: '32kb' }))

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'mioani-api',
    env: IS_PROD ? 'production' : 'development',
    time: new Date().toISOString(),
    playback: true,
  })
})

function parseAlt(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((v) => String(v).split(',')).map((s) => s.trim()).filter(Boolean)
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(',').map((s) => s.trim()).filter(Boolean)
  }
  return []
}

/**
 * Stream Resolve: title + episode → Playable Stream or Unplayable (HTTP 200).
 * Multi-source fallback is internal; response source is always mioani.
 */
app.get('/api/playback/sources', (_req, res) => {
  res.json({
    sources: listProviders(),
    default: 'auto',
  })
})

app.get('/api/playback/resolve', async (req, res) => {
  try {
    const title = typeof req.query.title === 'string' ? req.query.title.trim() : ''
    const episodeRaw = typeof req.query.episode === 'string' ? req.query.episode : ''
    const episode = Number(episodeRaw)
    const id = typeof req.query.id === 'string' ? req.query.id.trim() : undefined
    const alt = parseAlt(req.query.alt)
    const providerRaw =
      typeof req.query.provider === 'string' ? req.query.provider.trim() : ''
    const preferredProvider =
      providerRaw && providerRaw !== 'auto' && isProviderId(providerRaw)
        ? providerRaw
        : undefined

    if (!title) {
      res.status(400).json({ error: 'missing title' })
      return
    }
    if (!Number.isFinite(episode) || episode < 1) {
      res.status(400).json({ error: 'invalid episode' })
      return
    }

    const result = await resolvePlayback({
      title,
      alt,
      episode: Math.floor(episode),
      id,
      preferredProvider,
    })
    res.json(result)
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : String(err),
    })
  }
})

app.get('/api/playback/episodes', async (req, res) => {
  try {
    const title = typeof req.query.title === 'string' ? req.query.title.trim() : ''
    const alt = parseAlt(req.query.alt)
    if (!title) {
      res.status(400).json({ error: 'missing title' })
      return
    }
    const result = await listPlaybackEpisodes({ title, alt })
    res.json(result)
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : String(err),
    })
  }
})

/**
 * Media proxy for HLS playlists / segments with SSRF allowlist.
 * Rewrites m3u8 URIs through this proxy; streams large bodies.
 */
app.get('/api/playback/proxy', async (req, res) => {
  try {
    const raw = typeof req.query.url === 'string' ? req.query.url : ''
    if (!raw) {
      res.status(400).send('missing url')
      return
    }
    let target: URL
    try {
      target = new URL(raw)
    } catch {
      res.status(400).send('invalid url')
      return
    }
    if (!/^https?:$/i.test(target.protocol)) {
      res.status(400).send('invalid protocol')
      return
    }
    if (!isProxyHostAllowed(target.hostname)) {
      res.status(403).send('host not allowed')
      return
    }

    const headers: Record<string, string> = {
      'User-Agent': UA,
      Accept: '*/*',
      Referer: `${target.protocol}//${target.hostname}/`,
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    }
    const range = req.headers.range
    if (typeof range === 'string' && range) headers.Range = range

    // Classic m3u8 paths + ezdmw disguised listres (often .webp Content-Type, body is #EXTM3U)
    const pathLooksLikePlaylist =
      /\.m3u8(\?|$)/i.test(target.pathname) || /\/index\/listres\//i.test(target.pathname)
    if (pathLooksLikePlaylist) {
      await proxyPlaylistBuffered(target, headers, res)
      return
    }
    await proxyMediaStream(req, res, target, headers)
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
})

/**
 * Bangumi public page proxy (episode / subject / character / person HTML).
 * Path is allowlisted to prevent SSRF. Optional BANGUMI_COOKIE (from .env.local
 * or the deployment environment) lifts guest-only walls such as the subject
 * 吐槽 page (/subject/{id}/comments).
 */
app.get('/api/bangumi/page', async (req, res) => {
  try {
    const raw = typeof req.query.path === 'string' ? req.query.path.trim() : ''
    if (!raw || !/^(ep|character|person|subject)\/[0-9]+(\/comments)?$/i.test(raw)) {
      res.status(400).json({ error: 'invalid path' })
      return
    }
    const cookie = process.env.BANGUMI_COOKIE || ''
    // Node's native TLS fingerprint is rejected by bgm.tv; use the shared
    // Playwright browser (real Chromium handshake) and optionally inject the
    // user's login cookie to lift guest-only walls.
    const html = await withPage(async (page) => {
      if (cookie) {
        try {
          const pairs = cookie
            .split(';')
            .map((pair) => {
              const [name, ...rest] = pair.trim().split('=')
              return { name: name.trim(), value: rest.join('=').trim() }
            })
            .filter((c) => c.name && c.value)
          await page.context().addCookies(
            pairs.map((c) => ({ ...c, domain: 'bgm.tv', path: '/' })),
          )
        } catch {
          // ignore malformed cookie values
        }
      }
      await page.goto(`https://bgm.tv/${raw}`, {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      })
      // Bangumi lazy-renders some comment lists; let them settle.
      await page.waitForTimeout(900)
      return page.content()
    })
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html)
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

async function proxyPlaylistBuffered(
  target: URL,
  headers: Record<string, string>,
  res: express.Response,
): Promise<void> {
  const upstream = await fetch(target.toString(), { headers, redirect: 'follow' })
  let finalTarget = target
  try {
    finalTarget = new URL(upstream.url)
  } catch {
    res.status(502).send('bad upstream url')
    return
  }
  if (!/^https?:$/i.test(finalTarget.protocol) || !isProxyHostAllowed(finalTarget.hostname)) {
    res.status(403).send('host not allowed after redirect')
    return
  }
  if (!upstream.ok && upstream.status !== 206) {
    res.status(upstream.status || 502).send('upstream error')
    return
  }

  // Always buffer text for playlist paths; force HLS content-type when body is m3u8
  // (ezdmw listres may claim image/webp).
  const text = await upstream.text()
  if (/^\s*#EXTM3U/im.test(text) || /#EXTM3U/i.test(text.slice(0, 256))) {
    const rewritten = rewriteHlsPlaylist(text, finalTarget)
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
    res.setHeader('Cache-Control', 'private, no-store')
    res.status(200).send(rewritten)
    return
  }
  const contentType = upstream.headers.get('content-type') || 'application/octet-stream'
  res.status(upstream.status)
  res.setHeader('Content-Type', contentType)
  res.setHeader('Cache-Control', 'private, no-store')
  res.send(text)
}

async function proxyMediaStream(
  req: express.Request,
  res: express.Response,
  target: URL,
  headers: Record<string, string>,
): Promise<void> {
  const abort = new AbortController()
  const onClientClose = () => abort.abort()
  req.on('close', onClientClose)

  try {
    const upstream = await fetch(target.toString(), {
      headers,
      redirect: 'follow',
      signal: abort.signal,
    })

    let finalTarget = target
    try {
      finalTarget = new URL(upstream.url)
    } catch {
      res.status(502).send('bad upstream url')
      return
    }
    if (!/^https?:$/i.test(finalTarget.protocol) || !isProxyHostAllowed(finalTarget.hostname)) {
      res.status(403).send('host not allowed after redirect')
      return
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream'
    const looksLikePlaylistCt =
      /mpegurl|m3u8/i.test(contentType) ||
      /\/index\/listres\//i.test(finalTarget.pathname) ||
      // Disguised playlist: webp/octet that may actually be m3u8 (peek only small paths)
      (/image\/webp|octet-stream|text\/plain/i.test(contentType) &&
        /listres|\.webp$/i.test(finalTarget.pathname))

    if (looksLikePlaylistCt) {
      const text = await upstream.text()
      if (/^\s*#EXTM3U/im.test(text) || /#EXTM3U/i.test(text.slice(0, 256))) {
        const rewritten = rewriteHlsPlaylist(text, finalTarget)
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
        res.setHeader('Cache-Control', 'private, no-store')
        res.status(200).send(rewritten)
        return
      }
      // Not a playlist after all — send buffered body as-is
      if (!upstream.ok && upstream.status !== 206) {
        res.status(upstream.status || 502).send('upstream error')
        return
      }
      res.status(upstream.status)
      // If body started as playlist path but wasn't m3u8, keep upstream type
      res.setHeader('Content-Type', contentType)
      res.setHeader('Cache-Control', 'private, no-store')
      res.send(text)
      return
    }

    if (!upstream.ok && upstream.status !== 206) {
      res.status(upstream.status || 502).send('upstream error')
      return
    }

    res.status(upstream.status)
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'private, no-store')
    const contentRange = upstream.headers.get('content-range')
    if (contentRange) res.setHeader('Content-Range', contentRange)
    const acceptRanges = upstream.headers.get('accept-ranges')
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges)
    const contentLength = upstream.headers.get('content-length')
    if (contentLength) res.setHeader('Content-Length', contentLength)

    if (!upstream.body) {
      res.end()
      return
    }

    const nodeStream = Readable.fromWeb(upstream.body as unknown as NodeReadableStream)
    nodeStream.on('error', () => {
      if (!res.writableEnded) res.destroy()
    })
    res.on('close', () => {
      nodeStream.destroy()
      abort.abort()
    })
    nodeStream.pipe(res)
  } finally {
    req.off('close', onClientClose)
  }
}

function rewriteHlsPlaylist(body: string, base: URL): string {
  return body
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/gi, (_m, uri: string) => {
          const abs = absAllowedMediaUrl(base, uri)
          if (!abs) return _m
          return `URI="${proxyMediaUrl(abs)}"`
        })
      }
      const abs = absAllowedMediaUrl(base, trimmed)
      if (!abs) return line
      return proxyMediaUrl(abs)
    })
    .join('\n')
}

function absAllowedMediaUrl(base: URL, ref: string): string | null {
  try {
    const u = new URL(ref, base)
    if (!/^https?:$/i.test(u.protocol)) return null
    if (!isProxyHostAllowed(u.hostname)) return null
    return u.toString()
  } catch {
    return null
  }
}

function proxyMediaUrl(absolute: string): string {
  return `/api/playback/proxy?url=${encodeURIComponent(absolute)}`
}

app.listen(PORT, () => {
  console.log(`[mioani-api] listening on :${PORT} (${IS_PROD ? 'production' : 'development'})`)
  if (process.env.PLAYBACK_DEBUG === '1') {
    console.log('[mioani-api] PLAYBACK_DEBUG=1 (provider names in responses)')
  }
  // Warm Chromium so the first user resolve is not cold-starting the browser.
  void warmupBrowser()
})
