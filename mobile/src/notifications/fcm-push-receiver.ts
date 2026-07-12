// Why: orchestration for an inbound FCM data-only message on the mobile
// (SPEC-FCM-001, M5). FCM data-only messages (no `notification` field) are
// delivered to the app and handled in-app, so the OS never sees plaintext and
// E2EE is preserved. This module:
//   1. loads the mobile persistent push secret (M1 push-keypair secretKeyB64);
//   2. loads paired hosts (each carries the desktop persistent public key as
//      host.publicKeyB64 — present in the pairing QR / E2EE handshake);
//   3. for each host, derives the persistent FCM-shared key (mobile persistent
//      secret x desktop persistent public) and attempts to decrypt the base64
//      ciphertext carried in data.payload — the FIRST host whose key decrypts
//      the payload is the origin (FCM data carries no hostId, so the matching
//      key is the disambiguator); wrong-host keys fail Poly1305 auth cleanly;
//   4. routes the decrypted {title, body} through the EXISTING
//      showLocalNotification path, which owns the single-notificationId dedupe
//      map (AC-FCM-005) and the permission/toggle gate (AC-FCM-009).
//
// The shared key uses PERSISTENT material only — never the per-connection WS
// ephemeral session key — so WebSocket forward secrecy is preserved
// (REQ-FCM-019). The decrypt primitive + ECDH symmetry are proven in
// push-payload-decrypt.test.ts and fcm-payload-cross-platform.test.ts.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { loadHosts } from '../transport/host-store'
import {
  decryptPushPayload,
  deriveMobileFcmSharedKey,
  type DecryptedPushPayload
} from './push-payload-decrypt'
import { showLocalNotification, type NotificationEvent } from './mobile-notifications'

// Why: M1 contract — push-keypair.ts persists the long-lived Curve25519 pair at
// this key as {secretKeyB64, publicKeyB64}. The receiver consumes that record
// READ-ONLY (push-keypair.ts is intentionally not modified) to load the mobile
// persistent secret half of the FCM shared-key derivation.
const PUSH_KEYPAIR_STORAGE_KEY = 'orca:push-keypair'

type PushKeypairRecord = {
  secretKeyB64?: string
  publicKeyB64?: string
}

// Why: the FCM v1 `data` map is a string->string map. M3/M4 emit exactly two
// fields: `payload` (M2 base64 ciphertext) and `notificationId` (single-namespace
// dedupe id shared with the WS path). Both arrive as strings; defensive coercion
// rejects anything malformed rather than crashing the receiver.
export type FcmDataMessage = {
  payload?: unknown
  notificationId?: unknown
}

// Why: decode the persisted base64 secret into raw bytes. Mirrors the encoding
// in e2ee.ts (base64 over a 32-byte key) without importing the RN-bound e2ee
// module here — the secret is a plain 32-byte scalar, not a public key, so the
// 32-byte length check from publicKeyFromBase64 does not apply.
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// Why: loads the mobile persistent secret. Returns null when absent/malformed so
// the receiver degrades to a clean no-op (a device that never registered a push
// keypair simply cannot decrypt FCM payloads — never a crash).
async function loadMobilePersistentSecret(): Promise<Uint8Array | null> {
  const raw = await AsyncStorage.getItem(PUSH_KEYPAIR_STORAGE_KEY)
  if (!raw) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const record = parsed as PushKeypairRecord
  if (typeof record?.secretKeyB64 !== 'string' || record.secretKeyB64.length === 0) {
    return null
  }
  try {
    return base64ToBytes(record.secretKeyB64)
  } catch {
    return null
  }
}

// Why: FCM data carries no hostId, so the origin host is identified by which
// host's desktop persistent public key yields a successful decrypt. Each host
// produces a distinct shared key; a wrong key fails Poly1305 authentication and
// decryptPushPayload returns error. With the typical single paired host this is
// one derivation + one decrypt attempt.
type HostWithPublicKey = {
  id: string
  publicKeyB64: string
}

async function findOriginHostAndPayload(
  mobileSecret: Uint8Array,
  hosts: readonly HostWithPublicKey[],
  payloadB64: string
): Promise<{ hostId: string; payload: DecryptedPushPayload } | null> {
  for (const host of hosts) {
    const sharedKey = deriveMobileFcmSharedKey(mobileSecret, host.publicKeyB64)
    const outcome = decryptPushPayload(payloadB64, sharedKey)
    if (outcome.status === 'ok') {
      return { hostId: host.id, payload: outcome.payload }
    }
    // Why: wrong key / tampered payload for this host — try the next. A clean
    // auth failure is the expected outcome for every non-origin host.
  }
  return null
}

// Why: entry point invoked by the expo-notifications handler registered in
// app/_layout.tsx. Fire-and-forget-safe: never throws (a decrypt/storage fault
// is contained so the OS push delivery callback is never destabilized).
export async function handleFcmDataNotification(data: FcmDataMessage): Promise<void> {
  if (typeof data.payload !== 'string' || data.payload.length === 0) {
    return
  }
  if (typeof data.notificationId !== 'string' || data.notificationId.length === 0) {
    // Why: without notificationId there is no dedupe key, and the WS/FCM
    // cross-channel dedupe (AC-FCM-005) depends on it. Drop rather than risk a
    // duplicate that cannot be suppressed.
    return
  }

  const mobileSecret = await loadMobilePersistentSecret()
  if (!mobileSecret) {
    return
  }

  const hosts = await loadHosts().catch(() => [] as Awaited<ReturnType<typeof loadHosts>>)
  if (hosts.length === 0) {
    return
  }

  const origin = await findOriginHostAndPayload(mobileSecret, hosts, data.payload)
  if (!origin) {
    // Why: no paired host's key could decrypt — either a foreign payload or a
    // host whose desktop persistent public key is stale. Silently drop; the WS
    // path (if it reconnects) will re-deliver the canonical notification.
    return
  }

  // Why: route through the SAME local-notification path as the WS subscriber so
  // the single-notificationId dedupe map (AC-FCM-005) and the permission/toggle
  // gate (AC-FCM-009) apply identically to FCM-delivered notifications. M4's
  // fan-out encrypts only {title, body}, so source/worktreeId are not carried —
  // 'fcm-supplemental' records the transport honestly as metadata.
  const event: NotificationEvent = {
    type: 'notification',
    source: 'fcm-supplemental',
    title: origin.payload.title,
    body: origin.payload.body,
    notificationId: data.notificationId
  }
  await showLocalNotification(event, origin.hostId)
}
