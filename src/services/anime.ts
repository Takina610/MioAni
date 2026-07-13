import { apiConfig, authHeaders } from '../config/api'
import type { Anime, ImportResult, WatchStatus } from '../types/anime'

const statusMap: Record<string, WatchStatus> = {
  CURRENT: 'watching', COMPLETED: 'completed', PLANNING: 'planned', PAUSED: 'paused', DROPPED: 'dropped',
}

function cleanText(value?: string): string {
  return value?.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() ?? ''
}

function formatAiring(seconds?: number): string | undefined {
  if (!seconds) return undefined
  const days = Math.floor(seconds / 86400)
  if (days) return `${days} 天后更新`
  const hours = Math.max(1, Math.floor(seconds / 3600))
  return `${hours} 小时后更新`
}

async function aniListRequest(query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(apiConfig.aniListBase, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeaders(apiConfig.aniListToken) },
    body: JSON.stringify({ query, variables }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.errors) throw new Error(payload?.errors?.[0]?.message ?? 'AniList 服务暂时不可用')
  return payload.data
}

function mapAniList(media: any, entry?: any): Anime {
  return {
    id: `anilist-${media.id}`, source: 'anilist', title: media.title.english || media.title.romaji,
    originalTitle: media.title.native || media.title.romaji, image: media.coverImage.extraLarge,
    banner: media.bannerImage || undefined, score: media.averageScore ? media.averageScore / 10 : entry?.score || 0,
    year: media.seasonYear || 0, season: media.season || '', episodes: media.episodes || 0,
    watched: entry?.progress || 0, status: statusMap[entry?.status] ?? 'planned',
    tags: media.genres?.slice(0, 3) || [], summary: cleanText(media.description),
    nextEpisode: formatAiring(media.nextAiringEpisode?.timeUntilAiring), popularity: media.popularity || 0,
  }
}

const mediaFields = `id title { romaji native english } coverImage { extraLarge } bannerImage averageScore popularity seasonYear season episodes genres description(asHtml: false) nextAiringEpisode { episode timeUntilAiring }`

function currentSeason() {
  const month = new Date().getMonth() + 1
  if (month <= 3) return 'WINTER'
  if (month <= 6) return 'SPRING'
  if (month <= 9) return 'SUMMER'
  return 'FALL'
}

export async function fetchAniListSeasonal(limit = 50): Promise<Anime[]> {
  const query = `query ($perPage: Int, $season: MediaSeason, $year: Int) { Page(page: 1, perPage: $perPage) { media(type: ANIME, season: $season, seasonYear: $year, sort: TRENDING_DESC, isAdult: false) { ${mediaFields} } } }`
  const data = await aniListRequest(query, { perPage: limit, season: currentSeason(), year: new Date().getFullYear() })
  return data.Page.media.map((media: any) => mapAniList(media))
}

export async function importAniList(username: string): Promise<ImportResult> {
  const query = `query ($name: String) { MediaListCollection(userName: $name, type: ANIME) { lists { entries { status progress score media { ${mediaFields} } } } } }`
  const data = await aniListRequest(query, { name: username })
  const entries = data.MediaListCollection.lists.flatMap((list: any) => list.entries)
  return { source: 'anilist', items: entries.map((entry: any) => mapAniList(entry.media, entry)), username }
}

function bangumiHeaders(): Record<string, string> {
  return { Accept: 'application/json', ...authHeaders(apiConfig.bangumiToken) }
}

function mapBangumi(item: any): Anime {
  return {
    id: `bgm-${item.id ?? item.subject_id}`, source: 'bangumi', title: item.name_cn || item.name,
    originalTitle: item.name, image: (item.images?.large || '').replace('http://', 'https://'),
    score: item.rating?.score || item.score || 0, year: Number((item.air_date || item.date)?.slice(0, 4)) || 0,
    season: '', episodes: item.eps || item.total_episodes || 0, watched: item.ep_status || 0,
    status: 'planned', tags: item.tags?.slice(0, 3).map((tag: any) => tag.name) || [],
    summary: cleanText(item.summary || item.short_summary), popularity: item.collection?.doing || 0,
  }
}

export async function fetchBangumiCalendar(): Promise<Anime[]> {
  const response = await fetch(`${apiConfig.bangumiBase}/calendar`, { headers: bangumiHeaders() })
  if (!response.ok) throw new Error('Bangumi 放送数据暂时不可用')
  const days = await response.json()
  const now = new Date()
  const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3
  const quarterStart = new Date(now.getFullYear(), quarterStartMonth, 1)
  const quarterEnd = new Date(now.getFullYear(), quarterStartMonth + 3, 1)
  const currentQuarter = days.flatMap((day: any) => day.items).filter((item: any) => {
    const airDate = item.air_date ? new Date(`${item.air_date}T00:00:00`) : null
    return airDate && airDate >= quarterStart && airDate < quarterEnd
  })
  const quarterUnique = new Map<string, Anime>()
  currentQuarter.forEach((item: any) => quarterUnique.set(String(item.id), mapBangumi(item)))
  return [...quarterUnique.values()].sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
}

export async function importBangumi(username: string): Promise<ImportResult> {
  const all: any[] = []
  let offset = 0
  do {
    const response = await fetch(`${apiConfig.bangumiBase}/v0/users/${encodeURIComponent(username)}/collections?subject_type=2&limit=50&offset=${offset}`, { headers: bangumiHeaders() })
    if (!response.ok) throw new Error('Bangumi 用户不存在、收藏不可见或服务暂时不可用')
    const payload = await response.json()
    all.push(...payload.data)
    offset += payload.data.length
    if (payload.data.length < 50 || offset >= payload.total) break
  } while (offset < 1000)
  const typeMap: Record<number, WatchStatus> = { 1: 'planned', 2: 'completed', 3: 'watching', 4: 'paused', 5: 'dropped' }
  const items = all.map((entry: any) => ({ ...mapBangumi({ ...entry.subject, subject_id: entry.subject_id, ep_status: entry.ep_status }), status: typeMap[entry.type] ?? 'planned' }))
  return { source: 'bangumi', items, username }
}

export async function searchBangumi(keyword: string): Promise<Anime[]> {
  const response = await fetch(`${apiConfig.bangumiBase}/v0/search/subjects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...bangumiHeaders() },
    body: JSON.stringify({ keyword, sort: 'match', filter: { type: [2] } }),
  })
  if (!response.ok) throw new Error('Bangumi 搜索暂时不可用')
  const payload = await response.json()
  return payload.data.slice(0, 30).map(mapBangumi)
}

export async function searchAniList(keyword: string): Promise<Anime[]> {
  const query = `query ($search: String) { Page(page: 1, perPage: 30) { media(type: ANIME, search: $search, sort: SEARCH_MATCH, isAdult: false) { ${mediaFields} } } }`
  const data = await aniListRequest(query, { search: keyword })
  return data.Page.media.map((media: any) => mapAniList(media))
}

export async function searchAnime(keyword: string): Promise<Anime[]> {
  try {
    const bangumiResults = await searchBangumi(keyword)
    if (bangumiResults.length) return bangumiResults
  } catch {
    // AniList is the automatic fallback for Bangumi network and API failures.
  }
  return searchAniList(keyword)
}
