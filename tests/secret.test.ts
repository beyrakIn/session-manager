import { expect, test } from 'vitest'
import { PIN_LENGTH, iterationsFor, secretError } from '../src/lib/secret'

test('a password must be at least 8 characters', () => {
  expect(secretError('password', 'short7!')).toMatch(/8/)
  expect(secretError('password', 'longenough')).toBeNull()
  expect(secretError('password', '')).toMatch(/8/)
})

test('a PIN must be exactly six digits', () => {
  expect(secretError('pin', '123456')).toBeNull()
  expect(secretError('pin', '12345')).toMatch(/6 digits/)
  expect(secretError('pin', '1234567')).toMatch(/6 digits/)
  expect(secretError('pin', '12345a')).toMatch(/6 digits/)
  expect(secretError('pin', '')).toMatch(/6 digits/)
  expect(secretError('pin', '12 456')).toMatch(/6 digits/)
})

test('PIN_LENGTH is what the validator enforces', () => {
  expect(secretError('pin', '1'.repeat(PIN_LENGTH))).toBeNull()
})

test('a PIN derives with a higher work factor than a password', () => {
  // A 6-digit PIN has a million possibilities; the KDF cost is the only
  // thing standing between an offline copy of the vault and a brute force.
  expect(iterationsFor('pin')).toBeGreaterThan(iterationsFor('password'))
})
