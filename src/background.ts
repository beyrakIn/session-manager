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
import { decryptJson, deriveKey, encryptJson, newSalt } from './lib/crypto'
import { iterationsFor, secretError } from './lib/secret'
import {
  LockedError,
  clearSessionKey,
  getLockSettings,
  getSessionKey,
  getVault,
  isLocked,
  isProtected,
  setLockSettings,
  setSessionKey,
  setVault,
} from './lib/lock'
import { hostFromSiteKey, registrableDomain, siteKeyFromUrl } from './lib/site'
import {
  getActiveMap,
  getProfiles,
  hasPlaintextProfiles,
  removePlaintextProfiles,
  saveProfiles,
  setActive,
  writePlaintextProfiles,
} from './lib/store'
import {
  mergeProfiles,
  parseEncryptedExport,
  parseImport,
  serializeEncryptedExport,
  serializeExport,
} from './lib/transfer'
import {
  clearStoragesInPage,
  readStoragesInPage,
  writeStoragesInPage,
} from './lib/webstorage'
import type {
  BgRequest,
  BgResponse,
  DeleteProfileRequest,
  ChangePassphraseRequest,
  DeleteProfilesRequest,
  DisableProtectionRequest,
  EnableProtectionRequest,
  ImportProfilesRequest,
  LockState,
  SetLockTimeoutRequest,
  UnlockRequest,
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
  run.then(
    (res) => {
      // Any successful use of an unlocked vault pushes the idle timer out, so
      // active work never locks under you. Read-only state queries are
      // excluded: a future poller must not be able to hold the lock open.
      if (res.ok && msg.type !== 'lock' && msg.type !== 'lockState') void touchAutoLock()
      sendResponse(res)
    },
    (e) => {
      if (e instanceof LockedError) {
        sendResponse({ ok: false, error: e.message, locked: true })
        return
      }
      sendResponse({ ok: false, error: String(e instanceof Error ? e.message : e) })
    }
  )
  return true // keep the channel open for the async response
})

async function touchAutoLock(): Promise<void> {
  if ((await isProtected()) && !(await isLocked())) await armAutoLock()
}

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
    case 'lockState':
      return { ok: true, warnings: [], lock: await lockState() }
    case 'lock':
      return lockOp()
    case 'unlock':
      return unlockOp(msg)
    case 'enableProtection':
      return enableProtectionOp(msg)
    case 'disableProtection':
      return disableProtectionOp(msg)
    case 'setLockTimeout':
      return setLockTimeoutOp(msg)
    case 'exportAll':
      return exportAllOp()
    case 'changePassphrase':
      return changePassphraseOp(msg)
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

async function importProfilesOp({ json, passphrase }: ImportProfilesRequest): Promise<BgResponse> {
  const sealed = parseEncryptedExport(json)
  let imported: SessionProfile[]
  if (sealed) {
    if (!passphrase) {
      return { ok: false, error: 'This backup is encrypted — enter the password it was made with' }
    }
    const key = await deriveKey(passphrase, sealed.salt, sealed.iterations)
    try {
      imported = await decryptJson<SessionProfile[]>(key, sealed.blob)
    } catch {
      return { ok: false, error: 'Wrong password for this backup' }
    }
  } else {
    imported = parseImport(json) // throws → listener error path replies {ok:false}
  }
  const merged = mergeProfiles(await getProfiles(), imported)
  await saveProfiles(merged)
  return { ok: true, warnings: [], imported: imported.length }
}

/** Export goes through the worker so the vault key never leaves it. */
async function exportAllOp(): Promise<BgResponse> {
  const profiles = await getProfiles() // throws LockedError while locked
  const vault = await getVault()
  if (!vault) return { ok: true, warnings: [], json: serializeExport(profiles) }

  const key = await getSessionKey()
  if (!key) throw new LockedError()
  const blob = await encryptJson(key, profiles)
  return {
    ok: true,
    warnings: [],
    json: serializeEncryptedExport(vault.salt, vault.iterations, blob),
  }
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

// ---- Lock, passphrase protection, auto-lock --------------------------------

const LOCK_ALARM = 'auto-lock'

/**
 * A vault and a readable `profiles` key must never coexist: that state means
 * an earlier enable committed the vault but died before deleting the
 * plaintext, leaving every session readable on disk while the UI claims they
 * are encrypted. Idempotent, so it is safe to run at every worker start.
 */
async function reconcileVault(): Promise<void> {
  if ((await isProtected()) && (await hasPlaintextProfiles())) {
    await removePlaintextProfiles()
  }
}

void reconcileVault()
chrome.runtime.onStartup.addListener(() => void reconcileVault())
chrome.runtime.onInstalled.addListener(() => void reconcileVault())

async function lockState(): Promise<LockState> {
  const { timeoutMinutes } = await getLockSettings()
  const vault = await getVault()
  return {
    protected: vault !== null,
    locked: await isLocked(),
    timeoutMinutes,
    kind: vault?.kind ?? 'password',
  }
}

/** Restart the idle countdown. Any successful unlocked operation extends it. */
async function armAutoLock(): Promise<void> {
  const { timeoutMinutes } = await getLockSettings()
  await chrome.alarms.create(LOCK_ALARM, { delayInMinutes: timeoutMinutes })
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LOCK_ALARM) void clearSessionKey()
})

async function lockOp(): Promise<BgResponse> {
  await clearSessionKey()
  await chrome.alarms.clear(LOCK_ALARM)
  return { ok: true, warnings: [], lock: await lockState() }
}

async function unlockOp({ passphrase }: UnlockRequest): Promise<BgResponse> {
  const vault = await getVault()
  if (!vault) return { ok: false, error: 'Protection is not enabled' }
  const key = await deriveKey(passphrase, vault.salt, vault.iterations)
  try {
    // Decrypting is the passphrase check: AES-GCM authenticates, so a wrong
    // key throws here rather than yielding garbage.
    await decryptJson(key, vault.blob)
  } catch {
    return { ok: false, error: 'Wrong password' }
  }
  await setSessionKey(key)
  await armAutoLock()
  return { ok: true, warnings: [], lock: await lockState() }
}

async function enableProtectionOp({
  passphrase,
  kind,
}: EnableProtectionRequest): Promise<BgResponse> {
  if (await isProtected()) return { ok: false, error: 'Protection is already enabled' }
  const invalid = secretError(kind, passphrase)
  if (invalid) return { ok: false, error: invalid }

  const profiles = await getProfiles() // still plaintext at this point
  const salt = newSalt()
  const iterations = iterationsFor(kind)
  const key = await deriveKey(passphrase, salt, iterations)
  await setVault({
    v: 1,
    salt,
    iterations,
    kind,
    blob: await encryptJson(key, profiles),
  })
  // Only drop the readable copy once the encrypted one is committed — and
  // confirm it actually went, rather than reporting success over a vault that
  // still has a plaintext twin sitting next to it.
  await removePlaintextProfiles()
  if (await hasPlaintextProfiles()) {
    return {
      ok: false,
      error:
        'Encrypted, but the readable copy could not be removed. It is cleaned up automatically — restart the browser if this keeps happening.',
    }
  }
  await setSessionKey(key)
  await armAutoLock()
  return { ok: true, warnings: [], lock: await lockState() }
}

async function changePassphraseOp({
  current,
  next,
  kind,
}: ChangePassphraseRequest): Promise<BgResponse> {
  const vault = await getVault()
  if (!vault) return { ok: false, error: 'Protection is not enabled' }
  const invalid = secretError(kind, next)
  if (invalid) return { ok: false, error: invalid }

  const oldKey = await deriveKey(current, vault.salt, vault.iterations)
  let profiles: SessionProfile[]
  try {
    profiles = await decryptJson<SessionProfile[]>(oldKey, vault.blob)
  } catch {
    return { ok: false, error: 'Wrong current password' }
  }
  // Re-encrypt in place: the plaintext never touches chrome.storage.local.
  const salt = newSalt()
  const iterations = iterationsFor(kind)
  const key = await deriveKey(next, salt, iterations)
  await setVault({
    v: 1,
    salt,
    iterations,
    kind,
    blob: await encryptJson(key, profiles),
  })
  try {
    await setSessionKey(key)
  } catch {
    // The vault is already re-keyed; a stale cached key would make the next
    // read fail with a raw crypto error. Fall back to a clean locked state.
    await clearSessionKey()
    return {
      ok: false,
      error: 'Password changed — unlock again with the new password',
    }
  }
  await armAutoLock()
  return { ok: true, warnings: [], lock: await lockState() }
}

async function disableProtectionOp({ passphrase }: DisableProtectionRequest): Promise<BgResponse> {
  const vault = await getVault()
  if (!vault) return { ok: false, error: 'Protection is not enabled' }
  const key = await deriveKey(passphrase, vault.salt, vault.iterations)
  let profiles: SessionProfile[]
  try {
    profiles = await decryptJson<SessionProfile[]>(key, vault.blob)
  } catch {
    return { ok: false, error: 'Wrong password' }
  }
  // Write the plaintext copy before removing the vault, so a failure here
  // can't leave the profiles in neither place.
  await writePlaintextProfiles(profiles)
  await setVault(null)
  await clearSessionKey()
  await chrome.alarms.clear(LOCK_ALARM)
  return { ok: true, warnings: [], lock: await lockState() }
}

async function setLockTimeoutOp({ minutes }: SetLockTimeoutRequest): Promise<BgResponse> {
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 24 * 60) {
    return { ok: false, error: 'Auto-lock must be between 1 minute and 24 hours' }
  }
  await setLockSettings({ timeoutMinutes: Math.round(minutes) })
  if (!(await isLocked()) && (await isProtected())) await armAutoLock()
  return { ok: true, warnings: [], lock: await lockState() }
}

// ---- Toolbar badge: profile count for the site in the focused tab ----------

void chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' })
void chrome.action.setBadgeTextColor({ color: '#ffffff' })

async function updateBadge(tabId: number, url: string | undefined): Promise<void> {
  // A count is still information about the vault — show a lock instead.
  if (await isLocked()) {
    try {
      await chrome.action.setBadgeText({ tabId, text: '🔒' })
    } catch {
      /* tab closed */
    }
    return
  }
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
  // With protection on, saves land in `vault`, not `profiles` — watch both or
  // the badge goes stale for every protected user.
  if (area !== 'local' || !(changes['profiles'] || changes['vault'])) return
  chrome.tabs
    .query({ active: true })
    .then((tabs) => {
      for (const t of tabs) if (t.id !== undefined) void updateBadge(t.id, t.url)
    })
    .catch(() => undefined)
})
