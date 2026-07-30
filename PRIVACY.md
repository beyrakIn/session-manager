# Privacy Policy — Session Manager

**Effective date:** 2026-07-30

Session Manager is a browser extension that lets you save and switch between
multiple login sessions on a website. This policy describes what data the
extension handles and what happens to it.

## What data the extension handles

When you explicitly save or switch a session, the extension captures, for the
site in your active tab only:

- **Cookies** (which typically include login/session tokens)
- **localStorage and sessionStorage contents** (which may include login tokens
  on sites that use token-based authentication)
- The **site's domain**, and the profile **name, color, and emoji** you choose

## Where the data goes

**Nowhere.** All data is stored locally on your device in the browser's
extension storage (`chrome.storage.local`). The extension:

- makes **no network requests** of any kind,
- transmits **nothing** off your device,
- has **no server**, no accounts, no analytics, no telemetry,
- does **not sell or transfer** any data to anyone,
- does not use data for any purpose other than saving and restoring your
  sessions.

## Export files

The optional **Export** feature writes your saved profiles to a JSON file on
your device, at your request. That file contains login credentials (cookies
and tokens). You control it entirely — treat it like a password and share it
with no one.

## Data retention and deletion

Data persists only in your browser's local extension storage. To delete it:

- delete individual profiles in the extension popup, or
- uninstall the extension, which removes all stored data.

## Browsing activity

The extension does not track, record, or transmit your browsing history. It
reads the active tab's URL only at the moment you open the popup or perform a
save/switch, solely to determine which site's profiles to show and manage.

## Changes

If this policy changes, the updated version will be published at the same URL
with a new effective date.

## Contact

Questions about this policy: fields@exploit.az
