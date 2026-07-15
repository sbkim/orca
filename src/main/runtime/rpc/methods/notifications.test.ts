import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RpcContext, RpcMethod } from '../core'
import { DeviceRegistry } from '../../device-registry'
import { NOTIFICATION_METHODS } from './notifications'

// Why: find() returns the RpcAnyMethod union ( RpcMethod | RpcStreamingMethod ).
// Narrow to the non-streaming RpcMethod so the 2-arg handler call type-checks;
// registerPushToken is defined via defineMethod (not streaming).
const registerPushToken = NOTIFICATION_METHODS.find(
  (m) => m.name === 'notifications.registerPushToken'
) as RpcMethod | undefined
const unregisterPushToken = NOTIFICATION_METHODS.find(
  (m) => m.name === 'notifications.unregisterPushToken'
) as RpcMethod | undefined

function makeRegistry(): DeviceRegistry {
  const dir = mkdtempSync(join(tmpdir(), 'orca-notif-push-'))
  return new DeviceRegistry(dir)
}

// Why: invoke the erased handler with a ctx carrying a real DeviceRegistry and
// a clientId (= the device auth token). Exercises the full resolve-and-persist
// path the production dispatcher hits.
function ctxWith(registry: DeviceRegistry, clientId?: string): RpcContext {
  return {
    runtime: {} as RpcContext['runtime'],
    deviceRegistry: registry,
    clientId
  }
}

describe('notifications.registerPushToken', () => {
  it('is registered as an RPC method', () => {
    // Why: mobile-rpc-allowlist boundary test requires the method exist in
    // ALL_RPC_METHODS; this guard catches a accidental removal.
    expect(registerPushToken).toBeDefined()
    expect(registerPushToken?.name).toBe('notifications.registerPushToken')
  })

  it('resolves the caller via clientId token and persists the push fields (AC-FCM-004a)', async () => {
    const registry = makeRegistry()
    const device = registry.addDevice('pixel')

    const result = await registerPushToken!.handler(
      { token: 'fcm-abc', platform: 'android', mobilePublicKeyB64: 'mpk-b64' },
      ctxWith(registry, device.token)
    )

    expect(result).toEqual({ ok: true })
    const stored = registry.getDevice(device.deviceId)
    expect(stored?.fcmToken).toBe('fcm-abc')
    expect(stored?.pushPlatform).toBe('android')
    expect(stored?.mobilePublicKeyB64).toBe('mpk-b64')
  })

  it('rejects when the clientId does not resolve to a paired device', async () => {
    const registry = makeRegistry()

    const result = await registerPushToken!.handler(
      { token: 'fcm-abc', platform: 'ios', mobilePublicKeyB64: 'mpk-b64' },
      ctxWith(registry, 'not-a-real-token')
    )

    expect(result).toMatchObject({ ok: false })
    // Why: no device should have been mutated.
    expect(registry.listDevices().every((d) => d.fcmToken === undefined)).toBe(true)
  })

  it('rejects when the deviceRegistry is not wired into the ctx', async () => {
    // Why: in-process / Unix-socket callers have no paired-device context.
    // The handler must fail closed rather than crash.
    const result = await registerPushToken!.handler(
      { token: 'fcm-abc', platform: 'android', mobilePublicKeyB64: 'mpk-b64' },
      { runtime: {} as RpcContext['runtime'] }
    )
    expect(result).toMatchObject({ ok: false })
  })

  it('overwrites the prior token on re-registration (AC-FCM-004b idempotency)', async () => {
    const registry = makeRegistry()
    const device = registry.addDevice('iphone')

    await registerPushToken!.handler(
      { token: 'old', platform: 'ios', mobilePublicKeyB64: 'mpk' },
      ctxWith(registry, device.token)
    )
    await registerPushToken!.handler(
      { token: 'new', platform: 'ios', mobilePublicKeyB64: 'mpk' },
      ctxWith(registry, device.token)
    )

    const stored = registry.getDevice(device.deviceId)
    expect(stored?.fcmToken).toBe('new')
  })

  it('rejects an empty token via schema validation', () => {
    // Why: the params schema enforces non-empty token/platform/publicKey before
    // the handler runs, so a malformed mobile request never touches the registry.
    expect(registerPushToken?.params).toBeDefined()
    // parse() throws ZodError on invalid input — exercise it directly.
    const schema = registerPushToken!.params!
    expect(() =>
      schema.parse({ token: '', platform: 'android', mobilePublicKeyB64: 'mpk' })
    ).toThrow()
  })
})

describe('notifications.unregisterPushToken', () => {
  it('clears every durable push field for the authenticated device', async () => {
    const registry = makeRegistry()
    const device = registry.addDevice('iphone')
    registry.updateDevicePushToken(device.deviceId, {
      fcmToken: 'registered-token',
      pushPlatform: 'ios',
      mobilePublicKeyB64: 'mobile-key'
    })

    const result = await unregisterPushToken!.handler(undefined, ctxWith(registry, device.token))

    expect(result).toEqual({ ok: true })
    expect(registry.getDevice(device.deviceId)).toMatchObject({
      deviceId: device.deviceId
    })
    expect(registry.getDevice(device.deviceId)?.fcmToken).toBeUndefined()
    expect(registry.getDevice(device.deviceId)?.pushPlatform).toBeUndefined()
    expect(registry.getDevice(device.deviceId)?.mobilePublicKeyB64).toBeUndefined()
  })

  it('cannot clear another device without a valid caller token', async () => {
    const registry = makeRegistry()
    const device = registry.addDevice('pixel')
    registry.updateDevicePushToken(device.deviceId, {
      fcmToken: 'keep-token',
      pushPlatform: 'android',
      mobilePublicKeyB64: 'keep-key'
    })

    const result = await unregisterPushToken!.handler(undefined, ctxWith(registry, 'invalid-token'))

    expect(result).toEqual({ ok: false, error: 'invalid_token' })
    expect(registry.getDevice(device.deviceId)?.fcmToken).toBe('keep-token')
  })
})
