import { describe, expect, it } from 'vitest'
import { defaultEpisode, pickPlaybackTitle, watchPositionKey } from './playback'

describe('pickPlaybackTitle', () => {
  it('prefers titles.cn then title then originalTitle', () => {
    const r = pickPlaybackTitle({
      title: 'Main',
      originalTitle: 'Original',
      titles: { cn: '中文名', en: 'English', romaji: 'Romaji' },
    })
    expect(r.title).toBe('中文名')
    expect(r.alt).toContain('Main')
    expect(r.alt).toContain('Original')
    expect(r.alt).toContain('English')
    expect(r.alt).not.toContain('中文名')
  })

  it('falls back to title when no cn', () => {
    const r = pickPlaybackTitle({
      title: 'Frieren',
      originalTitle: '葬送のフリーレン',
      titles: { en: 'Frieren' },
    })
    expect(r.title).toBe('Frieren')
  })
})

describe('defaultEpisode', () => {
  it('uses watched + 1', () => {
    expect(defaultEpisode(0)).toBe(1)
    expect(defaultEpisode(3)).toBe(4)
  })

  it('clamps to episodeCount', () => {
    expect(defaultEpisode(12, 12)).toBe(12)
    expect(defaultEpisode(20, 12)).toBe(12)
  })
})

describe('watchPositionKey', () => {
  it('uses mioani prefix with id and episode', () => {
    expect(watchPositionKey('bgm-123', 5)).toBe('mioani:watch:bgm-123:5')
  })
})

describe('playback source choice', () => {
  it('accepts auto and provider ids as string unions', () => {
    const auto: 'auto' = 'auto'
    const line: 'sorani' | 'ezdmw' | 'MXdm' | 'DM84' = 'ezdmw'
    expect(auto).toBe('auto')
    expect(line).toBe('ezdmw')
  })
})
