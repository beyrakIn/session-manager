/**
 * Vault crypto: PBKDF2-SHA256 to turn a passphrase into a key, AES-GCM to
 * encrypt the profile list at rest.
 *
 * The key is never written to disk. It lives in chrome.storage.session, which
 * is memory-only and cleared when the browser closes — see lock.ts.
 */

/** OWASP's floor for PBKDF2-SHA256. Costs ~0.3s on a laptop, once per unlock. */
export const KDF_ITERATIONS = 600_000

export interface EncryptedBlob {
  /** base64 */
  iv: string
  /** base64 */
  ct: string
}

const enc = new TextEncoder()
const dec = new TextDecoder()

function fromUtf8(s: string): Uint8Array<ArrayBuffer> {
  const encoded = enc.encode(s)
  const out = bytes(encoded.length)
  out.set(encoded)
  return out
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

// Explicitly ArrayBuffer-backed: WebCrypto's BufferSource excludes the
// SharedArrayBuffer-backed views a bare `new Uint8Array(n)` may widen to.
function bytes(length: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(length))
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64)
  const out = bytes(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** A fresh random salt, base64-encoded for storage alongside the vault. */
export function newSalt(): string {
  return toBase64(crypto.getRandomValues(bytes(16)))
}

export async function deriveKey(
  passphrase: string,
  saltB64: string,
  iterations: number
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    fromUtf8(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromBase64(saltB64), iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    true, // extractable: so it can be parked in chrome.storage.session
    ['encrypt', 'decrypt']
  )
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(bytes(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    fromUtf8(JSON.stringify(value))
  )
  return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) }
}

/** Rejects on a wrong key or tampered ciphertext — AES-GCM authenticates. */
export async function decryptJson<T>(key: CryptoKey, blob: EncryptedBlob): Promise<T> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(blob.iv) },
    key,
    fromBase64(blob.ct)
  )
  return JSON.parse(dec.decode(plain)) as T
}

export async function exportKeyRaw(key: CryptoKey): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.exportKey('raw', key)))
}

export async function importKeyRaw(rawB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromBase64(rawB64), 'AES-GCM', true, [
    'encrypt',
    'decrypt',
  ])
}
