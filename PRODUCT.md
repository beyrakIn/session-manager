# Session Manager — product context

## What it is

A Chrome/Edge MV3 extension that saves and switches website login sessions.
A "session" is a site's cookies plus its localStorage/sessionStorage, captured
as a named profile scoped to an origin (hostname + port).

Two surfaces:

- **Popup** — the fast path. One site, one decision: switch, save, or start fresh.
- **Dashboard** (options page) — the library. Every profile across every site,
  with editing, bulk cleanup, storage insight, and switch-from-anywhere.

## Register

**Product.** Design serves the task. The user is mid-work — juggling a work and
a personal account, or five internal subdomains — and wants the tool to
disappear into the job. Earned familiarity beats novelty.

## Who uses it

Developers and people with multiple accounts on the same service. They live in
Chrome DevTools, Linear, and a terminal. They run several localhost ports at
once. They will judge this by whether it feels like a real tool.

## The physical scene

Daytime, an office or home desk, a bright IDE-adjacent workflow, often with the
system in dark mode after hours. The dashboard is opened occasionally and with
intent ("clean up my saved logins", "which profile was that?"), not left open.
So: light by default, dark honored automatically, never a choice the user has
to make.

## Design principles

1. **Density is a feature.** Someone with 40 profiles across 15 subdomains
   needs to scan, sort and filter — not scroll through decorated cards.
2. **Destructive actions are explicit.** Delete and switch both rewrite real
   logins. They confirm, they report warnings, they never happen invisibly.
3. **The data is the interface.** Cookie counts, sizes and dates are what make
   a profile identifiable months later. Show them, don't hide them behind a
   detail view.
4. **One accent.** Blue marks primary actions, current selection and active
   state. Nothing decorative.

## Color

Existing committed brand color: blue `#2563eb` (light) / `#3b82f6` (dark),
already used by the popup and the extension icon. Strategy: **Restrained** —
tinted neutrals, accent under 10% of the surface. A second, cooler neutral
layer carries the sidebar so the content plane reads as the workspace.
