import { describe, expect, it } from 'vitest'
import type { Anime } from '../types/anime'
import {
  bangumiWeekdayToJs,
  buildScheduleFromAniList,
  buildWeekSchedule,
  emptyWeekSchedule,
  enrichScheduleWithAiringTimes,
  formatAirTime,
  scheduleHasContent,
  weekdayLabel,
} from './schedule'

function anime(partial: Partial<Anime> & Pick<Anime, 'id'>): Anime {
  return {
    source: 'bangumi',
    title: partial.title || partial.id,
    originalTitle: partial.originalTitle || partial.title || partial.id,
    image: '',
    score: 0,
    year: 2026,
    season: '',
    episodes: 0,
    watched: 0,
    status: 'planned',
    tags: [],
    summary: '',
    popularity: 0,
    ...partial,
  }
}

describe('bangumiWeekdayToJs', () => {
  it('maps 1=Mon … 7=Sun to JS getDay()', () => {
    expect(bangumiWeekdayToJs(1)).toBe(1)
    expect(bangumiWeekdayToJs(5)).toBe(5)
    expect(bangumiWeekdayToJs(6)).toBe(6)
    expect(bangumiWeekdayToJs(7)).toBe(0)
  })

  it('falls back safely for invalid ids', () => {
    expect(bangumiWeekdayToJs(0)).toBe(0)
    expect(bangumiWeekdayToJs(99)).toBe(0)
  })
})

describe('formatAirTime', () => {
  it('normalizes compact and colon times', () => {
    expect(formatAirTime('2330')).toBe('23:30')
    expect(formatAirTime('930')).toBe('09:30')
    expect(formatAirTime('9:05')).toBe('09:05')
    expect(formatAirTime('23:30')).toBe('23:30')
  })

  it('rejects empty or invalid values', () => {
    expect(formatAirTime('')).toBeUndefined()
    expect(formatAirTime(undefined)).toBeUndefined()
    expect(formatAirTime('99:99')).toBeUndefined()
    expect(formatAirTime('ab')).toBeUndefined()
  })
})

describe('buildWeekSchedule', () => {
  // Fixed Wednesday so isToday is deterministic (2026-07-22 is Wednesday).
  const wednesday = new Date(2026, 6, 22, 12, 0, 0)

  it('emits Mon→Sun order with Chinese labels', () => {
    const days = emptyWeekSchedule(wednesday)
    expect(days).toHaveLength(7)
    expect(days.map((d) => d.label)).toEqual([
      '周一', '周二', '周三', '周四', '周五', '周六', '周日',
    ])
    expect(days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0])
  })

  it('marks today and sorts timed ascending then untimed', () => {
    const days = buildWeekSchedule(
      [
        { anime: anime({ id: 'bgm-1', title: 'Late', popularity: 10 }), airWeekday: 3, airTime: '23:00' },
        { anime: anime({ id: 'bgm-2', title: 'Early', popularity: 1 }), airWeekday: 3, airTime: '09:30' },
        { anime: anime({ id: 'bgm-3', title: 'Pending B', popularity: 5 }), airWeekday: 3 },
        { anime: anime({ id: 'bgm-4', title: 'Pending A', popularity: 50 }), airWeekday: 3 },
        { anime: anime({ id: 'bgm-5', title: 'Monday', popularity: 1 }), airWeekday: 1, airTime: '2200' },
      ],
      wednesday,
    )

    const wed = days.find((d) => d.weekday === 3)!
    expect(wed.isToday).toBe(true)
    expect(days.find((d) => d.weekday === 1)?.isToday).toBe(false)

    expect(wed.items.map((i) => i.anime.id)).toEqual([
      'bgm-2', // 09:30
      'bgm-1', // 23:00
      'bgm-4', // untimed, higher popularity
      'bgm-3', // untimed, lower popularity
    ])
    expect(wed.items.map((i) => i.timed)).toEqual([true, true, false, false])
    expect(wed.items[2].airTime).toBeUndefined()
    expect(wed.items[0].airTime).toBe('09:30')

    const mon = days.find((d) => d.weekday === 1)!
    expect(mon.items).toHaveLength(1)
    expect(mon.items[0].airTime).toBe('22:00')
  })

  it('dedupes by anime id and never invents fake times', () => {
    const days = buildWeekSchedule(
      [
        { anime: anime({ id: 'bgm-1', title: 'A' }), airWeekday: 2, airTime: '21:00' },
        { anime: anime({ id: 'bgm-1', title: 'A-dup' }), airWeekday: 2, airTime: '10:00' },
        { anime: anime({ id: 'bgm-2', title: 'B' }), airWeekday: 2 },
      ],
      wednesday,
    )
    const tue = days.find((d) => d.weekday === 2)!
    expect(tue.items).toHaveLength(2)
    expect(tue.items[0].airTime).toBe('21:00')
    expect(tue.items[1].timed).toBe(false)
    expect(tue.items[1].airTime).toBeUndefined()
  })

  it('scheduleHasContent is false for empty week', () => {
    expect(scheduleHasContent(emptyWeekSchedule(wednesday))).toBe(false)
    expect(
      scheduleHasContent(
        buildWeekSchedule(
          [{ anime: anime({ id: 'x' }), airWeekday: 1, airTime: '12:00' }],
          wednesday,
        ),
      ),
    ).toBe(true)
  })
})

describe('buildScheduleFromAniList', () => {
  it('groups by local weekday and HH:mm from airingAt', () => {
    // 2026-07-20 20:15 local (Monday if system is local; construct via Date components).
    const monday = new Date(2026, 6, 20, 20, 15, 0)
    const airingAt = Math.floor(monday.getTime() / 1000)
    const items = [anime({ id: 'anilist-1', title: 'AL Show', source: 'anilist' })]
    const map = new Map([['anilist-1', airingAt]])
    const days = buildScheduleFromAniList(items, map, monday)

    const mon = days.find((d) => d.weekday === monday.getDay())!
    expect(mon.items).toHaveLength(1)
    expect(mon.items[0].timed).toBe(true)
    expect(mon.items[0].airTime).toBe('20:15')
    expect(mon.items[0].anime.airDay).toBe(weekdayLabel(monday.getDay()))
  })

  it('skips entries without airingAt', () => {
    const now = new Date(2026, 6, 22)
    const days = buildScheduleFromAniList(
      [anime({ id: 'anilist-1', source: 'anilist' })],
      new Map(),
      now,
    )
    expect(scheduleHasContent(days)).toBe(false)
  })
})

describe('enrichScheduleWithAiringTimes', () => {
  it('fills missing HH:mm from same-title AniList donor', () => {
    const now = new Date(2026, 6, 22)
    const base = buildWeekSchedule(
      [
        {
          anime: anime({
            id: 'bgm-1',
            source: 'bangumi',
            title: '地狱模式 第二季',
            originalTitle: 'ヘルモード 2nd Season',
            titles: { cn: '地狱模式 第二季', native: 'ヘルモード 2nd Season' },
            year: 2026,
          }),
          airWeekday: 3,
        },
      ],
      now,
    )
    expect(base.find((d) => d.weekday === 3)!.items[0].timed).toBe(false)

    const enriched = enrichScheduleWithAiringTimes(
      base,
      [
        anime({
          id: 'anilist-9',
          source: 'anilist',
          title: 'ヘルモード 2nd Season',
          originalTitle: 'ヘルモード 2nd Season',
          titles: { native: 'ヘルモード 2nd Season', cn: '地狱模式 第二季' },
          year: 2026,
          airTime: '22:30',
          airWeekday: 3,
        }),
      ],
      now,
    )
    const item = enriched.find((d) => d.weekday === 3)!.items[0]
    expect(item.timed).toBe(true)
    expect(item.airTime).toBe('22:30')
  })

  it('keeps existing times and skips when no donor match', () => {
    const now = new Date(2026, 6, 22)
    const base = buildWeekSchedule(
      [
        {
          anime: anime({ id: 'bgm-1', title: '已知时刻', year: 2026 }),
          airWeekday: 1,
          airTime: '19:00',
        },
        {
          anime: anime({ id: 'bgm-2', title: '无匹配', year: 2026 }),
          airWeekday: 2,
        },
      ],
      now,
    )
    const out = enrichScheduleWithAiringTimes(
      base,
      [anime({ id: 'anilist-x', title: '完全不同', year: 2026, airTime: '10:00' })],
      now,
    )
    expect(out.find((d) => d.weekday === 1)!.items[0].airTime).toBe('19:00')
    expect(out.find((d) => d.weekday === 2)!.items[0].timed).toBe(false)
  })
})
