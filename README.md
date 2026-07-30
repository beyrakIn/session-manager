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
- Partitioned (CHIPS) third-party cookies are not captured.
- If the extension's service worker is killed mid-switch, the site may end up
  logged out with no active profile marked — your outgoing session is still
  safe in its (auto-saved) profile; just switch to it again.
