import { describe, expect, it, vi } from 'vitest'

// Why: the real mobile e2ee.ts imports expo-crypto -> react-native, which the
// node test env cannot import (RN parse error at module load). The mobile
// e2ee.ts deriveSharedKey/decrypt/publicKeyFromBase64 are Hermes-safe wrappers
// over the IDENTICAL tweetnacl calls in the shared Node-compatible e2ee-crypto.
// Backing the mock with the shared module runs REAL NaCl crypto through the
// module under test while bypassing the RN import chain. The definitive
// cross-platform ECDH proof lives in fcm-payload-cross-platform.test.ts (no
// mocks) — this file proves the module's own structure + real decrypt round-trip.
vi.mock('../transport/e2ee', async () => {
  const crypto = await import('../../../src/shared/e2ee-crypto')
  return {
    deriveSharedKey: crypto.deriveSharedKey,
    decrypt: crypto.decrypt,
    publicKeyFromBase64: crypto.publicKeyFromBase64
  }
})

import {
  encryptPushPayload,
  deriveFcmSharedKey
} from '../../../src/main/runtime/push-payload-crypto'
import {
  encrypt as encryptRaw,
  generateKeyPair,
  publicKeyToBase64
} from '../../../src/shared/e2ee-crypto'
import { decryptPushPayload, deriveMobileFcmSharedKey } from './push-payload-decrypt'

// Why: builds a desktop+mobile persistent keypair pair and the two derived
// shared keys, mirroring the production split (desktop derives with its secret +
// mobile public; mobile derives with its secret + desktop public). Both halves
// yield byte-identical 32-byte keys by ECDH symmetry (REQ-FCM-019).
function makeKeyPairSet() {
  const desktop = generateKeyPair()
  const mobile = generateKeyPair()
  const desktopPublicB64 = publicKeyToBase64(desktop.publicKey)
  const mobilePublicB64 = publicKeyToBase64(mobile.publicKey)
  // Desktop-derived (M2 path): deriveSharedKey(desktopSecret, mobilePublic).
  const desktopShared = deriveFcmSharedKey(desktop.secretKey, mobilePublicB64)
  // Mobile-derived (M5 path): deriveSharedKey(mobileSecret, desktopPublic).
  const mobileShared = deriveMobileFcmSharedKey(mobile.secretKey, desktopPublicB64)
  return { desktop, mobile, desktopPublicB64, mobilePublicB64, desktopShared, mobileShared }
}

describe('deriveMobileFcmSharedKey', () => {
  it('produces the same 32-byte key as the desktop (M2) derivation (ECDH symmetry)', () => {
    // Why: AC-FCM-003 — the mobile-derived persistent FCM-shared key MUST equal
    // the desktop-derived one so a payload encrypted by the desktop decrypts on
    // the mobile. This is the cross-platform ECDH symmetry that makes the
    // persistent FCM channel work independent of the WS session key.
    const { desktopShared, mobileShared } = makeKeyPairSet()
    expect(Array.from(mobileShared)).toEqual(Array.from(desktopShared))
    expect(mobileShared.length).toBe(32)
  })

  it('is independent of the WS ephemeral session key (forward secrecy preserved)', () => {
    // Why: REQ-FCM-019 — the persistent FCM-shared key MUST NOT depend on the
    // per-connection ephemeral keypair. A fresh ephemeral pair (as generated on
    // every WS connect in rpc-client.ts) derives a different shared key.
    const { mobile, desktopPublicB64, mobileShared } = makeKeyPairSet()
    const ephemeral = generateKeyPair()
    const ephemeralShared = deriveMobileFcmSharedKey(ephemeral.secretKey, desktopPublicB64)
    expect(Array.from(ephemeralShared)).not.toEqual(Array.from(mobileShared))
    // The persistent mobile secret is the one that matches the desktop derivation.
    const persistentRederived = deriveMobileFcmSharedKey(mobile.secretKey, desktopPublicB64)
    expect(Array.from(persistentRederived)).toEqual(Array.from(mobileShared))
  })
})

describe('decryptPushPayload', () => {
  it('decrypts a desktop-encrypted (M2) payload to the byte-identical original', () => {
    // Why: AC-FCM-003 mobile half — desktop encrypts with the desktop-derived
    // key (M2 encryptPushPayload), mobile decrypts with the mobile-derived key
    // and recovers {title, body}. The base64 bundle (nonce+ciphertext) format
    // produced by M2 MUST be consumed unchanged by the mobile decrypt.
    const { desktopShared, mobileShared } = makeKeyPairSet()
    const original = { title: 'Agent complete', body: 'main.ts updated' }
    const outcome = encryptPushPayload(original, desktopShared)
    expect(outcome.status).toBe('ok')

    const decrypted = decryptPushPayload(
      (outcome as { ciphertextB64: string }).ciphertextB64,
      mobileShared
    )
    expect(decrypted.status).toBe('ok')
    if (decrypted.status === 'ok') {
      expect(decrypted.payload.title).toBe(original.title)
      expect(decrypted.payload.body).toBe(original.body)
    }
  })

  it('recovers metadata when the desktop includes it', () => {
    const { desktopShared, mobileShared } = makeKeyPairSet()
    const original = {
      title: 'Bell',
      body: 'ding',
      metadata: { severity: 'info', url: 'https://example.com/x' }
    }
    const outcome = encryptPushPayload(original, desktopShared)
    expect(outcome.status).toBe('ok')

    const decrypted = decryptPushPayload(
      (outcome as { ciphertextB64: string }).ciphertextB64,
      mobileShared
    )
    expect(decrypted.status).toBe('ok')
    if (decrypted.status === 'ok') {
      expect(decrypted.payload.metadata).toEqual(original.metadata)
    }
  })

  it('returns error on a tampered ciphertext (auth fails -> no plaintext leak)', () => {
    // Why: XSalsa20-Poly1305 authenticated encryption — a flipped byte makes
    // decrypt return null, so the mobile never acts on a forged/corrupt payload.
    const { desktopShared, mobileShared } = makeKeyPairSet()
    const outcome = encryptPushPayload({ title: 't', body: 'b' }, desktopShared)
    expect(outcome.status).toBe('ok')
    const ok = outcome as { ciphertextB64: string }

    // Flip one byte in the decoded bundle (corrupt the ciphertext tail).
    const corrupt = corruptBase64Bundle(ok.ciphertextB64)

    const result = decryptPushPayload(corrupt, mobileShared)
    expect(result.status).toBe('error')
  })

  it('returns error when the shared key does not match (wrong host)', () => {
    // Why: the receiver tries one derivation per paired host; a payload encrypted
    // for host A must fail to decrypt with host B's shared key rather than yield
    // garbage. This is what makes try-decrypt-per-host a safe disambiguator.
    const desktopA = generateKeyPair()
    const desktopB = generateKeyPair()
    const mobile = generateKeyPair()
    const sharedA = deriveFcmSharedKey(desktopA.secretKey, publicKeyToBase64(mobile.publicKey))
    const mobileSharedB = deriveMobileFcmSharedKey(
      mobile.secretKey,
      publicKeyToBase64(desktopB.publicKey)
    )

    const outcome = encryptPushPayload({ title: 't', body: 'b' }, sharedA)
    expect(outcome.status).toBe('ok')
    const result = decryptPushPayload(
      (outcome as { ciphertextB64: string }).ciphertextB64,
      mobileSharedB
    )
    expect(result.status).toBe('error')
  })

  it('returns error on a non-JSON plaintext (defensive parse)', () => {
    // Why: decrypt succeeds (correct key) but the plaintext is not an object.
    // Simulated by encrypting a bare string via the shared primitive.
    const { mobileShared } = makeKeyPairSet()
    const notObject = encryptRaw('not-json-brace', mobileShared)
    const result = decryptPushPayload(notObject, mobileShared)
    expect(result.status).toBe('error')
  })

  it('returns error when title or body is missing from the decrypted object', () => {
    const { mobileShared } = makeKeyPairSet()
    // Valid JSON object but missing required fields.
    const missingFields = encryptRaw(JSON.stringify({ title: 'only-title' }), mobileShared)
    const result = decryptPushPayload(missingFields, mobileShared)
    expect(result.status).toBe('error')
  })
})

// Why: helper that decodes the base64 bundle, flips the last byte, and re-encodes
// so the tamper is inside the ciphertext (not the nonce header) — exercising the
// Poly1305 authentication failure path rather than a length check.
function corruptBase64Bundle(b64: string): string {
  const bytes = Buffer.from(b64, 'base64')
  const copy = Buffer.from(bytes)
  copy[copy.length - 1] = (copy[copy.length - 1]! + 1) & 0xff
  return copy.toString('base64')
}
