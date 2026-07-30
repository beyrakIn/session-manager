import type { CapturedCookie } from './cookies'
import type { SessionProfile } from './types'

export function autoSaveName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `Auto-saved ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

export function newProfile(init: {
  siteKey: string
  name: string
  color: string
  emoji?: string
  cookies: CapturedCookie[]
  localStorage: Record<string, string>
  sessionStorage: Record<string, string>
}): SessionProfile {
  const now = Date.now()
  return { ...init, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
}

/**
 * How many profiles belong to a site. legacyKey lets callers also count
 * profiles saved before session keys became origin-scoped (keyed by the
 * registrable domain); pass the same value as siteKey to count only exact
 * matches.
 */
export function countProfilesForSite(
  profiles: SessionProfile[],
  siteKey: string,
  legacyKey: string = siteKey
): number {
  return profiles.filter((p) => p.siteKey === siteKey || p.siteKey === legacyKey).length
}

export interface SessionSnapshot {
  cookies: CapturedCookie[]
  localStorage: Record<string, string>
  sessionStorage: Record<string, string>
  /** false when the page-storage read failed — storages are then unreliable */
  storageRead: boolean
}

/**
 * Fold a snapshot into the profile list before a switch: update the active
 * profile, or create an auto-named one if the snapshot holds anything.
 * When storageRead is false the existing profile's storages are preserved —
 * a failed read must never replace saved SPA tokens with {}.
 */
export function applyAutoSave(
  profiles: SessionProfile[],
  siteKey: string,
  activeId: string | null | undefined,
  snap: SessionSnapshot,
  autoSaveColor: string,
  now: Date
): void {
  const found = activeId ? profiles.find((p) => p.id === activeId) : undefined
  // Only update in place when the profile belongs to this exact site. A legacy
  // profile keyed by the registrable domain bundles cookies from every
  // subdomain; overwriting it with one subdomain's narrower snapshot would
  // silently discard the others. Fork a new profile for this site instead.
  const existing = found && found.siteKey === siteKey ? found : undefined
  if (existing) {
    existing.cookies = snap.cookies
    if (snap.storageRead) {
      existing.localStorage = snap.localStorage
      existing.sessionStorage = snap.sessionStorage
    }
    existing.updatedAt = now.getTime()
    return
  }
  const hasContent =
    snap.cookies.length > 0 ||
    Object.keys(snap.localStorage).length > 0 ||
    Object.keys(snap.sessionStorage).length > 0
  if (hasContent) {
    profiles.push(
      newProfile({
        siteKey,
        name: autoSaveName(now),
        color: autoSaveColor,
        cookies: snap.cookies,
        localStorage: snap.localStorage,
        sessionStorage: snap.sessionStorage,
      })
    )
  }
}
