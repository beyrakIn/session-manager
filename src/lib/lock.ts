import { exportKeyRaw, importKeyRaw, type EncryptedBlob } from './crypto'
import type { SecretKind } from './secret'

/**
 * Lock state. The derived key lives in chrome.storage.session — memory-only,
 * wiped when the browser closes, and readable by the worker and extension
 * pages alike, so an MV3 worker restart doesn't force a re-unlock.
 */

const KEY_SLOT = 'dek'
const VAULT_KEY = 'vault'
const SETTINGS_KEY = 'lockSettings'

export const DEFAULT_LOCK_MINUTES = 60

export interface Vault {
  v: 1
  salt: string
  iterations: number
  blob: EncryptedBlob
  /** Absent on vaults created before PIN support — treat those as passwords. */
  kind?: SecretKind
}

export interface LockSettings {
  timeoutMinutes: number
}

/** Thrown by profile reads/writes while the vault is locked. */
export class LockedError extends Error {
  constructor() {
    super('Session Manager is locked')
    this.name = 'LockedError'
  }
}

export async function getVault(): Promise<Vault | null> {
  const r = await chrome.storage.local.get(VAULT_KEY)
  return (r[VAULT_KEY] as Vault | undefined) ?? null
}

export async function setVault(v: Vault | null): Promise<void> {
  if (v) await chrome.storage.local.set({ [VAULT_KEY]: v })
  else await chrome.storage.local.remove(VAULT_KEY)
}

export async function isProtected(): Promise<boolean> {
  return (await getVault()) !== null
}

export async function getSessionKey(): Promise<CryptoKey | null> {
  const r = await chrome.storage.session.get(KEY_SLOT)
  const raw = r[KEY_SLOT] as string | undefined
  return raw ? importKeyRaw(raw) : null
}

export async function setSessionKey(key: CryptoKey): Promise<void> {
  await chrome.storage.session.set({ [KEY_SLOT]: await exportKeyRaw(key) })
}

export async function clearSessionKey(): Promise<void> {
  await chrome.storage.session.remove(KEY_SLOT)
}

/** Protected and no key in memory. Unprotected vaults are never "locked". */
export async function isLocked(): Promise<boolean> {
  if (!(await isProtected())) return false
  return (await getSessionKey()) === null
}

export async function getLockSettings(): Promise<LockSettings> {
  const r = await chrome.storage.local.get(SETTINGS_KEY)
  const s = r[SETTINGS_KEY] as Partial<LockSettings> | undefined
  const minutes = s?.timeoutMinutes
  return {
    timeoutMinutes:
      typeof minutes === 'number' && minutes > 0 ? minutes : DEFAULT_LOCK_MINUTES,
  }
}

export async function setLockSettings(s: LockSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: s })
}
