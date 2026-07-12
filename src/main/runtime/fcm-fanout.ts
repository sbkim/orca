// Desktop FCM supplemental-channel fan-out (SPEC-FCM-001, M4).
//
// Why: when dispatchMobileNotification fires with zero WebSocket listeners,
// Orca forwards the notification to every paired device that registered an FCM
// token so an offline mobile device still gets notified. This module owns the
// per-device M1+M2+M3 chain (derive persistent shared key → encrypt payload →
// FCM send) and is injected into OrcaRuntimeService as a hook, keeping the
// runtime decoupled from the device registry, FCM credentials, and sender.
//
// The listener-count GATE that decides WHEN this runs lives in
// OrcaRuntimeService.dispatchMobileNotification (AC-FCM-002a / AC-FCM-002b);
// this module is the "what happens when the gate opens" half.
//
// Non-blocking (REQ-FCM-014): the returned promise never rejects into the
// caller's dispatch loop. The M3 sender already resolves rather than throwing;
// this module wraps the full per-device chain in try/catch so a derive/encrypt
// fault is logged and swallowed, and each device is handled independently so
// one device's failure never aborts the others.
import {
  deriveFcmSharedKey,
  encryptPushPayload,
  type PushPayloadInput
} from './push-payload-crypto'
import type { FcmCredentials, FcmSender, FcmSenderOptions } from './fcm-sender'
import type { DeviceEntry } from './device-registry'

export type FcmFanOutInput = {
  payload: PushPayloadInput
  // Why: single-namespace dedupe id shared with the WS path so mobile can
  // suppress a push that a reconnecting WS subscriber already delivered
  // (AC-FCM-005, wired in M5).
  notificationId: string
}

export type FcmFanOutDeps = {
  // Why injectable: the registry lives on the RPC server, the credentials in
  // the persistence Store, and the keypair on the RPC server. Tests supply a
  // fixed device list without standing up any of those.
  listFcmDevices: () => readonly DeviceEntry[]
  // The desktop persistent E2EE secret (loadOrCreateE2EEKeypair().secretKey).
  // Null when the keypair is unavailable — fan-out becomes a no-op.
  getDesktopPersistentSecret: () => Uint8Array | null
  // The FCM v1 credentials (projectId + plaintext service-account JSON). Null
  // until the user onboards a credential — fan-out becomes a no-op.
  getFcmCredentials: () => FcmCredentials | null
  // Sender factory seam; production wires createFcmSender with the
  // google-auth minter so the per-project OAuth token cache is reused across
  // sends. Tests inject a fixed mock sender to assert call shape.
  createSender: (options?: FcmSenderOptions) => FcmSender
  // Injectable logger so tests can silence the fire-and-log error path.
  logError?: (message: string, context?: unknown) => void
}

export type FcmFanOut = (input: FcmFanOutInput) => Promise<void>

// Why: a DeviceEntry with a present fcmToken + mobilePublicKeyB64. Narrowing via
// this alias (rather than an inline intersection on the filter return) preserves
// the non-optional field types through to the derive/send call sites.
type FcmCapableDevice = DeviceEntry & { fcmToken: string; mobilePublicKeyB64: string }

// Why: paired devices that can actually receive an FCM push need both a push
// token and a persistent mobile public key (the key derives the shared FCM key
// independent of the ephemeral WS session key — REQ-FCM-019). Filtering here
// keeps the orchestration loop focused on sendable devices.
function selectFcmCapableDevices(devices: readonly DeviceEntry[]): FcmCapableDevice[] {
  return devices.filter(
    (device): device is FcmCapableDevice =>
      typeof device.fcmToken === 'string' &&
      device.fcmToken.length > 0 &&
      typeof device.mobilePublicKeyB64 === 'string' &&
      device.mobilePublicKeyB64.length > 0
  )
}

export function createFcmFanOut(deps: FcmFanOutDeps): FcmFanOut {
  const logError =
    deps.logError ??
    ((message, context) => {
      console.error(`[runtime] ${message}`, context ?? '')
    })
  // Why: one sender for the fan-out's lifetime so the M3 OAuth token cache is
  // reused across sends instead of re-minting on every notification.
  const sender = deps.createSender()

  return async ({ payload, notificationId }) => {
    const credentials = deps.getFcmCredentials()
    if (!credentials) {
      return
    }
    const desktopSecret = deps.getDesktopPersistentSecret()
    if (!desktopSecret) {
      return
    }
    const devices = selectFcmCapableDevices(deps.listFcmDevices())
    if (devices.length === 0) {
      return
    }

    // Why: each device is handled independently so one failure (dropped
    // payload, send error, derive fault) never aborts the remaining devices and
    // never throws into the dispatch loop (REQ-FCM-014). The inner try/catch is
    // defense-in-depth: the M3 sender never throws, but a derive/encrypt fault
    // must still be contained.
    await Promise.all(
      devices.map(async (device) => {
        try {
          const sharedKey = deriveFcmSharedKey(desktopSecret, device.mobilePublicKeyB64)
          const outcome = encryptPushPayload(payload, sharedKey)
          // Why: only ok/truncated produce a sendable ciphertext; `dropped`
          // means the payload was too large even after truncation, so emitting
          // a malformed FCM message would be worse than skipping (REQ-FCM-006).
          if (outcome.status === 'dropped') {
            return
          }
          const result = await sender.send({
            credentials,
            deviceFcmToken: device.fcmToken,
            ciphertextB64: outcome.ciphertextB64,
            notificationId
          })
          if (result.status === 'failed') {
            logError('FCM supplemental push failed', {
              notificationId,
              redactedReason: result.redactedReason
            })
          }
        } catch (err) {
          logError('FCM supplemental push error', { notificationId, err })
        }
      })
    )
  }
}
