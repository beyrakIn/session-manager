import { expect, test } from 'vitest'
import { mergeProfiles, parseImport, serializeExport } from '../src/lib/transfer'
import { newProfile } from '../src/lib/profiles'

const sample = () =>
  newProfile({
    siteKey: 'github.com',
    name: 'Work',
    color: '#3b82f6',
    cookies: [],
    localStorage: { theme: 'dark' },
    sessionStorage: {},
  })

test('export/import round-trip preserves profiles', () => {
  const p = sample()
  const parsed = parseImport(serializeExport([p]))
  expect(parsed).toEqual([p])
})

test('parseImport rejects invalid JSON', () => {
  expect(() => parseImport('{oops')).toThrow('Not valid JSON')
})

test('parseImport rejects foreign JSON files', () => {
  expect(() => parseImport('{"foo": 1}')).toThrow('Not a session-manager export')
  expect(() => parseImport('[]')).toThrow('Not a session-manager export')
})

test('parseImport rejects malformed profiles', () => {
  const bad = JSON.stringify({ app: 'session-manager', version: 1, profiles: [{ id: 42 }] })
  expect(() => parseImport(bad)).toThrow('invalid profile')
})

test('parseImport rejects profiles missing web storage maps', () => {
  const noLs = JSON.stringify({
    app: 'session-manager',
    version: 1,
    profiles: [{ id: 'x', siteKey: 'a.com', name: 'A', cookies: [], sessionStorage: {} }],
  })
  const nullSs = JSON.stringify({
    app: 'session-manager',
    version: 1,
    profiles: [
      { id: 'x', siteKey: 'a.com', name: 'A', cookies: [], localStorage: {}, sessionStorage: null },
    ],
  })
  expect(() => parseImport(noLs)).toThrow('invalid profile')
  expect(() => parseImport(nullSs)).toThrow('invalid profile')
})

test('mergeProfiles: imported entry wins on id collision, others appended', () => {
  const a = sample()
  const b = sample()
  const updatedA = { ...a, name: 'Renamed' }
  const merged = mergeProfiles([a], [updatedA, b])
  expect(merged).toHaveLength(2)
  expect(merged.find((p) => p.id === a.id)?.name).toBe('Renamed')
})
