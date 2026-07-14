// Why: the definitive AC-FCM-003 proof — desktop-encrypt (M2) <-> mobile-decrypt
// -> byte-identical, with NO module mocking. The production mobile e2ee.ts
// deriveSharedKey/decryptBytes are `nacl.box.before(peerPublic, ourSecret)` /
// `nacl.box.open.after(ciphertext, nonce, sharedKey)` — byte-identical tweetnacl
// calls to the shared Node-compatible e2ee-crypto used here. The shared module
// is therefore a faithful stand-in for the mobile production crypto path, and
// this test exercises the real M2 desktop encrypt against the real NaCl mobile
// decrypt math. (The mobile e2ee.ts file itself cannot be imported in the node
// test env because it pulls in expo-crypto -> react-native.)
import { describe, expect, it } from 'vitest'
import {
  decrypt,
  deriveSharedKey,
  encryptBytes,
  generateKeyPair,
  publicKeyFromBase64,
  publicKeyToBase64
} from '../../../src/shared/e2ee-crypto'
import {
  deriveFcmSharedKey,
  encryptPushPayload
} from '../../../src/main/runtime/push-payload-crypto'
import nacl from 'tweetnacl'

describe('AC-FCM-003 — persistent FCM key cross-platform payload round-trip', () => {
  it('mobile-derived key equals desktop-derived key (ECDH symmetry)', () => {
    // Why: box.before is symmetric — box.before(B_pub, A_sec) === box.before(A_pub, B_sec).
    // Desktop derives with its secret + mobile public (M2 deriveFcmSharedKey);
    // mobile derives with its secret + desktop public. Both MUST yield the same
    // 32-byte key or the encrypted payload would not decrypt across platforms.
    const desktop = generateKeyPair()
    const mobile = generateKeyPair()
    const mobilePublicB64 = publicKeyToBase64(mobile.publicKey)
    const desktopPublicB64 = publicKeyToBase64(desktop.publicKey)

    // Desktop side (M2 production call).
    const desktopShared = deriveFcmSharedKey(desktop.secretKey, mobilePublicB64)
    // Mobile side (mobile e2ee deriveSharedKey(mobileSecret, desktopPublic) —
    // identical tweetnacl call to the shared deriveSharedKey used here).
    const mobileShared = deriveSharedKey(mobile.secretKey, publicKeyFromBase64(desktopPublicB64))

    expect(Array.from(mobileShared)).toEqual(Array.from(desktopShared))
    expect(mobileShared.length).toBe(32)
  })

  it('desktop-encrypt (M2) -> mobile-decrypt recovers the byte-identical original', () => {
    // Why: AC-FCM-003 mobile half — the load-bearing round-trip. M2 produces a
    // base64 [nonce+ciphertext] bundle; the mobile decrypt consumes that exact
    // bundle format and recovers the original payload, proving the bundle format
    // matches across the two platforms.
    const desktop = generateKeyPair()
    const mobile = generateKeyPair()
    const desktopShared = deriveFcmSharedKey(desktop.secretKey, publicKeyToBase64(mobile.publicKey))
    const mobileShared = deriveSharedKey(mobile.secretKey, desktop.publicKey)

    const original = { title: 'Task done', body: 'ci green', metadata: { ts: 42 } }
    const outcome = encryptPushPayload(original, desktopShared)
    expect(outcome.status).toBe('ok')
    const ciphertextB64 = (outcome as { ciphertextB64: string }).ciphertextB64

    // Mobile decrypt: base64 bundle -> plaintext (mobile e2ee decrypt path).
    const plaintextJson = decrypt(ciphertextB64, mobileShared)
    expect(plaintextJson).not.toBeNull()
    expect(JSON.parse(plaintextJson!)).toEqual(original)
  })

  it('round-trips without any WebSocket session key (WS-independent derivation)', () => {
    // Why: AC-FCM-003 #3 — the persistent FCM key is derived from long-lived
    // material, not the ephemeral per-connection WS keypair. The round-trip
    // succeeds with zero reference to any WS session key.
    const desktop = generateKeyPair()
    const mobile = generateKeyPair()
    const shared = deriveSharedKey(mobile.secretKey, desktop.publicKey)
    const bundle = encryptBytes(new TextEncoder().encode('payload'), shared)
    const b64 = Buffer.from(bundle).toString('base64')
    expect(decrypt(b64, shared)).toBe('payload')
  })

  it('persistent FCM key is distinct from a WS ephemeral session key (REQ-FCM-019)', () => {
    // Why: forward secrecy — the WS session key is discarded on disconnect and
    // MUST be a different key from the persistent FCM-shared key. A new ephemeral
    // pair (as rpc-client.ts generates per WS connect) derives a different shared
    // key than the persistent pair.
    const desktop = generateKeyPair()
    const mobilePersistent = generateKeyPair()
    const ephemeral = generateKeyPair()

    const fcmKey = deriveSharedKey(mobilePersistent.secretKey, desktop.publicKey)
    const wsSessionKey = deriveSharedKey(ephemeral.secretKey, desktop.publicKey)
    expect(Array.from(wsSessionKey)).not.toEqual(Array.from(fcmKey))
  })

  it('derivation is reproducible — same keypair pair always yields the same 32-byte key', () => {
    // Why: AC-FCM-003 #5 — re-deriving from the same persistent keypair pair
    // MUST produce the identical key every time (WS-connection-state independent).
    // This is what lets the desktop encrypt offline (WS down) and the mobile
    // decrypt later without any live handshake.
    const desktop = generateKeyPair()
    const mobile = generateKeyPair()
    const first = deriveSharedKey(mobile.secretKey, desktop.publicKey)
    const second = deriveSharedKey(mobile.secretKey, desktop.publicKey)
    expect(Array.from(first)).toEqual(Array.from(second))
  })

  it('uses a fresh 24-byte nonce per message (REQ-FCM-005 nonce uniqueness)', () => {
    // Why: nonce reuse with XSalsa20 breaks confidentiality. M2 generates a fresh
    // random nonce inside each encryptBytes call; across N encrypts of the SAME
    // plaintext, the decoded bundles MUST carry N distinct 24-byte nonces.
    const desktop = generateKeyPair()
    const mobile = generateKeyPair()
    const shared = deriveSharedKey(desktop.secretKey, mobile.publicKey)

    const nonces = new Set<string>()
    const iterations = 32
    for (let i = 0; i < iterations; i += 1) {
      const outcome = encryptPushPayload({ title: 'same', body: 'same' }, shared)
      expect(outcome.status).toBe('ok')
      const bundle = Buffer.from((outcome as { ciphertextB64: string }).ciphertextB64, 'base64')
      // Why: nonceLength is 24 for XSalsa20. Slice the header and record its hex.
      expect(bundle.length).toBeGreaterThanOrEqual(nacl.box.nonceLength)
      const nonce = bundle.subarray(0, nacl.box.nonceLength).toString('hex')
      nonces.add(nonce)
    }
    expect(nonces.size).toBe(iterations)
  })
})
