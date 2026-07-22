// Why: handles FCM token refresh events and re-registers the refreshed token
// with the desktop (SPEC-FCM-001, REQ-FCM-010). FCM may periodically refresh
// the registration token for security reasons. When this happens, the mobile app
// must notify the desktop of the new token via RPC, otherwise push delivery
// will fail with "InvalidRegistration" (FCM error code for stale tokens).
//
// This module provides a subscription function that sets up the Firebase
// onTokenRefresh listener and triggers re-registration when the token changes.

import { getMessaging, onTokenRefresh } from '@react-native-firebase/messaging'
import type { RpcClient } from '../transport/rpc-client'
import { loadPushNotificationsEnabled } from '../storage/preferences'
import { loadOrCreatePushKeypair } from '../transport/push-keypair'
import { Platform } from 'react-native'

// Why: minimal client surface needed for token refresh RPC.
type TokenRefreshClient = Pick<RpcClient, 'sendRequest'>

let unsubscribe: (() => void) | null = null

// Why: subscribes to Firebase onTokenRefresh events and re-registers the
// refreshed token with the desktop. Call this when the app starts and/or when
// push notifications are enabled. Returns an unsubscribe function for cleanup.
export function subscribeToTokenRefresh(
  getClients: () => readonly TokenRefreshClient[]
): () => void {
  // Clean up existing subscription if any
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }

  // Why: onTokenRefresh fires when FCM refreshes the registration token.
  // We must immediately send the new token to every connected host to avoid
  // leaving sibling host registries with a stale destination.
  unsubscribe = onTokenRefresh(getMessaging(), async (newToken: string) => {
    try {
      // REQ-FCM-018: respect push toggle even for token refresh
      const enabled = await loadPushNotificationsEnabled()
      if (!enabled) {
        return // Don't register if push is disabled
      }

      // REQ-FCM-019: load the persistent mobile public key
      const { publicKeyB64 } = await loadOrCreatePushKeypair()

      // REQ-FCM-016: platform selection for desktop FCM transport shaping
      const platform: 'android' | 'ios' = Platform.OS === 'ios' ? 'ios' : 'android'

      const params = { token: newToken, platform, mobilePublicKeyB64: publicKeyB64 }
      // Why: hosts are independent authorities; one unavailable host must not
      // prevent every other connected host from receiving the refreshed token.
      await Promise.allSettled(
        getClients().map((client) => client.sendRequest('notifications.registerPushToken', params))
      )
    } catch {
      // Why: native token callbacks must stay non-fatal; reconnect and toggle-on
      // registration provide the later recovery path for connected hosts.
    }
  })

  // Why: return cleanup function for caller to use on app pause/stop
  return () => {
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
  }
}

// Why: ensures the messaging module is initialized (required for onTokenRefresh
// to work on some platforms). Call this when the app starts.
export function initializeMessaging(): void {
  // Side effect: accessing the messaging singleton initializes it
  getMessaging()
}
