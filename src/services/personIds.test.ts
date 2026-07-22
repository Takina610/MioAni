import { describe, expect, it } from 'vitest'
import {
  buildAniListCharacterId,
  buildAniListStaffId,
  buildBgmCharacterId,
  buildBgmPersonId,
  parsePersonId,
  personRouteName,
  personRoutePath,
} from './personIds'

describe('personIds', () => {
  it('builds stable dual-source ids', () => {
    expect(buildBgmCharacterId(1)).toBe('bgm-char-1')
    expect(buildBgmPersonId(9)).toBe('bgm-person-9')
    expect(buildAniListCharacterId(123)).toBe('anilist-char-123')
    expect(buildAniListStaffId(456)).toBe('anilist-staff-456')
  })

  it('parses character and person ids', () => {
    expect(parsePersonId('bgm-char-12')).toEqual({
      kind: 'character',
      source: 'bangumi',
      rawId: '12',
      id: 'bgm-char-12',
    })
    expect(parsePersonId('anilist-staff-99')).toEqual({
      kind: 'person',
      source: 'anilist',
      rawId: '99',
      id: 'anilist-staff-99',
    })
    expect(parsePersonId('bgm-999')).toBeNull()
  })

  it('maps routes by kind', () => {
    expect(personRouteName('character')).toBe('character-detail')
    expect(personRouteName('person')).toBe('person-detail')
    expect(personRoutePath('bgm-char-1')).toBe('/character/bgm-char-1')
    expect(personRoutePath('bgm-person-2')).toBe('/person/bgm-person-2')
    expect(personRoutePath('bad')).toBeNull()
  })
})
