import { siteKeyFromUrl } from '../lib/site'
import { getActiveMap, getProfiles } from '../lib/store'
import { serializeExport } from '../lib/transfer'
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

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const key = tab?.id !== undefined && tab.url ? siteKeyFromUrl(tab.url) : null
  if (!key || tab?.id === undefined) {
    showNotice("Can't manage sessions on this page.")
    formEl.hidden = true
    freshBtn.disabled = true
    siteEl.textContent = '—'
    wireTransferEvents() // export/import still work anywhere
    return
  }
  tabId = tab.id
  siteKey = key
  siteEl.textContent = siteKey
  renderColorSwatches()
  await renderList()
  wireSessionEvents()
  wireTransferEvents()
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
  const [profiles, active] = await Promise.all([getProfiles(), getActiveMap()])
  const activeId = active[siteKey] ?? null
  const mine = profiles
    .filter((p) => p.siteKey === siteKey)
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

    const del = document.createElement('button')
    del.className = 'del'
    del.textContent = '✕'
    del.title = 'Delete profile'
    del.addEventListener('click', (e) => {
      e.stopPropagation()
      void deleteProfile(p)
    })

    li.append(dot, name, del)
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

function wireTransferEvents(): void {
  exportBtn.addEventListener('click', () => {
    void (async () => {
      const blob = new Blob([serializeExport(await getProfiles())], {
        type: 'application/json',
      })
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
        const res = await send({ type: 'importProfiles', json })
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
