import { dm84Provider } from './dm84.js'
import { ezdmwProvider } from './ezdmw.js'
import { mxdmProvider } from './mxdm.js'
import { soraniProvider } from './sorani.js'
import type {
  AnimeStreamProvider,
  EpisodesResult,
  ProviderId,
  ResolveRequest,
  ResolveResult,
} from './types.js'

export type {
  EpisodeInfo,
  EpisodesResult,
  PlayableStream,
  ProviderId,
  ProviderInfo,
  ResolveRequest,
  ResolveResult,
  StreamKind,
} from './types.js'

const DEBUG = () => process.env.PLAYBACK_DEBUG === '1'

/** Fixed fallback order: sorani → ezdmw → MXdm → DM84. */
const PROVIDERS: AnimeStreamProvider[] = [
  soraniProvider,
  ezdmwProvider,
  mxdmProvider,
  dm84Provider,
]

const PROVIDER_LABELS: Record<ProviderId, string> = {
  sorani: '线路 1',
  ezdmw: '线路 2',
  MXdm: '线路 3',
  DM84: '线路 4',
}

export function listProviders(): ProviderInfo[] {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: PROVIDER_LABELS[p.id] || p.id,
  }))
}

export function isProviderId(value: string): value is ProviderId {
  return PROVIDERS.some((p) => p.id === value)
}

/** preferred first, then the rest in fixed order (wrap-around). */
function providerSequence(preferred?: ProviderId): AnimeStreamProvider[] {
  if (!preferred) return [...PROVIDERS]
  const idx = PROVIDERS.findIndex((p) => p.id === preferred)
  if (idx < 0) return [...PROVIDERS]
  return [...PROVIDERS.slice(idx), ...PROVIDERS.slice(0, idx)]
}

/** Per-provider budget; intercept early-exit makes ~25–30s enough for cold paths. */
const PROVIDER_TIMEOUT_MS = Number(process.env.PLAYBACK_PROVIDER_TIMEOUT_MS || 28000)
const CACHE_TTL_MS = Number(process.env.PLAYBACK_CACHE_TTL_MS || 10 * 60 * 1000)

interface CacheEntry {
  at: number
  result: ResolveResult
}

const resolveCache = new Map<string, CacheEntry>()

function cacheKey(req: ResolveRequest, provider?: ProviderId): string {
  const title = req.title.trim().toLowerCase()
  const alts = req.alt.map((a) => a.trim().toLowerCase()).filter(Boolean).sort().join('|')
  const pref = req.preferredProvider || 'auto'
  return `${provider || 'any'}::${pref}::${title}::${alts}::${req.episode}`
}

function getCached(key: string): ResolveResult | null {
  const hit = resolveCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    resolveCache.delete(key)
    return null
  }
  return hit.result
}

function setCache(key: string, result: ResolveResult) {
  resolveCache.set(key, { at: Date.now(), result })
  // crude bound
  if (resolveCache.size > 200) {
    const first = resolveCache.keys().next().value
    if (first) resolveCache.delete(first)
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout`)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/**
 * Resolve with multi-source fallback (preferred first, then remaining).
 * Public stream.source is always `mioani`; `provider` names the successful line.
 */
export async function resolvePlayback(req: ResolveRequest): Promise<ResolveResult> {
  const key = cacheKey(req)
  const cached = getCached(key)
  if (cached) {
    if (DEBUG()) console.log('[playback] cache hit', key)
    return cached
  }

  const sequence = providerSequence(req.preferredProvider)
  if (DEBUG()) {
    console.log(
      '[playback] sequence',
      sequence.map((p) => p.id).join(' → '),
      req.preferredProvider ? `(preferred ${req.preferredProvider})` : '(auto)',
    )
  }

  for (const provider of sequence) {
    try {
      if (DEBUG()) console.log('[playback] try provider', provider.id)
      const stream = await withTimeout(
        provider.resolve(req),
        PROVIDER_TIMEOUT_MS,
        provider.id,
      )
      if (stream) {
        const result: ResolveResult = {
          playable: true,
          stream: {
            url: stream.url,
            kind: stream.kind,
            source: 'mioani',
          },
          episode: req.episode,
          episodeCount: stream.episodeCount,
          provider: stream.provider,
        }
        if (DEBUG()) {
          console.log('[playback] resolved via', stream.provider, stream.url.slice(0, 80))
        }
        setCache(key, result)
        setCache(cacheKey(req, stream.provider), result)
        return result
      }
    } catch (e) {
      if (DEBUG()) console.log('[playback] provider failed', provider.id, e)
    }
  }

  const unplayable: ResolveResult = {
    playable: false,
    reason: 'unplayable',
    episode: req.episode,
  }
  // Short negative cache (60s) so retry is not locked out for full positive TTL
  resolveCache.set(key, { at: Date.now() - Math.max(0, CACHE_TTL_MS - 60_000), result: unplayable })
  return unplayable
}

export async function listPlaybackEpisodes(
  req: Pick<ResolveRequest, 'title' | 'alt'>,
): Promise<EpisodesResult> {
  for (const provider of PROVIDERS) {
    if (!provider.listEpisodes) continue
    try {
      const result = await withTimeout(
        provider.listEpisodes(req),
        PROVIDER_TIMEOUT_MS,
        `${provider.id}_episodes`,
      )
      if (result && result.episodeCount > 0) {
        // Never expose internal provider id to clients (debug only in server logs).
        const { provider: providerId, ...rest } = result
        if (DEBUG() && providerId) {
          console.log('[playback] episodes via', providerId, rest.episodeCount)
        }
        return rest
      }
    } catch (e) {
      if (DEBUG()) console.log('[playback] episodes failed', provider.id, e)
    }
  }
  return { episodeCount: 0, episodes: [] }
}

/** Hosts allowed for media proxy (SSRF allowlist) — from probe report + parent wildcards. */
export function isProxyHostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase()

  const exact = new Set([
    'sorani-vids.xyz',
    'www.sorani-vids.xyz',
    'yzzy31-play.com',
    'cdn.yzzy31-play.com',
    'oxxx.eu.org',
    'm3u8.oxxx.eu.org',
    'www.sorani.net',
    'api.sorani.cc',
    'www.dcc3.com',
    'dmbus.cc',
    // MXdm-family play CDNs seen in successful resolves
    'yzzy.play-cdn19.com',
    'play-cdn19.com',
    // ezdmw (E站) player + disguise CDN
    'www.ezdmw.org',
    'ezdmw.org',
    'player.ezdmw.com',
    'image.ezdmw.com',
    'ins.wdbed.vip',
    'wdbed.vip',
    'player.danmuzf.vip',
    'danmuzf.vip',
  ])
  if (exact.has(host)) return true

  const suffixes = [
    '.sorani-vids.xyz',
    '.yzzy31-play.com',
    '.oxxx.eu.org',
    '.sorani.net',
    '.sorani.cc',
    '.dcc3.com',
    '.dmbus.cc',
    '.ezdmw.com',
    '.ezdmw.org',
    '.wdbed.vip',
    '.danmuzf.vip',
  ]
  if (suffixes.some((s) => host.endsWith(s))) return true

  // MXdm / yzzy play-cdn family: yzzy.play-cdn19.com, foo.play-cdn3.com, etc.
  // Bound to play-cdn + digits + .com — not open-ended play.* or video.*
  if (/(^|\.)play-cdn\d+\.com$/i.test(host)) return true

  // Common subdomains of known probe CDNs (avoid open-ended "play.*" which is SSRF-risky)
  if (
    /^(cdn|m3u8|play|video|vids|v|image|ins)\./i.test(host) &&
    (host.includes('yzzy') ||
      host.includes('sorani') ||
      host.includes('oxxx') ||
      host.includes('dcc3') ||
      host.includes('dmbus') ||
      host.includes('ezdmw') ||
      host.includes('wdbed') ||
      host.includes('danmuzf'))
  ) {
    return true
  }

  // Host contains both yzzy + play-cdn (e.g. alternate branding without digit suffix)
  if (host.includes('yzzy') && host.includes('play-cdn')) return true

  const extra = (process.env.PLAYBACK_PROXY_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  if (extra.some((h) => host === h || host.endsWith(`.${h}`))) return true

  return false
}
