import { describe, expect, it, vi } from 'vitest'
import {
  filterDanmuBySource,
  normalizeDanmuResponse,
  readDanmuMargin,
  readDanmuSourcePreferences,
  writeDanmuMargin,
  writeDanmuSourcePreferences,
} from './danmu'

describe('danmu service', () => {
  it('normalizes an aggregated response and falls back to source counts', () => {
    const result = normalizeDanmuResponse({
      comments: [
        { text: 'one', time: 3, mode: 0, color: '#ff0000', sources: ['Bilibili'] },
        { m: 'two', time: 5, mode: 5, color: 255, sources: ['Tencent', 'bilibili'] },
      ],
    })

    expect(result.comments[1]).toEqual({
      text: 'two',
      time: 5,
      mode: 1,
      color: '#0000FF',
      sources: ['tencent', 'bilibili'],
    })
    expect(result.sourceCounts).toEqual([
      { id: 'bilibili', label: 'bilibili', count: 2 },
      { id: 'tencent', label: 'tencent', count: 1 },
    ])
  })

  it('keeps comments usable when an upstream adapter marks the response unavailable', () => {
    const result = normalizeDanmuResponse({
      available: false,
      comments: [{ text: 'loaded despite stale flag', sources: ['bilibili'] }],
    })

    expect(result).toMatchObject({
      available: true,
      count: 1,
    })
    expect(result.comments[0].text).toBe('loaded despite stale flag')
  })

  it('keeps merged comments when at least one source remains enabled', () => {
    const comments = normalizeDanmuResponse({
      comments: [
        { text: 'merged', sources: ['bilibili', 'tencent'] },
        { text: 'only bilibili', sources: ['bilibili'] },
      ],
    }).comments

    expect(filterDanmuBySource(comments, { bilibili: false })).toEqual([
      { text: 'merged', mode: 0, color: '#FFFFFF', sources: ['bilibili', 'tencent'] },
    ])
  })

  it('accepts merged source strings and canonicalizes platform aliases', () => {
    const result = normalizeDanmuResponse({
      comments: [{
        text: 'merged',
        time: 120_000,
        sources: 'bilibili1&qq&qiyi&dandan',
      }],
    })

    expect(result.comments[0]).toMatchObject({
      time: 120,
      sources: ['bilibili', 'tencent', 'iqiyi', 'dandan'],
    })
    expect(filterDanmuBySource(result.comments, { bilibili: false })).toHaveLength(1)
    expect(filterDanmuBySource(result.comments, {
      bilibili: false,
      tencent: false,
      iqiyi: false,
      dandan: false,
    })).toHaveLength(0)
  })

  it('persists source preferences when localStorage is available', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    })
    writeDanmuSourcePreferences({ bilibili: false })
    expect(readDanmuSourcePreferences()).toEqual({ bilibili: false })
    localStorage.removeItem('mioani:danmu-source-preferences')
    vi.unstubAllGlobals()
  })

  it('persists only supported danmu margin settings', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    })
    writeDanmuMargin([10, '50%'])
    expect(readDanmuMargin()).toEqual([10, '50%'])
    writeDanmuMargin([10, '15%'])
    expect(readDanmuMargin()).toEqual([10, '50%'])
    localStorage.removeItem('mioani:danmu-settings')
    vi.unstubAllGlobals()
  })
})
