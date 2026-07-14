// Desktop-side crypto for the FCM supplemental push channel (SPEC-FCM-001, M2).
//
// Why: when no mobile WebSocket subscriber is connected, Orca sends the
// notification through FCM (or APNs brokered via FCM). The FCM `data` field is
// a plain string map with a ~4KB cap, so the notification payload is
// application-layer encrypted with a persistent FCM-shared key and carried as a
// base64 ciphertext. Mobile decrypts with the same derived key (M5).
//
// The persistent FCM-shared key is derived from the desktop's long-lived
// E2EE keypair secret and the mobile's long-lived public key — independent of
// the per-connection ephemeral WS session key, so WebSocket forward secrecy is
// preserved (REQ-FCM-019). This mirrors the WS derivation in
// rpc/e2ee-channel.ts (deriveSharedKey(serverSecretKey, clientPublicKey)) but
// uses persistent material instead of an ephemeral keypair.
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { deriveSharedKey, encryptBytes, publicKeyFromBase64 } from '../../shared/e2ee-crypto'

// Why: the FCM `data` field carries a base64 ciphertext and is capped near 4KB.
// Enforcing it here guarantees no oversized/malformed FCM message is emitted
// (REQ-FCM-006 / AC-FCM-008).
export const FCM_DATA_MAX_BYTES = 4096

export type PushPayloadInput = {
  title: string
  body: string
  // Why: low-priority extra fields (urls, severity, timestamps) dropped first
  // when the encrypted payload would exceed the FCM data cap.
  metadata?: Record<string, unknown>
  // Why (#9 deeplink parity): carried INSIDE the encrypted payload so an FCM
  // notification tap can route to the origin worktree exactly like the WS path.
  // Optional — omitted when the source event has no worktree (e.g. global alerts).
  worktreeId?: string
  source?: string
}

export type PushEncryptOutcome =
  | { status: 'ok'; ciphertextB64: string }
  | { status: 'truncated'; ciphertextB64: string; droppedFields: string[] }
  | { status: 'dropped'; reason: string }

const IOS_ENVELOPE_VERSION = 1
const IOS_NONCE_BYTES = 12
const IOS_AUTH_TAG_BYTES = 16
const IOS_AUTHENTICATED_DATA = Buffer.from('orca-ios-push-v1', 'utf8')

// Why: derive the persistent FCM-shared key from desktop persistent secret +
// mobile persistent public key. The (secret, public) arg order matches the WS
// path's deriveSharedKey(serverSecretKey, clientPublicKey) call exactly.
export function deriveFcmSharedKey(
  desktopPersistentSecret: Uint8Array,
  mobilePublicKeyB64: string
): Uint8Array {
  const mobilePublic = publicKeyFromBase64(mobilePublicKeyB64)
  return deriveSharedKey(desktopPersistentSecret, mobilePublic)
}

function encryptPayloadToB64(payload: PushPayloadInput, sharedKey: Uint8Array): string {
  const json = JSON.stringify(payload)
  const bundle = encryptBytes(new TextEncoder().encode(json), sharedKey)
  return Buffer.from(bundle).toString('base64')
}

function encryptIosPayloadToB64(payload: PushPayloadInput, sharedKey: Uint8Array): string {
  const nonce = randomBytes(IOS_NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', sharedKey, nonce)
  cipher.setAAD(IOS_AUTHENTICATED_DATA)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  const bundle = Buffer.concat([
    Buffer.from([IOS_ENVELOPE_VERSION]),
    nonce,
    ciphertext,
    cipher.getAuthTag()
  ])
  return bundle.toString('base64')
}

export function derivePushKeyId(sharedKey: Uint8Array): string {
  return createHash('sha256').update(sharedKey).digest('hex')
}

type PayloadEncryptor = (payload: PushPayloadInput, sharedKey: Uint8Array) => string

// Why: find the longest body prefix (by UTF-16 code units) whose encrypted
// base64 form fits under maxBytes, holding title fixed. Title outranks body, so
// body is shortened before title is touched. Binary search keeps this O(log n)
// encryptions for an over-long body.
function findMaxBodyLength(
  title: string,
  body: string,
  sharedKey: Uint8Array,
  maxBytes: number,
  encryptPayload: PayloadEncryptor
): number {
  let lo = 0
  let hi = body.length
  let best = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const b64 = encryptPayload({ title, body: body.slice(0, mid) }, sharedKey)
    if (b64.length <= maxBytes) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

// Why: priority-based graceful degradation for the 4KB cap (AC-FCM-008). Fields
// are shed in priority order — title (keep), body (keep/truncate), metadata
// (drop first). If even the title alone exceeds the cap, the send is dropped so
// no malformed FCM message is emitted (REQ-FCM-006).
function encryptPushPayloadWith(
  payload: PushPayloadInput,
  sharedFcmKey: Uint8Array,
  maxBytes: number,
  encryptPayload: PayloadEncryptor
): PushEncryptOutcome {
  const full = encryptPayload(payload, sharedFcmKey)
  if (full.length <= maxBytes) {
    return { status: 'ok', ciphertextB64: full }
  }

  const metadataKeys = payload.metadata ? Object.keys(payload.metadata) : []
  const droppedFields: string[] = [...metadataKeys]

  // Drop all metadata first, keep title + body intact.
  if (metadataKeys.length > 0) {
    const withoutMeta: PushPayloadInput = { title: payload.title, body: payload.body }
    const trimmed = encryptPayload(withoutMeta, sharedFcmKey)
    if (trimmed.length <= maxBytes) {
      return { status: 'truncated', ciphertextB64: trimmed, droppedFields }
    }
  }

  // Still over: title alone must fit, otherwise the send is dropped.
  const titleOnly = encryptPayload({ title: payload.title, body: '' }, sharedFcmKey)
  if (titleOnly.length > maxBytes) {
    return {
      status: 'dropped',
      reason: `notification title (${payload.title.length} chars) exceeds the ${maxBytes}-byte FCM data cap`
    }
  }

  // Title fits: truncate the body to the largest prefix that fits.
  const maxBodyLen = findMaxBodyLength(
    payload.title,
    payload.body,
    sharedFcmKey,
    maxBytes,
    encryptPayload
  )
  const trimmed = encryptPayload(
    { title: payload.title, body: payload.body.slice(0, maxBodyLen) },
    sharedFcmKey
  )
  if (trimmed.length <= maxBytes) {
    if (maxBodyLen < payload.body.length) {
      droppedFields.push('body')
    }
    return { status: 'truncated', ciphertextB64: trimmed, droppedFields }
  }

  return {
    status: 'dropped',
    reason: 'notification payload exceeds the FCM data cap even after truncation'
  }
}

export function encryptPushPayload(
  payload: PushPayloadInput,
  sharedFcmKey: Uint8Array,
  maxBytes: number = FCM_DATA_MAX_BYTES
): PushEncryptOutcome {
  return encryptPushPayloadWith(payload, sharedFcmKey, maxBytes, encryptPayloadToB64)
}

export function encryptIosPushPayload(
  payload: PushPayloadInput,
  sharedFcmKey: Uint8Array,
  maxBytes: number = FCM_DATA_MAX_BYTES
): PushEncryptOutcome {
  // Why: iOS extensions can open AES-GCM with CryptoKit without loading the JS
  // runtime; Android retains the existing NaCl envelope and in-app receiver.
  return encryptPushPayloadWith(payload, sharedFcmKey, maxBytes, encryptIosPayloadToB64)
}

export const IOS_PUSH_ENVELOPE = {
  version: IOS_ENVELOPE_VERSION,
  nonceBytes: IOS_NONCE_BYTES,
  authTagBytes: IOS_AUTH_TAG_BYTES,
  authenticatedData: IOS_AUTHENTICATED_DATA.toString('utf8')
} as const
