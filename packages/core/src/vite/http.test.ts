import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { sameOrigin } from './http.js'

const req = (headers: Record<string, string>, encrypted = false) =>
  ({ headers, socket: { encrypted } }) as unknown as IncomingMessage

describe('sameOrigin', () => {
  it('accepts the page from this host and requests with no Origin', () => {
    expect(sameOrigin(req({ host: 'localhost:5473', origin: 'http://localhost:5473' }))).toBe(true)
    expect(sameOrigin(req({ host: 'localhost:5473' }))).toBe(true)
  })

  it('refuses another origin or a cross-site fetch', () => {
    expect(sameOrigin(req({ host: 'localhost:5473', origin: 'http://evil.test' }))).toBe(false)
    expect(
      sameOrigin(
        req({
          host: 'localhost:5473',
          origin: 'http://localhost:5473',
          'sec-fetch-site': 'cross-site',
        }),
      ),
    ).toBe(false)
    expect(sameOrigin(req({ host: 'localhost:5473', origin: 'null' }))).toBe(false)
  })

  it('accepts a proxied https page when the proxy forwards the host but not the scheme', () => {
    const headers = {
      host: 'localhost:5473',
      'x-forwarded-host': '5473-cs-123.cloudshell.dev',
      origin: 'https://5473-cs-123.cloudshell.dev',
    }
    expect(sameOrigin(req(headers))).toBe(true)
  })

  it('holds the scheme to the forwarded one when the proxy states it', () => {
    const base = { host: 'localhost:5473', 'x-forwarded-host': 'dash.example.com' }
    expect(
      sameOrigin(
        req({ ...base, 'x-forwarded-proto': 'https', origin: 'https://dash.example.com' }),
      ),
    ).toBe(true)
    expect(
      sameOrigin(req({ ...base, 'x-forwarded-proto': 'https', origin: 'http://dash.example.com' })),
    ).toBe(false)
    expect(sameOrigin(req({ ...base, origin: 'https://other.example.com' }))).toBe(false)
  })
})
