# Session Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chrome/Edge MV3 extension that saves and switches complete website sessions (cookies + localStorage + sessionStorage), one active session per site, with named/colored profiles, auto-save on switch, and JSON export/import.

**Architecture:** Popup renders state and sends messages; the service worker performs switch/save operations so they survive popup close. All `chrome.*` calls live at the edges; pure data-transform functions (`toSetParams`, site-key derivation, import validation) are unit-tested with Vitest. State lives only in `chrome.storage.local` (MV3 workers are ephemeral).

**Tech Stack:** TypeScript, Vite, CRXJS (`@crxjs/vite-plugin`), `tldts`, Vitest (+jsdom for web-storage tests). Plain DOM popup, no UI framework.

**Spec:** `docs/superpowers/specs/2026-07-30-session-manager-design.md`

---

## File Map

| File | Responsibility |
|---|---|
| `manifest.config.ts` | MV3 manifest (CRXJS `defineManifest`) |
| `vite.config.ts` | Vite + CRXJS wiring |
| `src/lib/types.ts` | Shared interfaces: `SessionProfile`, messages, responses |
| `src/lib/site.ts` | URL → site key (eTLD+1) |
| `src/lib/cookies.ts` | `CapturedCookie`, `toSetParams` (capture→set conversion) |
| `src/lib/profiles.ts` | `newProfile` factory, `autoSaveName` |
| `src/lib/transfer.ts` | Export serialization, import validation, merge |
| `src/lib/store.ts` | Typed `chrome.storage.local` wrapper |
| `src/lib/webstorage.ts` | Page-injected functions to read/clear/write localStorage+sessionStorage |
| `src/background.ts` | Message handler: `switch` and `saveNew` orchestration |
| `src/popup/index.html`, `popup.ts`, `popup.css` | UI |
| `tests/*.test.ts` | Vitest unit tests for the pure modules |
| `docs/manual-testing.md` | Manual E2E checklist |

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `manifest.config.ts`, `.gitignore`, `src/background.ts` (stub), `src/popup/index.html` (stub), `src/popup/popup.ts` (stub)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "session-manager",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install tldts
npm install -D vite @crxjs/vite-plugin@beta typescript vitest jsdom @types/chrome
```
Expected: both commands exit 0; `package.json` gains `dependencies` and `devDependencies`.

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
```

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "types": ["chrome"],
    "skipLibCheck": true
  },
  "include": ["src", "tests", "vite.config.ts", "manifest.config.ts"]
}
```

- [ ] **Step 5: Create `manifest.config.ts`**

```ts
import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'Session Manager',
  version: '0.1.0',
  description: 'Save and switch multiple sessions per website.',
  action: { default_popup: 'src/popup/index.html' },
  background: { service_worker: 'src/background.ts', type: 'module' },
  permissions: ['cookies', 'storage', 'unlimitedStorage', 'scripting', 'tabs'],
  host_permissions: ['<all_urls>'],
})
```

- [ ] **Step 6: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config'

export default defineConfig({
  plugins: [crx({ manifest })],
})
```

- [ ] **Step 7: Create stub entry points**

`src/background.ts`:
```ts
console.log('session-manager service worker loaded')
```

`src/popup/index.html`:
```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Session Manager</title>
  </head>
  <body>
    <p>Session Manager</p>
    <script type="module" src="./popup.ts"></script>
  </body>
</html>
```

`src/popup/popup.ts`:
```ts
console.log('popup loaded')
```

- [ ] **Step 8: Verify build**

Run: `npm run build`
Expected: exits 0; `dist/manifest.json` exists and contains `"manifest_version": 3`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold MV3 extension with Vite + CRXJS + TypeScript"
```

---

### Task 2: Shared Types

**Files:**
- Create: `src/lib/types.ts`

Pure declarations — no test file (nothing executable), verified by `typecheck` once consumers exist.

- [ ] **Step 1: Create `src/lib/types.ts`**

```ts
import type { CapturedCookie } from './cookies'

export interface SessionProfile {
  id: string
  siteKey: string
  name: string
  color: string
  emoji?: string
  cookies: CapturedCookie[]
  localStorage: Record<string, string>
  sessionStorage: Record<string, string>
  createdAt: number
  updatedAt: number
}

export interface SwitchRequest {
  type: 'switch'
  tabId: number
  siteKey: string
  /** null = switch to a fresh, logged-out session */
  targetProfileId: string | null
}

export interface SaveNewRequest {
  type: 'saveNew'
  tabId: number
  siteKey: string
  name: string
  color: string
  emoji?: string
}

export type BgRequest = SwitchRequest | SaveNewRequest

export type BgResponse =
  | { ok: true; warnings: string[] }
  | { ok: false; error: string }
```

Note: `./cookies` doesn't exist yet — Task 3 in this plan is `site.ts`, Task 4 creates `cookies.ts`. Typecheck will fail until Task 4; that's fine, `npm test` doesn't typecheck. If you prefer a clean state, commit types together with Task 4's commit instead.

- [ ] **Step 2: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add shared SessionProfile and message types"
```

---

### Task 3: Site Key Derivation (`site.ts`)

**Files:**
- Create: `src/lib/site.ts`
- Test: `tests/site.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/site.test.ts`:
```ts
import { expect, test } from 'vitest'
import { siteKeyFromUrl } from '../src/lib/site'

test('maps subdomains to the registrable domain', () => {
  expect(siteKeyFromUrl('https://mail.google.com/mail/u/0')).toBe('google.com')
  expect(siteKeyFromUrl('https://github.com/settings')).toBe('github.com')
})

test('handles multi-part public suffixes correctly', () => {
  expect(siteKeyFromUrl('https://www.example.co.uk/')).toBe('example.co.uk')
})

test('falls back to hostname for localhost and IPs', () => {
  expect(siteKeyFromUrl('http://localhost:3000/app')).toBe('localhost')
  expect(siteKeyFromUrl('http://192.168.1.5/admin')).toBe('192.168.1.5')
})

test('returns null for non-http(s) and invalid URLs', () => {
  expect(siteKeyFromUrl('chrome://extensions')).toBeNull()
  expect(siteKeyFromUrl('about:blank')).toBeNull()
  expect(siteKeyFromUrl('not a url')).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/site.test.ts`
Expected: FAIL — cannot resolve `../src/lib/site`.

- [ ] **Step 3: Write the implementation**

`src/lib/site.ts`:
```ts
import { getDomain } from 'tldts'

/**
 * Derive the "site key" (registrable domain / eTLD+1) a session belongs to.
 * Returns null for pages we can't manage (chrome://, about:, invalid URLs).
 */
export function siteKeyFromUrl(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  // getDomain returns null for IPs and single-label hosts like localhost —
  // fall back to the raw hostname so those still work.
  return getDomain(u.hostname) ?? u.hostname
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/site.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/site.ts tests/site.test.ts
git commit -m "feat: derive site key (eTLD+1) from tab URL"
```

---

### Task 4: Cookie Conversion (`cookies.ts`) — the most bug-prone code in the project

**Files:**
- Create: `src/lib/cookies.ts`
- Test: `tests/cookies.test.ts`

Background for the engineer: `chrome.cookies.getAll()` returns cookies with `domain`, `hostOnly`, `session` fields. `chrome.cookies.set()` instead wants a `url`, rejects `domain` for host-only cookies, forbids `domain` for `__Host-` cookies, and must not receive `expirationDate` for session cookies. `toSetParams` is the single place this asymmetry is handled.

- [ ] **Step 1: Write the failing test**

`tests/cookies.test.ts`:
```ts
import { expect, test } from 'vitest'
import { toSetParams, type CapturedCookie } from '../src/lib/cookies'

function cookie(overrides: Partial<CapturedCookie>): CapturedCookie {
  return {
    name: 'sid',
    value: 'abc123',
    domain: '.github.com',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    hostOnly: false,
    session: false,
    expirationDate: 1900000000,
    storeId: '0',
    ...overrides,
  }
}

test('domain cookie: keeps domain, builds https url from stripped host', () => {
  const p = toSetParams(cookie({}))
  expect(p.url).toBe('https://github.com/')
  expect(p.domain).toBe('.github.com')
  expect(p.expirationDate).toBe(1900000000)
})

test('host-only cookie: omits domain entirely', () => {
  const p = toSetParams(cookie({ domain: 'github.com', hostOnly: true }))
  expect(p.url).toBe('https://github.com/')
  expect(p.domain).toBeUndefined()
})

test('insecure cookie builds http url', () => {
  const p = toSetParams(cookie({ secure: false, domain: 'example.com', hostOnly: true }))
  expect(p.url).toBe('http://example.com/')
})

test('session cookie: omits expirationDate', () => {
  const p = toSetParams(cookie({ session: true }))
  expect(p.expirationDate).toBeUndefined()
})

test('__Host- cookie: no domain, path preserved as /', () => {
  const p = toSetParams(
    cookie({ name: '__Host-session', domain: 'app.example.com', hostOnly: true, path: '/' })
  )
  expect(p.domain).toBeUndefined()
  expect(p.path).toBe('/')
  expect(p.url).toBe('https://app.example.com/')
})

test('non-root path is used in the url', () => {
  const p = toSetParams(cookie({ path: '/api', domain: 'example.com', hostOnly: true }))
  expect(p.url).toBe('https://example.com/api')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cookies.test.ts`
Expected: FAIL — cannot resolve `../src/lib/cookies`.

- [ ] **Step 3: Write the implementation**

`src/lib/cookies.ts`:
```ts
/** Serializable snapshot of a chrome.cookies.Cookie (same fields, plain JSON). */
export interface CapturedCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: chrome.cookies.SameSiteStatus
  hostOnly: boolean
  session: boolean
  expirationDate?: number
  storeId?: string
}

/**
 * Convert a captured cookie into params accepted by chrome.cookies.set().
 * Handles the get/set asymmetry:
 *  - set() needs a url, which getAll() doesn't return — rebuild it
 *  - host-only cookies must omit `domain`
 *  - __Host- cookies must omit `domain` (they're host-only by definition)
 *  - session cookies must omit `expirationDate`
 */
export function toSetParams(c: CapturedCookie): chrome.cookies.SetDetails {
  const host = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain
  const details: chrome.cookies.SetDetails = {
    url: `${c.secure ? 'https' : 'http'}://${host}${c.path}`,
    name: c.name,
    value: c.value,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
  }
  if (!c.hostOnly && !c.name.startsWith('__Host-')) {
    details.domain = c.domain
  }
  if (!c.session && c.expirationDate !== undefined) {
    details.expirationDate = c.expirationDate
  }
  return details
}

/** Rebuild the url needed by chrome.cookies.remove() for a live cookie. */
export function cookieUrl(c: { domain: string; path: string; secure: boolean }): string {
  const host = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain
  return `${c.secure ? 'https' : 'http'}://${host}${c.path}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cookies.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cookies.ts tests/cookies.test.ts
git commit -m "feat: cookie capture-to-set conversion with host-only/__Host-/session handling"
```

---

### Task 5: Profile Factory & Export/Import (`profiles.ts`, `transfer.ts`)

**Files:**
- Create: `src/lib/profiles.ts`, `src/lib/transfer.ts`
- Test: `tests/profiles.test.ts`, `tests/transfer.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/profiles.test.ts`:
```ts
import { expect, test } from 'vitest'
import { autoSaveName, newProfile } from '../src/lib/profiles'

test('autoSaveName formats as Auto-saved YYYY-MM-DD HH:MM', () => {
  expect(autoSaveName(new Date(2026, 6, 30, 9, 5))).toBe('Auto-saved 2026-07-30 09:05')
})

test('newProfile fills id and timestamps', () => {
  const p = newProfile({
    siteKey: 'github.com',
    name: 'Work',
    color: '#3b82f6',
    cookies: [],
    localStorage: {},
    sessionStorage: {},
  })
  expect(p.id).toMatch(/^[0-9a-f-]{36}$/)
  expect(p.siteKey).toBe('github.com')
  expect(p.createdAt).toBeGreaterThan(0)
  expect(p.updatedAt).toBe(p.createdAt)
})
```

`tests/transfer.test.ts`:
```ts
import { expect, test } from 'vitest'
import { mergeProfiles, parseImport, serializeExport } from '../src/lib/transfer'
import { newProfile } from '../src/lib/profiles'

const sample = () =>
  newProfile({
    siteKey: 'github.com',
    name: 'Work',
    color: '#3b82f6',
    cookies: [],
    localStorage: { theme: 'dark' },
    sessionStorage: {},
  })

test('export/import round-trip preserves profiles', () => {
  const p = sample()
  const parsed = parseImport(serializeExport([p]))
  expect(parsed).toEqual([p])
})

test('parseImport rejects invalid JSON', () => {
  expect(() => parseImport('{oops')).toThrow('Not valid JSON')
})

test('parseImport rejects foreign JSON files', () => {
  expect(() => parseImport('{"foo": 1}')).toThrow('Not a session-manager export')
  expect(() => parseImport('[]')).toThrow('Not a session-manager export')
})

test('parseImport rejects malformed profiles', () => {
  const bad = JSON.stringify({ app: 'session-manager', version: 1, profiles: [{ id: 42 }] })
  expect(() => parseImport(bad)).toThrow('invalid profile')
})

test('mergeProfiles: imported entry wins on id collision, others appended', () => {
  const a = sample()
  const b = sample()
  const updatedA = { ...a, name: 'Renamed' }
  const merged = mergeProfiles([a], [updatedA, b])
  expect(merged).toHaveLength(2)
  expect(merged.find((p) => p.id === a.id)?.name).toBe('Renamed')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/profiles.test.ts tests/transfer.test.ts`
Expected: FAIL — cannot resolve the two modules.

- [ ] **Step 3: Write the implementations**

`src/lib/profiles.ts`:
```ts
import type { CapturedCookie } from './cookies'
import type { SessionProfile } from './types'

export function autoSaveName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `Auto-saved ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

export function newProfile(init: {
  siteKey: string
  name: string
  color: string
  emoji?: string
  cookies: CapturedCookie[]
  localStorage: Record<string, string>
  sessionStorage: Record<string, string>
}): SessionProfile {
  const now = Date.now()
  return { id: crypto.randomUUID(), createdAt: now, updatedAt: now, ...init }
}
```

`src/lib/transfer.ts`:
```ts
import type { SessionProfile } from './types'

interface ExportFile {
  app: 'session-manager'
  version: 1
  profiles: SessionProfile[]
}

export function serializeExport(profiles: SessionProfile[]): string {
  const file: ExportFile = { app: 'session-manager', version: 1, profiles }
  return JSON.stringify(file, null, 2)
}

export function parseImport(json: string): SessionProfile[] {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('Not valid JSON')
  }
  const f = data as Partial<ExportFile> | null
  if (
    typeof f !== 'object' ||
    f === null ||
    f.app !== 'session-manager' ||
    f.version !== 1 ||
    !Array.isArray(f.profiles)
  ) {
    throw new Error('Not a session-manager export')
  }
  for (const p of f.profiles) {
    if (
      typeof p?.id !== 'string' ||
      typeof p?.siteKey !== 'string' ||
      typeof p?.name !== 'string' ||
      !Array.isArray(p?.cookies)
    ) {
      throw new Error('Export file contains an invalid profile')
    }
  }
  return f.profiles
}

/** Merge imported profiles into existing ones; imported wins on id collision. */
export function mergeProfiles(
  existing: SessionProfile[],
  imported: SessionProfile[]
): SessionProfile[] {
  const byId = new Map(existing.map((p) => [p.id, p]))
  for (const p of imported) byId.set(p.id, p)
  return [...byId.values()]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/profiles.test.ts tests/transfer.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/profiles.ts src/lib/transfer.ts tests/profiles.test.ts tests/transfer.test.ts
git commit -m "feat: profile factory, export serialization, import validation and merge"
```

---

### Task 6: Web Storage Page Functions (`webstorage.ts`)

**Files:**
- Create: `src/lib/webstorage.ts`
- Test: `tests/webstorage.test.ts`

These functions are injected into the page via `chrome.scripting.executeScript({ func })`. **They must be fully self-contained** — no references to imports or outer-scope variables, because Chrome serializes only the function body into the page. They're tested under jsdom, which provides `window.localStorage`.

- [ ] **Step 1: Write the failing test**

`tests/webstorage.test.ts`:
```ts
// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest'
import {
  clearStoragesInPage,
  readStoragesInPage,
  writeStoragesInPage,
} from '../src/lib/webstorage'

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})

test('read captures both storages', () => {
  window.localStorage.setItem('token', 'jwt-abc')
  window.sessionStorage.setItem('tmp', '1')
  expect(readStoragesInPage()).toEqual({
    localStorage: { token: 'jwt-abc' },
    sessionStorage: { tmp: '1' },
  })
})

test('write replaces existing contents', () => {
  window.localStorage.setItem('stale', 'x')
  writeStoragesInPage({ fresh: 'y' }, { s: 'z' })
  expect(window.localStorage.getItem('stale')).toBeNull()
  expect(window.localStorage.getItem('fresh')).toBe('y')
  expect(window.sessionStorage.getItem('s')).toBe('z')
})

test('clear empties both storages', () => {
  window.localStorage.setItem('a', '1')
  window.sessionStorage.setItem('b', '2')
  clearStoragesInPage()
  expect(window.localStorage.length).toBe(0)
  expect(window.sessionStorage.length).toBe(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/webstorage.test.ts`
Expected: FAIL — cannot resolve `../src/lib/webstorage`.

- [ ] **Step 3: Write the implementation**

`src/lib/webstorage.ts`:
```ts
// NOTE: every function here is injected into the page with
// chrome.scripting.executeScript({ func }). Each must be self-contained:
// no imports, no closure over module variables.

export function readStoragesInPage(): {
  localStorage: Record<string, string>
  sessionStorage: Record<string, string>
} {
  const dump = (s: Storage) => {
    const out: Record<string, string> = {}
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)!
      out[k] = s.getItem(k)!
    }
    return out
  }
  return {
    localStorage: dump(window.localStorage),
    sessionStorage: dump(window.sessionStorage),
  }
}

export function clearStoragesInPage(): void {
  window.localStorage.clear()
  window.sessionStorage.clear()
}

export function writeStoragesInPage(
  ls: Record<string, string>,
  ss: Record<string, string>
): void {
  window.localStorage.clear()
  window.sessionStorage.clear()
  for (const [k, v] of Object.entries(ls)) window.localStorage.setItem(k, v)
  for (const [k, v] of Object.entries(ss)) window.sessionStorage.setItem(k, v)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/webstorage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/webstorage.ts tests/webstorage.test.ts
git commit -m "feat: page-injected web storage read/clear/write functions"
```

---

### Task 7: Storage Wrapper (`store.ts`)

**Files:**
- Create: `src/lib/store.ts`
- Test: `tests/store.test.ts`

Thin imperative shell over `chrome.storage.local`, tested with a minimal in-memory fake of the `chrome` global.

- [ ] **Step 1: Write the failing test**

`tests/store.test.ts`:
```ts
import { beforeEach, expect, test } from 'vitest'

const mem: Record<string, unknown> = {}
;(globalThis as Record<string, unknown>).chrome = {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: mem[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(mem, items)
      },
    },
  },
}

const { getProfiles, saveProfiles, getActiveMap, setActive } = await import(
  '../src/lib/store'
)
const { newProfile } = await import('../src/lib/profiles')

beforeEach(() => {
  for (const k of Object.keys(mem)) delete mem[k]
})

test('getProfiles returns [] when storage is empty', async () => {
  expect(await getProfiles()).toEqual([])
})

test('saveProfiles / getProfiles round-trip', async () => {
  const p = newProfile({
    siteKey: 'github.com',
    name: 'Work',
    color: '#3b82f6',
    cookies: [],
    localStorage: {},
    sessionStorage: {},
  })
  await saveProfiles([p])
  expect(await getProfiles()).toEqual([p])
})

test('setActive / getActiveMap round-trip, null clears', async () => {
  await setActive('github.com', 'some-id')
  expect(await getActiveMap()).toEqual({ 'github.com': 'some-id' })
  await setActive('github.com', null)
  expect(await getActiveMap()).toEqual({ 'github.com': null })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/store.test.ts`
Expected: FAIL — cannot resolve `../src/lib/store`.

- [ ] **Step 3: Write the implementation**

`src/lib/store.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the whole suite + typecheck**

Run: `npm test` then `npm run typecheck`
Expected: all tests PASS; typecheck exits 0 (all modules referenced by `types.ts` now exist).

- [ ] **Step 6: Commit**

```bash
git add src/lib/store.ts tests/store.test.ts
git commit -m "feat: typed chrome.storage.local wrapper for profiles and active map"
```

---

### Task 8: Service Worker (`background.ts`)

**Files:**
- Modify: `src/background.ts` (replace stub entirely)

Imperative shell — orchestrates the five-step switch flow from the spec. No unit tests (every line touches `chrome.*`); covered by the manual checklist in Task 10.

- [ ] **Step 1: Replace `src/background.ts` with the full implementation**

```ts
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

chrome.runtime.onMessage.addListener((msg: BgRequest, _sender, sendResponse) => {
  handle(msg)
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
  for (const c of profile.cookies) {
    try {
      await chrome.cookies.set(toSetParams(c))
    } catch {
      warnings.push(`Could not restore cookie ${c.name}`)
    }
  }
}

/** Auto-save current state into the active profile, or a new auto-named one. */
function autoSave(profiles: SessionProfile[], siteKey: string, activeId: string | null | undefined, snap: Snapshot): void {
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
```

- [ ] **Step 2: Verify build and typecheck**

Run: `npm run build` then `npm run typecheck`
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/background.ts
git commit -m "feat: service worker with switch and save-new session orchestration"
```

---

### Task 9: Popup UI

**Files:**
- Modify: `src/popup/index.html`, `src/popup/popup.ts` (replace stubs entirely)
- Create: `src/popup/popup.css`

- [ ] **Step 1: Replace `src/popup/index.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Session Manager</title>
    <link rel="stylesheet" href="./popup.css" />
  </head>
  <body>
    <header>
      <strong id="site">…</strong>
    </header>

    <div id="notice" hidden></div>

    <ul id="profiles"></ul>

    <form id="save-form">
      <input id="name" placeholder="Profile name" required maxlength="40" autocomplete="off" />
      <div class="row">
        <div id="colors"></div>
        <input id="emoji" placeholder="🙂" maxlength="4" title="Optional emoji label" />
      </div>
      <button type="submit">Save current session as profile</button>
    </form>

    <div class="row actions">
      <button id="fresh" title="Switch to a logged-out session">Fresh session</button>
      <button id="export">Export</button>
      <button id="import-btn">Import</button>
      <input type="file" id="import-file" accept="application/json" hidden />
    </div>
    <p class="hint">Exports contain login credentials — keep the file safe.</p>

    <script type="module" src="./popup.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `src/popup/popup.css`**

```css
body {
  width: 320px;
  margin: 0;
  padding: 12px;
  font: 13px/1.4 system-ui, sans-serif;
  color: #111827;
}
header { margin-bottom: 8px; }
#notice { background: #fef3c7; border-radius: 6px; padding: 8px; margin-bottom: 8px; }
ul { list-style: none; margin: 0 0 12px; padding: 0; }
li {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 4px; border-radius: 6px; cursor: pointer;
}
li:hover { background: #f3f4f6; }
li.active { font-weight: 600; }
.dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.del { border: none; background: none; cursor: pointer; color: #9ca3af; }
.del:hover { color: #dc2626; }
form { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
input { padding: 6px; border: 1px solid #d1d5db; border-radius: 6px; }
#emoji { width: 44px; }
#colors { display: flex; gap: 6px; align-items: center; flex: 1; }
.swatch {
  width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid transparent; cursor: pointer; padding: 0;
}
.swatch.selected { border-color: #111827; }
button { padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; cursor: pointer; }
button:hover { background: #f3f4f6; }
.row { display: flex; gap: 6px; }
.hint { color: #6b7280; font-size: 11px; margin: 6px 0 0; }
```

- [ ] **Step 3: Replace `src/popup/popup.ts`**

```ts
import { siteKeyFromUrl } from '../lib/site'
import { getActiveMap, getProfiles, saveProfiles, setActive } from '../lib/store'
import { mergeProfiles, parseImport, serializeExport } from '../lib/transfer'
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
  if (!confirm(`Delete profile "${p.name}"? The saved login will be lost.`)) return
  const profiles = await getProfiles()
  await saveProfiles(profiles.filter((x) => x.id !== p.id))
  const active = await getActiveMap()
  if (active[siteKey] === p.id) await setActive(siteKey, null)
  await renderList()
}

async function doSwitch(targetProfileId: string | null): Promise<void> {
  const res = (await chrome.runtime.sendMessage({
    type: 'switch',
    tabId,
    siteKey,
    targetProfileId,
  })) as BgResponse
  if (!res.ok) {
    showNotice(`Switch failed: ${res.error}`)
    return
  }
  if (res.warnings.length > 0) {
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
      const res = (await chrome.runtime.sendMessage({
        type: 'saveNew',
        tabId,
        siteKey,
        name: nameEl.value.trim(),
        color: selectedColor,
        emoji: emojiEl.value.trim() || undefined,
      })) as BgResponse
      if (!res.ok) {
        showNotice(`Save failed: ${res.error}`)
        return
      }
      formEl.reset()
      await renderList()
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
      const file = importFile.files?.[0]
      if (!file) return
      try {
        const imported = parseImport(await file.text())
        const merged = mergeProfiles(await getProfiles(), imported)
        await saveProfiles(merged)
        showNotice(`Imported ${imported.length} profile(s).`)
        if (siteKey) await renderList()
      } catch (e) {
        showNotice(`Import failed: ${e instanceof Error ? e.message : String(e)}`)
      }
      importFile.value = ''
    })()
  })
}
```

- [ ] **Step 4: Verify build, typecheck, tests**

Run: `npm run build && npm run typecheck && npm test`
Expected: all exit 0, all tests pass.

- [ ] **Step 5: Smoke-test in Chrome**

1. `npm run build`
2. Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, select the `dist/` folder.
3. Open `https://github.com`, click the extension icon.
Expected: popup shows `github.com`, empty profile list, the save form, and the action buttons.

- [ ] **Step 6: Commit**

```bash
git add src/popup
git commit -m "feat: popup UI with profile list, save form, switch, export/import"
```

---

### Task 10: README & Manual Test Checklist

**Files:**
- Create: `README.md`, `docs/manual-testing.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# Session Manager

Chrome/Edge (Manifest V3) extension that saves and switches multiple sessions
per website — cookies plus localStorage/sessionStorage — one active session at
a time.

## Features

- Save the current session as a named profile (with color + emoji label)
- Switch profiles: the page reloads into the other account
- Auto-save before every switch — logins are never silently lost
- "Fresh session" = switch to a logged-out state
- Export/import all profiles as JSON (**the file contains login credentials —
  treat it like a password**)

## Development

```bash
npm install
npm run dev        # dev build with hot reload
npm run build      # production build into dist/
npm test           # unit tests (Vitest)
npm run typecheck  # tsc --noEmit
```

Load in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** →
select `dist/`.

## Known limitations (v1)

- Sites that keep auth state in IndexedDB, or spread it across multiple
  registrable domains, may require a re-login after switching.
- Sessions cannot run simultaneously in different tabs — switching is
  one-at-a-time per site.
- Profiles are stored unencrypted in `chrome.storage.local`.
```

- [ ] **Step 2: Create `docs/manual-testing.md`**

```markdown
# Manual Test Checklist

Prereqs: production build loaded unpacked from `dist/`; two test accounts on a
real site (GitHub works well).

## Core switching
- [ ] Log into account A on github.com → popup → save as "A" (pick a color + emoji)
- [ ] Popup shows "A ✓" as active
- [ ] Click **Fresh session** → page reloads logged out
- [ ] Log into account B → save as "B"
- [ ] Click profile "A" → page reloads logged in as A
- [ ] Click profile "B" → page reloads logged in as B

## Auto-save
- [ ] While on A, change something session-visible (e.g. GitHub theme), switch
      to B, switch back to A → change persisted (state was auto-saved)
- [ ] Log in on a site with NO saved profiles, switch to Fresh →
      an "Auto-saved …" profile appears (login not lost)

## Export / import
- [ ] Export → JSON file downloads
- [ ] Delete profile "A" (confirm dialog appears)
- [ ] Import the file → "A" is back and switching to it works
- [ ] Import a random non-export JSON → clear error, nothing corrupted

## Edge cases
- [ ] Popup on `chrome://extensions` → "Can't manage sessions on this page",
      save/switch disabled, export/import still usable
- [ ] Popup on a `mail.google.com` tab shows site `google.com`
- [ ] Delete the active profile → no crash; next switch auto-saves to a new
      "Auto-saved …" profile

## Regression basics
- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] No errors in the service worker console (chrome://extensions → Inspect)
```

- [ ] **Step 3: Run the full checklist manually and fix anything that fails**

Expected: every box checkable. Any failure → debug before committing (use the systematic-debugging skill).

- [ ] **Step 4: Commit**

```bash
git add README.md docs/manual-testing.md
git commit -m "docs: README and manual test checklist"
```

---

## Task Order & Dependencies

1 (scaffold) → 2 (types) → 3 (site) / 4 (cookies) / 5 (profiles+transfer) / 6 (webstorage) in any order → 7 (store) → 8 (background) → 9 (popup) → 10 (docs + manual E2E).
