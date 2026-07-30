import type { SessionProfile } from './types'

const PROFILES_KEY = 'profiles'
const ACTIVE_KEY = 'activeProfile'

export async function getProfiles(): Promise<SessionProfile[]> {
  const r = await chrome.storage.local.get(PROFILES_KEY)
  return (r[PROFILES_KEY] as SessionProfile[] | undefined) ?? []
}

export async function saveProfiles(profiles: SessionProfile[]): Promise<void> {
  await chrome.storage.local.set({ [PROFILES_KEY]: profiles })
}

export async function getActiveMap(): Promise<Record<string, string | null>> {
  const r = await chrome.storage.local.get(ACTIVE_KEY)
  return (r[ACTIVE_KEY] as Record<string, string | null> | undefined) ?? {}
}

export async function setActive(siteKey: string, profileId: string | null): Promise<void> {
  const map = await getActiveMap()
  map[siteKey] = profileId
  await chrome.storage.local.set({ [ACTIVE_KEY]: map })
}
