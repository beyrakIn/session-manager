import type { CapturedCookie } from './cookies'

/** Human-readable flags for a captured cookie — only what is actually set. */
export function cookieFlags(c: CapturedCookie): string[] {
  const flags: string[] = []
  if (c.secure) flags.push('Secure')
  if (c.httpOnly) flags.push('HttpOnly')
  if (c.sameSite && c.sameSite !== 'unspecified') flags.push(`SameSite=${c.sameSite}`)
  if (!c.hostOnly) flags.push('Domain cookie')
  return flags
}

/** "Session", "Expired", or the local expiry date. */
export function cookieExpiry(c: CapturedCookie): string {
  if (c.session || c.expirationDate === undefined) return 'Session'
  if (c.expirationDate * 1000 < Date.now()) return 'Expired'
  return new Date(c.expirationDate * 1000).toLocaleDateString()
}

export type Entry = [key: string, value: string]

export function recordToEntries(rec: Record<string, string>): Entry[] {
  return Object.entries(rec)
}

/**
 * Rebuild a storage record from edited rows. Blank keys are dropped; on a
 * duplicate key the last row wins, matching what a real Storage would end up
 * with. Object.fromEntries defines own properties, so a key literally named
 * "__proto__" survives instead of hitting the prototype setter.
 */
export function entriesToRecord(entries: Entry[]): Record<string, string> {
  return Object.fromEntries(entries.filter(([k]) => k.trim() !== ''))
}
