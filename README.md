# Session Manager

Chrome/Edge (Manifest V3) extension that saves and switches multiple sessions
per website — cookies plus localStorage/sessionStorage — one active session at
a time.

## Features

- Save the current session as a named profile (with color + emoji label)
- Switch profiles: the page reloads into the other account
- Auto-save before every switch — logins are never silently lost
- "Fresh session" = switch to a logged-out state
- Toolbar badge shows how many profiles are saved for the current site
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
- Partitioned (CHIPS) third-party cookies are not captured or cleared.
- Sessions are scoped per origin — `jira.company.com`, `wiki.company.com` and
  `localhost:3000` each keep their own profiles. Cookies, however, are not
  origin-scoped: a cookie set on `.company.com` is shared by every subdomain,
  and clearing it during a switch can sign you out of sibling subdomains. The
  extension warns when a switch touched such shared cookies.
- If the extension's service worker is killed mid-switch, the site may end up
  logged out with no active profile marked — your outgoing session is still
  safe in its (auto-saved) profile; just switch to it again. Switches now
  abort up front (no cookies wiped) if the page's storage can't be read at
  all, e.g. the Chrome Web Store or a PDF viewer tab.
