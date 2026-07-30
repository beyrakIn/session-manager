import { hostFromSiteKey, registrableDomain, siteKeyFromUrl } from '../lib/site'
import { getActiveMap, getProfiles } from '../lib/store'
import { parseEncryptedExport, serializeExport } from '../lib/transfer'
import type { BgResponse, SessionProfile } from '../lib/types'

const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#6b7280']

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const siteEl = $('site')
const noticeEl = $('notice')
const listEl = $<HTMLUListElement>('profiles')
const formEl = $<HTMLFormElement>('save-form')
const nameEl = $<HTMLInputElement>('name')
const emojiEl = $<HTMLInputElement>('emoji')
const colorsEl = $('colors')
const freshBtn = $<HTMLButtonElement>('fresh')
const exportBtn = $<HTMLButtonElement>('export')
const importBtn = $<HTMLButtonElement>('import-btn')
const importFile = $<HTMLInputElement>('import-file')
const manageAllBtn = $<HTMLButtonElement>('manage-all')
const unlockForm = $<HTMLFormElement>('unlock-form')
const unlockPass = $<HTMLInputElement>('unlock-pass')

// Available on every page, including ones we can't manage sessions on.
manageAllBtn.addEventListener('click', () => chrome.runtime.openOptionsPage())

let tabId = -1
let siteKey = ''
let selectedColor = COLORS[3]
let busy = false

function setBusy(b: boolean): void {
  busy = b
  document.body.classList.toggle('busy', b)
}

// chrome.runtime.sendMessage's promise form REJECTS when there's no
// receiver (e.g. the extension was reloaded while the popup stayed open) —
// without this, that leaves busy stuck true and the caller unhandled.
async function send(msg: unknown): Promise<BgResponse> {
  try {
    return (await chrome.runtime.sendMessage(msg)) as BgResponse
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

void init()

/**
 * While the vault is locked the popup shows only the unlock form — no site
 * name, no profile list, no export.
 */
async function gateOnLock(): Promise<boolean> {
  const res = await send({ type: 'lockState' })
  if (!res.ok || !res.lock?.locked) return false

  unlockForm.hidden = false
  formEl.hidden = true
  freshBtn.disabled = true
  exportBtn.disabled = true
  importBtn.disabled = true
  listEl.replaceChildren()
  siteEl.textContent = 'Locked'
  unlockPass.focus()

  unlockForm.addEventListener('submit', (e) => {
    e.preventDefault()
    void (async () => {
      const r = await send({ type: 'unlock', passphrase: unlockPass.value })
      if (!r.ok) {
        showNotice(r.error)
        unlockPass.select()
        return
      }
      window.location.reload() // start again, now unlocked
    })()
  })
  return true
}

async function init(): Promise<void> {
  if (await gateOnLock()) return

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const key = tab?.id !== undefined && tab.url ? siteKeyFromUrl(tab.url) : null
  if (!key || tab?.id === undefined) {
    showNotice("Can't manage sessions on this page.")
    formEl.hidden = true
    freshBtn.disabled = true
    siteEl.textContent = '—'
    wireTransferEvents() // export/import still work anywhere
    wirePasteImport()
    return
  }
  tabId = tab.id
  siteKey = key
  siteEl.textContent = siteKey
  renderColorSwatches()
  await renderList()
  wireSessionEvents()
  wireTransferEvents()
  wirePasteImport()
}

function showNotice(text: string): void {
  noticeEl.hidden = false
  noticeEl.textContent = text
}

function renderColorSwatches(): void {
  for (const color of COLORS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'swatch' + (color === selectedColor ? ' selected' : '')
    b.style.background = color
    b.addEventListener('click', () => {
      selectedColor = color
      colorsEl.querySelectorAll('.swatch').forEach((s) => s.classList.remove('selected'))
      b.classList.add('selected')
    })
    colorsEl.appendChild(b)
  }
}

async function renderList(): Promise<void> {
  let profiles, active
  try {
    ;[profiles, active] = await Promise.all([getProfiles(), getActiveMap()])
  } catch {
    // Auto-lock can fire between the unlock check and this read; restart so
    // the gate takes over rather than dying on an uncaught LockedError.
    window.location.reload()
    return
  }
  const activeId = active[siteKey] ?? null
  // Profiles saved before session keys became subdomain-aware are keyed by the
  // registrable domain; keep showing them here so they aren't stranded.
  const legacyKey = registrableDomain(hostFromSiteKey(siteKey))
  const mine = profiles
    .filter((p) => p.siteKey === siteKey || p.siteKey === legacyKey)
    .sort((a, b) => b.updatedAt - a.updatedAt)

  listEl.replaceChildren()
  for (const p of mine) {
    const li = document.createElement('li')
    if (p.id === activeId) li.classList.add('active')

    const dot = document.createElement('span')
    dot.className = 'dot'
    dot.style.background = p.color

    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = `${p.emoji ? p.emoji + ' ' : ''}${p.name}${p.id === activeId ? ' ✓' : ''}`

    const copy = document.createElement('button')
    copy.className = 'del'
    copy.textContent = '⧉'
    copy.title = 'Copy this session to the clipboard'
    copy.setAttribute('aria-label', `Copy ${p.name}`)
    copy.addEventListener('click', (e) => {
      e.stopPropagation()
      void copyProfile(p)
    })

    const del = document.createElement('button')
    del.className = 'del'
    del.textContent = '✕'
    del.title = 'Delete profile'
    del.setAttribute('aria-label', `Delete ${p.name}`)
    del.addEventListener('click', (e) => {
      e.stopPropagation()
      void deleteProfile(p)
    })

    li.append(dot, name, copy, del)
    li.addEventListener('click', () => void doSwitch(p.id))
    listEl.appendChild(li)
  }
}

async function deleteProfile(p: SessionProfile): Promise<void> {
  if (busy) return
  if (!confirm(`Delete profile "${p.name}"? The saved login will be lost.`)) return
  setBusy(true)
  try {
    const res = await send({
      type: 'deleteProfile',
      profileId: p.id,
      siteKey,
    })
    if (!res || !res.ok) {
      showNotice(`Delete failed: ${res ? res.error : 'no response from service worker'}`)
      return
    }
    await renderList()
  } finally {
    setBusy(false)
  }
}

async function doSwitch(targetProfileId: string | null): Promise<void> {
  if (busy) return
  setBusy(true)
  const res = await send({
    type: 'switch',
    tabId,
    siteKey,
    targetProfileId,
  })
  if (!res || !res.ok) {
    setBusy(false)
    showNotice(`Switch failed: ${res ? res.error : 'no response from service worker'}`)
    return
  }
  if (res.warnings.length > 0) {
    setBusy(false)
    showNotice(`Switched with ${res.warnings.length} warning(s): ${res.warnings[0]}`)
    await renderList()
  } else {
    window.close()
  }
}

function wireSessionEvents(): void {
  formEl.addEventListener('submit', (e) => {
    e.preventDefault()
    void (async () => {
      if (busy) return
      const name = nameEl.value.trim()
      if (!name) {
        showNotice('Profile name cannot be empty.')
        return
      }
      setBusy(true)
      const res = await send({
        type: 'saveNew',
        tabId,
        siteKey,
        name,
        color: selectedColor,
        emoji: emojiEl.value.trim() || undefined,
      })
      if (!res || !res.ok) {
        setBusy(false)
        showNotice(`Save failed: ${res ? res.error : 'no response from service worker'}`)
        return
      }
      if (res.warnings.length > 0) {
        showNotice(`Saved with ${res.warnings.length} warning(s): ${res.warnings[0]}`)
      }
      formEl.reset()
      await renderList()
      setBusy(false)
    })()
  })

  freshBtn.addEventListener('click', () => void doSwitch(null))
}

/** Copy one session as the same JSON the file export uses. */
async function copyProfile(p: SessionProfile): Promise<void> {
  if (busy) return
  try {
    await navigator.clipboard.writeText(serializeExport([p]))
    showNotice(`Copied "${p.name}" — paste it with Ctrl+V here or on another machine.`)
  } catch (e) {
    showNotice(`Copy failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Paste-to-import. Reading the clipboard directly would need the
 * clipboardRead permission; capturing the paste event needs none, and Ctrl+V
 * anywhere in the popup is the same single gesture.
 */
function wirePasteImport(): void {
  document.addEventListener('paste', (e) => {
    if (busy) return
    const text = e.clipboardData?.getData('text')
    if (!text || !text.includes('session-manager')) return
    e.preventDefault()
    void (async () => {
      setBusy(true)
      try {
        const res = await send({ type: 'importProfiles', json: text })
        if (!res || !res.ok) {
          showNotice(`Paste failed: ${res ? res.error : 'no response from service worker'}`)
          return
        }
        showNotice(`Pasted ${res.imported ?? 0} session(s) from the clipboard.`)
        if (siteKey) await renderList()
      } finally {
        setBusy(false)
      }
    })()
  })
}

function wireTransferEvents(): void {
  exportBtn.addEventListener('click', () => {
    void (async () => {
      // The worker owns the vault key, so it produces the file — encrypted
      // when protection is on, plain JSON when it isn't.
      const res = await send({ type: 'exportAll' })
      if (!res.ok || !res.json) {
        showNotice(`Export failed: ${res.ok ? 'no data returned' : res.error}`)
        return
      }
      const blob = new Blob([res.json], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `session-manager-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(a.href)
    })()
  })

  importBtn.addEventListener('click', () => importFile.click())

  importFile.addEventListener('change', () => {
    void (async () => {
      if (busy) return
      const file = importFile.files?.[0]
      if (!file) return
      setBusy(true)
      try {
        const json = await file.text()
        // Encrypted backups carry their own salt, so they need the password
        // they were made with — not necessarily the current one.
        const passphrase = parseEncryptedExport(json)
          ? (prompt('This backup is encrypted. Enter its password:') ?? '')
          : undefined
        const res = await send({ type: 'importProfiles', json, passphrase })
        if (!res || !res.ok) {
          showNotice(`Import failed: ${res ? res.error : 'no response from service worker'}`)
          return
        }
        showNotice(`Imported ${res.imported ?? 0} profile(s).`)
        if (siteKey) await renderList()
      } catch (e) {
        showNotice(`Import failed: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        importFile.value = ''
        setBusy(false)
      }
    })()
  })
}
