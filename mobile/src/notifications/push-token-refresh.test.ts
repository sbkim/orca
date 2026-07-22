import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: true,
  listener: null as ((token: string) => Promise<void>) | null,
  unsubscribe: vi.fn(),
  platform: 'android',
  publicKeyB64: 'mobile-public-key'
}))

vi.mock('@react-native-firebase/messaging', () => ({
  getMessaging: () => ({}),
  onTokenRefresh: (_messaging: unknown, listener: (token: string) => Promise<void>) => {
    mocks.listener = listener
    return mocks.unsubscribe
  }
}))

vi.mock('../storage/preferences', () => ({
  loadPushNotificationsEnabled: async () => mocks.enabled
}))

vi.mock('../transport/push-keypair', () => ({
  loadOrCreatePushKeypair: async () => ({ publicKeyB64: mocks.publicKeyB64 })
}))

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mocks.platform
    }
  }
}))

import { subscribeToTokenRefresh } from './push-token-refresh'

function successfulResponse() {
  return {
    id: 'refresh',
    ok: true as const,
    result: { ok: true },
    _meta: { runtimeId: 'runtime' }
  }
}

describe('subscribeToTokenRefresh', () => {
  beforeEach(() => {
    mocks.enabled = true
    mocks.listener = null
    mocks.unsubscribe.mockReset()
    mocks.platform = 'android'
    mocks.publicKeyB64 = 'mobile-public-key'
  })

  it('registers a refreshed token with every connected host', async () => {
    const first = { sendRequest: vi.fn(async () => successfulResponse()) }
    const second = { sendRequest: vi.fn(async () => successfulResponse()) }
    const cleanup = subscribeToTokenRefresh(() => [first, second])

    await mocks.listener?.('refreshed-token')

    const expectedParams = {
      token: 'refreshed-token',
      platform: 'android',
      mobilePublicKeyB64: 'mobile-public-key'
    }
    expect(first.sendRequest).toHaveBeenCalledWith(
      'notifications.registerPushToken',
      expectedParams
    )
    expect(second.sendRequest).toHaveBeenCalledWith(
      'notifications.registerPushToken',
      expectedParams
    )
    cleanup()
  })

  it('updates other hosts when one host rejects the refresh RPC', async () => {
    const unavailable = {
      sendRequest: vi.fn(async () => {
        throw new Error('host unavailable')
      })
    }
    const available = { sendRequest: vi.fn(async () => successfulResponse()) }
    subscribeToTokenRefresh(() => [unavailable, available])

    expect(mocks.listener).not.toBeNull()
    await expect(mocks.listener!('refreshed-token')).resolves.toBeUndefined()

    expect(unavailable.sendRequest).toHaveBeenCalledTimes(1)
    expect(available.sendRequest).toHaveBeenCalledTimes(1)
  })

  it('does not update any host while notifications are disabled', async () => {
    mocks.enabled = false
    const client = { sendRequest: vi.fn(async () => successfulResponse()) }
    subscribeToTokenRefresh(() => [client])

    await mocks.listener?.('refreshed-token')

    expect(client.sendRequest).not.toHaveBeenCalled()
  })
})
