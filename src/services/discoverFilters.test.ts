import { describe, expect, it } from 'vitest'
import { DEFAULT_DISCOVER_FILTERS, DISCOVER_PAGE_SIZE } from '../constants/discover'
import type { Anime } from '../types/anime'
import type { DiscoverFilters, DiscoverPageRequest } from '../types/discover'
import {
  bangumiNeedsPrecisionGather,
  buildAniListVariables,
  buildBangumiSearchBody,
  classifyBangumiAirStatus,
  softFilterBangumiStatus,
} from './discoverFilters'

function req(partial: {
  keyword?: string
  filters?: Partial<DiscoverFilters>
  page?: number
  pageSize?: number
}): DiscoverPageRequest {
  const genres = partial.filters?.genres
    ? [...partial.filters.genres]
    : [...DEFAULT_DISCOVER_FILTERS.genres]
  return {
    keyword: partial.keyword ?? '',
    filters: {
      ...DEFAULT_DISCOVER_FILTERS,
      ...partial.filters,
      genres,
    },
    page: partial.page ?? 1,
    pageSize: partial.pageSize ?? DISCOVER_PAGE_SIZE,
  }
}

function anime(partial: Partial<Anime> & Pick<Anime, 'id' | 'year'>): Anime {
  return {
    source: 'bangumi',
    title: partial.title || partial.id,
    originalTitle: partial.originalTitle || partial.title || partial.id,
    image: '',
    score: 0,
    season: '',
    episodes: 0,
    watched: 0,
    status: 'planned',
    tags: [],
    summary: '',
    ...partial,
  }
}

describe('buildBangumiSearchBody', () => {
  it('always sends type anime and never invents a status field', () => {
    const body = buildBangumiSearchBody(req({ filters: { status: 'releasing' } }))
    expect(body.filter.type).toEqual([2])
    expect(body.filter).not.toHaveProperty('status')
    expect(body.keyword).toBe('')
  })

  it('maps releasing/not_yet/finished to air_date windows (no year needed)', () => {
    const year = new Date().getFullYear()
    const releasing = buildBangumiSearchBody(req({ filters: { status: 'releasing' } }))
    expect(releasing.filter.air_date).toEqual([`>=${year}-01-01`, `<=${year}-12-31`])

    const notYet = buildBangumiSearchBody(req({ filters: { status: 'not_yet' } }))
    expect(notYet.filter.air_date).toEqual([`>=${year + 1}-01-01`])

    const finished = buildBangumiSearchBody(req({ filters: { status: 'finished' } }))
    expect(finished.filter.air_date).toEqual([`<=${year - 1}-12-31`])
  })

  it('intersects explicit year with status air_date', () => {
    const year = new Date().getFullYear()
    const body = buildBangumiSearchBody(req({
      filters: { year, status: 'releasing' },
    }))
    expect(body.filter.air_date).toEqual([`>=${year}-01-01`, `<=${year}-12-31`])
  })

  it('maps year+season to air_date range', () => {
    const body = buildBangumiSearchBody(req({
      filters: { year: 2024, season: 'SPRING' },
    }))
    expect(body.filter.air_date).toEqual(['>=2024-04-01', '<=2024-06-30'])
  })

  it('uses a single primary language tag (zh)', () => {
    const body = buildBangumiSearchBody(req({ filters: { language: 'zh' } }))
    expect(body.filter.tag).toEqual(['中国'])
  })

  it('merges genre + format + one language tag', () => {
    const body = buildBangumiSearchBody(req({
      filters: { genres: ['科幻', '战斗'], format: 'TV', language: 'zh' },
    }))
    expect(body.filter.tag).toEqual(['科幻', '战斗', 'TV', '中国'])
  })

  it('maps score range to rating filter', () => {
    const body = buildBangumiSearchBody(req({
      filters: { scoreMin: 7, scoreMax: 9 },
    }))
    expect(body.filter.rating).toEqual(['>=7', '<=9'])
  })

  it('forces match sort when keyword present', () => {
    const body = buildBangumiSearchBody(req({
      keyword: '电锯人',
      filters: { sort: 'heat' },
    }))
    expect(body.keyword).toBe('电锯人')
    expect(body.sort).toBe('match')
  })

  it('uses heat for default heat sort without keyword', () => {
    const body = buildBangumiSearchBody(req({ filters: { sort: 'heat' } }))
    expect(body.sort).toBe('heat')
  })
})

describe('buildAniListVariables', () => {
  it('maps status enums and omits status when all', () => {
    expect(buildAniListVariables(req({ filters: { status: 'releasing' } })).status).toBe('RELEASING')
    expect(buildAniListVariables(req({ filters: { status: 'finished' } })).status).toBe('FINISHED')
    expect(buildAniListVariables(req({ filters: { status: 'not_yet' } })).status).toBe('NOT_YET_RELEASED')
    expect(buildAniListVariables(req({ filters: { status: 'all' } }))).not.toHaveProperty('status')
  })

  it('maps season + year', () => {
    const variables = buildAniListVariables(req({
      filters: { year: 2023, season: 'FALL' },
    }))
    expect(variables.seasonYear).toBe(2023)
    expect(variables.season).toBe('FALL')
  })

  it('maps format_in and countryOfOrigin', () => {
    const variables = buildAniListVariables(req({
      filters: { format: 'TV', language: 'JP' },
    }))
    expect(variables.format_in).toEqual(['TV'])
    expect(variables.countryOfOrigin).toBe('JP')
  })

  it('maps Bangumi language chips to AniList country codes', () => {
    expect(buildAniListVariables(req({ filters: { language: 'zh' } })).countryOfOrigin).toBe('CN')
    expect(buildAniListVariables(req({ filters: { language: 'ja' } })).countryOfOrigin).toBe('JP')
  })

  it('maps score range to AniList 0–100 scale', () => {
    const variables = buildAniListVariables(req({
      filters: { scoreMin: 7, scoreMax: 9 },
    }))
    expect(variables.scoreGreater).toBe(69)
    expect(variables.scoreLesser).toBe(91)
  })

  it('forces SEARCH_MATCH when keyword present', () => {
    const variables = buildAniListVariables(req({
      keyword: 'Frieren',
      filters: { sort: 'heat' },
    }))
    expect(variables.search).toBe('Frieren')
    expect(variables.sort).toEqual(['SEARCH_MATCH'])
  })

  it('does not put Bangumi-only fields on AniList variables', () => {
    const variables = buildAniListVariables(req({
      filters: { status: 'releasing', format: 'TV', language: 'CN' },
    }))
    expect(variables).not.toHaveProperty('filter')
    expect(variables).not.toHaveProperty('tag')
    expect(variables).not.toHaveProperty('air_date')
    expect(variables).not.toHaveProperty('rating')
  })
})

describe('classifyBangumiAirStatus', () => {
  const now = new Date('2026-07-22T00:00:00Z')

  it('classifies by year without nextEpisode', () => {
    expect(classifyBangumiAirStatus({ year: 2026 }, now)).toBe('releasing')
    expect(classifyBangumiAirStatus({ year: 2024 }, now)).toBe('finished')
    expect(classifyBangumiAirStatus({ year: 2027 }, now)).toBe('not_yet')
    expect(classifyBangumiAirStatus({ year: 0 }, now)).toBe('unknown')
  })
})

describe('softFilterBangumiStatus', () => {
  const now = new Date('2026-07-22T00:00:00Z')
  const pool = [
    anime({ id: 'a', year: 2026, title: 'This Year' }),
    anime({ id: 'b', year: 2020, title: 'Old' }),
    anime({ id: 'c', year: 2028, title: 'Future' }),
    anime({ id: 'd', year: 0, title: 'Unknown' }),
  ]

  it('keeps releasing items without nextEpisode', () => {
    const items = softFilterBangumiStatus(pool, 'releasing', now)
    expect(items.map((i) => i.id)).toEqual(['a'])
  })

  it('filters finished / not_yet and excludes unknown year from strict statuses', () => {
    expect(softFilterBangumiStatus(pool, 'finished', now).map((i) => i.id)).toEqual(['b'])
    expect(softFilterBangumiStatus(pool, 'not_yet', now).map((i) => i.id)).toEqual(['c'])
    expect(softFilterBangumiStatus(pool, 'all', now)).toHaveLength(4)
  })

  it('does not empty a mixed page when status=releasing and current-year rows exist', () => {
    const page = Array.from({ length: 24 }, (_, i) =>
      anime({ id: `x${i}`, year: i % 3 === 0 ? 2026 : 2018 }),
    )
    const filtered = softFilterBangumiStatus(page, 'releasing', now)
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every((i) => i.year === 2026)).toBe(true)
  })
})

describe('bangumiNeedsPrecisionGather', () => {
  it('requires multi-page gather for non-all status', () => {
    expect(bangumiNeedsPrecisionGather(req({ filters: { status: 'all' } }))).toBe(false)
    expect(bangumiNeedsPrecisionGather(req({ filters: { status: 'releasing' } }))).toBe(true)
    expect(bangumiNeedsPrecisionGather(req({ filters: { status: 'finished' } }))).toBe(true)
  })

  it('requires gather for keyword and genres', () => {
    expect(bangumiNeedsPrecisionGather(req({ keyword: 'abc' }))).toBe(true)
    expect(bangumiNeedsPrecisionGather(req({ filters: { genres: ['科幻'] } }))).toBe(true)
  })
})

describe('combo query assembly', () => {
  it('status + year: BGM air_date (intersected); AL seasonYear + status', () => {
    const bgm = buildBangumiSearchBody(req({
      filters: { status: 'finished', year: 2020 },
    }))
    // year 2020 already inside finished window (…<= last year)
    expect(bgm.filter.air_date).toEqual(['>=2020-01-01', '<=2020-12-31'])
    expect(bgm.filter).not.toHaveProperty('status')

    const al = buildAniListVariables(req({
      filters: { status: 'finished', year: 2020 },
    }))
    expect(al.seasonYear).toBe(2020)
    expect(al.status).toBe('FINISHED')
  })

  it('status + format: BGM tags; AL format_in + status', () => {
    const bgm = buildBangumiSearchBody(req({
      filters: { status: 'releasing', format: 'TV' },
    }))
    expect(bgm.filter.tag).toEqual(['TV'])

    const al = buildAniListVariables(req({
      filters: { status: 'releasing', format: 'MOVIE' },
    }))
    expect(al.format_in).toEqual(['MOVIE'])
    expect(al.status).toBe('RELEASING')
  })

  it('genre + status: BGM tags include genre; AL genre_in + status', () => {
    const bgm = buildBangumiSearchBody(req({
      filters: { genres: ['恋爱'], status: 'finished' },
    }))
    expect(bgm.filter.tag).toEqual(['恋爱'])
    expect(bangumiNeedsPrecisionGather(req({
      filters: { genres: ['恋爱'], status: 'finished' },
    }))).toBe(true)

    const al = buildAniListVariables(req({
      filters: { genres: ['Romance'], status: 'finished' },
    }))
    expect(al.genre_in).toEqual(['Romance'])
    expect(al.status).toBe('FINISHED')
  })

  it('score + status: BGM rating; AL score bounds + status', () => {
    const bgm = buildBangumiSearchBody(req({
      filters: { scoreMin: 8, status: 'releasing' },
    }))
    expect(bgm.filter.rating).toEqual(['>=8'])

    const al = buildAniListVariables(req({
      filters: { scoreMin: 8, status: 'releasing' },
    }))
    expect(al.scoreGreater).toBe(79)
    expect(al.status).toBe('RELEASING')
  })
})
