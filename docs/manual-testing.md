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
- [ ] Delete profile "A" (confirm dialog appears and works — popup must not
      close when the dialog opens)
- [ ] **Import via the file picker** → picker opens WITHOUT the popup closing
      (known Firefox-class bug; verify on Chrome and Edge), file imports,
      notice shows count, "A" is back and switching to it works
- [ ] Import a random non-export JSON → clear error notice, nothing corrupted,
      popup still responsive (busy state cleared)

## Concurrency / rapid input
- [ ] Rapid double-click on a profile row → only ONE switch occurs (busy guard),
      no duplicate reload flash
- [ ] Double-click "Save current session as profile" → only one profile created
- [ ] While a switch is in flight (list dimmed), clicking delete/import does
      nothing until it completes

## Edge cases
- [ ] Popup on `chrome://extensions` → "Can't manage sessions on this page",
      save/switch disabled, export/import still usable
- [ ] Popup on `mail.google.com` shows site `mail.google.com`, and its profile
      list is separate from `accounts.google.com`
- [ ] Two internal subdomains (e.g. `jira.company.com` / `wiki.company.com`)
      each show only their own profiles
- [ ] Two local dev servers on different ports show separate profile lists
      (`localhost:3000` vs `localhost:8080`)
- [ ] Switching on a site whose auth cookie is domain-wide (`.company.com`)
      reports the "shared with other subdomains" warning
- [ ] Popup on `alice.github.io` shows site `alice.github.io` (NOT `github.io`)
- [ ] Delete the active profile → no crash; next switch auto-saves to a new
      "Auto-saved …" profile
- [ ] Profile list with 10+ profiles scrolls inside the popup; save form and
      buttons stay visible
- [ ] Popup on the Chrome Web Store or a PDF tab → switching aborts with a clear
      error and NO cookies are wiped (site may show as google.com — that's why
      the abort matters)
- [ ] Save a profile that includes a short-lived cookie; let it expire; switch
      to that profile → warning says the expired cookie was skipped
- [ ] On a site whose login lives in localStorage (SPA token auth), save/switch
      round-trips the login correctly

## Toolbar badge
- [ ] Toolbar icon shows a count badge equal to the number of profiles saved
      for the current tab's site; no badge on sites with zero profiles
- [ ] Badge updates immediately after saving, deleting, and importing profiles
- [ ] Badge updates when switching between tabs on different sites, and after
      navigating a tab to a different site
- [ ] Badge shows nothing on `chrome://` pages

## Dashboard (options page)
- [ ] "Manage all sessions" in the popup opens the dashboard; right-click icon
      → Options opens the same page
- [ ] Every saved profile appears, grouped by site, sites A→Z and profiles
      most-recently-updated first
- [ ] Totals line matches reality (profile count, site count, storage size)
- [ ] Search filters by site key, profile name and emoji
- [ ] Edit → rename, change color, change emoji → Save persists, and the popup
      shows the new name/color on that site
- [ ] Saving an empty name is refused with a clear message
- [ ] Select profiles across two different sites → selection bar counts them →
      Delete removes exactly those, after one confirm
- [ ] Deleting the profile that was active on a site clears its "active here"
      marker (no stale checkmark in the popup)
- [ ] Switch from the dashboard opens the site in a foreground tab and lands
      logged into that profile
- [ ] Switch on a site that is slow/unreachable reports an error instead of
      hanging forever
- [ ] Editing a profile in the popup updates an open dashboard tab without a
      manual refresh
- [ ] With zero profiles saved, the dashboard shows the getting-started empty
      state; with a non-matching search, it shows the no-results state

## Clipboard transfer
- [ ] ⧉ on a profile copies it; the notice confirms
- [ ] Ctrl+V anywhere in the popup imports a copied session
- [ ] Pasting unrelated text does nothing (no error, no import)

## Session data editor
- [ ] Drawer lists every cookie with domain/path, flags and expiry, plus both
      storage areas
- [ ] Editing a cookie value, saving, then switching into that profile uses
      the edited value
- [ ] Removing a cookie and adding a storage key both persist
- [ ] Saving a cookie with a blank name is refused with a clear message

## Password protection
- [ ] Security → turn on protection: requires 8+ chars, both fields matching,
      and a confirmation of the no-recovery warning
- [ ] After enabling, `chrome.storage.local` holds a `vault` and **no**
      readable `profiles` key (check via the service worker console:
      `chrome.storage.local.get(console.log)`)
- [ ] Popup and dashboard both show the unlock gate after Lock now
- [ ] Wrong password is rejected; correct password unlocks both surfaces
- [ ] Toolbar badge shows 🔒 while locked (no profile count leaks)
- [ ] Auto-lock: set it to 1 minute, leave the browser idle, confirm it locks
- [ ] Using the extension repeatedly keeps it unlocked (the idle timer resets)
- [ ] Export while protected produces an encrypted file (open it — no cookie
      values visible); importing it asks for that password
- [ ] Wrong password on an encrypted import is rejected without corrupting
      existing profiles
- [ ] Turning protection off restores readable profiles and everything works
- [ ] Locking does not lose data: unlock again and all profiles are intact

## Regression basics
- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] No errors in the service worker console (chrome://extensions → Inspect)
