// Tests for the desktop FCM supplemental-channel fan-out (SPEC-FCM-001, M4).
//
// These tests exercise the per-device M1+M2+M3 orchestration in isolation:
// enumerate FCM-registered devices → derive persistent shared key (M2) →
// encrypt payload (M2) → FCM send (M3), with the sender injected as a mock so
// no real OAuth round-trip runs. The listener-count GATE that decides WHEN the
// fan-out runs is covered separately in dispatch-fcm-gate.test.ts against the
// real OrcaRuntimeService.dispatchMobileNotification.
import { describe, expect, it, vi } from 'vitest'
import { decryptBytes, deriveSharedKey, generateKeyPair } from '../../shared/e2ee-crypto'
import { createFcmFanOut, type FcmFanOutDeps } from './fcm-fanout'
import type { FcmCredentials, FcmSendOutcome, FcmSender } from './fcm-sender'
import type { DeviceEntry } from './device-registry'
import type { PushPayloadInput } from './push-payload-crypto'

// Why: a hex comparator avoids Uint8Array identity pitfalls when comparing
// derived shared keys across the desktop encrypt half and the test decrypt half.
function toHex(key: Uint8Array): string {
  return Buffer.from(key).toString('hex')
}

type MockSenderBuilder = {
  sender: FcmSender
  send: ReturnType<typeof vi.fn>
}

// Why: building the mock sender via a factory keeps each test's send outcome
// configurable without leaking vi.fn state across tests.
function makeMockSender(
  outcome: FcmSendOutcome = { status: 'sent', httpStatus: 200 }
): MockSenderBuilder {
  const send = vi.fn(async (): Promise<FcmSendOutcome> => outcome)
  return { sender: { send }, send }
}

const CREDENTIALS: FcmCredentials = {
  projectId: 'orca-fcm-project',
  serviceAccountJson: JSON.stringify({ project_id: 'orca-fcm-project', client_email: 'svc@x' })
}

function makeFcmDevice(overrides: Partial<DeviceEntry> = {}): DeviceEntry {
  const mobile = generateKeyPair()
  return {
    deviceId: 'device-1',
    name: 'Pixel',
    token: 'tok',
    scope: 'mobile',
    pairedAt: 1,
    lastSeenAt: 2,
    fcmToken: 'fcm-registration-token',
    pushPlatform: 'android',
    mobilePublicKeyB64: Buffer.from(mobile.publicKey).toString('base64'),
    ...overrides
  }
}

function makeDeps(overrides: Partial<FcmFanOutDeps> = {}): {
  deps: FcmFanOutDeps
  senderBuilder: MockSenderBuilder
  createSender: ReturnType<typeof vi.fn>
} {
  const desktop = generateKeyPair()
  const senderBuilder = makeMockSender()
  const createSender = vi.fn(() => senderBuilder.sender)
  const deps: FcmFanOutDeps = {
    listFcmDevices: () => [makeFcmDevice()],
    getDesktopPersistentSecret: () => desktop.secretKey,
    getFcmCredentials: () => CREDENTIALS,
    createSender,
    ...overrides
  }
  return { deps, senderBuilder, createSender }
}

describe('createFcmFanOut — AC-FCM-002a (listener-count=0 → FCM sent)', () => {
  it('sends one FCM message per registered device with the encrypted payload + notificationId', async () => {
    const { deps, senderBuilder } = makeDeps()
    const fanOut = createFcmFanOut(deps)
    const payload: PushPayloadInput = { title: 'Agent done', body: 'task complete' }

    await fanOut({ payload, notificationId: 'notif-123' })

    expect(senderBuilder.send).toHaveBeenCalledTimes(1)
    const callArg = senderBuilder.send.mock.calls[0]![0]
    expect(callArg).toMatchObject({
      credentials: CREDENTIALS,
      deviceFcmToken: 'fcm-registration-token',
      notificationId: 'notif-123'
    })
    expect(typeof callArg.ciphertextB64).toBe('string')
    expect(callArg.ciphertextB64.length).toBeGreaterThan(0)
  })

  it('notificationId is present in the FCM send input (AC-FCM-005 cross-channel dedupe carrier)', async () => {
    const { deps, senderBuilder } = makeDeps()
    const fanOut = createFcmFanOut(deps)

    await fanOut({ payload: { title: 't', body: 'b' }, notificationId: 'dedupe-id-9' })

    expect(senderBuilder.send.mock.calls[0]![0].notificationId).toBe('dedupe-id-9')
  })

  it('produces a ciphertext the mobile half can decrypt with the same derived key (M2 integration)', async () => {
    const desktop = generateKeyPair()
    const mobile = generateKeyPair()
    const device = makeFcmDevice({
      mobilePublicKeyB64: Buffer.from(mobile.publicKey).toString('base64')
    })
    const senderBuilder = makeMockSender()
    const deps: FcmFanOutDeps = {
      listFcmDevices: () => [device],
      getDesktopPersistentSecret: () => desktop.secretKey,
      getFcmCredentials: () => CREDENTIALS,
      createSender: () => senderBuilder.sender
    }
    const fanOut = createFcmFanOut(deps)

    const payload: PushPayloadInput = { title: 'hello', body: 'world', metadata: { url: 'x' } }
    await fanOut({ payload, notificationId: 'n1' })

    const ciphertextB64 = senderBuilder.send.mock.calls[0]![0].ciphertextB64 as string
    // Why: mobile derives the shared key from its own secret + the desktop
    // public key (symmetric ECDH). If desktop derived from (desktopSecret,
    // mobilePublic) correctly, both halves match and decryption succeeds.
    const mobileDerived = deriveSharedKey(mobile.secretKey, desktop.publicKey)
    const bundle = Uint8Array.from(Buffer.from(ciphertextB64, 'base64'))
    const plaintext = decryptBytes(bundle, mobileDerived)
    expect(plaintext).not.toBeNull()
    expect(JSON.parse(new TextDecoder().decode(plaintext!))).toEqual(payload)
    expect(toHex(mobileDerived)).toBeTruthy()
  })

  it('handles multiple devices — one send per device, each with that device token', async () => {
    const { deps, senderBuilder } = makeDeps({
      listFcmDevices: () => [
        makeFcmDevice({ deviceId: 'a', fcmToken: 'tok-a' }),
        makeFcmDevice({ deviceId: 'b', fcmToken: 'tok-b' })
      ]
    })
    const fanOut = createFcmFanOut(deps)

    await fanOut({ payload: { title: 't', body: 'b' }, notificationId: 'n' })

    expect(senderBuilder.send).toHaveBeenCalledTimes(2)
    const tokens = senderBuilder.send.mock.calls.map((c) => c[0].deviceFcmToken).sort()
    expect(tokens).toEqual(['tok-a', 'tok-b'])
  })
})

describe('createFcmFanOut — pushPlatform passthrough (AC-FCM-006a / AC-FCM-006b)', () => {
  it('threads device.pushPlatform into sender.send so the sender shapes the message per platform', async () => {
    const desktop = generateKeyPair()
    const mobile = generateKeyPair()
    const androidDevice = makeFcmDevice({
      deviceId: 'droid',
      fcmToken: 'tok-droid',
      pushPlatform: 'android',
      mobilePublicKeyB64: Buffer.from(mobile.publicKey).toString('base64')
    })
    const iosDevice = makeFcmDevice({
      deviceId: 'ios',
      fcmToken: 'tok-ios',
      pushPlatform: 'ios',
      mobilePublicKeyB64: Buffer.from(mobile.publicKey).toString('base64')
    })
    const senderBuilder = makeMockSender()
    const deps: FcmFanOutDeps = {
      listFcmDevices: () => [androidDevice, iosDevice],
      getDesktopPersistentSecret: () => desktop.secretKey,
      getFcmCredentials: () => CREDENTIALS,
      createSender: () => senderBuilder.sender
    }
    const fanOut = createFcmFanOut(deps)

    await fanOut({ payload: { title: 't', body: 'b' }, notificationId: 'n' })

    expect(senderBuilder.send).toHaveBeenCalledTimes(2)
    const sentPlatforms = senderBuilder.send.mock.calls.map((c) => c[0].pushPlatform).sort()
    expect(sentPlatforms).toEqual(['android', 'ios'])
    // The platform is paired with the matching device token, not crossed.
    const byToken = Object.fromEntries(
      senderBuilder.send.mock.calls.map((c) => [c[0].deviceFcmToken, c[0].pushPlatform])
    )
    expect(byToken['tok-droid']).toBe('android')
    expect(byToken['tok-ios']).toBe('ios')
  })

  it('defaults a device with no pushPlatform to the android direct FCM path', async () => {
    // Why asserted: pushPlatform is optional on a legacy DeviceEntry, so the
    // fan-out resolves undefined → android (the FCM-native transport) rather
    // than dropping the send or erroring on a missing required sender field.
    const desktop = generateKeyPair()
    const legacyDevice = makeFcmDevice({
      deviceId: 'legacy',
      fcmToken: 'tok-legacy',
      pushPlatform: undefined,
      mobilePublicKeyB64: Buffer.from(desktop.publicKey).toString('base64')
    })
    const senderBuilder = makeMockSender()
    const deps: FcmFanOutDeps = {
      listFcmDevices: () => [legacyDevice],
      getDesktopPersistentSecret: () => desktop.secretKey,
      getFcmCredentials: () => CREDENTIALS,
      createSender: () => senderBuilder.sender
    }
    await createFcmFanOut(deps)({ payload: { title: 't', body: 'b' }, notificationId: 'n' })
    expect(senderBuilder.send.mock.calls[0]![0].pushPlatform).toBe('android')
  })
})

describe('createFcmFanOut — graceful degradation (skip paths)', () => {
  it('does NOT send when no FCM credential is onboarded', async () => {
    const { deps, senderBuilder } = makeDeps({ getFcmCredentials: () => null })
    await createFcmFanOut(deps)({ payload: { title: 't', body: 'b' }, notificationId: 'n' })
    expect(senderBuilder.send).not.toHaveBeenCalled()
  })

  it('does NOT send when the desktop persistent secret is unavailable', async () => {
    const { deps, senderBuilder } = makeDeps({ getDesktopPersistentSecret: () => null })
    await createFcmFanOut(deps)({ payload: { title: 't', body: 'b' }, notificationId: 'n' })
    expect(senderBuilder.send).not.toHaveBeenCalled()
  })

  it('does NOT send when there are no FCM-registered devices', async () => {
    const { deps, senderBuilder } = makeDeps({ listFcmDevices: () => [] })
    await createFcmFanOut(deps)({ payload: { title: 't', body: 'b' }, notificationId: 'n' })
    expect(senderBuilder.send).not.toHaveBeenCalled()
  })

  it('skips a device whose payload exceeds the 4KB cap even after truncation (dropped outcome)', async () => {
    // Why: a title longer than the FCM data cap cannot fit even with body
    // truncation, so encryptPushPayload returns `dropped` and the fan-out must
    // NOT emit a malformed FCM message for that device.
    const hugeTitle = 'x'.repeat(5000)
    const { deps, senderBuilder } = makeDeps()
    await createFcmFanOut(deps)({ payload: { title: hugeTitle, body: 'b' }, notificationId: 'n' })
    expect(senderBuilder.send).not.toHaveBeenCalled()
  })

  it('skips a device missing fcmToken or mobilePublicKeyB64 but still sends to the others', async () => {
    const { deps, senderBuilder } = makeDeps({
      listFcmDevices: () => [
        makeFcmDevice({ deviceId: 'no-token', fcmToken: undefined }),
        makeFcmDevice({ deviceId: 'no-pubkey', mobilePublicKeyB64: undefined }),
        makeFcmDevice({ deviceId: 'ok', fcmToken: 'tok-ok' })
      ]
    })
    await createFcmFanOut(deps)({ payload: { title: 't', body: 'b' }, notificationId: 'n' })
    expect(senderBuilder.send).toHaveBeenCalledTimes(1)
    expect(senderBuilder.send.mock.calls[0]![0].deviceFcmToken).toBe('tok-ok')
  })
})

describe('createFcmFanOut — non-blocking (REQ-FCM-014)', () => {
  it('resolves without throwing when sender.send rejects', async () => {
    const senderBuilder = makeMockSender()
    senderBuilder.send.mockRejectedValueOnce(new Error('network blew up'))
    const desktop = generateKeyPair()
    const deps: FcmFanOutDeps = {
      listFcmDevices: () => [makeFcmDevice()],
      getDesktopPersistentSecret: () => desktop.secretKey,
      getFcmCredentials: () => CREDENTIALS,
      createSender: () => senderBuilder.sender
    }
    const fanOut = createFcmFanOut(deps)
    await expect(
      fanOut({ payload: { title: 't', body: 'b' }, notificationId: 'n' })
    ).resolves.toBeUndefined()
  })

  it('one device failure does not abort sends to the other devices', async () => {
    const send = vi.fn(async (input: { deviceFcmToken: string }): Promise<FcmSendOutcome> => {
      if (input.deviceFcmToken === 'tok-a') {
        throw new Error('per-device failure')
      }
      return { status: 'sent', httpStatus: 200 }
    })
    const desktop = generateKeyPair()
    const deps: FcmFanOutDeps = {
      listFcmDevices: () => [
        makeFcmDevice({ deviceId: 'a', fcmToken: 'tok-a' }),
        makeFcmDevice({ deviceId: 'b', fcmToken: 'tok-b' })
      ],
      getDesktopPersistentSecret: () => desktop.secretKey,
      getFcmCredentials: () => CREDENTIALS,
      createSender: () => ({ send })
    }
    const fanOut = createFcmFanOut(deps)
    await expect(
      fanOut({ payload: { title: 't', body: 'b' }, notificationId: 'n' })
    ).resolves.toBeUndefined()
    // Why: both devices were attempted — the failure on `a` did not short-circuit `b`.
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('createSender is invoked once so the M3 OAuth token cache is reused across sends', async () => {
    const { deps, createSender } = makeDeps({
      listFcmDevices: () => [makeFcmDevice({ deviceId: 'a' }), makeFcmDevice({ deviceId: 'b' })]
    })
    await createFcmFanOut(deps)({ payload: { title: 't', body: 'b' }, notificationId: 'n' })
    expect(createSender).toHaveBeenCalledTimes(1)
  })
})
