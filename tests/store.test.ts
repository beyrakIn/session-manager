import { beforeEach, expect, test } from 'vitest'

const mem: Record<string, unknown> = {}
;(globalThis as Record<string, unknown>).chrome = {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: mem[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(mem, items)
      },
    },
  },
}

const { getProfiles, saveProfiles, getActiveMap, setActive } = await import(
  '../src/lib/store'
)
const { newProfile } = await import('../src/lib/profiles')

beforeEach(() => {
  for (const k of Object.keys(mem)) delete mem[k]
})

test('getProfiles returns [] when storage is empty', async () => {
  expect(await getProfiles()).toEqual([])
})

test('saveProfiles / getProfiles round-trip', async () => {
  const p = newProfile({
    siteKey: 'github.com',
    name: 'Work',
    color: '#3b82f6',
    cookies: [],
    localStorage: {},
    sessionStorage: {},
  })
  await saveProfiles([p])
  expect(await getProfiles()).toEqual([p])
})

test('setActive / getActiveMap round-trip, null clears', async () => {
  await setActive('github.com', 'some-id')
  expect(await getActiveMap()).toEqual({ 'github.com': 'some-id' })
  await setActive('github.com', null)
  expect(await getActiveMap()).toEqual({ 'github.com': null })
})
