import type { SessionProfile } from './types'

export interface ProfileStats {
  cookies: number
  storageKeys: number
  /** Approximate stored size — the profile's JSON length. */
  bytes: number
}

export function profileStats(p: SessionProfile): ProfileStats {
  return {
    cookies: p.cookies.length,
    storageKeys:
      Object.keys(p.localStorage).length + Object.keys(p.sessionStorage).length,
    bytes: JSON.stringify(p).length,
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export interface SiteGroup {
  siteKey: string
  profiles: SessionProfile[]
  totalBytes: number
}

/** Group profiles by site: sites A→Z, profiles within a site most-recent first. */
export function groupProfilesBySite(profiles: SessionProfile[]): SiteGroup[] {
  const bySite = new Map<string, SessionProfile[]>()
  for (const p of profiles) {
    const list = bySite.get(p.siteKey)
    if (list) list.push(p)
    else bySite.set(p.siteKey, [p])
  }
  return [...bySite.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([siteKey, list]) => ({
      siteKey,
      profiles: [...list].sort((a, b) => b.updatedAt - a.updatedAt),
      totalBytes: list.reduce((sum, p) => sum + profileStats(p).bytes, 0),
    }))
}

/** Free-text filter over the site key, profile name and emoji. */
export function matchesQuery(p: SessionProfile, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return `${p.siteKey} ${p.name} ${p.emoji ?? ''}`.toLowerCase().includes(q)
}
