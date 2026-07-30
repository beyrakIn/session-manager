import { formatBytes, groupProfilesBySite, matchesQuery, profileStats } from '../lib/dashboard'
import { hostFromSiteKey } from '../lib/site'
import { getActiveMap, getProfiles } from '../lib/store'
import type { BgResponse, SessionProfile } from '../lib/types'

const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#2563eb', '#8b5cf6', '#6b7280']
const TAB_LOAD_TIMEOUT_MS = 20_000

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const totalsEl = $('totals')
const searchEl = $<HTMLInputElement>('search')
const noticeEl = $('notice')
const groupsEl = $('groups')
const barEl = $('selection-bar')
const countEl = $('selection-count')
const clearBtn = $<HTMLButtonElement>('clear-selection')
const deleteBtn = $<HTMLButtonElement>('delete-selected')

const selected = new Set<string>()
let editingId: string | null = null
let busy = false

void render()

searchEl.addEventListener('input', () => void render())
clearBtn.addEventListener('click', () => {
  selected.clear()
  void render()
})
deleteBtn.addEventListener('click', () => void deleteSelected())

// Reflect edits made elsewhere (the popup, or a second dashboard tab).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes['profiles'] || changes['activeProfile']) && !busy) {
    void render()
  }
})

function setBusy(b: boolean): void {
  busy = b
  document.body.classList.toggle('busy', b)
}

function showNotice(text: string): void {
  noticeEl.hidden = false
  noticeEl.textContent = text
}

async function send(msg: unknown): Promise<BgResponse> {
  try {
    return (await chrome.runtime.sendMessage(msg)) as BgResponse
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function render(): Promise<void> {
  const [profiles, active] = await Promise.all([getProfiles(), getActiveMap()])
  const query = searchEl.value
  const visible = profiles.filter((p) => matchesQuery(p, query))
  const groups = groupProfilesBySite(visible)

  await renderTotals(profiles)
  groupsEl.replaceChildren()

  if (groups.length === 0) {
    groupsEl.appendChild(
      emptyState(
        profiles.length === 0 ? 'No saved sessions yet' : 'Nothing matches your search',
        profiles.length === 0
          ? 'Open a site you are logged into, click the Session Manager icon, and save the session as a profile.'
          : 'Try a different site name or profile name.'
      )
    )
  }

  for (const g of groups) {
    groupsEl.appendChild(renderSite(g.siteKey, g.profiles, g.totalBytes, active[g.siteKey] ?? null))
  }

  renderSelectionBar()
}

async function renderTotals(profiles: SessionProfile[]): Promise<void> {
  const sites = new Set(profiles.map((p) => p.siteKey)).size
  let bytes = profiles.reduce((sum, p) => sum + profileStats(p).bytes, 0)
  try {
    bytes = await chrome.storage.local.getBytesInUse(null)
  } catch {
    /* keep the estimate */
  }
  totalsEl.textContent = `${profiles.length} profile(s) across ${sites} site(s) · ${formatBytes(bytes)} stored`
}

function emptyState(title: string, body: string): HTMLElement {
  const d = document.createElement('div')
  d.className = 'empty'
  const strong = document.createElement('strong')
  strong.textContent = title
  d.append(strong, document.createTextNode(body))
  return d
}

function renderSite(
  siteKey: string,
  profiles: SessionProfile[],
  totalBytes: number,
  activeId: string | null
): HTMLElement {
  const section = document.createElement('section')
  section.className = 'site'

  const head = document.createElement('div')
  head.className = 'site-head'

  const all = document.createElement('input')
  all.type = 'checkbox'
  all.title = 'Select every profile for this site'
  all.checked = profiles.every((p) => selected.has(p.id))
  all.addEventListener('change', () => {
    for (const p of profiles) {
      if (all.checked) selected.add(p.id)
      else selected.delete(p.id)
    }
    void render()
  })

  const name = document.createElement('span')
  name.className = 'site-name'
  name.textContent = siteKey

  const meta = document.createElement('span')
  meta.className = 'site-meta'
  meta.textContent = `${profiles.length} profile(s) · ${formatBytes(totalBytes)}`

  const open = document.createElement('a')
  open.className = 'site-open'
  open.href = `https://${hostFromSiteKey(siteKey)}/`
  open.target = '_blank'
  open.rel = 'noreferrer'
  open.textContent = 'Open site'

  head.append(all, name, meta, open)
  section.appendChild(head)

  for (const p of profiles) {
    section.appendChild(renderProfile(p, siteKey, activeId))
    if (editingId === p.id) section.appendChild(renderEditor(p))
  }
  return section
}

function renderProfile(p: SessionProfile, siteKey: string, activeId: string | null): HTMLElement {
  const row = document.createElement('div')
  row.className = 'profile'

  const check = document.createElement('input')
  check.type = 'checkbox'
  check.checked = selected.has(p.id)
  check.addEventListener('change', () => {
    if (check.checked) selected.add(p.id)
    else selected.delete(p.id)
    renderSelectionBar()
  })

  const dot = document.createElement('span')
  dot.className = 'dot'
  dot.style.background = p.color

  const info = document.createElement('div')
  info.className = 'pinfo'

  const nameLine = document.createElement('div')
  nameLine.className = 'pname'
  nameLine.textContent = `${p.emoji ? p.emoji + ' ' : ''}${p.name}`
  if (p.id === activeId) {
    const badge = document.createElement('span')
    badge.className = 'badge-active'
    badge.textContent = 'active here'
    nameLine.appendChild(badge)
  }

  const s = profileStats(p)
  const stats = document.createElement('div')
  stats.className = 'pstats'
  stats.textContent = `${s.cookies} cookies · ${s.storageKeys} storage keys · ${formatBytes(
    s.bytes
  )} · updated ${new Date(p.updatedAt).toLocaleDateString()}`

  info.append(nameLine, stats)

  const switchBtn = document.createElement('button')
  switchBtn.className = 'primary'
  switchBtn.textContent = 'Switch'
  switchBtn.title = `Open ${siteKey} and switch into this session`
  switchBtn.addEventListener('click', () => void switchInto(p, siteKey))

  const editBtn = document.createElement('button')
  editBtn.textContent = editingId === p.id ? 'Close' : 'Edit'
  editBtn.addEventListener('click', () => {
    editingId = editingId === p.id ? null : p.id
    void render()
  })

  row.append(check, dot, info, switchBtn, editBtn)
  return row
}

function renderEditor(p: SessionProfile): HTMLElement {
  const box = document.createElement('div')
  box.className = 'editor'

  const nameInput = document.createElement('input')
  nameInput.type = 'text'
  nameInput.className = 'edit-name'
  nameInput.value = p.name
  nameInput.maxLength = 40
  nameInput.placeholder = 'Profile name'

  let color = p.color
  const swatches = document.createElement('div')
  swatches.className = 'swatches'
  for (const c of COLORS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'swatch' + (c === color ? ' selected' : '')
    b.style.background = c
    b.addEventListener('click', () => {
      color = c
      swatches.querySelectorAll('.swatch').forEach((s) => s.classList.remove('selected'))
      b.classList.add('selected')
    })
    swatches.appendChild(b)
  }

  const emojiInput = document.createElement('input')
  emojiInput.type = 'text'
  emojiInput.className = 'edit-emoji'
  emojiInput.value = p.emoji ?? ''
  emojiInput.maxLength = 4
  emojiInput.placeholder = '🙂'

  const save = document.createElement('button')
  save.className = 'primary'
  save.textContent = 'Save'
  save.addEventListener('click', () => {
    const name = nameInput.value.trim()
    if (!name) {
      showNotice('Profile name cannot be empty.')
      return
    }
    void applyEdit(p.id, name, color, emojiInput.value.trim() || undefined)
  })

  const cancel = document.createElement('button')
  cancel.textContent = 'Cancel'
  cancel.addEventListener('click', () => {
    editingId = null
    void render()
  })

  box.append(nameInput, swatches, emojiInput, save, cancel)
  return box
}

function renderSelectionBar(): void {
  barEl.hidden = selected.size === 0
  countEl.textContent = `${selected.size} selected`
}

async function applyEdit(
  profileId: string,
  name: string,
  color: string,
  emoji: string | undefined
): Promise<void> {
  setBusy(true)
  try {
    const res = await send({ type: 'updateProfile', profileId, name, color, emoji })
    if (!res.ok) {
      showNotice(`Could not save changes: ${res.error}`)
      return
    }
    noticeEl.hidden = true
    editingId = null
  } finally {
    setBusy(false)
  }
  await render()
}

async function deleteSelected(): Promise<void> {
  const ids = [...selected]
  if (ids.length === 0) return
  if (!confirm(`Delete ${ids.length} profile(s)? The saved logins will be lost.`)) return
  setBusy(true)
  try {
    const res = await send({ type: 'deleteProfiles', profileIds: ids })
    if (!res.ok) {
      showNotice(`Delete failed: ${res.error}`)
      return
    }
    noticeEl.hidden = true
    selected.clear()
  } finally {
    setBusy(false)
  }
  await render()
}

/** Open the site in a foreground tab, wait for it to load, then switch. */
async function switchInto(p: SessionProfile, siteKey: string): Promise<void> {
  setBusy(true)
  try {
    const tab = await chrome.tabs.create({
      url: `https://${hostFromSiteKey(siteKey)}/`,
      active: true,
    })
    if (tab.id === undefined) {
      showNotice(`Couldn't open ${siteKey} to switch.`)
      return
    }
    await waitForTabLoad(tab.id)
    const res = await send({ type: 'switch', tabId: tab.id, siteKey, targetProfileId: p.id })
    if (!res.ok) {
      showNotice(`Switch failed: ${res.error}`)
      return
    }
    noticeEl.hidden = true
    if (res.warnings.length > 0) {
      showNotice(`Switched with ${res.warnings.length} warning(s): ${res.warnings[0]}`)
    }
  } catch (e) {
    showNotice(`Switch failed: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    setBusy(false)
  }
  await render()
}

function waitForTabLoad(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      reject(new Error('the site took too long to load'))
    }, TAB_LOAD_TIMEOUT_MS)

    const listener = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id !== tabId || info.status !== 'complete') return
      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
}
