import { cookieUrl, toSetParams, type CapturedCookie } from './lib/cookies'
import { applyAutoSave, newProfile, type SessionSnapshot } from './lib/profiles'
import { getActiveMap, getProfiles, saveProfiles, setActive } from './lib/store'
import { mergeProfiles, parseImport } from './lib/transfer'
import {
  clearStoragesInPage,
  readStoragesInPage,
  writeStoragesInPage,
} from './lib/webstorage'
import type {
  BgRequest,
  BgResponse,
  DeleteProfileRequest,
  ImportProfilesRequest,
  SaveNewRequest,
  SessionProfile,
  SwitchRequest,
} from './lib/types'

const AUTO_SAVE_COLOR = '#9ca3af'

// REVIEW-MANDATED: serialize all operations. store.ts uses non-atomic
// get→mutate→set, so two concurrent switches/saves must never interleave.
let queue: Promise<unknown> = Promise.resolve()

chrome.runtime.onMessage.addListener((msg: BgRequest, _sender, sendResponse) => {
  const run = queue.then(() => handle(msg))
  queue = run.catch(() => undefined) // keep the queue alive after failures
  run.then(sendResponse, (e) =>
    sendResponse({ ok: false, error: String(e instanceof Error ? e.message : e) })
  )
  return true // keep the channel open for the async response
})

async function handle(msg: BgRequest): Promise<BgResponse> {
  switch (msg.type) {
    case 'switch':
      return switchProfile(msg)
    case 'saveNew':
      return saveNew(msg)
    case 'deleteProfile':
      return deleteProfileOp(msg)
    case 'importProfiles':
      return importProfilesOp(msg)
    default:
      return { ok: false, error: 'Unknown message type' }
  }
}

interface Snapshot extends SessionSnapshot {
  warnings: string[]
}

async function captureSession(tabId: number, siteKey: string): Promise<Snapshot> {
  const warnings: string[] = []
  const cookies = (await chrome.cookies.getAll({ domain: siteKey })) as CapturedCookie[]
  let localStorage: Record<string, string> = {}
  let sessionStorage: Record<string, string> = {}
  let storageRead = false
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId },
      func: readStoragesInPage,
    })
    if (r?.result) {
      ;({ localStorage, sessionStorage } = r.result)
      storageRead = true
    }
  } catch {
    /* fall through — storageRead stays false */
  }
  if (!storageRead) warnings.push('Could not read page storage — captured cookies only')
  return { cookies, localStorage, sessionStorage, storageRead, warnings }
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

async function switchProfile({ tabId, siteKey, targetProfileId }: SwitchRequest): Promise<BgResponse> {
  // REVIEW-MANDATED: chrome.cookies.getAll({domain: ''}) matches every cookie
  // in the browser, so a falsy siteKey would make clearCookies wipe all sites.
  if (!siteKey) return { ok: false, error: 'Invalid site' }

  const profiles = await getProfiles()
  const target = targetProfileId ? profiles.find((p) => p.id === targetProfileId) : undefined
  if (targetProfileId && !target) return { ok: false, error: 'Profile not found' }

  // 1. snapshot
  const snap = await captureSession(tabId, siteKey)

  // REVIEW-MANDATED: if the page's storage can't be read (e.g. the Chrome Web
  // Store or a PDF viewer tab — both https pages that resolve to a real
  // siteKey, e.g. chromewebstore.google.com → google.com), abort before any
  // mutation. Continuing would wipe google.com's cookies on a page we can
  // never restore into — exactly the half-switch this guard forbids.
  if (!snap.storageRead) {
    return {
      ok: false,
      error: "Can't access this page's storage — switch aborted. Focus/reload the site tab and try again.",
    }
  }

  // 2. auto-save (persisted immediately so a mid-wipe failure can't lose the outgoing session)
  const warnings = [...snap.warnings]
  const active = await getActiveMap()
  applyAutoSave(profiles, siteKey, active[siteKey], snap, AUTO_SAVE_COLOR, new Date())
  await saveProfiles(profiles)

  // 3. wipe
  await clearCookies(siteKey, warnings)
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: clearStoragesInPage })
  } catch {
    warnings.push('Could not clear page storage')
  }

  // REVIEW-MANDATED: if the worker dies during restore, the site reads as
  // "no active profile" so a retry can't overwrite the outgoing profile's
  // just-saved snapshot with a broken half-restored state.
  await setActive(siteKey, null)

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
  await setActive(siteKey, target?.id ?? null)
  try {
    await chrome.tabs.reload(tabId)
  } catch {
    // REVIEW-MANDATED: a tab closed mid-switch must not turn a completed
    // switch into a reported failure — the switch itself already succeeded.
    warnings.push('Could not reload the tab — reload it manually')
  }
  return { ok: true, warnings }
}

async function saveNew({ tabId, siteKey, name, color, emoji }: SaveNewRequest): Promise<BgResponse> {
  if (!siteKey) return { ok: false, error: 'Invalid site' }

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

async function deleteProfileOp({ profileId, siteKey }: DeleteProfileRequest): Promise<BgResponse> {
  const profiles = await getProfiles()
  await saveProfiles(profiles.filter((p) => p.id !== profileId))
  if (siteKey) {
    const active = await getActiveMap()
    if (active[siteKey] === profileId) await setActive(siteKey, null)
  }
  return { ok: true, warnings: [] }
}

async function importProfilesOp({ json }: ImportProfilesRequest): Promise<BgResponse> {
  const imported = parseImport(json) // throws → listener error path replies {ok:false}
  const merged = mergeProfiles(await getProfiles(), imported)
  await saveProfiles(merged)
  return { ok: true, warnings: [], imported: imported.length }
}
