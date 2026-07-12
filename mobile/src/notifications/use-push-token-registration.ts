// Why: React hook that fires FCM token registration whenever a host client
// reaches 'connected' (post e2ee_authenticated). Extracted from app/index.tsx
// to keep the home screen under the file max-lines ceiling and to make the
// connect-driven registration independently testable.
import { useEffect, useRef } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { registerPushTokenWithDesktop } from './push-token-registration'

export type PushRegistrationClientEntry = {
  hostId: string
  client: RpcClient
  state: ConnectionState
}

export function usePushTokenRegistration(allClients: readonly PushRegistrationClientEntry[]): void {
  // Why: track which hosts have registered in the current connected span so we
  // don't re-fire on every render tick. Cleared on disconnect so a reconnect
  // re-registers (expo-notifications may have refreshed the token).
  const registeredHostsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const entry of allClients) {
      if (entry.state !== 'connected') {
        registeredHostsRef.current.delete(entry.hostId)
        continue
      }
      if (registeredHostsRef.current.has(entry.hostId)) {
        continue
      }
      registeredHostsRef.current.add(entry.hostId)
      // Why: fire-and-forget — a disabled toggle / denied permission
      // short-circuits inside the orchestrator, and a registration failure must
      // not block the UI (the WS channel still delivers foreground alerts).
      void registerPushTokenWithDesktop(entry.client).catch(() => {})
    }
  }, [allClients])
}
