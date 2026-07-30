import { getDomain } from 'tldts'

/**
 * Derive the "site key" (registrable domain / eTLD+1) a session belongs to.
 * Returns null for pages we can't manage (chrome://, about:, invalid URLs).
 */
export function siteKeyFromUrl(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  // allowPrivateDomains keeps tenant subdomains distinct (alice.github.io vs
  // bob.github.io) — each is its own cookie boundary per the public suffix list.
  // getDomain returns null for IPs and single-label hosts like localhost —
  // fall back to the (trailing-dot-normalized) hostname so those still work.
  return (
    getDomain(u.hostname, { allowPrivateDomains: true }) ??
    u.hostname.replace(/\.$/, '')
  )
}
