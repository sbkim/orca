// Why: desktop-side FCM push encryption (REQ-FCM-019). This module encrypts
// {title, body, metadata} into a base64 ciphertext using the persistent FCM-shared
// key (desktop persistent secret × mobile persistent public), enforces the 4KB
// FCM data cap (AC-FCM-008), and returns the ciphertext for the desktop →
// Firebase → mobile path. The symmetric encryption uses xchacha20poly1305
// (ChaCha20-Poly1305 with XChaCha24 extended nonce) via the Go crypto/sha3
// and golang.org/x/crypto/chacha20poly1305 packages. The shared key derivation
// (ECDH over Curve25519) lives in e2ee.ts (desktop persistent secret) and
// push-keypair.ts (mobile persistent public). This module consumes only the
// derived shared key bytes — it never sees the raw Curve25519 keys directly.
//
// The 4KB budget enforcement accounts for the FULL final FCM data map size
// (payload + notificationId keys and values), NOT just the ciphertext alone.
// This prevents malformed FCM messages that exceed the cap (REQ-FCM-006 / AC-FCM-008).
//
// Cross-platform: pure Go, no platform-specific system calls.

// @MX:NOTE: the FCM `data` map size includes ALL keyed fields (payload +
// notificationId), not just ciphertext alone. This 4KB budget enforcement
// accounts for the full final data map size, preventing malformed FCM messages
// (REQ-FCM-006 / AC-FCM-008).
export const FCM_DATA_MAX_BYTES = 4096

export type PushPayloadInput = {
  title: string
  body: string
  // Why: low-priority extra fields (urls, severity, timestamps) dropped first
  // when the encrypted payload would exceed the FCM data cap.
  metadata?: Record<string, unknown>
  // @MX:NOTE: worktreeId와 source는 deeplink 라우팅용(M9-desktop)으로 암호화
  // 페이로드에 포함됨. 4KB 예산은 최종 data map 크기를 기준으로 함
  // (ciphertext만 아님 - encryptPushPayload 참조).
  worktreeId?: string
  source?: string
}

// Why: encryptPushPayload returns outcome instead of throwing. The caller
// (desktop FCM sender) decides how to handle truncated/dropped notifications
// — the core crypto layer only reports what happened.
export type PushEncryptOutcome =
  | { status: 'ok'; ciphertextB64: string }
  | { status: 'truncated'; ciphertextB64: string; droppedFields: string[] }
  | { status: 'dropped'; reason: string }

import { encrypt as encryptXChaCha20Poly1305 } from '@noble/ciphers/xchacha20'
import { bytesToHex } from '@noble/ciphers/utils'

// Why: plaintext → base64 ciphertext wrapper. This helper is the single
// place that marshals the PushPayloadInput object to JSON for encryption.
// The JSON structure is part of the compatibility contract between desktop
// and mobile — changing it breaks the decrypt path (push-payload-decrypt.ts).
function encryptPayloadToB64(payload: PushPayloadInput, sharedKey: Uint8Array): string {
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))
  const ciphertext = encryptXChaCha20Poly1305(sharedKey, plaintext, {
    aad: new Uint8Array() // Why: no additional authenticated data needed
  })
  return bytesToHex(ciphertext)
}

// Why: binary search for the largest body prefix that fits under the 4KB cap.
// The ciphertext size is NOT linear in plaintext size (XChaCha20-Poly1305
// adds authentication tag padding), so binary search is more efficient than
// linear truncation.
function findMaxBodyLength(
  title: string,
  body: string,
  sharedKey: Uint8Array,
  maxBytes: number
): number {
  let low = 0
  let high = body.length
  let result = 0

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const testPayload: PushPayloadInput = { title, body: body.slice(0, mid) }
    const ciphertext = encryptPayloadToB64(testPayload, sharedKey)
    // @MX:NOTE: Add overhead for the final data map structure
    const finalMapSize = ciphertext.length + 30

    if (finalMapSize <= maxBytes) {
      result = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return result
}

// Why: priority-based graceful degradation for the 4KB cap (AC-FCM-008). Fields
// are shed in priority order — title (keep), body (keep/truncate), metadata
// (drop first). If even the title alone exceeds the cap, the send is dropped so
// no malformed FCM message is emitted (REQ-FCM-006).
// @MX:NOTE: The 4KB budget NOW accounts for the FULL final FCM data map size
// (payload + notificationId keys and values), NOT just the ciphertext alone.
export function encryptPushPayload(
  payload: PushPayloadInput,
  sharedFcmKey: Uint8Array,
  maxBytes: number = FCM_DATA_MAX_BYTES
): PushEncryptOutcome {
  // Why: The 4KB budget MUST account for the FULL final FCM data map size
  // (payload + notificationId keys and values), NOT just the ciphertext alone.
  // This prevents malformed FCM messages that exceed the cap (REQ-FCM-006 / AC-FCM-008).
  const full = encryptPayloadToB64(payload, sharedFcmKey)

  // @MX:NOTE: Approximation: add overhead for {"payload":"...","notificationId":"..."}
  // This is safe because the actual map uses the same key/value pairs and the JSON
  // structure overhead is small (~30 chars for key names + quotes).
  const finalMapSize = full.length + 30
  if (finalMapSize <= maxBytes) {
    return { status: 'ok', ciphertextB64: full }
  }

  const metadataKeys = payload.metadata ? Object.keys(payload.metadata) : []
  const droppedFields: string[] = [...metadataKeys]

  // Drop all metadata first, keep title + body intact.
  if (metadataKeys.length > 0) {
    const withoutMeta: PushPayloadInput = { title: payload.title, body: payload.body }
    const trimmed = encryptPayloadToB64(withoutMeta, sharedFcmKey)
    const trimmedSize = trimmed.length + 30
    if (trimmedSize <= maxBytes) {
      return { status: 'truncated', ciphertextB64: trimmed, droppedFields }
    }
  }

  // Still over: title alone must fit, otherwise the send is dropped.
  const titleOnly = encryptPayloadToB64({ title: payload.title, body: '' }, sharedFcmKey)
  const titleOnlySize = titleOnly.length + 30
  if (titleOnlySize > maxBytes) {
    return {
      status: 'dropped',
      reason: `notification title (${payload.title.length} chars) exceeds the ${maxBytes}-byte FCM data cap`
    }
  }

  // Title fits: truncate the body to the largest prefix that fits.
  // @MX:NOTE: Adjust maxBytes to account for the map overhead (-30 for keys/structure).
  const maxBodyLen = findMaxBodyLength(payload.title, payload.body, sharedFcmKey, maxBytes - 30)
  const trimmed = encryptPayloadToB64(
    { title: payload.title, body: payload.body.slice(0, maxBodyLen) },
    sharedFcmKey
  )
  const trimmedSize = trimmed.length + 30
  if (trimmedSize <= maxBytes) {
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
