/** Serializable snapshot of a chrome.cookies.Cookie (same fields, plain JSON). */
export interface CapturedCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: `${chrome.cookies.SameSiteStatus}`
  hostOnly: boolean
  session: boolean
  expirationDate?: number
  storeId?: string
}

/**
 * Convert a captured cookie into params accepted by chrome.cookies.set().
 * Handles the get/set asymmetry:
 *  - set() needs a url, which getAll() doesn't return — rebuild it
 *  - host-only cookies must omit `domain`
 *  - __Host- cookies must omit `domain` (they're host-only by definition)
 *  - session cookies must omit `expirationDate`
 */
export function toSetParams(c: CapturedCookie): chrome.cookies.SetDetails {
  const host = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain
  const details: chrome.cookies.SetDetails = {
    url: `${c.secure ? 'https' : 'http'}://${host}${c.path}`,
    name: c.name,
    value: c.value,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
  }
  if (!c.hostOnly && !c.name.startsWith('__Host-')) {
    details.domain = c.domain
  }
  if (!c.session && c.expirationDate !== undefined) {
    details.expirationDate = c.expirationDate
  }
  return details
}

/** Rebuild the url needed by chrome.cookies.remove() for a live cookie. */
export function cookieUrl(c: { domain: string; path: string; secure: boolean }): string {
  const host = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain
  return `${c.secure ? 'https' : 'http'}://${host}${c.path}`
}
