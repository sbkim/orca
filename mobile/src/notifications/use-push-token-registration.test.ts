import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { registerPushTokenWithDesktop } from './push-token-registration'
import {
  type PushRegistrationClientEntry,
  usePushTokenRegistration
} from './use-push-token-registration'

const preference = vi.hoisted(() => ({
  enabled: false,
  listeners: new Set<(enabled: boolean) => void>()
}))

vi.mock('../storage/preferences', () => ({
  loadPushNotificationsEnabled: async () => preference.enabled,
  subscribePushNotificationsEnabled: (listener: (enabled: boolean) => void) => {
    preference.listeners.add(listener)
    return () => preference.listeners.delete(listener)
  }
}))

vi.mock('./push-token-registration', () => ({
  registerPushTokenWithDesktop: vi.fn(async () => ({ registered: true }))
}))

vi.mock('./push-token-refresh', () => ({
  initializeMessaging: vi.fn(),
  subscribeToTokenRefresh: vi.fn(() => () => {})
}))

function Harness({ clients }: { clients: readonly PushRegistrationClientEntry[] }): null {
  usePushTokenRegistration(clients)
  return null
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('usePushTokenRegistration', () => {
  let renderer: ReactTestRenderer | null = null
  const client = { sendRequest: vi.fn() } as unknown as RpcClient
  const connectedClients: readonly PushRegistrationClientEntry[] = [
    { hostId: 'host-1', client, state: 'connected' }
  ]

  beforeEach(() => {
    renderer?.unmount()
    renderer = null
    preference.enabled = false
    preference.listeners.clear()
    vi.mocked(registerPushTokenWithDesktop).mockClear()
    vi.mocked(registerPushTokenWithDesktop).mockResolvedValue({ registered: true })
  })

  it('registers a connected host when push is enabled after mount', async () => {
    await act(async () => {
      renderer = create(createElement(Harness, { clients: connectedClients }))
    })
    await flushEffects()
    expect(registerPushTokenWithDesktop).not.toHaveBeenCalled()

    await act(async () => {
      preference.enabled = true
      for (const listener of preference.listeners) {
        listener(true)
      }
    })
    await flushEffects()

    expect(registerPushTokenWithDesktop).toHaveBeenCalledTimes(1)
    expect(registerPushTokenWithDesktop).toHaveBeenCalledWith(client, 'host-1')
  })

  it('registers an already-connected host when persisted push state loads enabled', async () => {
    preference.enabled = true
    await act(async () => {
      renderer = create(createElement(Harness, { clients: connectedClients }))
    })
    await flushEffects()

    expect(registerPushTokenWithDesktop).toHaveBeenCalledTimes(1)
  })
})
