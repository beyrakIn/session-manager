import type { CapturedCookie } from './cookies'
import type { SessionProfile } from './types'

export function autoSaveName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `Auto-saved ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

export function newProfile(init: {
  siteKey: string
  name: string
  color: string
  emoji?: string
  cookies: CapturedCookie[]
  localStorage: Record<string, string>
  sessionStorage: Record<string, string>
}): SessionProfile {
  const now = Date.now()
  return { ...init, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
}
