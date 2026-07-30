import { getDomain } from 'tldts'

/**
 * Derive the "site key" a session belongs to: the tab's origin authority —
 * hostname, plus the port when it isn't the scheme's default.
 *
 * Sessions are scoped per subdomain and per port (jira.company.com and
 * wiki.company.com are separate; localhost:3000 and localhost:8080 are
 * separate). That matches how localStorage/sessionStorage are scoped and
 * keeps unrelated internal apps on one company domain out of each other's
 * profile lists. Cookies are matched separately, against the whole
 * registrable domain — see cookieAppliesToHost in cookies.ts.
 *
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
  // URL already lowercases the host and omits a default port; strip a trailing
  // dot so "localhost." and "localhost" are treated as one site.
  const host = u.hostname.replace(/\.$/, '')
  if (!host) return null
  return u.port ? `${host}:${u.port}` : host
}

/** The hostname part of a site key, without the port (IPv6-literal safe). */
export function hostFromSiteKey(siteKey: string): string {
  const afterBracket = siteKey.lastIndexOf(']')
  const colon = siteKey.indexOf(':', afterBracket + 1)
  return colon === -1 ? siteKey : siteKey.slice(0, colon)
}

/**
 * Registrable domain (eTLD+1) of a host — the widest scope a cookie set by
 * that host can claim, and therefore the query scope for finding its cookies.
 * allowPrivateDomains keeps tenant subdomains distinct (alice.github.io vs
 * bob.github.io). Falls back to the host itself for IPs and single-label
 * names like localhost.
 */
export function registrableDomain(host: string): string {
  return getDomain(host, { allowPrivateDomains: true }) ?? host
}
