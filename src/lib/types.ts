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

export interface DeleteProfileRequest {
  type: 'deleteProfile'
  profileId: string
  /** '' when no manageable site is focused (delete still works) */
  siteKey: string
}

export interface ImportProfilesRequest {
  type: 'importProfiles'
  json: string
}

/** Edits presentation fields only — never session data. */
export interface UpdateProfileRequest {
  type: 'updateProfile'
  profileId: string
  name: string
  color: string
  emoji?: string
}

export interface DeleteProfilesRequest {
  type: 'deleteProfiles'
  profileIds: string[]
}

/** Replaces a profile's captured session contents after hand-editing. */
export interface UpdateProfileDataRequest {
  type: 'updateProfileData'
  profileId: string
  cookies: CapturedCookie[]
  localStorage: Record<string, string>
  sessionStorage: Record<string, string>
}

export type BgRequest =
  | SwitchRequest
  | SaveNewRequest
  | DeleteProfileRequest
  | ImportProfilesRequest
  | UpdateProfileRequest
  | DeleteProfilesRequest
  | UpdateProfileDataRequest

export type BgResponse =
  | { ok: true; warnings: string[]; imported?: number }
  | { ok: false; error: string }
