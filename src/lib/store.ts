import { decryptJson, encryptJson } from './crypto'
import { LockedError, getSessionKey, getVault, setVault } from './lock'
import type { SessionProfile } from './types'

const PROFILES_KEY = 'profiles'
const ACTIVE_KEY = 'activeProfile'

/**
 * Profiles live either as plaintext under `profiles` (protection off) or
 * inside the encrypted `vault` (protection on). Callers don't care which —
 * but every read and write throws LockedError while the vault is locked.
 */
export async function getProfiles(): Promise<SessionProfile[]> {
  const vault = await getVault()
  if (vault) {
    const key = await getSessionKey()
    if (!key) throw new LockedError()
    return decryptJson<SessionProfile[]>(key, vault.blob)
  }
  const r = await chrome.storage.local.get(PROFILES_KEY)
  return (r[PROFILES_KEY] as SessionProfile[] | undefined) ?? []
}

export async function saveProfiles(profiles: SessionProfile[]): Promise<void> {
  const vault = await getVault()
  if (vault) {
    const key = await getSessionKey()
    if (!key) throw new LockedError()
    await setVault({ ...vault, blob: await encryptJson(key, profiles) })
    return
  }
  await chrome.storage.local.set({ [PROFILES_KEY]: profiles })
}

/** Drops the plaintext copy — used when protection is switched on. */
export async function removePlaintextProfiles(): Promise<void> {
  await chrome.storage.local.remove(PROFILES_KEY)
}

/** Writes the plaintext copy — used when protection is switched off. */
export async function writePlaintextProfiles(profiles: SessionProfile[]): Promise<void> {
  await chrome.storage.local.set({ [PROFILES_KEY]: profiles })
}

export async function hasPlaintextProfiles(): Promise<boolean> {
  const r = await chrome.storage.local.get(PROFILES_KEY)
  return r[PROFILES_KEY] !== undefined
}

// The active-profile map holds no credentials (site key → profile id), so it
// stays readable while locked; the toolbar badge and popup need it to explain
// what is locked rather than showing an empty extension.
export async function getActiveMap(): Promise<Record<string, string | null>> {
  const r = await chrome.storage.local.get(ACTIVE_KEY)
  return (r[ACTIVE_KEY] as Record<string, string | null> | undefined) ?? {}
}

// NOTE: get→mutate→set below is not atomic. v1 assumes a single popup driving
// one operation at a time (the service worker serializes its message handling);
// revisit if any other writer (alarms, sync) is ever added.
export async function setActive(siteKey: string, profileId: string | null): Promise<void> {
  const map = await getActiveMap()
  map[siteKey] = profileId
  await chrome.storage.local.set({ [ACTIVE_KEY]: map })
}
