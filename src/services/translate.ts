const cache = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()

function normalize(text: unknown): string {
  if (typeof text !== 'string') return ''
  return text.replace(/\s+/g, ' ').trim()
}

export function shouldOfferTranslation(text?: unknown): boolean {
  const value = normalize(text)
  if (!value) return false
  const hasCjk = /[\u4e00-\u9fff]/.test(value)
  const hasJapanese = /[\u3040-\u30ff]/.test(value)
  const latinCharacters = value.match(/[A-Za-z]/g)?.length || 0
  const hasLatinWords = latinCharacters >= 3
  return hasJapanese || (hasLatinWords && !hasCjk)
}

export async function translateToChinese(text: unknown): Promise<string> {
  const q = normalize(text)
  if (!q) return ''
  const cached = cache.get(q)
  if (cached) return cached
  const pending = inflight.get(q)
  if (pending) return pending

  const request = (async () => {
    const url = new URL('https://translate.googleapis.com/translate_a/single')
    url.searchParams.set('client', 'gtx')
    url.searchParams.set('sl', 'auto')
    url.searchParams.set('tl', 'zh-CN')
    url.searchParams.set('dt', 't')
    url.searchParams.set('q', q)

    const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error('翻译服务暂时不可用')
    const payload = await response.json()
    const translated = Array.isArray(payload?.[0])
      ? payload[0].map((part: unknown[]) => part?.[0] || '').join('').trim()
      : ''
    if (!translated) throw new Error('没有拿到翻译结果')
    cache.set(q, translated)
    return translated
  })().finally(() => {
    inflight.delete(q)
  })

  inflight.set(q, request)
  return request
}
