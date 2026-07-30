import type { EncryptedBlob } from './crypto'
import type { SessionProfile } from './types'

interface ExportFile {
  app: 'session-manager'
  version: 1
  profiles: SessionProfile[]
}

/** Version 2 = the same backup, encrypted with the vault passphrase. */
export interface EncryptedExportFile {
  app: 'session-manager'
  version: 2
  encrypted: true
  salt: string
  iterations: number
  blob: EncryptedBlob
}

export function serializeEncryptedExport(
  salt: string,
  iterations: number,
  blob: EncryptedBlob
): string {
  const file: EncryptedExportFile = {
    app: 'session-manager',
    version: 2,
    encrypted: true,
    salt,
    iterations,
    blob,
  }
  return JSON.stringify(file, null, 2)
}

/**
 * Bounds on an imported file's KDF cost. The count comes from the file, so an
 * absurd value would pin a core for minutes inside crypto.subtle.deriveKey.
 */
export const MIN_KDF_ITERATIONS = 1
export const MAX_KDF_ITERATIONS = 2_000_000

/** The envelope of an encrypted export, or null if this isn't one. */
export function parseEncryptedExport(json: string): EncryptedExportFile | null {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  const f = data as Partial<EncryptedExportFile> | null
  if (
    typeof f !== 'object' ||
    f === null ||
    f.app !== 'session-manager' ||
    f.version !== 2 ||
    typeof f.salt !== 'string' ||
    typeof f.iterations !== 'number' ||
    !Number.isInteger(f.iterations) ||
    f.iterations < MIN_KDF_ITERATIONS ||
    f.iterations > MAX_KDF_ITERATIONS ||
    typeof f.blob?.iv !== 'string' ||
    typeof f.blob?.ct !== 'string'
  ) {
    return null
  }
  return f as EncryptedExportFile
}

export function serializeExport(profiles: SessionProfile[]): string {
  const file: ExportFile = { app: 'session-manager', version: 1, profiles }
  return JSON.stringify(file, null, 2)
}

export function parseImport(json: string): SessionProfile[] {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('Not valid JSON')
  }
  const f = data as Partial<ExportFile> | null
  if (
    typeof f !== 'object' ||
    f === null ||
    f.app !== 'session-manager' ||
    f.version !== 1 ||
    !Array.isArray(f.profiles)
  ) {
    throw new Error('Not a session-manager export')
  }
  for (const p of f.profiles) {
    if (
      typeof p?.id !== 'string' ||
      typeof p?.siteKey !== 'string' ||
      typeof p?.name !== 'string' ||
      !Array.isArray(p?.cookies) ||
      typeof p?.localStorage !== 'object' || p.localStorage === null ||
      typeof p?.sessionStorage !== 'object' || p.sessionStorage === null ||
      typeof p?.color !== 'string' ||
      typeof p?.createdAt !== 'number' ||
      typeof p?.updatedAt !== 'number'
    ) {
      throw new Error('Export file contains an invalid profile')
    }
  }
  return f.profiles
}

/** Merge imported profiles into existing ones; imported wins on id collision. */
export function mergeProfiles(
  existing: SessionProfile[],
  imported: SessionProfile[]
): SessionProfile[] {
  const byId = new Map(existing.map((p) => [p.id, p]))
  for (const p of imported) byId.set(p.id, p)
  return [...byId.values()]
}
