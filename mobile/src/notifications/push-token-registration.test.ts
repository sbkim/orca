import { beforeEach, describe, expect, it, vi } from 'vitest'

// Why: vi.mock factories are hoisted above const declarations, so the mutable
// mock state must also be hoisted (vi.hoisted) to be referenceable from them.
const mocks = vi.hoisted(() => ({
  pushEnabled: true,
  permissionGranted: true,
  pushToken: 'fcm-token-xyz',
  publicKeyB64: 'mpk-b64',
  platformOS: 'android'
}))

// Why: isolate the orchestration from its native/RN deps so the toggle,
// permission, and token→RPC flow can be asserted deterministically.
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => {} }
}))
vi.mock('expo-notifications', () => ({
  getDevicePushTokenAsync: async () => ({ data: mocks.pushToken, type: 'fcm' })
}))
vi.mock('react-native', () => ({
  // Why: getter so Platform.OS reflects the latest mocks.platformOS value
  // (a bare property would snapshot the initial 'android' value at hoist time).
  Platform: {
    get OS() {
      return mocks.platformOS
    }
  }
}))
vi.mock('../storage/preferences', () => ({
  loadPushNotificationsEnabled: async () => mocks.pushEnabled
}))
vi.mock('./mobile-notifications', () => ({
  ensureNotificationPermissions: async () => mocks.permissionGranted
}))
vi.mock('../transport/push-keypair', () => ({
  loadOrCreatePushKeypair: async () => ({ publicKeyB64: mocks.publicKeyB64 })
}))

import { registerPushTokenWithDesktop } from './push-token-registration'

function makeClient() {
  const calls: Array<{ method: string; params: unknown }> = []
  const client = {
    sendRequest: vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params })
      return { id: 'r1', ok: true, result: { ok: true }, _meta: { runtimeId: 'rt' } }
    })
  }
  return { client, calls }
}

describe('registerPushTokenWithDesktop', () => {
  beforeEach(() => {
    mocks.pushEnabled = true
    mocks.permissionGranted = true
    mocks.pushToken = 'fcm-token-xyz'
    mocks.publicKeyB64 = 'mpk-b64'
    mocks.platformOS = 'android'
  })

  it('sends notifications.registerPushToken with token, platform, and persistent public key', async () => {
    const { client, calls } = makeClient()
    const result = await registerPushTokenWithDesktop(client)

    expect(result.registered).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      method: 'notifications.registerPushToken',
      params: { token: 'fcm-token-xyz', platform: 'android', mobilePublicKeyB64: 'mpk-b64' }
    })
  })

  // Why: REQ-FCM-018 — the existing single toggle governs FCM delivery too.
  // When it is off, no token must reach the desktop.
  it('does not register when the push toggle is disabled', async () => {
    mocks.pushEnabled = false
    const { client, calls } = makeClient()
    const result = await registerPushTokenWithDesktop(client)

    expect(result.registered).toBe(false)
    expect(calls).toHaveLength(0)
  })

  // Why: REQ-FCM-017 — permission must be requested before registering.
  it('does not register when notification permission is denied', async () => {
    mocks.permissionGranted = false
    const { client, calls } = makeClient()
    const result = await registerPushTokenWithDesktop(client)

    expect(result.registered).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('reports ios platform on iOS', async () => {
    mocks.platformOS = 'ios'
    const { client, calls } = makeClient()
    await registerPushTokenWithDesktop(client)

    expect(calls[0]?.params).toMatchObject({ platform: 'ios' })
  })

  it('reports not registered when the RPC returns ok:false', async () => {
    const client = {
      sendRequest: vi.fn(async () => ({
        id: 'r1',
        ok: false,
        error: { code: 'unauthorized', message: 'no' },
        _meta: { runtimeId: 'rt' }
      }))
    }
    const result = await registerPushTokenWithDesktop(client)
    expect(result.registered).toBe(false)
  })
})
