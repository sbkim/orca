// Why: React hook that fires FCM token registration whenever a host client
// reaches 'connected' (post e2ee_authenticated) OR when the push toggle is
// turned on (defect #1 fix: toggle-on is a registration trigger, not only pairing).
// Extracted from app/index.tsx to keep the home screen under the file max-lines
// ceiling and to make the connect-driven registration independently testable.
import { useEffect, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { registerPushTokenWithDesktop } from './push-token-registration'
import { loadPushNotificationsEnabled } from '../storage/preferences'

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

  // Why: track previous push toggle state to detect toggle-on transitions for
  // triggering registration (defect #1 fix: toggle-on is a registration trigger).
  const [pushToggleEnabled, setPushToggleEnabled] = useState<boolean | null>(null)

  // Why: separate effect to monitor push toggle changes and trigger registration
  // when toggle is turned on, even if hosts are already connected.
  useEffect(() => {
    let mounted = true

    const checkToggleAndRegister = async () => {
      const enabled = await loadPushNotificationsEnabled()
      if (!mounted) {
        return
      }

      // Detect toggle-on transition
      if (pushToggleEnabled === false && enabled === true) {
        // Toggle was turned ON - trigger registration for all connected hosts
        for (const entry of allClients) {
          if (entry.state === 'connected' && !registeredHostsRef.current.has(entry.hostId)) {
            void registerPushTokenWithDesktop(entry.client)
              .then((result) => {
                if (result.registered && mounted) {
                  registeredHostsRef.current.add(entry.hostId)
                }
              })
              .catch(() => {})
          }
        }
      }
      setPushToggleEnabled(enabled)
    }

    checkToggleAndRegister()
    return () => {
      mounted = false
    }
  }, [pushToggleEnabled, allClients])

  useEffect(() => {
    for (const entry of allClients) {
      if (entry.state !== 'connected') {
        registeredHostsRef.current.delete(entry.hostId)
        continue
      }
      if (registeredHostsRef.current.has(entry.hostId)) {
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
  }, [allClients])
}
