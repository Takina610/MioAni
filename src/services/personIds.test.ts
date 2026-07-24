import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePersonOverlayStore } from '../stores/personOverlay'
import {
  buildAniListCharacterId,
  buildAniListStaffId,
  buildBgmCharacterId,
  buildBgmPersonId,
  parsePersonId,
  personRouteName,
  personRoutePath,
} from './personIds'
import {
  fetchPersonComments,
  fetchPersonDetail,
  parseBangumiInfobox,
  parseBangumiMonoComments,
  parseBangumiMonoHtmlComments,
  parseBangumiMonoProfileHtml,
  parseBangumiMonoProfileMarkdown,
} from './person'

afterEach(() => {
  vi.unstubAllGlobals()
})

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

describe('Bangumi person payload parsing', () => {
  it('normalizes nested infobox values into display-safe strings', () => {
    expect(parseBangumiInfobox([
      { key: '别名', value: [{ k: '日文名', v: '古河 渚' }, { k: '罗马字', v: 'Furukawa Nagisa' }] },
      { key: '身高', value: 155 },
      { key: '空值', value: null },
    ])).toEqual([
      { label: '别名', value: '日文名：古河 渚 · 罗马字：Furukawa Nagisa' },
      { label: '身高', value: '155' },
    ])
  })

  it('extracts a missing profile summary from the public mono page', () => {
    const markdown = `
Title: 遠藤明範 | Bangumi 番组计划

Markdown Content:
*   [动画](https://bgm.tv/anime)
*   简体中文名: 远藤明范
*   性别: 男

## 职业: 制作人员

日本の脚本家、作家。

神奈川県出身。

## 最近参与
`

    const profile = parseBangumiMonoProfileMarkdown(markdown, 'person')
    expect(profile).toMatchObject({
      name: '遠藤明範',
      nameAlt: '远藤明范',
      summary: '日本の脚本家、作家。\n\n神奈川県出身。',
    })
    expect(profile.facts).toEqual([
      { label: '简体中文名', value: '远藤明范' },
      { label: '性别', value: '男' },
    ])
  })

  it('extracts profile enrichment from the complete public-page HTML', () => {
    const html = `
<div id="headerSubject" class="clearit">
  <h1 class="nameSingle"><a href="/person/42" title="测试人物中文名">テスト人物</a></h1>
</div>
<div id="columnCrtA" class="column">
  <div class="infobox"><a href="//lain.bgm.tv/pic/crt/l/test.jpg" class="cover"><img class="cover"></a></div>
  <ul id="infobox">
    <li><span class="tip">简体中文名: </span>测试人物中文名</li>
    <li><span class="tip">性别: </span>女</li>
  </ul>
</div>
<div id="columnCrtB" class="column">
  <div class="clearit"><h2 class="subtitle">职业: 声优</h2></div>
  <div class="detail">第一段官网简介。<br>第二段官网简介。</div>
</div>
<div class="crtCommentList"></div>
`

    expect(parseBangumiMonoProfileHtml(html, 'person')).toEqual({
      name: 'テスト人物',
      nameAlt: '测试人物中文名',
      image: 'https://lain.bgm.tv/pic/crt/l/test.jpg',
      summary: '职业: 声优\n\n第一段官网简介。\n第二段官网简介。',
      facts: [
        { label: '简体中文名', value: '测试人物中文名' },
        { label: '性别', value: '女' },
      ],
    })
  })

  it('returns Bangumi comments in newest-first order', () => {
    const markdown = `
## 吐槽箱
[#1](https://bgm.tv/rakuen/topic/prsn/1#post_1) - 2024-01-01 10:00
**[旧留言](https://bgm.tv/user/old)**
第一条
[#2](https://bgm.tv/rakuen/topic/prsn/1#post_2) - 2025-01-01 10:00
**[新留言](https://bgm.tv/user/new)**
第二条
**[新回复](https://bgm.tv/user/reply)**
楼中楼回复
© 2008
`

    const comments = parseBangumiMonoComments(markdown)
    expect(comments.map((comment) => comment.author)).toEqual([
      '新留言',
      '旧留言',
    ])
    expect(comments[0]?.text).toBe('第二条')
    expect(comments[0]?.replies).toEqual([
      { id: '2-reply-1', author: '新回复', text: '楼中楼回复' },
    ])
  })

  it('parses every HTML comment row with independent reply dates', () => {
    const html = `
<div id="comment_list">
  <div class="commentList">
    <div id="post_10" class="light_odd row row_reply clearit" name="floor-1">
      <div class="post_actions re_info"><div class="action"><small><a>#1</a> - 2024-01-01 10:00</small></div></div>
      <div class="inner">
        <strong><a href="/user/old" class="l">旧用户</a></strong>
        <div class="reply_content"><div class="message clearit">较早留言</div></div>
      </div>
    </div>
    <div id="post_20" class="light_even row row_reply clearit" name="floor-2">
      <div class="post_actions re_info"><div class="action"><small><a>#2</a></small></div></div>
      <div class="inner">
        <strong><a href="/user/no-date" class="l">无日期用户</a></strong>
        <div class="reply_content"><div class="message clearit">没有日期也不能被漏掉</div></div>
      </div>
    </div>
    <div id="post_30" class="light_odd row row_reply clearit" name="floor-3">
      <div class="post_actions re_info"><div class="action"><small><a>#3</a> - 2025-01-02 09:30</small></div></div>
      <div class="inner">
        <strong><a href="/user/new" class="l">新用户</a></strong>
        <div class="reply_content">
          <div class="message clearit">最新评论<br>第二行</div>
          <div class="topic_sub_reply">
            <div id="post_31" class="sub_reply_bg clearit" name="floor-3-1">
              <div class="post_actions re_info"><div class="action"><small><a>#3-1</a> - 2025-01-02 10:00</small></div></div>
              <div class="inner">
                <strong><a href="/user/reply" class="l">回复者</a></strong>
                <div class="cmt_sub_content">回复 &amp; 内容</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
<div id="footer"></div>
`

    const comments = parseBangumiMonoHtmlComments(html)

    expect(comments).toHaveLength(3)
    expect(comments.map((comment) => comment.id)).toEqual(['30', '20', '10'])
    expect(comments[0]).toEqual({
      id: '30',
      author: '新用户',
      time: '2025-01-02 09:30',
      text: '最新评论\n第二行',
      replies: [{
        id: '31',
        author: '回复者',
        time: '2025-01-02 10:00',
        text: '回复 & 内容',
      }],
    })
    expect(comments[1]).toMatchObject({
      id: '20',
      author: '无日期用户',
      text: '没有日期也不能被漏掉',
    })
    expect(comments[1]?.time).toBeUndefined()
  })

  it('strips quote chrome, keeps replyTo, soft/hard breaks, drops deleted placeholders', () => {
    const html = `
<div id="comment_list">
  <div class="commentList">
    <div id="post_1" class="row row_reply clearit">
      <div class="action"><small><a>#1</a> - 2026-1-23 13:32</small></div>
      <div class="inner">
        <strong><a class="l">夏実</a></strong>
        <div class="reply_content">
          <div class="message clearit">写真集很色很文艺，甚至有雪天泳衣骑马，敬业啊<br><br>另外公式照有点像另外一个名字里带优的人</div>
        </div>
      </div>
    </div>
    <div id="post_2" class="row row_reply clearit">
      <div class="action"><small><a>#2</a> - 2026-1-27 00:27</small></div>
      <div class="inner">
        <strong><a class="l">夏実</a></strong>
        <div class="reply_content">
          <div class="message clearit">
            <div class="quote"><q><span class="tip_j">回复</span> 2233：还有写真集吗 说: 还有写真集吗</q></div>
            有的，悠悠吉日
          </div>
          <div class="topic_sub_reply">
            <div id="post_3" class="sub_reply_bg clearit">
              <div class="action"><small><a>#2-1</a> - 2026-1-28 02:41</small></div>
              <div class="inner">
                <strong><a class="l">夏実</a></strong>
                <div class="cmt_sub_content">
                  <div class="quote"><q><span class="tip_j">回复</span> 2233：夏実 说: 有的，悠悠吉日</q></div>
                  有没有地址啊，想看
                </div>
              </div>
            </div>
            <div id="post_4" class="sub_reply_bg clearit">
              <div class="action"><small><a>#2-2</a> - 2026-5-19 12:49</small></div>
              <div class="inner">
                <strong><a class="l">pandakun</a></strong>
                <div class="cmt_sub_content">删除了回复</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div id="post_5" class="row row_reply clearit">
      <div class="action"><small><a>#3</a> - 2026-5-21 20:51</small></div>
      <div class="inner">
        <strong><a class="l">匿名用户</a></strong>
        <div class="reply_content">
          <div class="message clearit">かくや过来的<br>她歌声很辽阔啊 那几首歌她唱得很有感觉</div>
        </div>
      </div>
    </div>
    <div id="post_6" class="row row_reply clearit">
      <div class="action"><small><a>#4</a> - 2026-5-22 12:00</small></div>
      <div class="inner">
        <strong><a class="l">pandakun</a></strong>
        <div class="reply_content"><div class="message clearit">删除了回复</div></div>
      </div>
    </div>
  </div>
</div>
<div id="footer"></div>
`

    const comments = parseBangumiMonoHtmlComments(html)
    expect(comments.map((c) => c.id)).toEqual(['5', '2', '1'])
    expect(comments[0]?.text).toBe('かくや过来的\n她歌声很辽阔啊 那几首歌她唱得很有感觉')
    expect(comments[1]).toMatchObject({
      id: '2',
      author: '夏実',
      text: '有的，悠悠吉日',
      replyTo: '2233',
    })
    expect(comments[1]?.replies).toEqual([{
      id: '3',
      author: '夏実',
      time: '2026-1-28 02:41',
      text: '有没有地址啊，想看',
      replyTo: '2233',
    }])
    expect(comments[2]?.text).toBe(
      '写真集很色很文艺，甚至有雪天泳衣骑马，敬业啊\n\n另外公式照有点像另外一个名字里带优的人',
    )
  })

  it('cleans markdown reply quote noise without dropping real floors', () => {
    const markdown = `
## 吐槽箱
[#1](https://bgm.tv/rakuen/topic/prsn/1#post_1) - 2026-1-27 00:27
**[夏実](https://bgm.tv/user/a)**
回复 2233：还有写真集吗 说: 还有写真集吗
有的，悠悠吉日
**[夏実](https://bgm.tv/user/a)**
回复 2233：夏実 说: 有的，悠悠吉日有没有地址啊，想看 说: 有没有地址啊，想看
[#2](https://bgm.tv/rakuen/topic/prsn/1#post_2) - 2026-5-19 12:49
**[pandakun](https://bgm.tv/user/b)**
删除了回复
© 2008
`
    const comments = parseBangumiMonoComments(markdown)
    expect(comments).toHaveLength(1)
    expect(comments[0]?.text).toBe('有的，悠悠吉日')
    expect(comments[0]?.replies?.[0]?.text).toBe('有没有地址啊，想看')
  })

  it('loads complete Bangumi HTML comments in pages of twenty', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => {
      const floor = index + 1
      return `
        <div id="post_${floor}" class="row row_reply clearit" name="floor-${floor}">
          <div class="action"><small><a>#${floor}</a> - 2025-01-${String(floor).padStart(2, '0')} 10:00</small></div>
          <div class="inner">
            <strong><a class="l" href="/user/${floor}">用户${floor}</a></strong>
            <div class="reply_content"><div class="message clearit">留言${floor}</div></div>
          </div>
        </div>`
    }).join('')
    const html = `<div id="comment_list"><div class="commentList">${rows}</div></div><div id="footer"></div>`

    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      const isHtmlRequest = headers.get('X-Return-Format') === 'html'
      return new Response(isHtmlRequest ? html : 'Markdown Content: incomplete', { status: 200 })
    }))

    const first = await fetchPersonComments('bgm-person-987654', 1)
    const second = await fetchPersonComments('bgm-person-987654', 2)

    expect(first).toMatchObject({ page: 1, total: 21, hasMore: true })
    expect(first.items).toHaveLength(20)
    expect(first.items[0]?.id).toBe('21')
    expect(second).toMatchObject({ page: 2, total: 21, hasMore: false })
    expect(second.items.map((comment) => comment.id)).toEqual(['1'])
  })

  it('returns official Bangumi profile without waiting for optional public-page enrichment', async () => {
    const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('r.jina.ai')) {
        await wait(180)
        return new Response('Markdown Content:\n## 职业: 声优\n官网补充简介', { status: 200 })
      }
      if (url.endsWith('/v0/persons/987653')) {
        return Response.json({
          name: '测试人物',
          summary: '',
          infobox: [{ key: '性别', value: '女' }],
          images: { large: 'https://example.com/person.jpg' },
          career: ['seiyu'],
        })
      }
      if (url.endsWith('/subjects') || url.endsWith('/characters')) return Response.json([])
      return new Response('', { status: 404 })
    }))

    const detailPromise = fetchPersonDetail('bgm-person-987653')
    const firstSettled = await Promise.race([
      detailPromise,
      wait(40).then(() => 'blocked-by-enrichment' as const),
    ])
    await detailPromise

    expect(firstSettled).not.toBe('blocked-by-enrichment')
    expect(firstSettled).toMatchObject({
      id: 'bgm-person-987653',
      name: '测试人物',
      careers: ['声优'],
    })
  })

  it('starts Bangumi comments while the main profile request is still loading', async () => {
    const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))
    const html = `
      <div id="headerSubject"><h1 class="nameSingle"><a title="并行人物">並行人物</a></h1></div>
      <div id="columnCrtB"><div class="clearit"><h2 class="subtitle">职业: 声优</h2></div></div>
      <div id="comment_list"><div class="commentList">
        <div id="post_1" class="row row_reply clearit">
          <div class="action"><small><a>#1</a> - 2025-01-01 10:00</small></div>
          <div class="inner"><strong><a class="l">评论用户</a></strong><div class="reply_content"><div class="message clearit">立即加载的吐槽</div></div></div>
        </div>
      </div></div><div id="footer"></div>`
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('r.jina.ai')) return new Response(html, { status: 200 })
      if (url.endsWith('/v0/persons/987652')) {
        await wait(100)
        return Response.json({
          name: '並行人物',
          summary: '',
          infobox: [],
          images: { large: 'https://example.com/concurrent.jpg' },
          career: ['seiyu'],
        })
      }
      if (url.endsWith('/subjects') || url.endsWith('/characters')) return Response.json([])
      return new Response('', { status: 404 })
    }))
    setActivePinia(createPinia())
    const store = usePersonOverlayStore()

    const opening = store.openPerson({ id: 'bgm-person-987652' })
    await wait(20)

    expect(store.loading).toBe(true)
    expect(store.detail?.comments?.map((comment) => comment.text)).toEqual(['立即加载的吐槽'])

    await opening
    expect(store.loading).toBe(false)
    expect(store.detail?.commentsTotal).toBe(1)
    store.close()
  })
})
