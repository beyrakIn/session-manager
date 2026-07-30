import {
  cookieAppliesToHost,
  cookieUrl,
  toSetParams,
  type CapturedCookie,
} from './lib/cookies'
import {
  applyAutoSave,
  countProfilesForSite,
  newProfile,
  type SessionSnapshot,
} from './lib/profiles'
import { hostFromSiteKey, registrableDomain, siteKeyFromUrl } from './lib/site'
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
  DeleteProfilesRequest,
  ImportProfilesRequest,
  SaveNewRequest,
  SessionProfile,
  SwitchRequest,
  UpdateProfileDataRequest,
  UpdateProfileRequest,
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
    case 'updateProfile':
      return updateProfileOp(msg)
    case 'deleteProfiles':
      return deleteProfilesOp(msg)
    case 'updateProfileData':
      return updateProfileDataOp(msg)
    default:
      return { ok: false, error: 'Unknown message type' }
  }
}

interface Snapshot extends SessionSnapshot {
  warnings: string[]
}

/**
 * Cookies the given site key can actually see: query the whole registrable
 * domain (so parent-domain cookies like .company.com are included), then keep
 * only those whose domain matches this specific host.
 */
async function cookiesForSite(siteKey: string): Promise<CapturedCookie[]> {
  const host = hostFromSiteKey(siteKey)
  const all = (await chrome.cookies.getAll({
    domain: registrableDomain(host),
  })) as CapturedCookie[]
  return all.filter((c) => cookieAppliesToHost(c, host))
}

async function captureSession(tabId: number, siteKey: string): Promise<Snapshot> {
  const warnings: string[] = []
  const cookies = await cookiesForSite(siteKey)
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
  const host = hostFromSiteKey(siteKey)
  const cookies = await cookiesForSite(siteKey)
  let shared = 0
  for (const c of cookies) {
    try {
      await chrome.cookies.remove({ url: cookieUrl(c), name: c.name, storeId: c.storeId })
      // A cookie scoped to a parent domain (.company.com) is shared with every
      // sibling subdomain — the browser gives us no way to clear it for this
      // host only, so say so rather than silently signing the user out there.
      if (!cookieAppliesToHost({ domain: c.domain, hostOnly: true }, host)) shared++
    } catch {
      warnings.push(`Could not remove cookie ${c.name}`)
    }
  }
  if (shared > 0) {
    warnings.push(
      `${shared} cookie(s) are shared with other subdomains of ${registrableDomain(host)} — you may need to sign in again there`
    )
  }
  // Cookies are not port-scoped at all, so a site key carrying a port shares
  // its entire cookie jar with every other port on the same host.
  if (siteKey !== host && cookies.length > 0) {
    warnings.push(
      `Cookies are shared with every port on ${host} — sessions on other ports were cleared too`
    )
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

async function updateProfileOp({
  profileId,
  name,
  color,
  emoji,
}: UpdateProfileRequest): Promise<BgResponse> {
  const profiles = await getProfiles()
  const p = profiles.find((x) => x.id === profileId)
  if (!p) return { ok: false, error: 'Profile not found' }
  p.name = name
  p.color = color
  p.emoji = emoji
  p.updatedAt = Date.now()
  await saveProfiles(profiles)
  return { ok: true, warnings: [] }
}

async function deleteProfilesOp({ profileIds }: DeleteProfilesRequest): Promise<BgResponse> {
  const doomed = new Set(profileIds)
  const profiles = await getProfiles()
  await saveProfiles(profiles.filter((p) => !doomed.has(p.id)))
  // Clear any site still pointing at a profile that no longer exists.
  const active = await getActiveMap()
  for (const [siteKey, id] of Object.entries(active)) {
    if (id && doomed.has(id)) await setActive(siteKey, null)
  }
  return { ok: true, warnings: [] }
}

async function updateProfileDataOp({
  profileId,
  cookies,
  localStorage,
  sessionStorage,
}: UpdateProfileDataRequest): Promise<BgResponse> {
  if (!Array.isArray(cookies)) return { ok: false, error: 'Invalid cookie data' }
  // Hand-edited data reaches chrome.cookies.set on the next switch, where a
  // malformed entry would fail that cookie. Reject the obviously broken ones
  // here so the profile can't be saved into that state at all.
  for (const c of cookies) {
    if (typeof c?.name !== 'string' || typeof c?.value !== 'string') {
      return { ok: false, error: 'Every cookie needs a name and a value' }
    }
    if (typeof c?.domain !== 'string' || c.domain === '') {
      return { ok: false, error: `Cookie ${c.name} has no domain` }
    }
  }
  const profiles = await getProfiles()
  const p = profiles.find((x) => x.id === profileId)
  if (!p) return { ok: false, error: 'Profile not found' }
  p.cookies = cookies
  p.localStorage = localStorage
  p.sessionStorage = sessionStorage
  p.updatedAt = Date.now()
  await saveProfiles(profiles)
  return { ok: true, warnings: [] }
}

// ---- Toolbar badge: profile count for the site in the focused tab ----------

void chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' })
void chrome.action.setBadgeTextColor({ color: '#ffffff' })

async function updateBadge(tabId: number, url: string | undefined): Promise<void> {
  const key = url ? siteKeyFromUrl(url) : null
  // Count legacy (registrable-domain) profiles too, so the badge matches what
  // the popup actually lists.
  const n = key
    ? countProfilesForSite(
        await getProfiles(),
        key,
        registrableDomain(hostFromSiteKey(key))
      )
    : 0
  try {
    await chrome.action.setBadgeText({ tabId, text: n > 0 ? String(n) : '' })
  } catch {
    /* tab closed between the event and this call — nothing to update */
  }
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs
    .get(tabId)
    .then((tab) => updateBadge(tabId, tab.url))
    .catch(() => undefined)
})

// Navigation clears a tab-scoped badge — re-derive it for the new URL.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'loading') void updateBadge(tabId, tab.url)
})

// Save/delete/import/auto-save all land in the 'profiles' storage key —
// refresh the badge on every active tab (one per window) when it changes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes['profiles']) return
  chrome.tabs
    .query({ active: true })
    .then((tabs) => {
      for (const t of tabs) if (t.id !== undefined) void updateBadge(t.id, t.url)
    })
    .catch(() => undefined)
})
