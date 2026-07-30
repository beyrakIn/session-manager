import { expect, test } from 'vitest'
import {
  applyAutoSave,
  autoSaveName,
  countProfilesForSite,
  newProfile,
  type SessionSnapshot,
} from '../src/lib/profiles'

test('countProfilesForSite counts only matching-site profiles', () => {
  const make = (siteKey: string) =>
    newProfile({ siteKey, name: 'X', color: '#000', cookies: [], localStorage: {}, sessionStorage: {} })
  const profiles = [make('a.com'), make('b.com'), make('a.com')]
  expect(countProfilesForSite(profiles, 'a.com')).toBe(2)
  expect(countProfilesForSite(profiles, 'c.com')).toBe(0)
  expect(countProfilesForSite([], 'a.com')).toBe(0)
})

test('autoSaveName formats as Auto-saved YYYY-MM-DD HH:MM', () => {
  expect(autoSaveName(new Date(2026, 6, 30, 9, 5))).toBe('Auto-saved 2026-07-30 09:05')
})

test('autoSaveName zero-pads single-digit month/day and midnight', () => {
  expect(autoSaveName(new Date(2026, 0, 5, 0, 0))).toBe('Auto-saved 2026-01-05 00:00')
})

test('newProfile fills id and timestamps', () => {
  const p = newProfile({
    siteKey: 'github.com',
    name: 'Work',
    color: '#3b82f6',
    cookies: [],
    localStorage: {},
    sessionStorage: {},
  })
  expect(p.id).toMatch(/^[0-9a-f-]{36}$/)
  expect(p.siteKey).toBe('github.com')
  expect(p.createdAt).toBeGreaterThan(0)
  expect(p.updatedAt).toBe(p.createdAt)
})

const snap = (over: Partial<SessionSnapshot>): SessionSnapshot => ({
  cookies: [],
  localStorage: {},
  sessionStorage: {},
  storageRead: true,
  ...over,
})

test('applyAutoSave updates active profile including storages when read succeeded', () => {
  const p = newProfile({ siteKey: 'a.com', name: 'X', color: '#000', cookies: [], localStorage: { t: '1' }, sessionStorage: {} })
  const profiles = [p]
  applyAutoSave(profiles, 'a.com', p.id, snap({ localStorage: { t: '2' } }), '#9ca3af', new Date())
  expect(p.localStorage).toEqual({ t: '2' })
})

test('applyAutoSave preserves saved storages when the page read failed', () => {
  const p = newProfile({ siteKey: 'a.com', name: 'X', color: '#000', cookies: [], localStorage: { jwt: 'keep-me' }, sessionStorage: { s: '1' } })
  const profiles = [p]
  applyAutoSave(profiles, 'a.com', p.id, snap({ storageRead: false }), '#9ca3af', new Date())
  expect(p.localStorage).toEqual({ jwt: 'keep-me' })
  expect(p.sessionStorage).toEqual({ s: '1' })
})

test('applyAutoSave creates an auto-named profile when none is active and snapshot has content', () => {
  const profiles: ReturnType<typeof newProfile>[] = []
  applyAutoSave(profiles, 'a.com', null, snap({ sessionStorage: { k: 'v' } }), '#9ca3af', new Date(2026, 6, 30, 9, 5))
  expect(profiles).toHaveLength(1)
  expect(profiles[0].name).toBe('Auto-saved 2026-07-30 09:05')
})

test('applyAutoSave skips creation for an empty snapshot', () => {
  const profiles: ReturnType<typeof newProfile>[] = []
  applyAutoSave(profiles, 'a.com', null, snap({}), '#9ca3af', new Date())
  expect(profiles).toHaveLength(0)
})
