import { describe, it, expect } from 'vitest'
import { corsProxy } from './cors-proxy'
import { ContentType, HeaderName, HttpMethod } from '../core/types'

describe('corsProxy', () => {
  it('rewrites absolute HTTP URLs by default', () => {
    const mw = corsProxy()
    const result = mw.onRequest!('https://api.example.com/users', { method: HttpMethod.GET })
    expect(result).toEqual({
      url: `/api-proxy/${encodeURIComponent('https://api.example.com/users')}`,
      init: { method: HttpMethod.GET },
    })
  })

  it('does not rewrite relative URLs', () => {
    const mw = corsProxy()
    const result = mw.onRequest!('/users', { method: HttpMethod.GET })
    expect(result).toEqual({
      url: '/users',
      init: { method: HttpMethod.GET },
    })
  })

  it('supports custom rewrite function', () => {
    const mw = corsProxy({
      rewrite: (url) => `https://proxy.io/?url=${encodeURIComponent(url)}`,
    })
    const result = mw.onRequest!('https://api.example.com/data', { method: HttpMethod.GET })
    expect(result).toEqual({
      url: `https://proxy.io/?url=${encodeURIComponent('https://api.example.com/data')}`,
      init: { method: HttpMethod.GET },
    })
  })

  it('supports custom shouldProxy predicate', async () => {
    const mw = corsProxy({
      shouldProxy: (url) => url.includes('blocked-api.com'),
    })

    const blocked = await mw.onRequest!('https://blocked-api.com/data', { method: HttpMethod.GET })
    expect(blocked.url).toContain('api-proxy')

    const allowed = await mw.onRequest!('https://open-api.com/data', { method: HttpMethod.GET })
    expect(allowed.url).toBe('https://open-api.com/data')
  })

  it('preserves init unchanged', async () => {
    const mw = corsProxy()
    const init = { method: HttpMethod.POST, body: '{}', headers: { [HeaderName.CONTENT_TYPE]: ContentType.JSON } }
    const result = await mw.onRequest!('https://api.example.com/users', init)
    expect(result.init).toBe(init)
  })

  it('has the name cors-proxy', () => {
    const mw = corsProxy()
    expect(mw.name).toBe('cors-proxy')
  })
})
