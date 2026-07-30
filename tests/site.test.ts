import { expect, test } from 'vitest'
import { siteKeyFromUrl } from '../src/lib/site'

test('maps subdomains to the registrable domain', () => {
  expect(siteKeyFromUrl('https://mail.google.com/mail/u/0')).toBe('google.com')
  expect(siteKeyFromUrl('https://github.com/settings')).toBe('github.com')
})

test('handles multi-part public suffixes correctly', () => {
  expect(siteKeyFromUrl('https://www.example.co.uk/')).toBe('example.co.uk')
})

test('falls back to hostname for localhost and IPs', () => {
  expect(siteKeyFromUrl('http://localhost:3000/app')).toBe('localhost')
  expect(siteKeyFromUrl('http://192.168.1.5/admin')).toBe('192.168.1.5')
})

test('returns null for non-http(s) and invalid URLs', () => {
  expect(siteKeyFromUrl('chrome://extensions')).toBeNull()
  expect(siteKeyFromUrl('about:blank')).toBeNull()
  expect(siteKeyFromUrl('not a url')).toBeNull()
})

test('private-PSL suffixes keep tenant subdomains distinct', () => {
  expect(siteKeyFromUrl('https://alice.github.io/repo')).toBe('alice.github.io')
  expect(siteKeyFromUrl('https://bob.github.io/')).toBe('bob.github.io')
  expect(siteKeyFromUrl('https://shop.myshopify.com/admin')).toBe('shop.myshopify.com')
})

test('fallback hostname is normalized (trailing dot stripped)', () => {
  expect(siteKeyFromUrl('http://localhost./x')).toBe('localhost')
})
