import { expect, test } from 'vitest'
import {
  formatBytes,
  groupProfilesBySite,
  matchesQuery,
  profileStats,
} from '../src/lib/dashboard'
import { newProfile } from '../src/lib/profiles'
import type { CapturedCookie } from '../src/lib/cookies'

const make = (siteKey: string, name: string, over: Partial<Parameters<typeof newProfile>[0]> = {}) =>
  newProfile({
    siteKey,
    name,
    color: '#000',
    cookies: [],
    localStorage: {},
    sessionStorage: {},
    ...over,
  })

test('profileStats counts cookies, storage keys, and a byte estimate', () => {
  const p = make('a.com', 'X', {
    cookies: [{ name: 'sid' }, { name: 'csrf' }] as unknown as CapturedCookie[],
    localStorage: { token: 'abc', theme: 'dark' },
    sessionStorage: { tmp: '1' },
  })
  const s = profileStats(p)
  expect(s.cookies).toBe(2)
  expect(s.storageKeys).toBe(3)
  expect(s.bytes).toBeGreaterThan(0)
})

test('formatBytes uses B, KB and MB with sensible precision', () => {
  expect(formatBytes(0)).toBe('0 B')
  expect(formatBytes(820)).toBe('820 B')
  expect(formatBytes(1024)).toBe('1.0 KB')
  expect(formatBytes(1536)).toBe('1.5 KB')
  expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB')
})

test('groupProfilesBySite sorts sites alphabetically and profiles by recency', () => {
  const older = make('b.com', 'Older')
  const newer = make('b.com', 'Newer')
  newer.updatedAt = older.updatedAt + 1000
  const other = make('a.com', 'Only')

  const groups = groupProfilesBySite([older, newer, other])
  expect(groups.map((g) => g.siteKey)).toEqual(['a.com', 'b.com'])
  expect(groups[1].profiles.map((p) => p.name)).toEqual(['Newer', 'Older'])
  expect(groups[1].totalBytes).toBeGreaterThan(0)
})

test('groupProfilesBySite returns nothing for an empty list', () => {
  expect(groupProfilesBySite([])).toEqual([])
})

test('matchesQuery is case-insensitive across site key, name and emoji', () => {
  const p = make('jira.company.com', 'Work account', { emoji: '💼' })
  expect(matchesQuery(p, '')).toBe(true)
  expect(matchesQuery(p, 'JIRA')).toBe(true)
  expect(matchesQuery(p, 'work')).toBe(true)
  expect(matchesQuery(p, '💼')).toBe(true)
  expect(matchesQuery(p, '  company  ')).toBe(true)
  expect(matchesQuery(p, 'wiki')).toBe(false)
})
