import { expect, test } from 'vitest'
import { autoSaveName, newProfile } from '../src/lib/profiles'

test('autoSaveName formats as Auto-saved YYYY-MM-DD HH:MM', () => {
  expect(autoSaveName(new Date(2026, 6, 30, 9, 5))).toBe('Auto-saved 2026-07-30 09:05')
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
