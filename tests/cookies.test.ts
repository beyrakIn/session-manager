import { expect, test } from 'vitest'
import { toSetParams, type CapturedCookie } from '../src/lib/cookies'

function cookie(overrides: Partial<CapturedCookie>): CapturedCookie {
  return {
    name: 'sid',
    value: 'abc123',
    domain: '.github.com',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    hostOnly: false,
    session: false,
    expirationDate: 1900000000,
    storeId: '0',
    ...overrides,
  }
}

test('domain cookie: keeps domain, builds https url from stripped host', () => {
  const p = toSetParams(cookie({}))
  expect(p.url).toBe('https://github.com/')
  expect(p.domain).toBe('.github.com')
  expect(p.expirationDate).toBe(1900000000)
})

test('host-only cookie: omits domain entirely', () => {
  const p = toSetParams(cookie({ domain: 'github.com', hostOnly: true }))
  expect(p.url).toBe('https://github.com/')
  expect(p.domain).toBeUndefined()
})

test('insecure cookie builds http url', () => {
  const p = toSetParams(cookie({ secure: false, domain: 'example.com', hostOnly: true }))
  expect(p.url).toBe('http://example.com/')
})

test('session cookie: omits expirationDate', () => {
  const p = toSetParams(cookie({ session: true }))
  expect(p.expirationDate).toBeUndefined()
})

test('__Host- cookie: no domain, path preserved as /', () => {
  const p = toSetParams(
    cookie({ name: '__Host-session', domain: 'app.example.com', hostOnly: true, path: '/' })
  )
  expect(p.domain).toBeUndefined()
  expect(p.path).toBe('/')
  expect(p.url).toBe('https://app.example.com/')
})

test('non-root path is used in the url', () => {
  const p = toSetParams(cookie({ path: '/api', domain: 'example.com', hostOnly: true }))
  expect(p.url).toBe('https://example.com/api')
})
