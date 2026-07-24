import { apiConfig, authHeaders } from '../config/api'
import type {
  AnimeRelation,
  PersonComment,
  PersonDetail,
  PersonFact,
  PersonVoiceRole,
} from '../types/anime'
import {
  buildAniListCharacterId,
  buildBgmCharacterId,
  parsePersonId,
} from './personIds'

const WORKS_PAGE_SIZE = 30
const ROLES_PAGE_SIZE = 30
const COMMENTS_PAGE_SIZE = 20
const BANGUMI_MONO_TIMEOUT_MS = 20_000
const BANGUMI_API_TIMEOUT_MS = 15_000

const BANGUMI_BLOOD_TYPES: Record<number, string> = {
  1: 'A型',
  2: 'B型',
  3: 'AB型',
  4: 'O型',
}

const BANGUMI_CAREER_LABELS: Record<string, string> = {
  artist: '音乐人',
  seiyu: '声优',
  producer: '制作人员',
  mangaka: '漫画家',
  writer: '作家',
  illustrator: '插画师',
  actor: '演员',
}

export interface PersonExtraPage<T> {
  items: T[]
  page: number
  total: number
  hasMore: boolean
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function cleanText(value: unknown): string {
  return textValue(value)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanSummary(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

function httpsUrl(url?: unknown): string | undefined {
  const value = cleanText(url)
  if (!value) return undefined
  if (value.startsWith('//')) return `https:${value}`
  return value.replace('http://', 'https://')
}

function infoboxValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item || typeof item !== 'object') return cleanText(item)
        const row = item as Record<string, unknown>
        const label = cleanText(row.k)
        const content = cleanText(row.v ?? row.value)
        if (!content) return ''
        return label ? `${label}：${content}` : content
      })
      .filter(Boolean)
      .join(' · ')
  }
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>
    return cleanText(row.v ?? row.value)
  }
  return cleanText(value)
}

export function parseBangumiInfobox(value: unknown): PersonFact[] {
  if (!Array.isArray(value)) return []
  const rows: PersonFact[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const label = cleanText(row.key)
    const content = infoboxValue(row.value)
    if (!label || !content) continue
    const key = `${label}\u0000${content}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ label, value: content })
  }
  return rows
}

function factValue(facts: PersonFact[], label: string): string {
  return facts.find((fact) => fact.label === label)?.value || ''
}

function extraBangumiFacts(facts: PersonFact[]): PersonFact[] {
  const common = new Set(['简体中文名', '性别', '生日', '血型'])
  return facts.filter((fact) => !common.has(fact.label))
}

function formatBangumiBloodType(value: unknown): string | undefined {
  const numeric = typeof value === 'number' ? value : Number(cleanText(value))
  if (Number.isInteger(numeric) && BANGUMI_BLOOD_TYPES[numeric]) {
    return BANGUMI_BLOOD_TYPES[numeric]
  }
  const text = cleanText(value)
  if (/^(?:A|B|AB|O)$/i.test(text)) return `${text.toUpperCase()}型`
  return text || undefined
}

function formatBangumiCareers(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((career) => cleanText(career))
    .filter(Boolean)
    .map((career) => BANGUMI_CAREER_LABELS[career.toLowerCase()] || career)
}

function titleFromAniList(node: any): string {
  return node?.title?.english || node?.title?.romaji || node?.title?.native || '作品'
}

function nativeTitleFromAniList(node: any): string | undefined {
  const native = node?.title?.native
  const display = titleFromAniList(node)
  return native && native !== display ? native : undefined
}

function characterNameFromAniList(node: any): string {
  return node?.name?.native || node?.name?.full || '角色'
}

function bangumiSubjectRelation(item: any): AnimeRelation | null {
  const rawId = item?.id ?? item?.subject_id
  if (!rawId || Number(item?.type) !== 2) return null
  const title = cleanText(item.name_cn) || cleanText(item.name) || '动画'
  const originalTitle = cleanText(item.name)
  const role = cleanText(item.staff)
  return {
    id: `bgm-${rawId}`,
    title,
    originalTitle: originalTitle && originalTitle !== title ? originalTitle : undefined,
    type: role || cleanText(item.type_name) || '动画',
    role: role || undefined,
    image: httpsUrl(item.image || item.images?.large || item.images?.medium),
    format: cleanText(item.platform) || undefined,
  }
}

function aniListMediaRelation(edge: any, fallbackRole = '参与'): AnimeRelation | null {
  const node = edge?.node
  if (!node?.id) return null
  const title = titleFromAniList(node)
  return {
    id: `anilist-${node.id}`,
    title,
    originalTitle: nativeTitleFromAniList(node),
    type: edge?.staffRole || edge?.characterRole || fallbackRole,
    role: edge?.staffRole || edge?.characterRole || fallbackRole,
    image: node.coverImage?.large || undefined,
    format: node.format || undefined,
    status: node.status || undefined,
  }
}

async function fetchJsonOrEmpty<T>(url: string): Promise<T | null> {
  const res = await fetchWithHardTimeout(url, { headers: bangumiHeaders() }).catch(() => null)
  if (!res) return null
  if (!res.ok) return null
  return res.json().catch(() => null)
}

async function fetchBangumiCharacterWorks(rawId: string): Promise<AnimeRelation[]> {
  const list = await fetchJsonOrEmpty<any[]>(
    `${apiConfig.bangumiBase}/v0/characters/${encodeURIComponent(rawId)}/subjects`,
  )
  if (!Array.isArray(list)) return []
  return list.map(bangumiSubjectRelation).filter((item): item is AnimeRelation => Boolean(item))
}

async function fetchBangumiPersonWorks(rawId: string): Promise<AnimeRelation[]> {
  const list = await fetchJsonOrEmpty<any[]>(
    `${apiConfig.bangumiBase}/v0/persons/${encodeURIComponent(rawId)}/subjects`,
  )
  if (!Array.isArray(list)) return []
  return list.map(bangumiSubjectRelation).filter((item): item is AnimeRelation => Boolean(item))
}

async function fetchBangumiPersonVoiceRoles(rawId: string): Promise<PersonVoiceRole[]> {
  const list = await fetchJsonOrEmpty<any[]>(
    `${apiConfig.bangumiBase}/v0/persons/${encodeURIComponent(rawId)}/characters`,
  )
  if (!Array.isArray(list)) return []
  return list
    .filter((item) => Number(item?.subject_type) === 2 && item?.id)
    .map((item) => {
      const name = cleanText(item.name_cn) || cleanText(item.name) || '角色'
      return {
        id: buildBgmCharacterId(item.id),
        name,
        image: httpsUrl(item.images?.large || item.images?.medium || item.image),
        role: cleanText(item.staff) || undefined,
        subjectId: item.subject_id ? `bgm-${item.subject_id}` : undefined,
        subjectTitle: cleanText(item.subject_name_cn) || cleanText(item.subject_name) || undefined,
        subjectImage: httpsUrl(item.subject_image || item.subject?.images?.large || item.subject?.images?.medium),
      }
    })
}

function pageItems<T>(items: T[], page: number, pageSize: number): PersonExtraPage<T> {
  const current = Math.max(1, Math.floor(page || 1))
  const end = current * pageSize
  return {
    items: items.slice((current - 1) * pageSize, end),
    page: current,
    total: items.length,
    hasMore: end < items.length,
  }
}

type BangumiMonoKind = 'character' | 'person'

interface BangumiMonoFallback {
  name?: string
  nameAlt?: string
  image?: string
  summary?: string
  facts: PersonFact[]
}

interface BangumiMonoApiItem {
  name?: unknown
  summary?: unknown
  gender?: unknown
  blood_type?: unknown
  career?: unknown
  infobox?: unknown
  img?: unknown
  images?: {
    large?: unknown
    medium?: unknown
  }
  birth_year?: number | null
  birth_mon?: number | null
  birth_day?: number | null
}

const bangumiMonoHtmlCache = new Map<string, Promise<string>>()

async function fetchWithHardTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = BANGUMI_API_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort()
      reject(new Error('请求超时，请稍后重试'))
    }, timeoutMs)
  })
  try {
    return await Promise.race([
      fetch(input, { ...init, signal: controller.signal }),
      timeout,
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

async function fetchBangumiMonoHtml(kind: BangumiMonoKind, rawId: string): Promise<string> {
  const key = `${kind}/${rawId}`
  const cached = bangumiMonoHtmlCache.get(key)
  if (cached) return cached

  const request = fetchWithHardTimeout(
    `https://r.jina.ai/http://https://bgm.tv/${kind}/${encodeURIComponent(rawId)}`,
    {
      headers: {
        Accept: 'text/plain',
        'X-Return-Format': 'html',
        'X-Cache-Tolerance': '0',
      },
    },
    BANGUMI_MONO_TIMEOUT_MS,
  )
    .then((response) => (response.ok ? response.text() : ''))
    .catch(() => '')

  bangumiMonoHtmlCache.set(key, request)
  const html = await request
  if (!html) bangumiMonoHtmlCache.delete(key)
  return html
}

function markdownContent(markdown: string): string {
  const marker = 'Markdown Content:'
  const start = markdown.indexOf(marker)
  return (start >= 0 ? markdown.slice(start + marker.length) : markdown).trim()
}

function cleanMarkdownInline(value: string): string {
  return cleanText(value
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1'))
}

function cleanMarkdownSummary(value: string): string {
  return cleanSummary(value
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*]\s+/gm, ''))
}

function usefulSummary(value: string): string {
  const compact = value.replace(/\s+/g, '')
  if (compact.length < 12) return ''
  if (/Bangumi番组计划|近期注目|排行榜|全部收藏会员/.test(compact)) return ''
  return value
}

function markdownProfileFacts(content: string): PersonFact[] {
  const rows: PersonFact[] = []
  const seen = new Set<string>()
  const firstSection = content.search(/^##\s+/m)
  const profileBlock = firstSection >= 0 ? content.slice(0, firstSection) : content
  const rowPattern = /^\* {2,}([^:\n]+):\s*(.+)$/gm
  for (const match of profileBlock.matchAll(rowPattern)) {
    const label = cleanText(match[1])
    const value = cleanMarkdownInline(match[2])
    if (!/^[\p{L}\p{N}][\p{L}\p{N} _·&/+.-]{0,23}$/u.test(label)) continue
    if (!label || !value) continue
    const key = `${label}\u0000${value}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ label, value })
  }
  return rows
}

function markdownSection(content: string, start: number): string {
  if (start < 0 || start >= content.length) return ''
  const rest = content.slice(start)
  const nextHeading = rest.search(/^##\s+/m)
  return nextHeading >= 0 ? rest.slice(0, nextHeading) : rest
}

export function parseBangumiMonoProfileMarkdown(
  markdown: string,
  kind: BangumiMonoKind,
): BangumiMonoFallback {
  const content = markdownContent(markdown)
  const facts = markdownProfileFacts(content)
  const title = cleanText(/^Title:\s*(.+?)\s*\|\s*Bangumi/m.exec(markdown)?.[1])
  const titleFromHeading = cleanMarkdownInline(/^#\s+\[([^\]]+)]\(/m.exec(content)?.[1] || '')
  const name = title || titleFromHeading || undefined
  const simplifiedName = factValue(facts, '简体中文名')
  const image = httpsUrl(/https?:\/\/lain\.bgm\.tv\/[^)\s"]*pic\/crt\/[^)\s"]+/i.exec(content)?.[0])

  let summary = ''
  if (kind === 'person') {
    const careerHeading = /^##\s+职业:[^\n]*$/m.exec(content)
    if (careerHeading) {
      const start = (careerHeading.index || 0) + careerHeading[0].length
      summary = usefulSummary(cleanMarkdownSummary(markdownSection(content, start)))
    }
  } else {
    const collected = /\[全部收藏会员[^\]]*]\([^)]+\)/m.exec(content)
    if (collected) {
      const start = (collected.index || 0) + collected[0].length
      summary = usefulSummary(cleanMarkdownSummary(markdownSection(content, start)))
    } else {
      const firstHeading = content.search(/^##\s+/m)
      const prefix = firstHeading >= 0 ? content.slice(0, firstHeading) : content
      if (!/^#\s+/m.test(prefix) && !prefix.includes('[Bangumi 番组计划]')) {
        summary = usefulSummary(cleanMarkdownSummary(prefix))
      }
    }
  }

  return {
    name,
    nameAlt: simplifiedName && simplifiedName !== name ? simplifiedName : undefined,
    image,
    summary: summary || undefined,
    facts,
  }
}

function cleanMarkdownText(text: string): string {
  return text
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\{num\}[\s\S]*$/m, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function decodeHtmlText(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  }
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith('#')) {
      const numeric = code[1]?.toLowerCase() === 'x'
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10)
      if (Number.isFinite(numeric)) {
        try {
          return String.fromCodePoint(numeric)
        } catch {
          return entity
        }
      }
      return entity
    }
    return named[code.toLowerCase()] ?? entity
  })
}

function htmlFragmentText(value: string): string {
  const text = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<img\b[^>]*\balt=(["'])(.*?)\1[^>]*>/gis, ' $2 ')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return cleanSummary(decodeHtmlText(text))
}

function htmlAttribute(opening: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(opening)
  return decodeHtmlText(match?.[2] || '')
}

function htmlClassOpenings(html: string, className: string): RegExpMatchArray[] {
  const pattern = new RegExp(
    `<div\\b[^>]*\\bclass\\s*=\\s*(["'])[^"']*\\b${className}\\b[^"']*\\1[^>]*>`,
    'gi',
  )
  return [...html.matchAll(pattern)]
}

function htmlTagClassContent(html: string, tagName: string, className: string): string {
  const pattern = new RegExp(
    `<${tagName}\\b[^>]*\\bclass\\s*=\\s*(["'])[^"']*\\b${className}\\b[^"']*\\1[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
    'i',
  )
  return pattern.exec(html)?.[2] || ''
}

function htmlClassContent(html: string, className: string): string {
  return htmlTagClassContent(html, 'div', className)
}

export function parseBangumiMonoProfileHtml(
  html: string,
  _kind: BangumiMonoKind,
): BangumiMonoFallback {
  const headerStart = /<div\b[^>]*\bid\s*=\s*(["'])headerSubject\1[^>]*>/i.exec(html)?.index ?? 0
  const headerEndCandidate = /<div\b[^>]*\bclass\s*=\s*(["'])[^"']*\bmainWrapper\b[^"']*\1[^>]*>/i
    .exec(html.slice(headerStart))?.index
  const headerEnd = headerEndCandidate == null ? html.length : headerStart + headerEndCandidate
  const header = html.slice(headerStart, headerEnd)
  const heading = htmlTagClassContent(header, 'h1', 'nameSingle')
  const nameAnchor = /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(heading)
  const name = htmlFragmentText(nameAnchor?.[1] || '') || undefined
  const nameAltRaw = htmlAttribute(nameAnchor?.[0] || '', 'title')
  const nameAlt = nameAltRaw && nameAltRaw !== name ? nameAltRaw : undefined

  const coverAnchor = /<a\b[^>]*\bclass\s*=\s*(["'])[^"']*\bcover\b[^"']*\1[^>]*>/i.exec(html)?.[0] || ''
  const coverImage = /<img\b[^>]*\bclass\s*=\s*(["'])[^"']*\bcover\b[^"']*\1[^>]*>/i.exec(html)?.[0] || ''
  const image = httpsUrl(htmlAttribute(coverAnchor, 'href') || htmlAttribute(coverImage, 'src'))

  const columnMatch = /<div\b[^>]*\bid\s*=\s*(["'])columnCrtB\1[^>]*>/i.exec(html)
  const columnStart = columnMatch?.index ?? -1
  const commentsOffset = columnStart >= 0
    ? /<div\b[^>]*\bclass\s*=\s*(["'])[^"']*\bcrtCommentList\b[^"']*\1[^>]*>/i.exec(html.slice(columnStart))?.index
    : undefined
  const columnEnd = columnStart >= 0 && commentsOffset != null ? columnStart + commentsOffset : html.length
  const column = columnStart >= 0 ? html.slice(columnStart, columnEnd) : ''
  const subtitle = htmlFragmentText(htmlTagClassContent(column, 'h2', 'subtitle'))
  const detail = htmlFragmentText(htmlClassContent(column, 'detail'))
  const summary = [subtitle, detail].filter(Boolean).join('\n\n') || undefined

  const infoMatch = /<ul\b[^>]*\bid\s*=\s*(["'])infobox\1[^>]*>/i.exec(html)
  const infoStart = infoMatch?.index ?? -1
  const infoEnd = columnStart > infoStart ? columnStart : Math.min(html.length, Math.max(0, infoStart) + 16_000)
  const info = infoStart >= 0 ? html.slice(infoStart, infoEnd) : ''
  const facts: PersonFact[] = []
  const seenFacts = new Set<string>()
  const factPattern = /<li\b[^>]*>\s*<span\b[^>]*\bclass\s*=\s*(["'])[^"']*\btip\b[^"']*\1[^>]*>([\s\S]*?)<\/span>([\s\S]*?)<\/li>/gi
  for (const fact of info.matchAll(factPattern)) {
    const opening = fact[0].slice(0, fact[0].indexOf('>') + 1)
    if (/\bsub_(?:container|section|group)\b/i.test(htmlAttribute(opening, 'class'))) continue
    const label = htmlFragmentText(fact[2]).replace(/[：:]\s*$/, '')
    const value = htmlFragmentText(fact[3])
    const key = `${label}\u0000${value}`
    if (!label || !value || seenFacts.has(key)) continue
    seenFacts.add(key)
    facts.push({ label, value })
  }

  return { name, nameAlt, image, summary, facts }
}

function htmlCommentTime(block: string): string | undefined {
  const action = /<div\b[^>]*\bclass\s*=\s*(["'])[^"']*\baction\b[^"']*\1[^>]*>[\s\S]*?<small\b[^>]*>([\s\S]*?)<\/small>/i
    .exec(block)
  const text = htmlFragmentText(action?.[2] || '')
  const separator = text.indexOf(' - ')
  return separator >= 0 ? text.slice(separator + 3).trim() || undefined : undefined
}

function htmlCommentAuthor(block: string): string {
  const author = /<strong\b[^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>\s*<\/strong>/i.exec(block)
  return htmlFragmentText(author?.[1] || '') || 'Bangumi 用户'
}

function htmlCommentId(opening: string): string {
  return htmlAttribute(opening, 'id').replace(/^post_/, '')
}

function bangumiCommentHtmlSection(html: string): string {
  const startMatch = /<div\b[^>]*\bid\s*=\s*(["'])comment_list\1[^>]*>/i.exec(html)
  const start = startMatch?.index ?? 0
  const footerMatch = /<div\b[^>]*\bid\s*=\s*(["'])footer\1[^>]*>/i.exec(html.slice(start))
  const end = footerMatch?.index != null ? start + footerMatch.index : html.length
  return html.slice(start, end)
}

function parseHtmlCommentBlock(
  opening: string,
  block: string,
  contentClass: 'message' | 'cmt_sub_content',
): PersonComment | null {
  const id = htmlCommentId(opening)
  const text = htmlFragmentText(htmlClassContent(block, contentClass))
  if (!id || !text) return null
  return {
    id,
    author: htmlCommentAuthor(block),
    time: htmlCommentTime(block),
    text,
  }
}

function bangumiCommentSection(markdown: string): string {
  const start = markdown.indexOf('## 吐槽箱')
  if (start < 0) return ''
  const raw = markdown.slice(start)
  const footerOffsets = [raw.indexOf('\n*   关于我们'), raw.indexOf('\n© 2008')]
    .filter((offset) => offset > 0)
  const end = footerOffsets.length ? Math.min(...footerOffsets) : raw.length
  return raw.slice(0, end)
}

function commentsFromFloorBlock(
  id: string,
  time: string | undefined,
  block: string,
): PersonComment | null {
  const authorPattern = /^\*\*\[(.+?)]\([^)]+\)\*\*(?:\([^\n)]*\))?\s*$/gm
  const authors = [...block.matchAll(authorPattern)]
  if (!authors.length) return null

  const parsed = authors.flatMap((author, index) => {
    const blockStart = (author.index || 0) + author[0].length
    const blockEnd = authors[index + 1]?.index ?? block.length
    const text = cleanMarkdownText(block.slice(blockStart, blockEnd))
    if (!text) return []
    return [{
      id: index === 0 ? id : `${id}-reply-${index}`,
      author: author[1]?.trim() || 'Bangumi 用户',
      time: index === 0 ? time?.trim() || undefined : undefined,
      text,
    } satisfies PersonComment]
  })
  if (!parsed.length) return null
  const [comment, ...replies] = parsed
  return replies.length ? { ...comment, replies } : comment
}

function commentTimestamp(value?: string): number {
  if (!value) return Number.NaN
  const match = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?:\s+(\d{1,2}):(\d{2}))?/.exec(value)
  if (!match) return Number.NaN
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] || 0),
    Number(match[5] || 0),
  )
}

function newestCommentsFirst(comments: PersonComment[]): PersonComment[] {
  return comments
    .map((comment, sourceIndex) => ({ comment, sourceIndex, timestamp: commentTimestamp(comment.time) }))
    .sort((a, b) => {
      const aHasTime = Number.isFinite(a.timestamp)
      const bHasTime = Number.isFinite(b.timestamp)
      if (aHasTime && bHasTime && a.timestamp !== b.timestamp) return b.timestamp - a.timestamp
      // When Bangumi omits a date, the later floor is still the newer comment.
      // Falling back to source order keeps undated rows in their correct position.
      return b.sourceIndex - a.sourceIndex
    })
    .map(({ comment }) => comment)
}

export function parseBangumiMonoHtmlComments(html: string): PersonComment[] {
  const section = bangumiCommentHtmlSection(html)
  const rows = htmlClassOpenings(section, 'row_reply')
  const comments: PersonComment[] = []

  rows.forEach((row, index) => {
    const blockStart = row.index || 0
    const blockEnd = rows[index + 1]?.index ?? section.length
    const block = section.slice(blockStart, blockEnd)
    const replies = htmlClassOpenings(block, 'sub_reply_bg')
    const mainEnd = replies[0]?.index ?? block.length
    const comment = parseHtmlCommentBlock(row[0], block.slice(0, mainEnd), 'message')
    if (!comment) return

    const parsedReplies = replies.flatMap((reply, replyIndex) => {
      const replyStart = reply.index || 0
      const replyEnd = replies[replyIndex + 1]?.index ?? block.length
      const parsed = parseHtmlCommentBlock(
        reply[0],
        block.slice(replyStart, replyEnd),
        'cmt_sub_content',
      )
      return parsed ? [parsed] : []
    })
    comments.push(parsedReplies.length ? { ...comment, replies: parsedReplies } : comment)
  })

  return newestCommentsFirst(comments)
}

export function parseBangumiMonoComments(markdown: string): PersonComment[] {
  const section = bangumiCommentSection(markdown)
  if (!section) return []
  const comments: PersonComment[] = []

  // Jina 的 Markdown 会把每个主楼和回复都输出成独立的 [#楼层] 标记。
  // 按楼层边界切块比跨多行的单个正则更稳，不会因为头像、签名或引用格式变化而只解析到前几条。
  const floorPattern = /^\[#([^\]]+)]\([^)]+\)\s*-\s*([^\n]+)\s*$/gm
  const floors = [...section.matchAll(floorPattern)]
  for (let index = 0; index < floors.length; index += 1) {
    const floor = floors[index]
    const blockStart = (floor.index || 0) + floor[0].length
    const blockEnd = floors[index + 1]?.index ?? section.length
    const comment = commentsFromFloorBlock(floor[1], floor[2], section.slice(blockStart, blockEnd))
    if (comment) comments.push(comment)
  }
  if (floors.length) return newestCommentsFirst(comments)

  // 少数人物页没有楼层链接，只保留作者块；仍按作者边界完整解析。
  const authorPattern = /^\*\*\[(.+?)]\([^)]+\)\*\*(?:\([^\n)]*\))?\s*$/gm
  const authors = [...section.matchAll(authorPattern)]
  for (let index = 0; index < authors.length; index += 1) {
    const author = authors[index]
    const blockStart = (author.index || 0) + author[0].length
    const blockEnd = authors[index + 1]?.index ?? section.length
    const text = cleanMarkdownText(section.slice(blockStart, blockEnd))
    if (!text) continue
    comments.push({ id: String(index + 1), author: author[1]?.trim() || 'Bangumi 用户', text })
  }
  return newestCommentsFirst(comments)
}

const bangumiCommentsCache = new Map<string, PersonComment[]>()

async function fetchBangumiCommentsAll(id: string): Promise<PersonComment[]> {
  const cached = bangumiCommentsCache.get(id)
  if (cached) return cached
  const parsed = parsePersonId(id)
  if (!parsed || parsed.source !== 'bangumi') return []
  const html = await fetchBangumiMonoHtml(parsed.kind, parsed.rawId)
  if (!html) return []
  const comments = parseBangumiMonoHtmlComments(html)
  bangumiCommentsCache.set(id, comments)
  return comments
}

export async function fetchPersonComments(
  id: string,
  page = 1,
  limit = COMMENTS_PAGE_SIZE,
): Promise<PersonExtraPage<PersonComment>> {
  const comments = await fetchBangumiCommentsAll(id)
  return pageItems(comments, page, limit)
}

export async function fetchPersonProfileEnrichment(id: string): Promise<Partial<PersonDetail>> {
  const parsed = parsePersonId(id)
  if (!parsed || parsed.source !== 'bangumi') return {}
  const html = await fetchBangumiMonoHtml(parsed.kind, parsed.rawId)
  if (!html) return {}
  const fallback = parseBangumiMonoProfileHtml(html, parsed.kind)
  const facts = fallback.facts
  const extraFacts = extraBangumiFacts(facts)
  const gender = factValue(facts, '性别') || undefined
  const birthday = factValue(facts, '生日') || undefined
  const bloodType = formatBangumiBloodType(factValue(facts, '血型'))
  return {
    name: fallback.name,
    nameAlt: fallback.nameAlt,
    image: fallback.image,
    summary: fallback.summary,
    gender,
    birthday,
    bloodType,
    extraFacts: extraFacts.length ? extraFacts : undefined,
  }
}

const bangumiWorksCache = new Map<string, AnimeRelation[]>()
const bangumiVoiceRolesCache = new Map<string, PersonVoiceRole[]>()

async function fetchBangumiWorksPage(
  parsed: NonNullable<ReturnType<typeof parsePersonId>>,
  page: number,
): Promise<PersonExtraPage<AnimeRelation>> {
  const cached = bangumiWorksCache.get(parsed.id)
  const works = cached || (parsed.kind === 'character'
    ? await fetchBangumiCharacterWorks(parsed.rawId)
    : await fetchBangumiPersonWorks(parsed.rawId))
  if (!cached) bangumiWorksCache.set(parsed.id, works)
  return pageItems(works, page, WORKS_PAGE_SIZE)
}

async function fetchBangumiVoiceRolesPage(
  parsed: NonNullable<ReturnType<typeof parsePersonId>>,
  page: number,
): Promise<PersonExtraPage<PersonVoiceRole>> {
  const cached = bangumiVoiceRolesCache.get(parsed.id)
  const roles = cached || (parsed.kind === 'person' ? await fetchBangumiPersonVoiceRoles(parsed.rawId) : [])
  if (!cached) bangumiVoiceRolesCache.set(parsed.id, roles)
  return pageItems(roles, page, ROLES_PAGE_SIZE)
}

async function fetchAniListCharacterWorksPage(rawId: string, page: number): Promise<PersonExtraPage<AnimeRelation>> {
  const query = `
    query ($id: Int, $page: Int) {
      Character(id: $id) {
        media(type: ANIME, sort: [POPULARITY_DESC], page: $page, perPage: 25) {
          pageInfo { currentPage hasNextPage total }
          edges {
            characterRole
            node { id title { romaji english native } coverImage { large } format status }
          }
        }
      }
    }
  `
  const data = await aniListRequest(query, { id: Number(rawId), page })
  const media = data.Character?.media
  const items = (media?.edges || [])
    .map((edge: any) => aniListMediaRelation(edge, '出演'))
    .filter((item: AnimeRelation | null): item is AnimeRelation => Boolean(item))
  return {
    items,
    page: media?.pageInfo?.currentPage || page,
    total: media?.pageInfo?.total || items.length,
    hasMore: Boolean(media?.pageInfo?.hasNextPage),
  }
}

async function fetchAniListStaffWorksPage(rawId: string, page: number): Promise<PersonExtraPage<AnimeRelation>> {
  const query = `
    query ($id: Int, $page: Int) {
      Staff(id: $id) {
        staffMedia(type: ANIME, sort: [POPULARITY_DESC], page: $page, perPage: 25) {
          pageInfo { currentPage hasNextPage total }
          edges {
            staffRole
            node { id title { romaji english native } coverImage { large } format status }
          }
        }
      }
    }
  `
  const data = await aniListRequest(query, { id: Number(rawId), page })
  const media = data.Staff?.staffMedia
  const items = (media?.edges || [])
    .map((edge: any) => aniListMediaRelation(edge, '制作'))
    .filter((item: AnimeRelation | null): item is AnimeRelation => Boolean(item))
  return {
    items,
    page: media?.pageInfo?.currentPage || page,
    total: media?.pageInfo?.total || items.length,
    hasMore: Boolean(media?.pageInfo?.hasNextPage),
  }
}

async function fetchAniListStaffVoiceRolesPage(rawId: string, page: number): Promise<PersonExtraPage<PersonVoiceRole>> {
  const query = `
    query ($id: Int, $page: Int) {
      Staff(id: $id) {
        characterMedia(sort: [POPULARITY_DESC], page: $page, perPage: 25) {
          pageInfo { currentPage hasNextPage total }
          edges {
            characterRole
            characters { id name { full native } image { large } }
            node { id type title { romaji english native } coverImage { large } }
          }
        }
      }
    }
  `
  const data = await aniListRequest(query, { id: Number(rawId), page })
  const media = data.Staff?.characterMedia
  const items = (media?.edges || [])
    .filter((edge: any) => edge?.node?.type === 'ANIME')
    .flatMap((edge: any) => (edge.characters || []).filter(Boolean).map((character: any) => ({
      id: buildAniListCharacterId(character.id),
      name: characterNameFromAniList(character),
      image: character.image?.large || undefined,
      role: edge.characterRole || undefined,
      subjectId: edge.node?.id ? `anilist-${edge.node.id}` : undefined,
      subjectTitle: titleFromAniList(edge.node),
      subjectImage: edge.node?.coverImage?.large || undefined,
    })))
    .filter((item: PersonVoiceRole) => Boolean(item.id))
  return {
    items,
    page: media?.pageInfo?.currentPage || page,
    total: media?.pageInfo?.total || items.length,
    hasMore: Boolean(media?.pageInfo?.hasNextPage),
  }
}

export async function fetchPersonWorksPage(id: string, page = 1): Promise<PersonExtraPage<AnimeRelation>> {
  const parsed = parsePersonId(id)
  if (!parsed) throw new Error('未知的人物 ID')
  if (parsed.source === 'bangumi') return fetchBangumiWorksPage(parsed, page)
  if (parsed.kind === 'character') return fetchAniListCharacterWorksPage(parsed.rawId, page)
  return fetchAniListStaffWorksPage(parsed.rawId, page)
}

export async function fetchPersonVoiceRolesPage(id: string, page = 1): Promise<PersonExtraPage<PersonVoiceRole>> {
  const parsed = parsePersonId(id)
  if (!parsed) throw new Error('未知的人物 ID')
  if (parsed.source === 'bangumi') return fetchBangumiVoiceRolesPage(parsed, page)
  if (parsed.kind === 'character') return { items: [], page, total: 0, hasMore: false }
  return fetchAniListStaffVoiceRolesPage(parsed.rawId, page)
}

function mergeProfileFacts(primary: PersonFact[], fallback: PersonFact[]): PersonFact[] {
  const result: PersonFact[] = []
  const labels = new Set<string>()
  for (const fact of [...primary, ...fallback]) {
    if (!fact.label || !fact.value || labels.has(fact.label)) continue
    labels.add(fact.label)
    result.push(fact)
  }
  return result
}

async function resolveBangumiProfile(
  response: Response,
  kind: BangumiMonoKind,
  rawId: string,
): Promise<{ item: BangumiMonoApiItem; fallback: BangumiMonoFallback; facts: PersonFact[] }> {
  const item = response.ok
    ? await response.json().catch(() => null) as BangumiMonoApiItem | null
    : null
  const apiFacts = parseBangumiInfobox(item?.infobox)
  // The public-page supplement is optional and materially slower than the API.
  // Only block the initial view when the API has no usable identity at all;
  // missing summary/facts are enriched independently after the page is visible.
  const needsFallback = !item || !cleanText(item.name)

  const fallback = needsFallback
    ? parseBangumiMonoProfileHtml(await fetchBangumiMonoHtml(kind, rawId), kind)
    : { facts: [] }
  const facts = mergeProfileFacts(apiFacts, fallback.facts)

  if (!item && !fallback.name && !fallback.summary && !facts.length) {
    throw new Error(kind === 'character' ? '无法获取角色详情' : '无法获取人物详情')
  }
  return { item: item || {}, fallback, facts }
}

function bangumiCoreFields(
  item: BangumiMonoApiItem,
  fallback: BangumiMonoFallback,
  facts: PersonFact[],
  defaultName: string,
) {
  const name = cleanText(item.name) || fallback.name || defaultName
  const simplifiedName = factValue(facts, '简体中文名') || fallback.nameAlt || ''
  return {
    name,
    nameAlt: simplifiedName && simplifiedName !== name ? simplifiedName : undefined,
    image: httpsUrl(item.images?.large || item.images?.medium || item.img) || fallback.image,
    summary: cleanSummary(item.summary) || fallback.summary || '',
    gender: cleanText(item.gender) || factValue(facts, '性别') || undefined,
    birthday: factValue(facts, '生日') || formatBangumiBirthday(item),
    bloodType: formatBangumiBloodType(factValue(facts, '血型')) || formatBangumiBloodType(item.blood_type),
    extraFacts: extraBangumiFacts(facts),
  }
}

async function fetchBangumiCharacter(rawId: string, id: string, contextRole?: string): Promise<PersonDetail> {
  const [res, worksPage] = await Promise.all([
    fetchWithHardTimeout(
      `${apiConfig.bangumiBase}/v0/characters/${encodeURIComponent(rawId)}`,
      { headers: bangumiHeaders() },
    ).catch(() => new Response('', { status: 504 })),
    fetchPersonWorksPage(id, 1).catch(() => ({ items: [], page: 1, total: 0, hasMore: false })),
  ])
  const { item, fallback, facts } = await resolveBangumiProfile(res, 'character', rawId)
  return {
    id,
    kind: 'character',
    source: 'bangumi',
    ...bangumiCoreFields(item, fallback, facts, '角色'),
    contextRole,
    works: worksPage.items,
    worksPage: worksPage.page,
    worksTotal: worksPage.total,
    worksHasMore: worksPage.hasMore,
  }
}

async function fetchBangumiPerson(rawId: string, id: string, contextRole?: string): Promise<PersonDetail> {
  const [res, worksPage, voiceRolesPage] = await Promise.all([
    fetchWithHardTimeout(
      `${apiConfig.bangumiBase}/v0/persons/${encodeURIComponent(rawId)}`,
      { headers: bangumiHeaders() },
    ).catch(() => new Response('', { status: 504 })),
    fetchPersonWorksPage(id, 1).catch(() => ({ items: [], page: 1, total: 0, hasMore: false })),
    fetchPersonVoiceRolesPage(id, 1).catch(() => ({ items: [], page: 1, total: 0, hasMore: false })),
  ])
  const { item, fallback, facts } = await resolveBangumiProfile(res, 'person', rawId)
  const careers = formatBangumiCareers(item.career)
  return {
    id,
    kind: 'person',
    source: 'bangumi',
    ...bangumiCoreFields(item, fallback, facts, '人物'),
    careers: careers.length ? careers : undefined,
    contextRole,
    works: worksPage.items,
    worksPage: worksPage.page,
    worksTotal: worksPage.total,
    worksHasMore: worksPage.hasMore,
    voiceRoles: voiceRolesPage.items,
    voiceRolesPage: voiceRolesPage.page,
    voiceRolesTotal: voiceRolesPage.total,
    voiceRolesHasMore: voiceRolesPage.hasMore,
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
  const worksPage = await fetchPersonWorksPage(id, 1).catch(() => ({ items: [], page: 1, total: 0, hasMore: false }))
  return {
    id,
    kind: 'character',
    source: 'anilist',
    name: node.name?.native || node.name?.full || 'Character',
    nameAlt: node.name?.full && node.name?.native && node.name.full !== node.name.native
      ? node.name.full
      : undefined,
    image: node.image?.large || undefined,
    summary: cleanSummary(node.description),
    gender: node.gender || undefined,
    birthday: formatAniListBirthday(node.dateOfBirth),
    bloodType: node.bloodType || undefined,
    contextRole,
    works: worksPage.items,
    worksPage: worksPage.page,
    worksTotal: worksPage.total,
    worksHasMore: worksPage.hasMore,
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
  const [worksPage, voiceRolesPage] = await Promise.all([
    fetchPersonWorksPage(id, 1).catch(() => ({ items: [], page: 1, total: 0, hasMore: false })),
    fetchPersonVoiceRolesPage(id, 1).catch(() => ({ items: [], page: 1, total: 0, hasMore: false })),
  ])
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
    summary: cleanSummary(node.description),
    gender: node.gender || undefined,
    birthday: formatAniListBirthday(node.dateOfBirth),
    bloodType: node.bloodType || undefined,
    careers: careers.length ? careers : undefined,
    contextRole,
    works: worksPage.items,
    worksPage: worksPage.page,
    worksTotal: worksPage.total,
    worksHasMore: worksPage.hasMore,
    voiceRoles: voiceRolesPage.items,
    voiceRolesPage: voiceRolesPage.page,
    voiceRolesTotal: voiceRolesPage.total,
    voiceRolesHasMore: voiceRolesPage.hasMore,
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
