// Tests for the desktop-side FCM push payload crypto (SPEC-FCM-001, M2).
// Mobile decryption is M5; these tests verify the desktop encrypt half plus
// the persistent FCM-shared key derivation, using the shared decryptBytes
// primitive to prove the round-trip on the desktop side.
import { describe, expect, it } from 'vitest'
import { decryptBytes, deriveSharedKey, generateKeyPair } from '../../shared/e2ee-crypto'
import {
  FCM_DATA_MAX_BYTES,
  deriveFcmSharedKey,
  encryptPushPayload,
  type PushPayloadInput
} from './push-payload-crypto'

// Why: a hex comparator avoids Uint8Array referential/identity pitfalls in
// deep-equality assertions on key material.
function toHex(key: Uint8Array): string {
  return Buffer.from(key).toString('hex')
}

function makeTestKeypairs(): {
  desktop: naclBoxKeyPair
  mobile: naclBoxKeyPair
  mobilePublicKeyB64: string
} {
  const desktop = generateKeyPair()
  const mobile = generateKeyPair()
  const mobilePublicKeyB64 = Buffer.from(mobile.publicKey).toString('base64')
  return { desktop, mobile, mobilePublicKeyB64 }
}

type naclBoxKeyPair = ReturnType<typeof generateKeyPair>

// Why: mirrors what M5 (mobile decrypt) will do — base64-decode the FCM data
// field, decrypt with the same shared key, JSON-parse the payload. Using it
// here proves the desktop ciphertext is consumable by the mobile half.
function decryptPayload(ciphertextB64: string, sharedKey: Uint8Array): PushPayloadInput {
  const bundle = Uint8Array.from(Buffer.from(ciphertextB64, 'base64'))
  const plaintext = decryptBytes(bundle, sharedKey)
  if (!plaintext) {
    throw new Error('decryption returned null — wrong key or tampered ciphertext')
  }
  return JSON.parse(new TextDecoder().decode(plaintext)) as PushPayloadInput
}

describe('deriveFcmSharedKey', () => {
  it('returns a 32-byte shared key', () => {
    const { desktop, mobilePublicKeyB64 } = makeTestKeypairs()
    const key = deriveFcmSharedKey(desktop.secretKey, mobilePublicKeyB64)
    expect(key.length).toBe(32)
  })

  it('is reproducible: same keypair pair yields the same key every call', () => {
    const { desktop, mobilePublicKeyB64 } = makeTestKeypairs()
    const a = deriveFcmSharedKey(desktop.secretKey, mobilePublicKeyB64)
    const b = deriveFcmSharedKey(desktop.secretKey, mobilePublicKeyB64)
    expect(toHex(a)).toBe(toHex(b))
  })

  it('matches the ECDH symmetric derivation (mobile can derive the same key for M5 decrypt)', () => {
    // Why: nacl.box.before(peerPublic, ourSecret) is symmetric in the pair —
    // desktop(desktopSecret, mobilePublic) === mobile(mobileSecret, desktopPublic).
    // This is what makes the M5 mobile-decrypt half of AC-FCM-003 possible.
    const { desktop, mobile, mobilePublicKeyB64 } = makeTestKeypairs()
    const desktopDerived = deriveFcmSharedKey(desktop.secretKey, mobilePublicKeyB64)
    const mobileDerived = deriveSharedKey(mobile.secretKey, desktop.publicKey)
    expect(toHex(desktopDerived)).toBe(toHex(mobileDerived))
  })

  it('is independent of the ephemeral WS session key (REQ-FCM-019 forward secrecy)', () => {
    const { desktop, mobile, mobilePublicKeyB64 } = makeTestKeypairs()
    // Persistent FCM-shared key from persistent materials only.
    const fcmKey = deriveFcmSharedKey(desktop.secretKey, mobilePublicKeyB64)
    // Ephemeral WS session key: a fresh per-connection desktop keypair (the WS
    // path in e2ee-channel.ts derives from an ephemeral keypair, not this one).
    const ephemeralDesktop = generateKeyPair()
    const wsSessionKey = deriveSharedKey(ephemeralDesktop.secretKey, mobile.publicKey)
    expect(toHex(fcmKey)).not.toBe(toHex(wsSessionKey))
    // Why: re-deriving with a second ephemeral keypair in play must not change
    // the persistent FCM key — proves it never depends on ephemeral material.
    const anotherEphemeral = generateKeyPair()
    const wsSessionKey2 = deriveSharedKey(anotherEphemeral.secretKey, mobile.publicKey)
    const fcmKeyAgain = deriveFcmSharedKey(desktop.secretKey, mobilePublicKeyB64)
    expect(toHex(fcmKeyAgain)).toBe(toHex(fcmKey))
    expect(toHex(wsSessionKey)).not.toBe(toHex(wsSessionKey2))
  })

  it('throws when mobilePublicKeyB64 is not a 32-byte Curve25519 public key', () => {
    const { desktop } = makeTestKeypairs()
    const bad = Buffer.from('not-a-32-byte-public-key').toString('base64')
    expect(() => deriveFcmSharedKey(desktop.secretKey, bad)).toThrow()
  })
})

describe('encryptPushPayload round-trip', () => {
  it('round-trips a normal payload (title / body / metadata) byte-for-byte', () => {
    const { desktop, mobilePublicKeyB64 } = makeTestKeypairs()
    const shared = deriveFcmSharedKey(desktop.secretKey, mobilePublicKeyB64)
    const payload: PushPayloadInput = {
      title: 'Build failed',
      body: 'main failed CI on commit abc123',
      metadata: { url: '/run/123', severity: 'error', ts: 1234567890 }
    }
    const out = encryptPushPayload(payload, shared)
    expect(out.status).toBe('ok')
    if (out.status !== 'ok') {
      return
    }
    const decoded = decryptPayload(out.ciphertextB64, shared)
    expect(decoded).toEqual(payload)
  })

  it('round-trips unicode content in title and body', () => {
    const { desktop, mobilePublicKeyB64 } = makeTestKeypairs()
    const shared = deriveFcmSharedKey(desktop.secretKey, mobilePublicKeyB64)
    const payload: PushPayloadInput = { title: '빌드 실패 🚨', body: '커밋 日本語 🎉 émojis' }
    const out = encryptPushPayload(payload, shared)
    expect(out.status).toBe('ok')
    if (out.status !== 'ok') {
      return
    }
    expect(decryptPayload(out.ciphertextB64, shared)).toEqual(payload)
  })

  it('decryption with a wrong key fails (decryptBytes returns null)', () => {
    const { desktop, mobilePublicKeyB64 } = makeTestKeypairs()
    const shared = deriveFcmSharedKey(desktop.secretKey, mobilePublicKeyB64)
    const out = encryptPushPayload({ title: 'T', body: 'B' }, shared)
    if (out.status === 'dropped') {
      throw new Error('unexpected drop for tiny payload')
    }
    const bundle = Uint8Array.from(Buffer.from(out.ciphertextB64, 'base64'))
    const wrongKey = deriveFcmSharedKey(generateKeyPair().secretKey, mobilePublicKeyB64)
    expect(decryptBytes(bundle, wrongKey)).toBeNull()
  })
})

describe('encryptPushPayload nonce freshness (REQ-FCM-005)', () => {
  it('each encryption produces a distinct 24-byte nonce', () => {
    const { desktop, mobilePublicKeyB64 } = makeTestKeypairs()
    const shared = deriveFcmSharedKey(desktop.secretKey, mobilePublicKeyB64)
    const payload: PushPayloadInput = { title: 'T', body: 'B' }
    const nonces = new Set<string>()
    const N = 50
    for (let i = 0; i < N; i++) {
      const out = encryptPushPayload(payload, shared)
      if (out.status === 'dropped') {
        throw new Error('unexpected drop')
      }
      const bundle = Uint8Array.from(Buffer.from(out.ciphertextB64, 'base64'))
      const nonce = bundle.slice(0, 24)
      expect(nonce.length).toBe(24)
      nonces.add(Buffer.from(nonce).toString('base64'))
    }
    // Why: a collision here would mean nonce reuse — catastrophic for box
    // confidentiality. N distinct nonces across N encrypts proves freshness.
    expect(nonces.size).toBe(N)
  })
})

describe('encryptPushPayload 4KB limit (AC-FCM-008)', () => {
  it('FCM_DATA_MAX_BYTES is 4096', () => {
    expect(FCM_DATA_MAX_BYTES).toBe(4096)
  })

  it('a small payload is ok and the ciphertext fits under 4096', () => {
    const { desktop, mobilePublicKeyB64 } = makeTestKeypairs()
    const shared = deriveFcmSharedKey(desktop.secretKey, mobilePublicKeyB64)
    const out = encryptPushPayload({ title: 'hi', body: 'small payload' }, shared)
    expect(out.status).toBe('ok')
    if (out.status !== 'ok') {
      return
    }
    expect(out.ciphertextB64.length).toBeLessThanOrEqual(FCM_DATA_MAX_BYTES)
  })

  it('drops metadata before truncating body', () => {
    const { desktop, mobilePublicKeyB64 } = makeTestKeypairs()
    const shared = deriveFcmSharedKey(desktop.secretKey, mobilePublicKeyB64)
    const out = encryptPushPayload(
      { title: 'T', body: 'B', metadata: { big: 'x'.repeat(4000) } },
      shared
    )
    expect(out.status).toBe('truncated')
    if (out.status !== 'truncated') {
      return
    }
    expect(out.droppedFields).toContain('big')
    expect(out.ciphertextB64.length).toBeLessThanOrEqual(FCM_DATA_MAX_BYTES)
    const decoded = decryptPayload(out.ciphertextB64, shared)
    expect(decoded.title).toBe('T')
    expect(decoded.body).toBe('B')
    expect(decoded.metadata).toBeUndefined()
  })

  it('truncates body when metadata is absent and the body is too large', () => {
    const { desktop, mobilePublicKeyB64 } = makeTestKeypairs()
    const shared = deriveFcmSharedKey(desktop.secretKey, mobilePublicKeyB64)
    // 4000 ASCII chars -> plaintext ~4KB -> base64 ~5.4KB, over the 4096 cap.
    const out = encryptPushPayload({ title: 'T', body: 'a'.repeat(4000) }, shared)
    expect(out.status).toBe('truncated')
    if (out.status !== 'truncated') {
      return
    }
    expect(out.ciphertextB64.length).toBeLessThanOrEqual(FCM_DATA_MAX_BYTES)
    expect(out.droppedFields).toContain('body')
    const decoded = decryptPayload(out.ciphertextB64, shared)
    expect(decoded.title).toBe('T')
    expect(decoded.body.length).toBeLessThan(4000)
  })

  it('drops the send when title alone exceeds the 4096 cap', () => {
    const { desktop, mobilePublicKeyB64 } = makeTestKeypairs()
    const shared = deriveFcmSharedKey(desktop.secretKey, mobilePublicKeyB64)
    const out = encryptPushPayload({ title: 't'.repeat(4000), body: '' }, shared)
    expect(out.status).toBe('dropped')
    if (out.status === 'dropped') {
      expect(out.reason.length).toBeGreaterThan(0)
    }
  })

  it('at the real 4096 boundary: fits at N, truncates at N+1 (no malformed output)', () => {
    const { desktop, mobilePublicKeyB64 } = makeTestKeypairs()
    const shared = deriveFcmSharedKey(desktop.secretKey, mobilePublicKeyB64)
    // Why: binary-search the max ASCII body length N such that {title:'T', body:'a'*N}
    // encrypts to <= 4096 base64 chars. N fits ('ok'); N+1 must truncate.
    const fits = (n: number): boolean =>
      encryptPushPayload({ title: 'T', body: 'a'.repeat(n) }, shared).status === 'ok'
    let lo = 0
    let hi = 5000
    let best = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (fits(mid)) {
        best = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    expect(best).toBeGreaterThan(0)
    expect(encryptPushPayload({ title: 'T', body: 'a'.repeat(best) }, shared).status).toBe('ok')
    const over = encryptPushPayload({ title: 'T', body: 'a'.repeat(best + 1) }, shared)
    expect(over.status).toBe('truncated')
    if (over.status === 'truncated') {
      expect(over.ciphertextB64.length).toBeLessThanOrEqual(FCM_DATA_MAX_BYTES)
      // No malformed output: the truncated ciphertext decrypts cleanly.
      const decoded = decryptPayload(over.ciphertextB64, shared)
      expect(decoded.title).toBe('T')
    }
  })

  it('a configurable smaller maxBytes drives deterministic ok/truncate/drop', () => {
    const { desktop, mobilePublicKeyB64 } = makeTestKeypairs()
    const shared = deriveFcmSharedKey(desktop.secretKey, mobilePublicKeyB64)
    // Fits under a small limit.
    const ok = encryptPushPayload({ title: 'T', body: 'a'.repeat(10) }, shared, 200)
    expect(ok.status).toBe('ok')
    // Over the small limit with metadata -> truncated (metadata dropped).
    const trunc = encryptPushPayload(
      { title: 'T', body: 'a'.repeat(10), metadata: { k: 'v'.repeat(100) } },
      shared,
      200
    )
    expect(trunc.status === 'truncated' || trunc.status === 'dropped').toBe(true)
    if (trunc.status === 'truncated') {
      expect(trunc.ciphertextB64.length).toBeLessThanOrEqual(200)
    }
    // Title alone over the small limit -> dropped.
    const dropped = encryptPushPayload(
      { title: 'this title is far too long for such a tiny limit', body: '' },
      shared,
      80
    )
    expect(dropped.status).toBe('dropped')
  })

  it('never emits a malformed ciphertext: every non-dropped outcome decrypts cleanly', () => {
    const { desktop, mobilePublicKeyB64 } = makeTestKeypairs()
    const shared = deriveFcmSharedKey(desktop.secretKey, mobilePublicKeyB64)
    const payloads: PushPayloadInput[] = [
      { title: 'a', body: 'b' },
      { title: 'a', body: 'b', metadata: { k: 'v', n: 1 } },
      { title: 'a', body: 'x'.repeat(2000) },
      { title: 'a', body: 'x'.repeat(2000), metadata: { big: 'y'.repeat(2000) } }
    ]
    for (const payload of payloads) {
      const out = encryptPushPayload(payload, shared)
      if (out.status === 'dropped') {
        continue
      }
      // Must base64-decode and decrypt without throwing.
      const decoded = decryptPayload(out.ciphertextB64, shared)
      expect(typeof decoded.title).toBe('string')
      expect(typeof decoded.body).toBe('string')
    }
  })
})
