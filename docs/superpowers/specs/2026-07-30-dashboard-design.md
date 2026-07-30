# Session Dashboard — Design Spec

**Date:** 2026-07-30
**Status:** Approved
**Builds on:** `2026-07-30-session-manager-design.md`

## What

A full-page options view listing every saved session profile across every site,
with editing, bulk deletion, storage inspection, and the ability to switch into
a profile without first visiting the site.

The popup stays the fast per-site tool. The dashboard is the "everything I have
saved" view.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Page type | `options_ui` with `open_in_tab: true` | Standard extension convention; reachable via right-click → Options and from the popup |
| Layout | Grouped by site, sections sorted alphabetically | Matches how users think about sessions; scales to many internal subdomains |
| Mutations | Routed through the service-worker message queue | `store.ts` is non-atomic; a second unserialized writer already caused a review finding once |
| Switch target | Always a foreground tab | Wiping cookies for a site the user can't see is the riskiest action here |

## Architecture

```
src/options/
├── index.html      structure
├── options.ts      rendering + event wiring
└── options.css     styling (reuses the popup's CSS custom-property palette)

src/lib/dashboard.ts   pure helpers: profileStats, formatBytes, groupProfilesBySite
```

`manifest.config.ts` gains:

```ts
options_ui: { page: 'src/options/index.html', open_in_tab: true }
```

The popup gains a "Manage all sessions" link calling
`chrome.runtime.openOptionsPage()`.

## New message types

Added to `BgRequest` in `lib/types.ts` and handled in `background.ts`:

```ts
interface UpdateProfileRequest {
  type: 'updateProfile'
  profileId: string
  name: string
  color: string
  emoji?: string
}

interface DeleteProfilesRequest {
  type: 'deleteProfiles'
  profileIds: string[]
}
```

`updateProfile` edits only presentation fields — never session data — and
refreshes `updatedAt`. `deleteProfiles` removes every listed profile and clears
any `activeProfile` entry pointing at one of them.

## Pure helpers (`lib/dashboard.ts`)

```ts
interface ProfileStats {
  cookies: number       // profile.cookies.length
  storageKeys: number   // localStorage + sessionStorage key counts
  bytes: number         // JSON.stringify(profile).length — approximate
}

profileStats(profile): ProfileStats
formatBytes(n): string                       // "1.4 KB", "820 B", "2.1 MB"
groupProfilesBySite(profiles): SiteGroup[]   // sorted by site, profiles by updatedAt desc
matchesQuery(profile, siteKey, query): boolean
```

These are the unit-tested core. Everything else in the page is DOM glue.

## Page structure

**Header:** title, total profile count, total storage used
(`chrome.storage.local.getBytesInUse()`, falling back to the summed estimate),
and a search field filtering on site key, profile name, and emoji.

**Per site section:** origin, profile count, combined size, a "select all"
checkbox, and an "Open" link to `https://<host>/`.

**Per profile row:** selection checkbox, color dot, emoji, name, an "active
here" marker when `activeProfile[siteKey]` matches, relative last-updated date,
and a stat line (`12 cookies · 4 storage keys · 3.2 KB`). Actions: **Switch**
and **Edit**.

**Edit** expands the row inline into a name input, the six color swatches, and
an emoji input, with Save/Cancel. No modal.

**Selection bar:** appears fixed at the bottom when any row is selected —
"N selected" plus a Delete button, with one confirm for the whole batch.

**Empty state:** when nothing is saved at all, explain how to save the first
profile from the popup.

## Switch-from-dashboard flow

1. `chrome.tabs.create({ url: 'https://<host>/', active: true })`
2. Wait for that tab to reach `status === 'complete'` (with a timeout so a
   hanging load can't wedge the page)
3. Send the normal `switch` message with the new tab's id
4. Report the result inline; warnings render the same way the popup renders them

The existing service-worker guards apply unchanged — including the abort when
page storage can't be read.

## Error handling

- Every mutation goes through `send()`-style wrapping so a missing service
  worker surfaces as an inline error rather than an unhandled rejection.
- A failed tab load reports "Couldn't open <site> to switch" and leaves data
  untouched.
- The page re-renders on `chrome.storage.onChanged`, so edits made in the popup
  (or a second dashboard tab) appear without a manual refresh.
- Delete is the only destructive action and always confirms, naming the count.

## Testing

- **Vitest** for `profileStats`, `formatBytes`, `groupProfilesBySite`,
  `matchesQuery`.
- **Manual checklist additions:** rename/recolor persists and shows in the
  popup; bulk delete across two sites; switch-from-dashboard opens a foreground
  tab and lands logged in; search filters both sites and profiles; totals match
  reality; empty state renders.

## Out of scope

- Editing session contents (cookies/storage) by hand
- Per-profile export (whole-library export already exists in the popup)
- Sorting controls beyond the fixed site/recency order
- Profile duplication or moving a profile between sites
