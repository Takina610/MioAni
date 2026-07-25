import { describe, expect, it } from 'vitest'
import { pickOnAirSlot, type OnAirEntry } from './onair'

describe('pickOnAirSlot', () => {
  it('prefers CN fields over JP', () => {
    const entry: OnAirEntry = {
      weekDayCN: 3,
      timeCN: '2230',
      weekDayJP: 2,
      timeJP: '2330',
    }
    expect(pickOnAirSlot(entry)).toEqual({
      bangumiWeekday: 3,
      timeRaw: '2230',
    })
  })

  it('falls back to JP when CN empty', () => {
    const entry: OnAirEntry = {
      weekDayJP: 5,
      timeJP: '2100',
    }
    expect(pickOnAirSlot(entry)).toEqual({
      bangumiWeekday: 5,
      timeRaw: '2100',
    })
  })

  it('falls back to JP when timeCN is empty string but weekDayCN is set', () => {
    // Common CDN shape: weekDayCN=0 + empty timeCN, real slot is JP.
    const entry: OnAirEntry = {
      weekDayCN: 0,
      timeCN: '',
      weekDayJP: 5,
      timeJP: '1800',
    }
    expect(pickOnAirSlot(entry)).toEqual({
      bangumiWeekday: 5,
      timeRaw: '1800',
    })
  })

  it('returns empty when no times are present (keep calendar weekday)', () => {
    expect(
      pickOnAirSlot({
        weekDayCN: 0,
        timeCN: '',
        weekDayJP: 3,
      }),
    ).toEqual({})
  })

  it('returns empty for missing entry', () => {
    expect(pickOnAirSlot(undefined)).toEqual({})
  })
})
