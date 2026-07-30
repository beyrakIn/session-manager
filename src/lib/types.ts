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
  /** Required only when the file is an encrypted (version 2) export. */
  passphrase?: string
}

export interface ExportAllRequest {
  type: 'exportAll'
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

export interface LockRequest {
  type: 'lock'
}

export interface UnlockRequest {
  type: 'unlock'
  passphrase: string
}

export interface EnableProtectionRequest {
  type: 'enableProtection'
  passphrase: string
}

export interface DisableProtectionRequest {
  type: 'disableProtection'
  passphrase: string
}

export interface ChangePassphraseRequest {
  type: 'changePassphrase'
  current: string
  next: string
}

export interface SetLockTimeoutRequest {
  type: 'setLockTimeout'
  minutes: number
}

export interface LockStateRequest {
  type: 'lockState'
}

export interface LockState {
  protected: boolean
  locked: boolean
  timeoutMinutes: number
}

export type BgRequest =
  | SwitchRequest
  | SaveNewRequest
  | DeleteProfileRequest
  | ImportProfilesRequest
  | UpdateProfileRequest
  | DeleteProfilesRequest
  | UpdateProfileDataRequest
  | LockRequest
  | UnlockRequest
  | EnableProtectionRequest
  | DisableProtectionRequest
  | SetLockTimeoutRequest
  | LockStateRequest
  | ExportAllRequest
  | ChangePassphraseRequest

export type BgResponse =
  | { ok: true; warnings: string[]; imported?: number; lock?: LockState; json?: string }
  | { ok: false; error: string; locked?: true }
