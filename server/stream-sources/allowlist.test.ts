import { describe, expect, it } from 'vitest'
import { isProxyHostAllowed } from './index.js'

describe('isProxyHostAllowed', () => {
  it('allows probe CDN hosts', () => {
    expect(isProxyHostAllowed('sorani-vids.xyz')).toBe(true)
    expect(isProxyHostAllowed('cdn.yzzy31-play.com')).toBe(true)
    expect(isProxyHostAllowed('m3u8.oxxx.eu.org')).toBe(true)
    expect(isProxyHostAllowed('www.sorani-vids.xyz')).toBe(true)
  })

  it('allows MXdm / yzzy play-cdn family', () => {
    expect(isProxyHostAllowed('yzzy.play-cdn19.com')).toBe(true)
    expect(isProxyHostAllowed('play-cdn19.com')).toBe(true)
    expect(isProxyHostAllowed('cdn.play-cdn3.com')).toBe(true)
    expect(isProxyHostAllowed('foo.play-cdn12.com')).toBe(true)
  })

  it('allows ezdmw player and disguise CDN hosts', () => {
    expect(isProxyHostAllowed('player.ezdmw.com')).toBe(true)
    expect(isProxyHostAllowed('www.ezdmw.org')).toBe(true)
    expect(isProxyHostAllowed('ezdmw.org')).toBe(true)
    expect(isProxyHostAllowed('image.ezdmw.com')).toBe(true)
    expect(isProxyHostAllowed('cdn.ezdmw.com')).toBe(true)
    expect(isProxyHostAllowed('ins.wdbed.vip')).toBe(true)
    expect(isProxyHostAllowed('wdbed.vip')).toBe(true)
    expect(isProxyHostAllowed('player.danmuzf.vip')).toBe(true)
    expect(isProxyHostAllowed('foo.danmuzf.vip')).toBe(true)
  })

  it('rejects random hosts (SSRF)', () => {
    expect(isProxyHostAllowed('evil.example.com')).toBe(false)
    expect(isProxyHostAllowed('127.0.0.1')).toBe(false)
    expect(isProxyHostAllowed('localhost')).toBe(false)
    // Open-ended play.* / video.* must not pass without known CDN tokens
    expect(isProxyHostAllowed('play.evil.com')).toBe(false)
    expect(isProxyHostAllowed('video.attacker.net')).toBe(false)
    // Bare play-cdn without digit brand is not enough
    expect(isProxyHostAllowed('evil.play-cdn.com')).toBe(false)
    expect(isProxyHostAllowed('play-cdn.attacker.net')).toBe(false)
  })
})
