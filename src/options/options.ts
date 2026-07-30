import { formatBytes, matchesQuery, profileStats } from '../lib/dashboard'
import { siteUrlFromKey } from '../lib/site'
import { getActiveMap, getProfiles } from '../lib/store'
import type { BgResponse, SessionProfile } from '../lib/types'

const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#2563eb', '#8b5cf6', '#6b7280']
const TAB_LOAD_TIMEOUT_MS = 20_000
const AUTO_SAVE_PREFIX = 'Auto-saved '

type SortKey = 'name' | 'site' | 'cookies' | 'keys' | 'size' | 'updated'
type Kind = 'all' | 'named' | 'auto'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const navEl = $('site-nav')
const searchEl = $<HTMLInputElement>('search')
const noticeEl = $('notice')
const rowsEl = $<HTMLTableSectionElement>('rows')
const gridEl = $<HTMLTableElement>('grid')
const emptyEl = $('empty')
const checkAllEl = $<HTMLInputElement>('check-all')
const barEl = $('selection-bar')
const countEl = $('selection-count')
const storageUsedEl = $('storage-used')
const storageBarEl = $('storage-bar')

const selected = new Set<string>()
let profiles: SessionProfile[] = []
let active: Record<string, string | null> = {}
let site: string | null = null // null = all sites
let kind: Kind = 'all'
let sortKey: SortKey = 'updated'
let sortDesc = true
let editingId: string | null = null
let busy = false

renderSkeleton()
void load()

/* ------------------------------- data ---------------------------------- */

async function load(): Promise<void> {
  ;[profiles, active] = await Promise.all([getProfiles(), getActiveMap()])
  if (site && !profiles.some((p) => p.siteKey === site)) site = null
  render()
  void renderStorage()
}

async function renderStorage(): Promise<void> {
  const estimate = profiles.reduce((n, p) => n + profileStats(p).bytes, 0)
  let used = estimate
  try {
    used = await chrome.storage.local.getBytesInUse(null)
  } catch {
    /* keep the estimate */
  }
  storageUsedEl.textContent = formatBytes(used)
  // No hard quota with unlimitedStorage; 5 MB is a useful visual reference.
  storageBarEl.style.width = `${Math.min(100, (used / (5 * 1024 * 1024)) * 100)}%`
}

async function send(msg: unknown): Promise<BgResponse> {
  try {
    return (await chrome.runtime.sendMessage(msg)) as BgResponse
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function setBusy(b: boolean): void {
  busy = b
  document.body.classList.toggle('busy', b)
}

function showNotice(text: string): void {
  noticeEl.hidden = false
  noticeEl.textContent = text
}

function clearNotice(): void {
  noticeEl.hidden = true
}

const isAuto = (p: SessionProfile) => p.name.startsWith(AUTO_SAVE_PREFIX)

/* ------------------------------ selectors ------------------------------- */

function visibleProfiles(): SessionProfile[] {
  const q = searchEl.value
  const rows = profiles.filter(
    (p) =>
      (site === null || p.siteKey === site) &&
      (kind === 'all' || (kind === 'auto') === isAuto(p)) &&
      matchesQuery(p, q)
  )
  const dir = sortDesc ? -1 : 1
  return rows.sort((a, b) => dir * compare(a, b))
}

function compare(a: SessionProfile, b: SessionProfile): number {
  switch (sortKey) {
    case 'name':
      return a.name.localeCompare(b.name)
    case 'site':
      return a.siteKey.localeCompare(b.siteKey) || a.name.localeCompare(b.name)
    case 'cookies':
      return profileStats(a).cookies - profileStats(b).cookies
    case 'keys':
      return profileStats(a).storageKeys - profileStats(b).storageKeys
    case 'size':
      return profileStats(a).bytes - profileStats(b).bytes
    case 'updated':
      return a.updatedAt - b.updatedAt
  }
}

function relativeDate(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

/* ------------------------------ rendering ------------------------------- */

function render(): void {
  renderNav()
  renderRows()
  renderSortIndicators()
  renderSelection()
}

function renderNav(): void {
  const bySite = new Map<string, { count: number; bytes: number }>()
  for (const p of profiles) {
    const e = bySite.get(p.siteKey) ?? { count: 0, bytes: 0 }
    e.count++
    e.bytes += profileStats(p).bytes
    bySite.set(p.siteKey, e)
  }
  const widest = Math.max(1, ...[...bySite.values()].map((e) => e.bytes))

  navEl.replaceChildren()
  navEl.appendChild(navItem('All sessions', profiles.length, null, 0))

  if (bySite.size > 0) {
    const label = document.createElement('div')
    label.className = 'nav-section'
    label.textContent = `Sites · ${bySite.size}`
    navEl.appendChild(label)
  }

  for (const [key, e] of [...bySite.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    navEl.appendChild(navItem(key, e.count, key, e.bytes / widest))
  }
}

function navItem(label: string, count: number, key: string | null, share: number): HTMLElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'nav-item'
  b.setAttribute('aria-current', String(site === key))

  const l = document.createElement('span')
  l.className = 'nav-label'
  l.textContent = label
  l.title = label

  const c = document.createElement('span')
  c.className = 'nav-count'
  c.textContent = String(count)

  b.append(l, c)

  if (key !== null) {
    const bar = document.createElement('span')
    bar.className = 'nav-bar'
    const fill = document.createElement('span')
    fill.style.width = `${Math.max(4, share * 100)}%`
    bar.appendChild(fill)
    b.appendChild(bar)
  }

  b.addEventListener('click', () => {
    site = key
    editingId = null
    render()
  })
  return b
}

function renderSkeleton(): void {
  rowsEl.replaceChildren()
  for (let i = 0; i < 6; i++) {
    const tr = document.createElement('tr')
    tr.className = 'skeleton'
    for (let c = 0; c < 8; c++) {
      const td = document.createElement('td')
      const bar = document.createElement('span')
      bar.style.width = c === 1 ? '60%' : c === 2 ? '70%' : '45%'
      if (c === 0 || c === 7) bar.style.visibility = 'hidden'
      td.appendChild(bar)
      tr.appendChild(td)
    }
    rowsEl.appendChild(tr)
  }
}

function renderRows(): void {
  const rows = visibleProfiles()
  rowsEl.replaceChildren()

  const nothing = rows.length === 0
  gridEl.hidden = nothing
  emptyEl.hidden = !nothing
  if (nothing) {
    renderEmpty()
    return
  }

  for (const p of rows) {
    rowsEl.appendChild(profileRow(p))
    if (editingId === p.id) rowsEl.appendChild(editorRow(p))
  }

  const allShown = rows.every((p) => selected.has(p.id))
  checkAllEl.checked = allShown
  checkAllEl.indeterminate = !allShown && rows.some((p) => selected.has(p.id))
}

function renderEmpty(): void {
  const h = document.createElement('h2')
  const p = document.createElement('p')
  if (profiles.length === 0) {
    h.textContent = 'No saved sessions yet'
    p.append(
      'Open a site you are signed in to, click the Session Manager icon in the toolbar, and save the session as a profile. It will appear here.'
    )
  } else if (searchEl.value.trim()) {
    h.textContent = 'No matches'
    p.append('Nothing matches that search. Press ')
    const kbd = document.createElement('kbd')
    kbd.textContent = 'Esc'
    p.append(kbd, ' to clear it.')
  } else {
    h.textContent = 'Nothing in this view'
    p.textContent =
      kind === 'auto'
        ? 'No auto-saved profiles here. Those are created automatically before a switch.'
        : 'No named profiles here yet.'
  }
  emptyEl.replaceChildren(h, p)
}

function profileRow(p: SessionProfile): HTMLTableRowElement {
  const s = profileStats(p)
  const tr = document.createElement('tr')
  tr.tabIndex = 0
  if (selected.has(p.id)) tr.classList.add('selected')

  // selection
  const tdCheck = document.createElement('td')
  const check = document.createElement('input')
  check.type = 'checkbox'
  check.checked = selected.has(p.id)
  check.setAttribute('aria-label', `Select ${p.name}`)
  check.addEventListener('change', () => {
    toggleSelected(p.id, check.checked)
    tr.classList.toggle('selected', check.checked)
    renderSelection()
  })
  tdCheck.appendChild(check)

  // name
  const tdName = document.createElement('td')
  const wrap = document.createElement('div')
  wrap.className = 'cell-name'

  const dot = document.createElement('span')
  dot.className = 'dot'
  dot.style.background = p.color

  const name = document.createElement('span')
  name.className = 'pname'
  name.textContent = `${p.emoji ? p.emoji + ' ' : ''}${p.name}`
  name.title = p.name

  wrap.append(dot, name)
  if (active[p.siteKey] === p.id) {
    const tag = document.createElement('span')
    tag.className = 'tag'
    tag.textContent = 'active'
    wrap.appendChild(tag)
  }
  if (isAuto(p)) {
    const tag = document.createElement('span')
    tag.className = 'tag tag-muted'
    tag.textContent = 'auto'
    wrap.appendChild(tag)
  }
  tdName.appendChild(wrap)

  const tdSite = document.createElement('td')
  tdSite.className = 'site-cell'
  tdSite.textContent = p.siteKey
  tdSite.title = p.siteKey

  const tdCookies = numCell(String(s.cookies))
  const tdKeys = numCell(String(s.storageKeys))
  const tdSize = numCell(formatBytes(s.bytes))
  const tdUpdated = numCell(relativeDate(p.updatedAt))
  tdUpdated.title = new Date(p.updatedAt).toLocaleString()

  // actions
  const tdActions = document.createElement('td')
  const actions = document.createElement('div')
  actions.className = 'row-actions'

  const switchBtn = iconButton('Switch', 'btn btn-primary', switchIcon())
  switchBtn.addEventListener('click', () => void switchInto(p))

  const editBtn = iconButton('Edit', 'btn btn-icon', pencilIcon(), true)
  editBtn.addEventListener('click', () => {
    editingId = editingId === p.id ? null : p.id
    renderRows()
  })

  const delBtn = iconButton('Delete', 'btn btn-icon btn-danger', trashIcon(), true)
  delBtn.addEventListener('click', () => void deleteProfiles([p.id], p.name))

  actions.append(switchBtn, editBtn, delBtn)
  tdActions.appendChild(actions)

  tr.append(tdCheck, tdName, tdSite, tdCookies, tdKeys, tdSize, tdUpdated, tdActions)

  tr.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void switchInto(p)
    } else if (e.key.toLowerCase() === 'e') {
      e.preventDefault()
      editingId = editingId === p.id ? null : p.id
      renderRows()
    } else if (e.key === ' ') {
      e.preventDefault()
      toggleSelected(p.id, !selected.has(p.id))
      renderRows()
      renderSelection()
    }
  })

  return tr
}

function numCell(text: string): HTMLTableCellElement {
  const td = document.createElement('td')
  td.className = 'num'
  td.textContent = text
  return td
}

function iconButton(label: string, cls: string, icon: SVGElement, iconOnly = false): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = cls
  b.title = label
  b.appendChild(icon)
  if (iconOnly) b.setAttribute('aria-label', label)
  else b.append(label)
  return b
}

function svg(paths: string[]): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  el.setAttribute('viewBox', '0 0 20 20')
  el.setAttribute('aria-hidden', 'true')
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    el.appendChild(path)
  }
  return el
}

const switchIcon = () => svg(['M3 7h11M11 4l3 3-3 3', 'M17 13H6M9 16l-3-3 3-3'])
const pencilIcon = () => svg(['M4 16l1-4 8-8 3 3-8 8-4 1z'])
const trashIcon = () => svg(['M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10'])

function editorRow(p: SessionProfile): HTMLTableRowElement {
  const tr = document.createElement('tr')
  tr.className = 'editor-row'
  const td = document.createElement('td')
  td.colSpan = 8

  const box = document.createElement('div')
  box.className = 'editor'

  const nameInput = document.createElement('input')
  nameInput.type = 'text'
  nameInput.className = 'edit-name'
  nameInput.value = p.name
  nameInput.maxLength = 40
  nameInput.setAttribute('aria-label', 'Profile name')

  let color = p.color
  const swatches = document.createElement('div')
  swatches.className = 'swatches'
  for (const c of COLORS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'swatch'
    b.style.background = c
    b.setAttribute('aria-label', `Color ${c}`)
    b.setAttribute('aria-pressed', String(c === color))
    b.addEventListener('click', () => {
      color = c
      swatches
        .querySelectorAll('.swatch')
        .forEach((s) => s.setAttribute('aria-pressed', 'false'))
      b.setAttribute('aria-pressed', 'true')
    })
    swatches.appendChild(b)
  }

  const emojiInput = document.createElement('input')
  emojiInput.type = 'text'
  emojiInput.className = 'edit-emoji'
  emojiInput.value = p.emoji ?? ''
  emojiInput.maxLength = 4
  emojiInput.setAttribute('aria-label', 'Emoji label')

  const save = document.createElement('button')
  save.type = 'button'
  save.className = 'btn btn-primary'
  save.textContent = 'Save'
  const commit = () => {
    const name = nameInput.value.trim()
    if (!name) {
      showNotice('Profile name cannot be empty.')
      nameInput.focus()
      return
    }
    void applyEdit(p.id, name, color, emojiInput.value.trim() || undefined)
  }
  save.addEventListener('click', commit)

  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.className = 'btn'
  cancel.textContent = 'Cancel'
  cancel.addEventListener('click', () => {
    editingId = null
    renderRows()
  })

  for (const input of [nameInput, emojiInput]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit()
      if (e.key === 'Escape') {
        editingId = null
        renderRows()
      }
    })
  }

  box.append(nameInput, swatches, emojiInput, save, cancel)
  td.appendChild(box)
  tr.appendChild(td)
  queueMicrotask(() => nameInput.focus())
  return tr
}

function renderSortIndicators(): void {
  gridEl.querySelectorAll('thead th').forEach((th) => th.removeAttribute('data-dir'))
  const btn = gridEl.querySelector(`thead th button[data-sort="${sortKey}"]`)
  btn?.parentElement?.setAttribute('data-dir', sortDesc ? 'desc' : 'asc')
}

function renderSelection(): void {
  barEl.hidden = selected.size === 0
  countEl.textContent = `${selected.size} selected`
}

function toggleSelected(id: string, on: boolean): void {
  if (on) selected.add(id)
  else selected.delete(id)
}

/* ------------------------------- actions -------------------------------- */

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
    clearNotice()
    editingId = null
  } finally {
    setBusy(false)
  }
  await load()
}

async function deleteProfiles(ids: string[], label?: string): Promise<void> {
  if (ids.length === 0) return
  const what = label ? `"${label}"` : `${ids.length} profile(s)`
  // Selection survives filtering, so some of these may not be on screen —
  // say so rather than silently deleting rows the user can't see.
  const shown = new Set(visibleProfiles().map((p) => p.id))
  const hidden = ids.filter((id) => !shown.has(id)).length
  const caveat = hidden > 0 ? `\n\n${hidden} of them are not shown in the current view.` : ''
  if (!confirm(`Delete ${what}? The saved login(s) will be lost.${caveat}`)) return
  setBusy(true)
  try {
    const res = await send({ type: 'deleteProfiles', profileIds: ids })
    if (!res.ok) {
      showNotice(`Delete failed: ${res.error}`)
      return
    }
    clearNotice()
    for (const id of ids) selected.delete(id)
  } finally {
    setBusy(false)
  }
  await load()
}

/** Open the site in a foreground tab, wait for it to load, then switch. */
async function switchInto(p: SessionProfile): Promise<void> {
  setBusy(true)
  try {
    const tab = await chrome.tabs.create({ url: siteUrlFromKey(p.siteKey), active: true })
    if (tab.id === undefined) {
      showNotice(`Couldn't open ${p.siteKey} to switch.`)
      return
    }
    await waitForTabLoad(tab.id)
    const res = await send({
      type: 'switch',
      tabId: tab.id,
      siteKey: p.siteKey,
      targetProfileId: p.id,
    })
    if (!res.ok) {
      showNotice(`Switch failed: ${res.error}`)
      return
    }
    if (res.warnings.length > 0) {
      showNotice(`Switched with ${res.warnings.length} warning(s): ${res.warnings[0]}`)
    } else {
      clearNotice()
    }
  } catch (e) {
    showNotice(`Switch failed: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    setBusy(false)
  }
  await load()
}

function waitForTabLoad(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => {
      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      chrome.tabs.onRemoved.removeListener(onRemoved)
      fn()
    }
    const timer = setTimeout(
      () => done(() => reject(new Error('the site took too long to load'))),
      TAB_LOAD_TIMEOUT_MS
    )
    const onUpdated = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id === tabId && info.status === 'complete') done(resolve)
    }
    const onRemoved = (id: number) => {
      if (id === tabId) done(() => reject(new Error('the tab was closed')))
    }
    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.tabs.onRemoved.addListener(onRemoved)
  })
}

/* ------------------------------- events --------------------------------- */

searchEl.addEventListener('input', () => renderRows())
searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    searchEl.value = ''
    renderRows()
  }
})

document.addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLInputElement
  if (!typing && (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key === 'k'))) {
    e.preventDefault()
    searchEl.focus()
    searchEl.select()
  }
})

for (const b of document.querySelectorAll<HTMLButtonElement>('.segmented button')) {
  b.addEventListener('click', () => {
    kind = (b.dataset['kind'] as Kind) ?? 'all'
    document.querySelectorAll('.segmented button').forEach((x) => x.classList.remove('on'))
    b.classList.add('on')
    renderRows()
  })
}

for (const b of gridEl.querySelectorAll<HTMLButtonElement>('thead th button')) {
  b.addEventListener('click', () => {
    const key = b.dataset['sort'] as SortKey
    if (key === sortKey) sortDesc = !sortDesc
    else {
      sortKey = key
      sortDesc = key === 'updated' || key === 'size' || key === 'cookies' || key === 'keys'
    }
    renderRows()
    renderSortIndicators()
  })
}

checkAllEl.addEventListener('change', () => {
  for (const p of visibleProfiles()) toggleSelected(p.id, checkAllEl.checked)
  renderRows()
  renderSelection()
})

$('clear-selection').addEventListener('click', () => {
  selected.clear()
  renderRows()
  renderSelection()
})

$('delete-selected').addEventListener('click', () => void deleteProfiles([...selected]))

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes['profiles'] || changes['activeProfile']) && !busy) {
    void load()
  }
})
