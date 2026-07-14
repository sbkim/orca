// Why: FCM data -> local decrypt for the supplemental push channel
// (SPEC-FCM-001, M5). FCM data-only messages (no `notification` field) are
// delivered to the app and handled in-app, so the OS never sees plaintext and
// E2EE is preserved. The mobile re-derives the persistent FCM-shared key
// (mobilePersistentSecret x desktopPersistentPublic) and decrypts the base64
// ciphertext carried in the FCM `data.payload` field, recovering the original
// {title, body, ...}.
//
// This is the ECDH peer of M2's desktop derivation
// (desktopPersistentSecret x mobilePersistentPublic): nacl.box.before is
// symmetric, so box.before(desktopPublic, mobileSecret) ===
// box.before(mobilePublic, desktopSecret) — both halves yield the same 32-byte
// key (AC-FCM-003). The key is derived from PERSISTENT material
// (M1 push-keypair secret + the host's publicKeyB64 from the pairing QR), NEVER
// the per-connection WS ephemeral session key, so WebSocket forward secrecy is
// preserved (REQ-FCM-019).
//
// Bundle format: M2 encryptBytes produces [24-byte nonce][ciphertext] and
// base64-encodes the whole bundle into data.payload. The mobile e2ee decrypt
// consumes that same nonce+ciphertext bundle unchanged (the nonce is read from
// the bundle header — never hardcoded or reused; M2 generates a fresh 24-byte
// nonce per message, REQ-FCM-005).
import { decrypt, deriveSharedKey, publicKeyFromBase64 } from '../transport/e2ee'

export type DecryptedPushPayload = {
  title: string
  body: string
  // Why: M2 may shed metadata to fit the 4KB FCM data cap (AC-FCM-008), so it
  // is optional on the receiving side.
  metadata?: Record<string, unknown>
  // Why (#9 deeplink parity): desktop includes these as TOP-LEVEL fields in the
  // encrypted payload so an FCM tap can route to the origin worktree. Optional —
  // absent for global alerts or older senders that did not include them.
  worktreeId?: string
  source?: string
}

export type PushDecryptOutcome =
  | { status: 'ok'; payload: DecryptedPushPayload }
  | { status: 'error'; reason: string }

// Why: derives the persistent FCM-shared key from the mobile persistent secret
// (M1 push-keypair secretKeyB64) and the desktop persistent public key
// (host.publicKeyB64 — present in the pairing QR / E2EE handshake, persisted in
// the host store). The (secret, public) arg order is the mirror of M2's
// deriveFcmSharedKey(desktopSecret, mobilePublic); box.before symmetry makes the
// two halves equal regardless of which side holds the secret.
export function deriveMobileFcmSharedKey(
  mobilePersistentSecret: Uint8Array,
  desktopPersistentPublicB64: string
): Uint8Array {
  const desktopPublic = publicKeyFromBase64(desktopPersistentPublicB64)
  return deriveSharedKey(mobilePersistentSecret, desktopPublic)
}

// Why: decrypts the M2-format base64 bundle and recovers {title, body, metadata?}.
// Returns an explicit outcome rather than throwing so the receiver can log and
// move on without surfacing a decrypt fault to the user (a tampered/wrong-key
// payload simply yields no local notification).
export function decryptPushPayload(
  payloadB64: string,
  sharedFcmKey: Uint8Array
): PushDecryptOutcome {
  const json = decrypt(payloadB64, sharedFcmKey)
  if (json === null) {
    // Why: decrypt returns null on tampering, truncation, or a wrong shared key
    // (Poly1305 auth failure). The receiver treats this as "not for this host"
    // and tries the next host, or drops if none match.
    return { status: 'error', reason: 'decryption failed (tampered, truncated, or wrong key)' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { status: 'error', reason: 'decrypted payload is not valid JSON' }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { status: 'error', reason: 'decrypted payload did not decode to an object' }
  }

  const obj = parsed as Record<string, unknown>
  if (typeof obj.title !== 'string' || typeof obj.body !== 'string') {
    // Why: title/body are the only fields M4 always sends; both are required for
    // a local notification. Rejecting a half-payload avoids a title-less banner.
    return { status: 'error', reason: 'decrypted payload missing required title/body' }
  }

  const payload: DecryptedPushPayload = { title: obj.title, body: obj.body }
  if (obj.metadata !== undefined) {
    payload.metadata = obj.metadata as Record<string, unknown>
  }
  // Why (#9): surface deeplink fields only when present + well-typed, so a
  // payload from an older sender (no worktreeId) degrades cleanly to undefined.
  if (typeof obj.worktreeId === 'string') {
    payload.worktreeId = obj.worktreeId
  }
  if (typeof obj.source === 'string') {
    payload.source = obj.source
  }
  return { status: 'ok', payload }
}
