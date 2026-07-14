import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DeviceRegistry, type DeviceEntry } from './device-registry'

function makeRegistry(): { registry: DeviceRegistry; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'orca-device-registry-'))
  const registry = new DeviceRegistry(dir)
  return { registry, dir }
}

describe('DeviceRegistry.updateDevicePushToken', () => {
  it('persists fcmToken, pushPlatform, and mobilePublicKeyB64 on the device', () => {
    const { registry, dir } = makeRegistry()
    const device = registry.addDevice('pixel')

    const updated = registry.updateDevicePushToken(device.deviceId, {
      fcmToken: 'fcm-abc',
      pushPlatform: 'android',
      mobilePublicKeyB64: 'mpk-b64'
    })

    expect(updated).toBe(true)
    const stored = registry.getDevice(device.deviceId)
    expect(stored?.fcmToken).toBe('fcm-abc')
    expect(stored?.pushPlatform).toBe('android')
    expect(stored?.mobilePublicKeyB64).toBe('mpk-b64')

    // Why: AC-FCM-004a requires the change to reach orca-devices.json on disk.
    const onDisk = JSON.parse(
      readFileSync(join(dir, 'orca-devices.json'), 'utf-8')
    ) as DeviceEntry[]
    const diskEntry = onDisk.find((d) => d.deviceId === device.deviceId)
    expect(diskEntry?.fcmToken).toBe('fcm-abc')
    expect(diskEntry?.pushPlatform).toBe('android')
    expect(diskEntry?.mobilePublicKeyB64).toBe('mpk-b64')
  })

  it('returns false and does not mutate when the deviceId is unknown', () => {
    const { registry } = makeRegistry()
    const updated = registry.updateDevicePushToken('does-not-exist', {
      fcmToken: 'fcm-x',
      pushPlatform: 'ios',
      mobilePublicKeyB64: 'mpk-x'
    })
    expect(updated).toBe(false)
  })

  // Why: AC-FCM-004b — expo-notifications emits a refreshed token and the
  // mobile re-registers. The latest token must overwrite the prior one so a
  // single device always has exactly one current token.
  it('overwrites the prior fcmToken on refresh (idempotent single latest token)', () => {
    const { registry } = makeRegistry()
    const device = registry.addDevice('iphone')

    registry.updateDevicePushToken(device.deviceId, {
      fcmToken: 'old',
      pushPlatform: 'ios',
      mobilePublicKeyB64: 'mpk'
    })
    registry.updateDevicePushToken(device.deviceId, {
      fcmToken: 'new',
      pushPlatform: 'ios',
      mobilePublicKeyB64: 'mpk'
    })

    const stored = registry.getDevice(device.deviceId)
    expect(stored?.fcmToken).toBe('new')
  })

  it('updates only the fields supplied in the patch (partial update)', () => {
    const { registry } = makeRegistry()
    const device = registry.addDevice('phone')
    registry.updateDevicePushToken(device.deviceId, {
      fcmToken: 'first',
      pushPlatform: 'android',
      mobilePublicKeyB64: 'mpk'
    })

    // Why: a token refresh re-sends token + platform but the persistent mobile
    // public key does not change. Re-registering must not clear the key.
    registry.updateDevicePushToken(device.deviceId, {
      fcmToken: 'second',
      pushPlatform: 'android'
    })

    const stored = registry.getDevice(device.deviceId)
    expect(stored?.fcmToken).toBe('second')
    expect(stored?.mobilePublicKeyB64).toBe('mpk')
  })
})

describe('DeviceRegistry legacy round-trip compatibility', () => {
  // Why: AC-FCM-004a — an orca-devices.json written before this SPEC has no
  // fcmToken/pushPlatform/mobilePublicKeyB64 fields. Loading it MUST surface
  // those fields as undefined (not crash, not synthesize bogus values).
  it('treats a legacy file without push fields as undefined on load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-device-registry-legacy-'))
    const legacy: DeviceEntry[] = [
      {
        deviceId: 'legacy-1',
        name: 'old-phone',
        token: 'legacy-token-hex',
        scope: 'mobile',
        pairedAt: 1_000,
        lastSeenAt: 2_000
      }
    ]
    writeFileSync(join(dir, 'orca-devices.json'), JSON.stringify(legacy), 'utf-8')
    expect(existsSync(join(dir, 'orca-devices.json'))).toBe(true)

    const registry = new DeviceRegistry(dir)
    const loaded = registry.listDevices()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.deviceId).toBe('legacy-1')
    expect(loaded[0]?.fcmToken).toBeUndefined()
    expect(loaded[0]?.pushPlatform).toBeUndefined()
    expect(loaded[0]?.mobilePublicKeyB64).toBeUndefined()
  })

  it('round-trips the push fields through save and reload', () => {
    const { registry, dir } = makeRegistry()
    const device = registry.addDevice('phone')
    registry.updateDevicePushToken(device.deviceId, {
      fcmToken: 'rt-token',
      pushPlatform: 'ios',
      mobilePublicKeyB64: 'rt-mpk'
    })

    const reloaded = new DeviceRegistry(dir)
    const stored = reloaded.getDevice(device.deviceId)
    expect(stored?.fcmToken).toBe('rt-token')
    expect(stored?.pushPlatform).toBe('ios')
    expect(stored?.mobilePublicKeyB64).toBe('rt-mpk')
  })
})
