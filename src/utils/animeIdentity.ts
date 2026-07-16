import type { Anime } from '../types/anime'

/** Normalize titles for fuzzy equality across Bangumi / AniList. */
export function normalizeTitleKey(value: string | undefined | null): string {
  if (!value) return ''
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[【】\[\]「」『』〈〉《》()（）·・\s._\-—–:'"“”‘’!！?？,，.。/\\|+☆★♪~～]/g, '')
    .replace(/第([0-9一二三四五六七八九十]+)[期季部]/g, '$1')
    .replace(/(season|cour|part)([0-9]+)/g, '$2')
    .trim()
}

export function collectTitleKeys(anime: Pick<Anime, 'title' | 'originalTitle' | 'titles'>): string[] {
  const raw = [
    anime.title,
    anime.originalTitle,
    anime.titles?.cn,
    anime.titles?.en,
    anime.titles?.romaji,
    anime.titles?.native,
  ]
  const keys = raw.map(normalizeTitleKey).filter(Boolean)
  return [...new Set(keys)]
}

export function isChineseQuery(keyword: string): boolean {
  return /[\u4e00-\u9fff]/.test(keyword)
}

export function isLikelyJapaneseQuery(keyword: string): boolean {
  return /[\u3040-\u30ff]/.test(keyword)
}

/** Same show if any normalized title matches and years are compatible. */
export function isSameAnime(
  a: Pick<Anime, 'title' | 'originalTitle' | 'titles' | 'year' | 'episodes'>,
  b: Pick<Anime, 'title' | 'originalTitle' | 'titles' | 'year' | 'episodes'>,
): boolean {
  const aKeys = collectTitleKeys(a)
  const bKeys = collectTitleKeys(b)
  if (!aKeys.length || !bKeys.length) return false
  const shareTitle = aKeys.some((key) => bKeys.includes(key))
  if (!shareTitle) return false

  const yearA = a.year || 0
  const yearB = b.year || 0
  if (yearA && yearB && Math.abs(yearA - yearB) > 1) return false

  // Episode count helps when remakes share a title root.
  const epsA = a.episodes || 0
  const epsB = b.episodes || 0
  if (epsA && epsB && Math.abs(epsA - epsB) > 6 && Math.min(epsA, epsB) >= 3) return false

  return true
}

export function findMatchingAnime(
  list: Anime[],
  candidate: Pick<Anime, 'id' | 'title' | 'originalTitle' | 'titles' | 'year' | 'episodes' | 'linkedIds'>,
): Anime | undefined {
  if (!list.length) return undefined
  const byId = list.find(
    (item) =>
      item.id === candidate.id
      || item.linkedIds?.includes(candidate.id)
      || candidate.linkedIds?.includes(item.id),
  )
  if (byId) return byId
  return list.find((item) => isSameAnime(item, candidate))
}
