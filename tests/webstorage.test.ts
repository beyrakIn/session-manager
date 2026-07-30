// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest'
import {
  clearStoragesInPage,
  readStoragesInPage,
  writeStoragesInPage,
} from '../src/lib/webstorage'

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})

test('read captures both storages', () => {
  window.localStorage.setItem('token', 'jwt-abc')
  window.sessionStorage.setItem('tmp', '1')
  expect(readStoragesInPage()).toEqual({
    localStorage: { token: 'jwt-abc' },
    sessionStorage: { tmp: '1' },
  })
})

test('write replaces existing contents', () => {
  window.localStorage.setItem('stale', 'x')
  writeStoragesInPage({ fresh: 'y' }, { s: 'z' })
  expect(window.localStorage.getItem('stale')).toBeNull()
  expect(window.localStorage.getItem('fresh')).toBe('y')
  expect(window.sessionStorage.getItem('s')).toBe('z')
})

test('clear empties both storages', () => {
  window.localStorage.setItem('a', '1')
  window.sessionStorage.setItem('b', '2')
  clearStoragesInPage()
  expect(window.localStorage.length).toBe(0)
  expect(window.sessionStorage.length).toBe(0)
})
