// Why: per-device tokens replace the shared runtime auth token for WebSocket
// (mobile) connections. Each paired device gets its own revocable token so
// compromising one device doesn't expose others. The registry is a simple
// JSON file with hardened permissions matching the runtime metadata pattern.
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hardenExistingSecureFile, writeSecureJsonFile } from '../../shared/secure-file'
import type { DeviceScope } from '../../shared/runtime-types'
import { DEVICE_REGISTRY_FILENAME } from './mobile-pairing-files'
import type { RelayDeviceBinding } from './relay/relay-revoke-outbox'
import type { MobilePairingConnectionMode } from '../../shared/mobile-pairing-connection-mode'

export type { DeviceScope }

// Why: FCM supplemental push channel (SPEC-FCM-001). The platform selects the
// FCM transport (direct for android, APNs brokered via FCM for ios). Optional
// so legacy orca-devices.json entries without a registered push token load as
// undefined — see REQ-FCM-009.
export type PushPlatform = 'android' | 'ios'

export type DeviceEntry = {
  deviceId: string
  name: string
  token: string
  scope: DeviceScope
  pairedAt: number
  lastSeenAt: number
  relayBinding?: RelayDeviceBinding
  mobilePairingConnectionMode?: MobilePairingConnectionMode
  // Why: the per-device FCM/APNs token used by the desktop FCM sender when no
  // WebSocket subscriber is connected (REQ-FCM-009). Absent on pre-FCM pairings.
  fcmToken?: string
  // Why: matches fcmToken's transport; both are registered together via the
  // notifications.registerPushToken RPC so the sender can pick android vs ios
  // message shaping (REQ-FCM-016).
  pushPlatform?: PushPlatform
  // Why: the mobile's long-lived Curve25519 public key (base64). The desktop
  // derives the persistent FCM-shared key from its own persistent secret x this
  // public key, independent of the per-connection ephemeral WS session key so
  // WebSocket forward secrecy is preserved (REQ-FCM-019).
  mobilePublicKeyB64?: string
}

// Why: the patch shape for push-token registration. All fields optional so a
// token refresh can re-send token + platform without clearing the persistent
// mobile public key (AC-FCM-004b idempotency).
export type DevicePushTokenPatch = {
  fcmToken?: string
  pushPlatform?: PushPlatform
  mobilePublicKeyB64?: string
}

function validRelayBinding(value: unknown, deviceId: string): RelayDeviceBinding | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const binding = value as Partial<RelayDeviceBinding>
  return binding.relayDeviceId === deviceId &&
    typeof binding.relayHostId === 'string' &&
    typeof binding.ownerIdentityKey === 'string'
    ? {
        relayHostId: binding.relayHostId,
        relayDeviceId: binding.relayDeviceId,
        ownerIdentityKey: binding.ownerIdentityKey,
        ...(typeof binding.inviteExpiresAt === 'number' && Number.isFinite(binding.inviteExpiresAt)
          ? { inviteExpiresAt: binding.inviteExpiresAt }
          : {})
      }
    : undefined
}

export class DeviceRegistry {
  private readonly registryPath: string
  private devices: DeviceEntry[] = []

  constructor(userDataPath: string) {
    this.registryPath = join(userDataPath, DEVICE_REGISTRY_FILENAME)
    this.load()
  }

  addDevice(name: string, scope: DeviceScope = 'mobile'): DeviceEntry {
    const entry: DeviceEntry = {
      deviceId: randomUUID(),
      name,
      token: randomBytes(24).toString('hex'),
      scope,
      pairedAt: Date.now(),
      lastSeenAt: 0
    }
    this.devices.push(entry)
    this.save()
    return entry
  }

  // Why: coalesce repeated QR-regenerate clicks onto a single pending token.
  // Each call to addDevice() produces a valid auth credential; without
  // coalescing, every renderer call to mobile:getPairingQR (e.g. the new
  // copy-button flow that encourages regeneration) leaves an orphaned token
  // forever. Returns an existing never-scanned entry if present; otherwise
  // mints a new one and drops any stale pending entries.
  getOrCreatePendingDevice(name: string, scope: DeviceScope = 'mobile'): DeviceEntry {
    const existing = this.devices.find((d) => d.lastSeenAt === 0 && d.scope === scope)
    if (existing) {
      return existing
    }
    return this.addDevice(name, scope)
  }

  // Why: explicit rotation path for "Regenerate QR" — invalidates any
  // existing never-scanned token (e.g. one that was screenshotted, copied
  // to clipboard, or shown on a screen-share) and mints a fresh one. Without
  // this, getOrCreatePendingDevice keeps returning the same token forever
  // until a phone actually pairs, so users have no way to revoke a leaked
  // pre-pairing token.
  rotatePendingDevice(name: string, scope: DeviceScope = 'mobile'): DeviceEntry {
    this.devices = this.devices.filter((d) => d.lastSeenAt !== 0 || d.scope !== scope)
    return this.addDevice(name, scope)
  }

  removeDevice(deviceId: string): boolean {
    const before = this.devices.length
    this.devices = this.devices.filter((d) => d.deviceId !== deviceId)
    if (this.devices.length < before) {
      this.save()
      return true
    }
    return false
  }

  getDevice(deviceId: string): DeviceEntry | null {
    return this.devices.find((d) => d.deviceId === deviceId) ?? null
  }

  getPendingDevice(scope: DeviceScope = 'mobile'): DeviceEntry | null {
    return this.devices.find((device) => device.lastSeenAt === 0 && device.scope === scope) ?? null
  }

  setRelayBinding(deviceId: string, binding: RelayDeviceBinding): boolean {
    const device = this.devices.find((candidate) => candidate.deviceId === deviceId)
    if (!device || binding.relayDeviceId !== deviceId) {
      return false
    }
    device.relayBinding = binding
    this.save()
    return true
  }

  setMobilePairingConnectionMode(deviceId: string, mode: MobilePairingConnectionMode): boolean {
    const device = this.devices.find((candidate) => candidate.deviceId === deviceId)
    if (!device || device.scope !== 'mobile') {
      return false
    }
    device.mobilePairingConnectionMode = mode
    this.save()
    return true
  }

  getMobilePairingConnectionMode(deviceId: string): MobilePairingConnectionMode | null {
    const device = this.devices.find((candidate) => candidate.deviceId === deviceId)
    if (!device || device.scope !== 'mobile') {
      return null
    }
    // Why: pairings created before this preference existed used automatic
    // direct-first Relay fallback, so missing state must preserve that behavior.
    return device.mobilePairingConnectionMode === 'local-only' ? 'local-only' : 'automatic'
  }

  listDevices(): readonly DeviceEntry[] {
    return this.devices
  }

  validateToken(token: string): DeviceEntry | null {
    return this.devices.find((d) => d.token === token) ?? null
  }

  updateLastSeen(deviceId: string): void {
    const device = this.devices.find((d) => d.deviceId === deviceId)
    if (device) {
      device.lastSeenAt = Date.now()
      this.save()
    }
  }

  // Why: persists the FCM token / platform / mobile persistent public key on a
  // paired device (REQ-FCM-008, REQ-FCM-009). Called by the
  // notifications.registerPushToken RPC handler after resolving the caller via
  // its auth token. Only supplied fields are written so a token refresh that
  // omits the public key does not clear it (AC-FCM-004b). Returns false when the
  // deviceId is unknown so the handler can report the outcome to the caller.
  updateDevicePushToken(deviceId: string, patch: DevicePushTokenPatch): boolean {
    const device = this.devices.find((d) => d.deviceId === deviceId)
    if (!device) {
      return false
    }
    if (patch.fcmToken !== undefined) {
      device.fcmToken = patch.fcmToken
    }
    if (patch.pushPlatform !== undefined) {
      device.pushPlatform = patch.pushPlatform
    }
    if (patch.mobilePublicKeyB64 !== undefined) {
      device.mobilePublicKeyB64 = patch.mobilePublicKeyB64
    }
    this.save()
    return true
  }

  private load(): void {
    if (!existsSync(this.registryPath)) {
      this.devices = []
      return
    }
    try {
      hardenExistingSecureFile(this.registryPath)
      const parsed = JSON.parse(readFileSync(this.registryPath, 'utf-8')) as DeviceEntry[]
      this.devices = parsed.map((device) => ({
        ...device,
        // Why: older registries only existed for phone pairing. Treat missing
        // scope as mobile so legacy device tokens do not gain new CLI powers.
        scope: device.scope === 'runtime' ? 'runtime' : 'mobile',
        relayBinding: validRelayBinding(device.relayBinding, device.deviceId),
        mobilePairingConnectionMode:
          device.mobilePairingConnectionMode === 'local-only' ? 'local-only' : 'automatic'
      }))
    } catch {
      this.devices = []
    }
  }

  private save(): void {
    writeSecureJsonFile(this.registryPath, this.devices)
  }
}
