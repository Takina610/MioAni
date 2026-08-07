import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Anime } from '../types/anime'
import {
  bangumiSubjectIdFromAnime,
  fetchBangumiEpisodeMeta,
  fetchEpisodeComments,
  searchBangumiSubjectId,
} from './bangumiComments'

const baseAnime = {
  id: 'bgm-400602',
  linkedIds: [],
  title: '葬送的芙莉莲',
  originalTitle: '葬送のフリーレン',
  titles: { cn: '葬送的芙莉莲' },
  year: 2023,
} as unknown as Anime

const EPISODE_PAYLOAD = {
  total: 2,
  data: [
    { id: 1227087, sort: 1, name: '冒険の終わり', name_cn: '冒险的终结' },
    { id: 1227088, sort: 2, name: '別に魔法じゃなくたって…', name_cn: '不见得一定要靠魔法…' },
  ],
}

const COMMENTS_HTML = `
<html><body><div id="main" class="mainWrapper"></div>
<div id="columnEpA" class="column column-main">
<div class="singleCommentList">
<div id="comment_list" class="commentList comment-list borderNeue">
  <div id="post_101" class="light_odd row row_reply clearit" name="floor-1" data-item-user="alice">
    <div class="post_actions re_info">
      <div class="action"><small><a href="#post_101" class="floor-anchor">#1</a> - 2024-1-1 10:00</small></div>
    </div>
    <a href="/user/alice" class="avatar"><span class="avatarNeue avatarReSize40 ll"></span></a>
    <div class="inner">
      <strong><a href="/user/alice" class="l post_author_101">Alice</a></strong>
      <div class="reply_content">
        <div class="message clearit">
          第一条吐槽内容
          <div class="topic_sub_reply" id="topic_reply_101">
            <div id="post_102" class="sub_reply_bg sub_reply_collapse clearit" name="floor-1-1" data-item-user="bob">
              <div class="post_actions re_info">
                <div class="action"><small><a href="#post_102" class="floor-anchor">#1-1</a> - 2024-1-1 11:00</small></div>
              </div>
              <a href="/user/bob" class="avatar"><span class="avatarNeue avatarSize32 ll"></span></a>
              <div class="inner">
                <strong><a id="102" href="/user/bob" class="l">Bob</a></strong>
                <div class="cmt_sub_content">楼中楼回复</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div id="post_103" class="light_odd row row_reply clearit" name="floor-2" data-item-user="carol">
    <div class="post_actions re_info">
      <div class="action"><small><a href="#post_103" class="floor-anchor">#2</a> - 2024-1-2 09:00</small></div>
    </div>
    <a href="/user/carol" class="avatar"><span class="avatarNeue avatarReSize40 ll"></span></a>
    <div class="inner">
      <strong><a href="/user/carol" class="l post_author_103">Carol</a></strong>
      <div class="reply_content">
        <div class="message clearit">
          第二条吐槽内容
        </div>
      </div>
    </div>
  </div>
</div>
</div></div></body></html>
`

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('bangumiSubjectIdFromAnime', () => {
  it('extracts subject id from bgm- prefixed id', () => {
    expect(bangumiSubjectIdFromAnime(baseAnime)).toBe(400602)
  })

  it('falls back to linked ids', () => {
    expect(
      bangumiSubjectIdFromAnime({ id: 'anilist-100', linkedIds: ['bgm-88'], title: '', originalTitle: '', titles: {}, year: 0 } as unknown as Anime),
    ).toBe(88)
  })

  it('returns null without a bangumi link', () => {
    expect(
      bangumiSubjectIdFromAnime({ id: 'anilist-100', linkedIds: [], title: '', originalTitle: '', titles: {}, year: 0 } as unknown as Anime),
    ).toBeNull()
  })
})

describe('searchBangumiSubjectId', () => {
  it('prefers exact title match with compatible year', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: 111, name: '別の作品', name_cn: '别作', date: '2024-01-01' },
        { id: 400602, name: '葬送のフリーレン', name_cn: '葬送的芙莉莲', date: '2023-09-29' },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    expect(await searchBangumiSubjectId(baseAnime)).toBe(400602)
  })

  it('returns null on no title match', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 111, name: '完全无关', name_cn: '完全无关', date: '2023-01-01' }],
    }), { status: 200 })))
    expect(await searchBangumiSubjectId(baseAnime)).toBeNull()
  })
})

describe('fetchBangumiEpisodeMeta', () => {
  it('fetches and caches episode metadata', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(EPISODE_PAYLOAD), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const first = await fetchBangumiEpisodeMeta(baseAnime)
    expect(first).toHaveLength(2)
    expect(first[0]).toMatchObject({ id: 1227087, sort: 1, nameCn: '冒险的终结' })

    const second = await fetchBangumiEpisodeMeta(baseAnime)
    expect(second).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('fetchEpisodeComments', () => {
  it('parses episode comments with replies and pages them', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/v0/episodes?')) {
        return new Response(JSON.stringify(EPISODE_PAYLOAD), { status: 200 })
      }
      if (url.includes('r.jina.ai')) {
        return new Response(COMMENTS_HTML, { status: 200 })
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const page1 = await fetchEpisodeComments(baseAnime, 1, 1, 2)
    expect(page1).not.toBeNull()
    expect(page1!.total).toBe(2)
    expect(page1!.items).toHaveLength(2)
    expect(page1!.hasMore).toBe(false)
    // newest first
    expect(page1!.items[0].author).toBe('Carol')
    expect(page1!.items[1].author).toBe('Alice')
    expect(page1!.items[1].replies?.[0]).toMatchObject({ author: 'Bob', text: '楼中楼回复' })
  })

  it('returns null when the anime has no matching bangumi episode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ total: 0, data: [] }), { status: 200 })))
    expect(await fetchEpisodeComments(baseAnime, 99)).toBeNull()
  })
})
