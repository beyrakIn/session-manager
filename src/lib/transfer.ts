import type { SessionProfile } from './types'

interface ExportFile {
  app: 'session-manager'
  version: 1
  profiles: SessionProfile[]
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
      !Array.isArray(p?.cookies)
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
