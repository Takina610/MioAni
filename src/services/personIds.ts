export type PersonKind = 'character' | 'person'
export type PersonSource = 'bangumi' | 'anilist'

export interface ParsedPersonId {
  kind: PersonKind
  source: PersonSource
  rawId: string
  id: string
}

export function buildBgmCharacterId(raw: number | string): string {
  return `bgm-char-${raw}`
}

export function buildBgmPersonId(raw: number | string): string {
  return `bgm-person-${raw}`
}

export function buildAniListCharacterId(raw: number | string): string {
  return `anilist-char-${raw}`
}

export function buildAniListStaffId(raw: number | string): string {
  return `anilist-staff-${raw}`
}

export function parsePersonId(id: string): ParsedPersonId | null {
  const value = (id || '').trim()
  if (!value) return null

  const patterns: Array<{ re: RegExp; kind: PersonKind; source: PersonSource }> = [
    { re: /^bgm-char-(\d+)$/i, kind: 'character', source: 'bangumi' },
    { re: /^bgm-person-(\d+)$/i, kind: 'person', source: 'bangumi' },
    { re: /^anilist-char-(\d+)$/i, kind: 'character', source: 'anilist' },
    { re: /^anilist-staff-(\d+)$/i, kind: 'person', source: 'anilist' },
  ]

  for (const p of patterns) {
    const m = value.match(p.re)
    if (m) {
      return {
        kind: p.kind,
        source: p.source,
        rawId: m[1],
        id: value,
      }
    }
  }
  return null
}

export function personRouteName(kind: PersonKind): 'character-detail' | 'person-detail' {
  return kind === 'character' ? 'character-detail' : 'person-detail'
}

export function personRoutePath(id: string): string | null {
  const parsed = parsePersonId(id)
  if (!parsed) return null
  return parsed.kind === 'character' ? `/character/${id}` : `/person/${id}`
}
