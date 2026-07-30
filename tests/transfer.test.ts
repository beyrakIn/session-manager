import { expect, test } from 'vitest'
import {
  mergeProfiles,
  parseEncryptedExport,
  parseImport,
  serializeEncryptedExport,
  serializeExport,
} from '../src/lib/transfer'
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

test('parseImport rejects profiles missing color or timestamps', () => {
  const noColor = JSON.stringify({ app: 'session-manager', version: 1, profiles: [{ id: 'x', siteKey: 'a.com', name: 'A', cookies: [], localStorage: {}, sessionStorage: {}, createdAt: 1, updatedAt: 1 }] })
  expect(() => parseImport(noColor)).toThrow('invalid profile')
})

test('encrypted export envelope round-trips', () => {
  const json = serializeEncryptedExport('c2FsdA==', 600000, { iv: 'aXY=', ct: 'Y3Q=' })
  const parsed = parseEncryptedExport(json)
  expect(parsed?.salt).toBe('c2FsdA==')
  expect(parsed?.iterations).toBe(600000)
  expect(parsed?.blob).toEqual({ iv: 'aXY=', ct: 'Y3Q=' })
})

test('parseEncryptedExport returns null for plain exports and junk', () => {
  expect(parseEncryptedExport(serializeExport([]))).toBeNull()
  expect(parseEncryptedExport('{oops')).toBeNull()
  expect(parseEncryptedExport('{"app":"session-manager","version":2}')).toBeNull()
})

test('parseEncryptedExport rejects an out-of-band iteration count', () => {
  const withIters = (n: unknown) =>
    JSON.stringify({
      app: 'session-manager',
      version: 2,
      encrypted: true,
      salt: 'c2FsdA==',
      iterations: n,
      blob: { iv: 'aXY=', ct: 'Y3Q=' },
    })
  // an attacker-supplied count would otherwise pin a core inside deriveKey
  expect(parseEncryptedExport(withIters(1e12))).toBeNull()
  expect(parseEncryptedExport(withIters(0))).toBeNull()
  expect(parseEncryptedExport(withIters(-1))).toBeNull()
  expect(parseEncryptedExport(withIters(1.5))).toBeNull()
  expect(parseEncryptedExport(withIters('600000'))).toBeNull()
  expect(parseEncryptedExport(withIters(600000))).not.toBeNull()
})

test('mergeProfiles: imported entry wins on id collision, others appended', () => {
  const a = sample()
  const b = sample()
  const updatedA = { ...a, name: 'Renamed' }
  const merged = mergeProfiles([a], [updatedA, b])
  expect(merged).toHaveLength(2)
  expect(merged.find((p) => p.id === a.id)?.name).toBe('Renamed')
})
