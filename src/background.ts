import { cookieUrl, toSetParams, type CapturedCookie } from './lib/cookies'
import { autoSaveName, newProfile } from './lib/profiles'
import { getActiveMap, getProfiles, saveProfiles, setActive } from './lib/store'
import {
  clearStoragesInPage,
  readStoragesInPage,
  writeStoragesInPage,
} from './lib/webstorage'
import type { BgRequest, BgResponse, SaveNewRequest, SessionProfile, SwitchRequest } from './lib/types'

const AUTO_SAVE_COLOR = '#9ca3af'

// REVIEW-MANDATED: serialize all operations. store.ts uses non-atomic
// get→mutate→set, so two concurrent switches/saves must never interleave.
let queue: Promise<unknown> = Promise.resolve()

chrome.runtime.onMessage.addListener((msg: BgRequest, _sender, sendResponse) => {
  const run = queue.then(() => handle(msg))
  queue = run.catch(() => undefined) // keep the queue alive after failures
  run
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String(e instanceof Error ? e.message : e) }))
  return true // keep the channel open for the async response
})

async function handle(msg: BgRequest): Promise<BgResponse> {
  switch (msg.type) {
    case 'switch':
      return switchProfile(msg)
    case 'saveNew':
      return saveNew(msg)
  }
}

interface Snapshot {
  cookies: CapturedCookie[]
  localStorage: Record<string, string>
  sessionStorage: Record<string, string>
  warnings: string[]
}

async function captureSession(tabId: number, siteKey: string): Promise<Snapshot> {
  const warnings: string[] = []
  const cookies = (await chrome.cookies.getAll({ domain: siteKey })) as CapturedCookie[]
  let localStorage: Record<string, string> = {}
  let sessionStorage: Record<string, string> = {}
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId },
      func: readStoragesInPage,
    })
    if (r?.result) ({ localStorage, sessionStorage } = r.result)
  } catch {
    warnings.push('Could not read page storage — captured cookies only')
  }
  return { cookies, localStorage, sessionStorage, warnings }
}

async function clearCookies(siteKey: string, warnings: string[]): Promise<void> {
  const cookies = await chrome.cookies.getAll({ domain: siteKey })
  for (const c of cookies) {
    try {
      await chrome.cookies.remove({ url: cookieUrl(c), name: c.name, storeId: c.storeId })
    } catch {
      warnings.push(`Could not remove cookie ${c.name}`)
    }
  }
}

async function restoreCookies(profile: SessionProfile, warnings: string[]): Promise<void> {
  const nowSec = Date.now() / 1000
  for (const c of profile.cookies) {
    // REVIEW-MANDATED: a malformed/null cookie entry (hand-edited import) must
    // fail that one cookie with a warning, never crash the whole switch —
    // and the catch must not dereference c.name on a non-object.
    const label = typeof c?.name === 'string' ? c.name : '<malformed entry>'
    try {
      // REVIEW-MANDATED: chrome.cookies.set() with a past expirationDate
      // "succeeds" and drops the cookie silently — surface it as a warning.
      if (!c.session && c.expirationDate !== undefined && c.expirationDate < nowSec) {
        warnings.push(`Cookie ${label} expired since this profile was saved — skipped`)
        continue
      }
      await chrome.cookies.set(toSetParams(c))
    } catch {
      warnings.push(`Could not restore cookie ${label}`)
    }
  }
}

/** Auto-save current state into the active profile, or a new auto-named one. */
function autoSave(
  profiles: SessionProfile[],
  siteKey: string,
  activeId: string | null | undefined,
  snap: Snapshot
): void {
  const existing = activeId ? profiles.find((p) => p.id === activeId) : undefined
  if (existing) {
    existing.cookies = snap.cookies
    existing.localStorage = snap.localStorage
    existing.sessionStorage = snap.sessionStorage
    existing.updatedAt = Date.now()
  } else if (snap.cookies.length > 0 || Object.keys(snap.localStorage).length > 0) {
    profiles.push(
      newProfile({
        siteKey,
        name: autoSaveName(new Date()),
        color: AUTO_SAVE_COLOR,
        cookies: snap.cookies,
        localStorage: snap.localStorage,
        sessionStorage: snap.sessionStorage,
      })
    )
  }
}

async function switchProfile({ tabId, siteKey, targetProfileId }: SwitchRequest): Promise<BgResponse> {
  const profiles = await getProfiles()
  const target = targetProfileId ? profiles.find((p) => p.id === targetProfileId) : undefined
  if (targetProfileId && !target) return { ok: false, error: 'Profile not found' }

  // 1. snapshot + 2. auto-save
  const snap = await captureSession(tabId, siteKey)
  const warnings = [...snap.warnings]
  const active = await getActiveMap()
  autoSave(profiles, siteKey, active[siteKey], snap)

  // 3. wipe
  await clearCookies(siteKey, warnings)
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: clearStoragesInPage })
  } catch {
    warnings.push('Could not clear page storage')
  }

  // 4. restore
  if (target) {
    await restoreCookies(target, warnings)
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: writeStoragesInPage,
        args: [target.localStorage, target.sessionStorage],
      })
    } catch {
      warnings.push('Could not restore page storage')
    }
  }

  // 5. bookkeeping + reload
  await saveProfiles(profiles)
  await setActive(siteKey, target?.id ?? null)
  await chrome.tabs.reload(tabId)
  return { ok: true, warnings }
}

async function saveNew({ tabId, siteKey, name, color, emoji }: SaveNewRequest): Promise<BgResponse> {
  const snap = await captureSession(tabId, siteKey)
  const profiles = await getProfiles()
  const p = newProfile({
    siteKey,
    name,
    color,
    emoji,
    cookies: snap.cookies,
    localStorage: snap.localStorage,
    sessionStorage: snap.sessionStorage,
  })
  profiles.push(p)
  await saveProfiles(profiles)
  await setActive(siteKey, p.id)
  return { ok: true, warnings: snap.warnings }
}
