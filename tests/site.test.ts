import { expect, test } from 'vitest'
import {
  hostFromSiteKey,
  registrableDomain,
  siteKeyFromUrl,
  siteUrlFromKey,
} from '../src/lib/site'

test('siteUrlFromKey keeps the port and picks a workable scheme', () => {
  expect(siteUrlFromKey('jira.company.com')).toBe('https://jira.company.com/')
  expect(siteUrlFromKey('app.example.com:8443')).toBe('https://app.example.com:8443/')
  // hosts with no registrable domain are plain http in practice
  expect(siteUrlFromKey('localhost:3000')).toBe('http://localhost:3000/')
  expect(siteUrlFromKey('192.168.1.5:9000')).toBe('http://192.168.1.5:9000/')
})

test('siteKeyFromUrl and siteUrlFromKey round-trip', () => {
  for (const url of ['https://jira.company.com/x', 'http://localhost:3000/app']) {
    const key = siteKeyFromUrl(url)!
    expect(siteKeyFromUrl(siteUrlFromKey(key))).toBe(key)
  }
})

test('each subdomain is its own site key', () => {
  expect(siteKeyFromUrl('https://jira.company.com/browse/X')).toBe('jira.company.com')
  expect(siteKeyFromUrl('https://wiki.company.com/')).toBe('wiki.company.com')
  expect(siteKeyFromUrl('https://company.com/')).toBe('company.com')
  expect(siteKeyFromUrl('https://mail.google.com/mail/u/0')).toBe('mail.google.com')
})

test('port is part of the site key when present', () => {
  expect(siteKeyFromUrl('http://localhost:3000/app')).toBe('localhost:3000')
  expect(siteKeyFromUrl('http://localhost:8080/app')).toBe('localhost:8080')
  expect(siteKeyFromUrl('http://localhost/app')).toBe('localhost')
  expect(siteKeyFromUrl('https://app.example.com:8443/x')).toBe('app.example.com:8443')
})

test('default ports are not part of the site key', () => {
  expect(siteKeyFromUrl('https://example.com:443/x')).toBe('example.com')
  expect(siteKeyFromUrl('http://example.com:80/x')).toBe('example.com')
})

test('host is lowercased and trailing dot stripped', () => {
  expect(siteKeyFromUrl('https://JIRA.Company.COM/x')).toBe('jira.company.com')
  expect(siteKeyFromUrl('http://localhost./x')).toBe('localhost')
})

test('IP hosts work, including IPv6 literals', () => {
  expect(siteKeyFromUrl('http://192.168.1.5/admin')).toBe('192.168.1.5')
  expect(siteKeyFromUrl('http://192.168.1.5:9000/admin')).toBe('192.168.1.5:9000')
  expect(siteKeyFromUrl('http://[::1]:3000/x')).toBe('[::1]:3000')
})

test('returns null for non-http(s) and invalid URLs', () => {
  expect(siteKeyFromUrl('chrome://extensions')).toBeNull()
  expect(siteKeyFromUrl('about:blank')).toBeNull()
  expect(siteKeyFromUrl('not a url')).toBeNull()
})

test('hostFromSiteKey drops the port, including for IPv6', () => {
  expect(hostFromSiteKey('jira.company.com')).toBe('jira.company.com')
  expect(hostFromSiteKey('localhost:3000')).toBe('localhost')
  expect(hostFromSiteKey('[::1]:3000')).toBe('[::1]')
  expect(hostFromSiteKey('[::1]')).toBe('[::1]')
})

test('registrableDomain returns the widest scope a host cookie can use', () => {
  expect(registrableDomain('jira.company.com')).toBe('company.com')
  expect(registrableDomain('www.example.co.uk')).toBe('example.co.uk')
  // private-PSL tenants are their own boundary
  expect(registrableDomain('alice.github.io')).toBe('alice.github.io')
  // hosts with no registrable domain fall back to themselves
  expect(registrableDomain('localhost')).toBe('localhost')
  expect(registrableDomain('192.168.1.5')).toBe('192.168.1.5')
})
