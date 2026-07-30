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
