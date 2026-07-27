import { describe, expect, it } from 'vitest'
import type { Anime } from '../types/anime'
import {
  addLocalDays,
  bangumiWeekdayToJs,
  buildScheduleFromAniList,
  buildWeekSchedule,
  emptyWeekSchedule,
  enrichScheduleWithAiringTimes,
  formatAirTime,
  flattenRecentSchedule,
  formatScheduleMonthDay,
  isSameLocalDay,
  itemsForWeekday,
  scheduleHasContent,
  sliceScheduleWindow,
  startOfLocalDay,
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

describe('schedule window helpers', () => {
  it('startOfLocalDay zeros time', () => {
    const d = new Date(2026, 6, 25, 15, 30, 45, 123)
    const start = startOfLocalDay(d)
    expect(start.getFullYear()).toBe(2026)
    expect(start.getMonth()).toBe(6)
    expect(start.getDate()).toBe(25)
    expect(start.getHours()).toBe(0)
    expect(start.getMinutes()).toBe(0)
    expect(start.getSeconds()).toBe(0)
  })

  it('addLocalDays crosses month boundaries', () => {
    const start = startOfLocalDay(new Date(2026, 6, 30))
    const next = addLocalDays(start, 2)
    expect(next.getFullYear()).toBe(2026)
    expect(next.getMonth()).toBe(7)
    expect(next.getDate()).toBe(1)
  })

  it('sliceScheduleWindow returns consecutive midnights', () => {
    const start = startOfLocalDay(new Date(2026, 6, 25))
    const window = sliceScheduleWindow(start, 4)
    expect(window).toHaveLength(4)
    expect(window.map((d) => d.getDate())).toEqual([25, 26, 27, 28])
    expect(window.every((d) => d.getHours() === 0)).toBe(true)
  })

  it('itemsForWeekday maps template days', () => {
    const now = new Date(2026, 6, 22)
    const days = buildWeekSchedule(
      [{ anime: anime({ id: 'bgm-1', title: 'Mon' }), airWeekday: 1, airTime: '12:00' }],
      now,
    )
    expect(itemsForWeekday(days, 1)).toHaveLength(1)
    expect(itemsForWeekday(days, 2)).toHaveLength(0)
    expect(itemsForWeekday(days, 99)).toHaveLength(0)
  })

  it('isSameLocalDay and formatScheduleMonthDay', () => {
    const a = new Date(2026, 6, 25, 8, 0, 0)
    const b = new Date(2026, 6, 25, 23, 59, 0)
    const c = new Date(2026, 6, 26, 0, 0, 0)
    expect(isSameLocalDay(a, b)).toBe(true)
    expect(isSameLocalDay(a, c)).toBe(false)
    expect(formatScheduleMonthDay(a)).toBe('7/25')
  })

  it('flattenRecentSchedule dedupes and limits', () => {
    const now = new Date(2026, 6, 22)
    const days = buildWeekSchedule(
      [
        { anime: anime({ id: 'a', title: 'A', popularity: 1 }), airWeekday: 1, airTime: '20:00' },
        { anime: anime({ id: 'b', title: 'B', popularity: 99 }), airWeekday: 2, airTime: '10:00' },
        { anime: anime({ id: 'c', title: 'C', popularity: 5 }), airWeekday: 3 },
      ],
      now,
    )
    const recent = flattenRecentSchedule(days, 2)
    expect(recent).toHaveLength(2)
    expect(recent[0].anime.id).toBe('b')
    expect(recent[0].dayLabel).toBe('周二')
    expect(recent.every((item) => item.dayLabel)).toBe(true)
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

  it('fills missing episodes from AniList donor', () => {
    const now = new Date(2026, 6, 22)
    const base = buildWeekSchedule(
      [
        {
          anime: anime({
            id: 'bgm-ep',
            source: 'bangumi',
            title: '集数缺失',
            originalTitle: 'Missing Eps',
            titles: { cn: '集数缺失', native: 'Missing Eps' },
            year: 2026,
            episodes: 0,
          }),
          airWeekday: 1,
          airTime: '12:00',
        },
      ],
      now,
    )
    expect(base.find((d) => d.weekday === 1)!.items[0].anime.episodes).toBe(0)

    const enriched = enrichScheduleWithAiringTimes(
      base,
      [
        anime({
          id: 'anilist-ep',
          source: 'anilist',
          title: 'Missing Eps',
          originalTitle: 'Missing Eps',
          titles: { native: 'Missing Eps', cn: '集数缺失' },
          year: 2026,
          episodes: 12,
          airTime: '12:00',
        }),
      ],
      now,
    )
    expect(enriched.find((d) => d.weekday === 1)!.items[0].anime.episodes).toBe(12)
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
