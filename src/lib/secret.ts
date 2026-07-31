/** How the vault is locked: a passphrase, or a 6-digit PIN. */
export type SecretKind = 'password' | 'pin'

export const PIN_LENGTH = 6
export const MIN_PASSWORD_LENGTH = 8

const PASSWORD_ITERATIONS = 600_000
/**
 * A 6-digit PIN has only a million possibilities, and the vault sits on disk
 * where it can be attacked offline. The KDF cost is the only defence, so PIN
 * mode pays roughly double. It is still far weaker than a password — the UI
 * says so at setup.
 */
const PIN_ITERATIONS = 1_200_000

export function iterationsFor(kind: SecretKind): number {
  return kind === 'pin' ? PIN_ITERATIONS : PASSWORD_ITERATIONS
}

/** Null when the secret is acceptable, otherwise the reason it isn't. */
export function secretError(kind: SecretKind, secret: string): string | null {
  if (kind === 'pin') {
    return /^\d{6}$/.test(secret) ? null : `Enter exactly ${PIN_LENGTH} digits`
  }
  return secret.length >= MIN_PASSWORD_LENGTH
    ? null
    : `Use a password of at least ${MIN_PASSWORD_LENGTH} characters`
}
