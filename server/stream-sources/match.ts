/** Normalize titles for fuzzy match across providers. */
export function normalizeTitleKey(value: string | undefined | null): string {
  if (!value) return ''
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(
      /[\u3010\u3011\[\]\u300c\u300d\u300e\u300f\u3008\u3009\u300a\u300b()（）·・\s._\-\u2014\u2013:'"\u201c\u201d\u2018\u2019!！?？,，.。/\\|+\u2606\u2605\u266a~\uff5e]/g,
      '',
    )
    .replace(/第([0-9一二三四五六七八九十]+)[期季部]/g, '$1')
    .replace(/(season|cour|part)([0-9]+)/g, '$2')
    .trim()
}

export function scoreTitleMatch(candidate: string, queries: string[]): number {
  const cand = normalizeTitleKey(candidate)
  if (!cand) return 0
  let best = 0
  for (const q of queries) {
    const nq = normalizeTitleKey(q)
    if (!nq) continue
    if (cand === nq) return 1000
    if (cand.includes(nq) || nq.includes(cand)) {
      best = Math.max(best, 800 - Math.abs(cand.length - nq.length))
    }
    let shared = 0
    const min = Math.min(cand.length, nq.length)
    for (let i = 0; i < min; i++) {
      if (cand[i] === nq[i]) shared++
      else break
    }
    if (shared >= 2) best = Math.max(best, shared * 40)
  }
  return best
}

export function pickBestMatch<T>(
  items: T[],
  getTitle: (item: T) => string,
  queries: string[],
): T | null {
  let best: T | null = null
  let bestScore = 0
  for (const item of items) {
    const s = scoreTitleMatch(getTitle(item), queries)
    if (s > bestScore) {
      bestScore = s
      best = item
    }
  }
  return bestScore >= 40 ? best : items[0] || null
}

export function uniqueQueries(title: string, alt: string[]): string[] {
  const raw = [title, ...alt].map((s) => s.trim()).filter(Boolean)
  return [...new Set(raw)]
}

export function parseEpisodeIndex(label: string, href = ''): number | null {
  const text = `${label} ${href}`
  const m =
    text.match(/(?:第\s*)?(\d{1,3})\s*集/) ||
    text.match(/EP\s*(\d{1,3})/i) ||
    text.match(/[Ee]-?(\d{1,3})\b/) ||
    text.match(/(?:episode|ep)[=\/_-]?(\d{1,3})/i) ||
    label.trim().match(/^(\d{1,3})$/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}
