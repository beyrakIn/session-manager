import { expect, test } from 'vitest'
import {
  KDF_ITERATIONS,
  decryptJson,
  deriveKey,
  encryptJson,
  exportKeyRaw,
  importKeyRaw,
  newSalt,
} from '../src/lib/crypto'

test('the same passphrase and salt derive the same key', async () => {
  const salt = newSalt()
  const a = await deriveKey('correct horse', salt, KDF_ITERATIONS)
  const b = await deriveKey('correct horse', salt, KDF_ITERATIONS)
  expect(await exportKeyRaw(a)).toBe(await exportKeyRaw(b))
})

test('a different salt derives a different key', async () => {
  const a = await deriveKey('correct horse', newSalt(), KDF_ITERATIONS)
  const b = await deriveKey('correct horse', newSalt(), KDF_ITERATIONS)
  expect(await exportKeyRaw(a)).not.toBe(await exportKeyRaw(b))
})

test('encrypt/decrypt round-trips arbitrary JSON', async () => {
  const key = await deriveKey('pw', newSalt(), KDF_ITERATIONS)
  const data = { profiles: [{ name: 'Work', cookies: [1, 2, 3] }], unicode: 'çé😀' }
  expect(await decryptJson(key, await encryptJson(key, data))).toEqual(data)
})

test('the same plaintext encrypts differently each time', async () => {
  const key = await deriveKey('pw', newSalt(), KDF_ITERATIONS)
  const a = await encryptJson(key, { x: 1 })
  const b = await encryptJson(key, { x: 1 })
  expect(a.ct).not.toBe(b.ct)
  expect(a.iv).not.toBe(b.iv)
})

test('the wrong key cannot decrypt', async () => {
  const salt = newSalt()
  const right = await deriveKey('right', salt, KDF_ITERATIONS)
  const wrong = await deriveKey('wrong', salt, KDF_ITERATIONS)
  const blob = await encryptJson(right, { secret: true })
  await expect(decryptJson(wrong, blob)).rejects.toThrow()
})

test('tampered ciphertext is rejected rather than silently decoded', async () => {
  const key = await deriveKey('pw', newSalt(), KDF_ITERATIONS)
  const blob = await encryptJson(key, { secret: true })
  const bytes = atob(blob.ct).split('')
  bytes[0] = bytes[0] === 'A' ? 'B' : 'A'
  await expect(decryptJson(key, { ...blob, ct: btoa(bytes.join('')) })).rejects.toThrow()
})

test('a key survives an export/import round-trip through storage', async () => {
  const key = await deriveKey('pw', newSalt(), KDF_ITERATIONS)
  const restored = await importKeyRaw(await exportKeyRaw(key))
  expect(await decryptJson(restored, await encryptJson(key, { ok: 1 }))).toEqual({ ok: 1 })
})
