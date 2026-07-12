// Why: orchestrates mobile→desktop FCM token registration after E2EE pairing
// completes (SPEC-FCM-001, REQ-FCM-008/010/017/018/019). Centralizes the
// toggle → permission → token → persistent-public-key → RPC sequence so the
// app layer (app/index.tsx) can trigger it on connect without inlining native
// async orchestration into the React render tree, and so the sequence is
// unit-testable in isolation.
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import type { RpcResponse } from '../transport/types'
import { loadOrCreatePushKeypair } from '../transport/push-keypair'
import { ensureNotificationPermissions } from './mobile-notifications'
import { loadPushNotificationsEnabled } from '../storage/preferences'

// Why: the minimal client surface this orchestration needs. Narrowing to a
// structural interface (not the full RpcClient) keeps the unit test free of the
// WebSocket/transport stack — only sendRequest is exercised.
export type PushTokenRegistrationClient = {
  sendRequest: (method: string, params?: unknown) => Promise<RpcResponse>
}

export type PushTokenRegistrationResult = {
  registered: boolean
  reason?: 'push-disabled' | 'permission-denied' | 'no-token' | 'rpc-error'
}

// Why: called after a host client reaches 'connected' (post e2ee_authenticated).
// Safe to call on every reconnect — re-registering the (possibly refreshed)
// token overwrites the prior one idempotently on the desktop (AC-FCM-004b).
export async function registerPushTokenWithDesktop(
  client: PushTokenRegistrationClient
): Promise<PushTokenRegistrationResult> {
  // REQ-FCM-018: the existing single push toggle governs FCM delivery too —
  // no new separate control. When off, do not register a token with the desktop.
  const enabled = await loadPushNotificationsEnabled()
  if (!enabled) {
    return { registered: false, reason: 'push-disabled' }
  }

  // REQ-FCM-017: request notification permission before acquiring/registering
  // the token, matching the existing expo-notifications permission flow.
  const granted = await ensureNotificationPermissions()
  if (!granted) {
    return { registered: false, reason: 'permission-denied' }
  }

  // REQ-FCM-008: acquire the FCM (android) / APNs-via-FCM (ios) device push
  // token. expo-notifications resolves the transport-specific token.
  const tokenResult = await Notifications.getDevicePushTokenAsync()
  const token = tokenResult?.data
  if (typeof token !== 'string' || token.length === 0) {
    return { registered: false, reason: 'no-token' }
  }

  // REQ-FCM-019: read the long-lived mobile public key (generated once,
  // persisted). The desktop derives the persistent FCM-shared key from its own
  // persistent secret x this public key, independent of the WS session key.
  const { publicKeyB64 } = await loadOrCreatePushKeypair()

  // REQ-FCM-016: platform selects FCM transport shaping on the desktop side.
  const platform: 'android' | 'ios' = Platform.OS === 'ios' ? 'ios' : 'android'

  const response = await client.sendRequest('notifications.registerPushToken', {
    token,
    platform,
    mobilePublicKeyB64: publicKeyB64
  })

  if (!response?.ok) {
    return { registered: false, reason: 'rpc-error' }
  }
  return { registered: true }
}
