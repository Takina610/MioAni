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
      canAdvance: true,
    })
  })

  it('does not offer a plus action for finished anime', () => {
    expect(isAnimeReleasing({ airingStatus: 'finished' })).toBe(false)
    expect(getLibraryProgress({
      watched: 12,
      episodes: 12,
      airingStatus: 'finished',
    }).canAdvance).toBe(false)
  })

  it('uses nextEpisode as a fallback for older library records', () => {
    expect(isAnimeReleasing({ nextEpisode: '明天更新' })).toBe(true)
  })
})
