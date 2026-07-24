import { afterEach, describe, expect, it, vi } from 'vitest'
import { shouldOfferTranslation, translateToChinese } from './translate'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('shouldOfferTranslation', () => {
  it('offers translation for Japanese text', () => {
    expect(shouldOfferTranslation('スパイク・スピーゲルは火星生まれの賞金稼ぎです。')).toBe(true)
    expect(shouldOfferTranslation('ミカ')).toBe(true)
  })

  it('offers translation for English-only text', () => {
    expect(shouldOfferTranslation('Spike Spiegel is a bounty hunter born on Mars.')).toBe(true)
    expect(shouldOfferTranslation('director')).toBe(true)
  })

  it('does not offer translation for Chinese text', () => {
    expect(shouldOfferTranslation('鲁路修是 Code Geass 反叛的鲁路修中的主角。')).toBe(false)
  })

  it('ignores non-text API values without throwing', () => {
    const values = [0, 18, true, { name: 'Spike' }, ['Spike'], null, undefined]

    for (const value of values) {
      expect(() => shouldOfferTranslation(value as never)).not.toThrow()
      expect(shouldOfferTranslation(value as never)).toBe(false)
    }
  })
})

describe('translateToChinese', () => {
  it('deduplicates concurrent requests and reuses the cached translation', async () => {
    const source = '日本ナレーション演技研究所 · concurrent-cache-test'
    let resolveResponse: ((response: Response) => void) | undefined
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => responsePromise)

    const first = translateToChinese(source)
    const second = translateToChinese(source)

    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveResponse?.({
      ok: true,
      json: async () => [[['并发请求已去重']]],
    } as Response)

    await expect(Promise.all([first, second])).resolves.toEqual([
      '并发请求已去重',
      '并发请求已去重',
    ])
    await expect(translateToChinese(source)).resolves.toBe('并发请求已去重')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
