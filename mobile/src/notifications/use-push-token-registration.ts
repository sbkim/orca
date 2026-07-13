// Why: React hook that fires FCM token registration whenever a host client
// reaches 'connected' (post e2ee_authenticated) OR when the push toggle is
// turned on (defect #1 fix: toggle-on is a registration trigger, not only pairing).
// Extracted from app/index.tsx to keep the home screen under the file max-lines
// ceiling and to make the connect-driven registration independently testable.
import { useEffect, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { registerPushTokenWithDesktop } from './push-token-registration'
import {
  loadPushNotificationsEnabled,
  subscribePushNotificationsEnabled
} from '../storage/preferences'
import { subscribeToTokenRefresh, initializeMessaging } from './push-token-refresh'

export type PushRegistrationClientEntry = {
  hostId: string
  client: RpcClient
  state: ConnectionState
}

export function usePushTokenRegistration(allClients: readonly PushRegistrationClientEntry[]): void {
  // Why: track which hosts have SUCCESSFULLY registered in the current connected
  // span so we don't re-fire on every render tick. Cleared on disconnect so a
  // reconnect re-registers (expo-notifications may have refreshed the token).
  // FIXED: Now only marks as registered AFTER successful RPC ack (defect #1).
  const registeredHostsRef = useRef<Set<string>>(new Set())

  const [pushToggleEnabled, setPushToggleEnabled] = useState<boolean | null>(null)

  // Why: track token refresh subscription cleanup function
  const tokenRefreshCleanupRef = useRef<(() => void) | null>(null)

  // Why: initialize Firebase messaging module on first render (required for
  // onTokenRefresh to work on some platforms)
  useEffect(() => {
    initializeMessaging()
  }, [])

  // Why: set up token refresh subscription when we have at least one connected
  // client and push is enabled. Clean up subscription when no clients or
  // push disabled.
  useEffect(() => {
    const connectedClients = allClients.filter((entry) => entry.state === 'connected')
    const hasConnectedClients = connectedClients.length > 0

    // Only set up subscription if we have clients and push is enabled
    if (!hasConnectedClients || pushToggleEnabled === false) {
      // Clean up existing subscription
      if (tokenRefreshCleanupRef.current) {
        tokenRefreshCleanupRef.current()
        tokenRefreshCleanupRef.current = null
      }
      return
    }

    // Set up token refresh subscription with a function to get a connected client
    const getClient = () => {
      const firstConnected = connectedClients[0]
      return firstConnected?.client ?? null
    }

    const cleanup = subscribeToTokenRefresh(getClient)
    tokenRefreshCleanupRef.current = cleanup

    // Clean up on unmount or when dependencies change
    return () => {
      if (cleanup) {
        cleanup()
      }
    }
  }, [allClients, pushToggleEnabled])

  // Why: HomeScreen remains mounted below the notification settings route, so
  // subscribe to preference writes instead of waiting for an unrelated rerender.
  useEffect(() => {
    let mounted = true
    const unsubscribe = subscribePushNotificationsEnabled((enabled) => {
      if (mounted) {
        setPushToggleEnabled(enabled)
      }
    })
    void loadPushNotificationsEnabled().then((enabled) => {
      if (mounted) {
        setPushToggleEnabled(enabled)
      }
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    for (const entry of allClients) {
      if (entry.state !== 'connected') {
        registeredHostsRef.current.delete(entry.hostId)
        continue
      }
      if (registeredHostsRef.current.has(entry.hostId)) {
        continue
      }
      if (pushToggleEnabled !== true) {
        continue
      }
      // Why: fire registration attempt - will only mark as registered on success
      void registerPushTokenWithDesktop(entry.client)
        .then((result) => {
          if (result.registered) {
            registeredHostsRef.current.add(entry.hostId)
          }
        })
        .catch(() => {})
    }
  }, [allClients, pushToggleEnabled])

  // Why: clean up token refresh subscription on component unmount
  useEffect(() => {
    return () => {
      if (tokenRefreshCleanupRef.current) {
        tokenRefreshCleanupRef.current()
        tokenRefreshCleanupRef.current = null
      }
    }
  }, [])
}
