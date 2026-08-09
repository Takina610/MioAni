import { describe, expect, it } from 'vitest'
import { normalizeWatchStatus } from './anime'

describe('normalizeWatchStatus', () => {
  it('merges paused and dropped source states', () => {
    expect(normalizeWatchStatus('paused')).toBe('dropped')
    expect(normalizeWatchStatus('dropped')).toBe('dropped')
  })

  it('falls back to planned for unknown imported states', () => {
    expect(normalizeWatchStatus('unknown-status')).toBe('planned')
  })
})
