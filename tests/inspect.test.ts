import { expect, test } from 'vitest'
import { cookieFlags, cookieExpiry, entriesToRecord, recordToEntries } from '../src/lib/inspect'
import type { CapturedCookie } from '../src/lib/cookies'

const cookie = (over: Partial<CapturedCookie>): CapturedCookie => ({
  name: 'sid',
  value: 'abc',
  domain: 'example.com',
  path: '/',
  secure: false,
  httpOnly: false,
  sameSite: 'unspecified',
  hostOnly: true,
  session: false,
  expirationDate: 1900000000,
  ...over,
})

test('cookieFlags lists only the flags that are set', () => {
  expect(cookieFlags(cookie({}))).toEqual([])
  expect(cookieFlags(cookie({ secure: true, httpOnly: true }))).toEqual(['Secure', 'HttpOnly'])
  expect(cookieFlags(cookie({ sameSite: 'strict' }))).toEqual(['SameSite=strict'])
  expect(cookieFlags(cookie({ hostOnly: false }))).toEqual(['Domain cookie'])
})

test('cookieExpiry describes session vs dated cookies', () => {
  expect(cookieExpiry(cookie({ session: true }))).toBe('Session')
  expect(cookieExpiry(cookie({ expirationDate: undefined }))).toBe('Session')
  const dated = cookieExpiry(cookie({ expirationDate: 1900000000 }))
  expect(dated).toMatch(/\d/)
  expect(dated).not.toBe('Session')
})

test('cookieExpiry marks already-expired cookies', () => {
  expect(cookieExpiry(cookie({ expirationDate: 1 }))).toBe('Expired')
})

test('record/entries round-trip preserves order and values', () => {
  const rec = { token: 'abc', theme: 'dark' }
  const entries = recordToEntries(rec)
  expect(entries).toEqual([
    ['token', 'abc'],
    ['theme', 'dark'],
  ])
  expect(entriesToRecord(entries)).toEqual(rec)
})

test('entriesToRecord drops blank keys and keeps the last duplicate', () => {
  expect(
    entriesToRecord([
      ['', 'ignored'],
      ['  ', 'ignored too'],
      ['k', 'first'],
      ['k', 'second'],
    ])
  ).toEqual({ k: 'second' })
})

test('entriesToRecord tolerates a key literally named __proto__', () => {
  const out = entriesToRecord([['__proto__', 'v']])
  expect(Object.entries(out)).toContainEqual(['__proto__', 'v'])
})
