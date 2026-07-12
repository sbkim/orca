import { beforeEach, describe, expect, it, vi } from 'vitest'

// Why: vi.mock factories are hoisted above const declarations, so the mutable
// mock state must also be hoisted (vi.hoisted) to be referenceable from them.
const mocks = vi.hoisted(() => ({
  pushEnabled: true,
  permissionGranted: true,
  pushToken: 'fcm-android-token-xyz',
  firebaseToken: 'fcm-ios-token-abc',
  publicKeyB64: 'mpk-b64',
  platformOS: 'android',
  expoGetDeviceTokenCalls: 0,
  firebaseGetTokenCalls: 0,
  firebaseThrow: false as boolean | Error
}))

// Why: isolate the orchestration from its native/RN deps so the toggle,
// permission, and token→RPC flow can be asserted deterministically.
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => {} }
}))
vi.mock('expo-notifications', () => ({
  getDevicePushTokenAsync: async () => {
    mocks.expoGetDeviceTokenCalls += 1
    return { data: mocks.pushToken, type: 'fcm' }
  }
}))
// SPEC-FCM-001 AC-006b: iOS acquires the FCM registration token via RNFB
// messaging.getToken(); expo-notifications returns an APNs token on iOS.
vi.mock('@react-native-firebase/messaging', () => ({
  getMessaging: () => ({}),
  getToken: async () => {
    mocks.firebaseGetTokenCalls += 1
    if (mocks.firebaseThrow) {
      throw mocks.firebaseThrow
    }
    return mocks.firebaseToken
  }
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
      return { id: 'r1', ok: true as const, result: { ok: true }, _meta: { runtimeId: 'rt' } }
    })
  }
  return { client, calls }
}

describe('registerPushTokenWithDesktop', () => {
  beforeEach(() => {
    mocks.pushEnabled = true
    mocks.permissionGranted = true
    mocks.pushToken = 'fcm-android-token-xyz'
    mocks.firebaseToken = 'fcm-ios-token-abc'
    mocks.publicKeyB64 = 'mpk-b64'
    mocks.platformOS = 'android'
    mocks.expoGetDeviceTokenCalls = 0
    mocks.firebaseGetTokenCalls = 0
    mocks.firebaseThrow = false
  })

  it('sends notifications.registerPushToken with token, platform, and persistent public key', async () => {
    const { client, calls } = makeClient()
    const result = await registerPushTokenWithDesktop(client)

    expect(result.registered).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      method: 'notifications.registerPushToken',
      params: { token: 'fcm-android-token-xyz', platform: 'android', mobilePublicKeyB64: 'mpk-b64' }
    })
    // Android must use the expo-notifications path, not RNFB.
    expect(mocks.expoGetDeviceTokenCalls).toBe(1)
    expect(mocks.firebaseGetTokenCalls).toBe(0)
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

  // SPEC-FCM-001 AC-006b: iOS must acquire the FCM registration token via RNFB
  // messaging.getToken() (expo-notifications returns an APNs device token on iOS,
  // which FCM v1 messages:send rejects).
  it('uses RNFB getToken (not expo-notifications) on iOS', async () => {
    mocks.platformOS = 'ios'
    const { client, calls } = makeClient()
    const result = await registerPushTokenWithDesktop(client)

    expect(result.registered).toBe(true)
    expect(calls[0]).toEqual({
      method: 'notifications.registerPushToken',
      params: { token: 'fcm-ios-token-abc', platform: 'ios', mobilePublicKeyB64: 'mpk-b64' }
    })
    expect(mocks.firebaseGetTokenCalls).toBe(1)
    expect(mocks.expoGetDeviceTokenCalls).toBe(0)
  })

  it('reports no-token when RNFB getToken throws on iOS', async () => {
    mocks.platformOS = 'ios'
    mocks.firebaseThrow = new Error('apns not registered')
    const { client, calls } = makeClient()
    const result = await registerPushTokenWithDesktop(client)

    expect(result.registered).toBe(false)
    expect(result.reason).toBe('no-token')
    expect(calls).toHaveLength(0)
  })

  it('reports not registered when the RPC returns ok:false', async () => {
    const client = {
      sendRequest: vi.fn(async () => ({
        id: 'r1',
        ok: false as const,
        error: { code: 'unauthorized', message: 'no' },
        _meta: { runtimeId: 'rt' }
      }))
    }
    const result = await registerPushTokenWithDesktop(client)
    expect(result.registered).toBe(false)
  })
})
