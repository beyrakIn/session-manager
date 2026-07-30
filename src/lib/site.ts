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
  // getDomain returns null for IPs and single-label hosts like localhost —
  // fall back to the raw hostname so those still work.
  return getDomain(u.hostname) ?? u.hostname
}
