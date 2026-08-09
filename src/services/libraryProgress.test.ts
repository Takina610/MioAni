import { describe, expect, it } from 'vitest'
import { getLibraryProgress, isAnimeReleasing } from './libraryProgress'

describe('library progress', () => {
  it('exposes pending episodes for a releasing anime', () => {
    expect(getLibraryProgress({
      watched: 1,
      episodes: 2,
      airingStatus: 'releasing',
    })).toEqual({
      watched: 1,
      available: 2,
      pending: 1,
      releasing: true,
      mode: 'tracking',
      canAdvance: true,
    })
  })

  it('allows unfinished episodes for finished anime', () => {
    expect(isAnimeReleasing({ airingStatus: 'finished' })).toBe(false)
    expect(getLibraryProgress({
      watched: 10,
      episodes: 12,
      airingStatus: 'finished',
    })).toMatchObject({
      canAdvance: true,
      mode: 'catching-up',
    })
    expect(getLibraryProgress({
      watched: 12,
      episodes: 12,
      airingStatus: 'finished',
    })).toMatchObject({
      canAdvance: false,
      mode: null,
    })
  })

  it('treats an explicitly finished anime as finished even with stale nextEpisode data', () => {
    expect(isAnimeReleasing({
      airingStatus: 'finished',
      nextEpisode: '明天更新',
    })).toBe(false)
  })

  it('uses nextEpisode as a fallback for older library records', () => {
    expect(isAnimeReleasing({ nextEpisode: '明天更新' })).toBe(true)
  })
})
