import { afterEach, describe, expect, it } from 'vitest'
import {
  clearLastPlayedMemory,
  defaultEpisode,
  findResumeEpisode,
  pickPlaybackTitle,
  setLastPlayedEpisode,
  setWatchPosition,
  watchPositionKey,
} from './playback'

function clearMioaniStorage() {
  clearLastPlayedMemory()
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith('mioani:')) keys.push(k)
    }
    for (const k of keys) localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
}

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
  afterEach(clearMioaniStorage)

  it('starts at ep 1 with no library progress and no resume', () => {
    expect(defaultEpisode(0)).toBe(1)
    expect(defaultEpisode(0, 12, 'bgm-fresh')).toBe(1)
  })

  it('uses library watched + 1 when no last-played', () => {
    expect(defaultEpisode(3)).toBe(4)
  })

  it('clamps to episodeCount', () => {
    expect(defaultEpisode(12, 12)).toBe(12)
    expect(defaultEpisode(20, 12)).toBe(12)
  })

  it('prefers last-played resume over library progress', () => {
    setLastPlayedEpisode('bgm-1', 2)
    expect(defaultEpisode(5, 12, 'bgm-1')).toBe(2)
  })

  it('setWatchPosition also records last-played', () => {
    setWatchPosition('bgm-2', 7, 90)
    expect(defaultEpisode(0, 24, 'bgm-2')).toBe(7)
  })
})

describe('findResumeEpisode', () => {
  afterEach(clearMioaniStorage)

  it('returns null when no last-played', () => {
    expect(findResumeEpisode('bgm-none')).toBeNull()
  })

  it('returns last played episode', () => {
    setLastPlayedEpisode('bgm-x', 1)
    setLastPlayedEpisode('bgm-x', 3)
    expect(findResumeEpisode('bgm-x')).toBe(3)
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
