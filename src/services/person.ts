import { apiConfig, authHeaders } from '../config/api'
import type { PersonDetail } from '../types/anime'
import { parsePersonId } from './personIds'

function cleanText(value?: string): string {
  return value?.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() ?? ''
}

function bangumiHeaders(): Record<string, string> {
  return { Accept: 'application/json', ...authHeaders(apiConfig.bangumiToken) }
}

async function aniListRequest(query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(apiConfig.aniListBase, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...authHeaders(apiConfig.aniListToken),
    },
    body: JSON.stringify({ query, variables }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.errors) {
    throw new Error(payload?.errors?.[0]?.message ?? 'AniList 服务暂时不可用')
  }
  return payload.data
}

function formatBangumiBirthday(item: {
  birth_year?: number | null
  birth_mon?: number | null
  birth_day?: number | null
}): string | undefined {
  const y = item.birth_year
  const m = item.birth_mon
  const d = item.birth_day
  if (!m && !d && !y) return undefined
  const parts: string[] = []
  if (y) parts.push(String(y))
  if (m) parts.push(String(m).padStart(2, '0'))
  if (d) parts.push(String(d).padStart(2, '0'))
  return parts.join('-')
}

function formatAniListBirthday(date?: { year?: number | null; month?: number | null; day?: number | null }): string | undefined {
  if (!date) return undefined
  const y = date.year
  const m = date.month
  const d = date.day
  if (!m && !d && !y) return undefined
  const parts: string[] = []
  if (y) parts.push(String(y))
  if (m) parts.push(String(m).padStart(2, '0'))
  if (d) parts.push(String(d).padStart(2, '0'))
  return parts.join('-')
}

function httpsUrl(url?: string): string | undefined {
  if (!url) return undefined
  return url.replace('http://', 'https://')
}

async function fetchBangumiCharacter(rawId: string, id: string, contextRole?: string): Promise<PersonDetail> {
  const res = await fetch(
    `${apiConfig.bangumiBase}/v0/characters/${encodeURIComponent(rawId)}`,
    { headers: bangumiHeaders() },
  )
  if (!res.ok) throw new Error('无法获取角色详情')
  const item = await res.json()
  return {
    id,
    kind: 'character',
    source: 'bangumi',
    name: item.name || '角色',
    image: httpsUrl(item.images?.large || item.images?.medium),
    summary: cleanText(item.summary),
    gender: item.gender || undefined,
    birthday: formatBangumiBirthday(item),
    bloodType: item.blood_type || undefined,
    contextRole,
  }
}

async function fetchBangumiPerson(rawId: string, id: string, contextRole?: string): Promise<PersonDetail> {
  const res = await fetch(
    `${apiConfig.bangumiBase}/v0/persons/${encodeURIComponent(rawId)}`,
    { headers: bangumiHeaders() },
  )
  if (!res.ok) throw new Error('无法获取人物详情')
  const item = await res.json()
  const careers = Array.isArray(item.career)
    ? item.career.filter((c: unknown): c is string => typeof c === 'string' && Boolean(c))
    : []
  return {
    id,
    kind: 'person',
    source: 'bangumi',
    name: item.name || '人物',
    image: httpsUrl(item.images?.large || item.images?.medium || item.img),
    summary: cleanText(item.summary),
    gender: item.gender || undefined,
    birthday: formatBangumiBirthday(item),
    bloodType: item.blood_type || undefined,
    careers: careers.length ? careers : undefined,
    contextRole,
  }
}

async function fetchAniListCharacter(rawId: string, id: string, contextRole?: string): Promise<PersonDetail> {
  const query = `
    query ($id: Int) {
      Character(id: $id) {
        id
        name { full native alternative }
        image { large }
        description(asHtml: false)
        gender
        dateOfBirth { year month day }
        bloodType
      }
    }
  `
  const data = await aniListRequest(query, { id: Number(rawId) })
  const node = data.Character
  if (!node) throw new Error('角色不存在')
  return {
    id,
    kind: 'character',
    source: 'anilist',
    name: node.name?.native || node.name?.full || 'Character',
    nameAlt: node.name?.full && node.name?.native && node.name.full !== node.name.native
      ? node.name.full
      : undefined,
    image: node.image?.large || undefined,
    summary: cleanText(node.description),
    gender: node.gender || undefined,
    birthday: formatAniListBirthday(node.dateOfBirth),
    bloodType: node.bloodType || undefined,
    contextRole,
  }
}

async function fetchAniListStaff(rawId: string, id: string, contextRole?: string): Promise<PersonDetail> {
  const query = `
    query ($id: Int) {
      Staff(id: $id) {
        id
        name { full native }
        image { large }
        description(asHtml: false)
        gender
        dateOfBirth { year month day }
        bloodType
        primaryOccupations
      }
    }
  `
  const data = await aniListRequest(query, { id: Number(rawId) })
  const node = data.Staff
  if (!node) throw new Error('人物不存在')
  const careers = Array.isArray(node.primaryOccupations)
    ? node.primaryOccupations.filter((c: unknown): c is string => typeof c === 'string' && Boolean(c))
    : []
  return {
    id,
    kind: 'person',
    source: 'anilist',
    name: node.name?.native || node.name?.full || 'Staff',
    nameAlt: node.name?.full && node.name?.native && node.name.full !== node.name.native
      ? node.name.full
      : undefined,
    image: node.image?.large || undefined,
    summary: cleanText(node.description),
    gender: node.gender || undefined,
    birthday: formatAniListBirthday(node.dateOfBirth),
    bloodType: node.bloodType || undefined,
    careers: careers.length ? careers : undefined,
    contextRole,
  }
}

export async function fetchPersonDetail(
  id: string,
  opts?: { contextRole?: string },
): Promise<PersonDetail> {
  const parsed = parsePersonId(id)
  if (!parsed) throw new Error('未知的人物 ID')

  if (parsed.source === 'bangumi' && parsed.kind === 'character') {
    return fetchBangumiCharacter(parsed.rawId, parsed.id, opts?.contextRole)
  }
  if (parsed.source === 'bangumi' && parsed.kind === 'person') {
    return fetchBangumiPerson(parsed.rawId, parsed.id, opts?.contextRole)
  }
  if (parsed.source === 'anilist' && parsed.kind === 'character') {
    return fetchAniListCharacter(parsed.rawId, parsed.id, opts?.contextRole)
  }
  return fetchAniListStaff(parsed.rawId, parsed.id, opts?.contextRole)
}
