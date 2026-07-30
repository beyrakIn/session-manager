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
- [ ] Popup on a `mail.google.com` tab shows site `google.com`
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

## Regression basics
- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] No errors in the service worker console (chrome://extensions → Inspect)
