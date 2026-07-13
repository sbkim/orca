// Full dispatch-path integration test for the FCM supplemental channel
// (SPEC-FCM-001, M7).
//
// Why: M4's fcm-fanout.test.ts and dispatch-fcm-gate.test.ts each verified one
// half — the per-device fan-out chain in isolation, and the listener-count gate
// in isolation. M7's integration proof wires the REAL M1→M2→M3→M4→M6 chain
// end-to-end at the test level and drives it through the real
// dispatchMobileNotification entry point, so a contract drift anywhere along
// the seam (device enumeration shape, key arg order, payload bundle format,
// platform branching, notificationId carrier, FCM POST shape) surfaces here.
//
// What is REAL vs injected:
//   REAL  — OrcaRuntimeService.dispatchMobileNotification + the M4 gate branch
//           (the actual ADDITIVE fan-out trigger)
//   REAL  — createFcmFanOut (M4 orchestration: enumerate → derive → encrypt → send)
//   REAL  — createFcmSender (M3 sender: OAuth cache + FCM v1 POST + redact + platform)
//   REAL  — M2 crypto (deriveFcmSharedKey + encryptPushPayload, exercised inside fan-out)
//   REAL  — DeviceRegistry (M1: a real on-disk registry with a registered FCM device)
//   INJECTED — mintAccessToken (the live Google OAuth round-trip is out of test scope)
//   INJECTED — fetchImpl (the live FCM HTTP POST is out of test scope)
//
// The mobile decrypt half uses the shared E2EE primitives (deriveSharedKey +
// decryptBytes) — the same cross-platform proof M4 used and M5 showed is
// byte-identical to the mobile deriveMobileFcmSharedKey + decryptPushPayload.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as GitUsernameModule from '../git/git-username'
import { decryptBytes, deriveSharedKey, generateKeyPair } from '../../shared/e2ee-crypto'
import { DeviceRegistry } from './device-registry'
import { createFcmFanOut } from './fcm-fanout'
import { createFcmSender, type FcmCredentials, type FcmAccessToken } from './fcm-sender'
import { OrcaRuntimeService, type MobileNotificationEvent } from './orca-runtime'

vi.mock('../git/worktree', () => ({
  listWorktrees: vi.fn().mockResolvedValue([]),
  listWorktreesStrict: vi.fn().mockResolvedValue([])
}))
vi.mock('../hooks', () => ({
  createSetupRunnerScript: vi.fn(),
  getEffectiveHooks: vi.fn().mockReturnValue(null),
  runHook: vi.fn().mockResolvedValue({ success: true, output: '' })
}))
vi.mock('../ipc/worktree-logic', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, computeWorktreePath: vi.fn(), ensurePathWithinWorkspace: vi.fn() }
})
vi.mock('../ipc/filesystem-auth', () => ({ invalidateAuthorizedRootsCache: vi.fn() }))
vi.mock('../git/repo', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    getDefaultBaseRef: vi.fn().mockReturnValue('origin/main'),
    getBranchConflictKind: vi.fn().mockResolvedValue(null)
  }
})
vi.mock('../git/git-username', async () => {
  const actual = await vi.importActual<typeof GitUsernameModule>('../git/git-username')
  return { ...actual, resolveLocalGitUsername: vi.fn(async () => '') }
})

const store = {
  getRepo: () => ({
    id: 'repo-1',
    path: '/tmp/repo',
    displayName: 'repo',
    badgeColor: 'blue',
    addedAt: 1
  }),
  getRepos: () => [store.getRepo()],
  addRepo: () => {},
  updateRepo: () => undefined as never,
  getAllWorktreeMeta: () => ({}),
  getWorktreeMeta: () => undefined,
  getGitHubCache: () => ({ pr: {}, issue: {} }),
  setWorktreeMeta: () => undefined as never,
  removeWorktreeMeta: () => {},
  getSettings: () => ({
    workspaceDir: '/tmp/workspaces',
    nestWorkspaces: false,
    refreshLocalBaseRefOnWorktreeCreate: false,
    branchPrefix: 'none',
    branchPrefixCustom: '',
    mobileAutoRestoreFitMs: 5_000
  })
}

function makeResponse(init: { status?: number; body?: string } = {}): Response {
  const status = init.status ?? 200
  const body = init.body ?? '{}'
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body)
  } as Response
}

const CREDENTIALS: FcmCredentials = {
  projectId: 'orca-fcm-project',
  serviceAccountJson: JSON.stringify({ project_id: 'orca-fcm-project', client_email: 'svc@x' })
}

// Why: a fixed token + far-future expiry means the M3 OAuth cache mints exactly
// once and reuses on every send, so the count of minter invocations is itself
// an assertion that the cache works across the dispatch path.
const MINTED_TOKEN: FcmAccessToken = {
  token: 'integration-access-token',
  expiresAtMs: Date.now() + 3_600_000
}

type Harness = {
  runtime: OrcaRuntimeService
  registry: DeviceRegistry
  desktop: { secretKey: Uint8Array; publicKey: Uint8Array }
  fetchImpl: ReturnType<typeof vi.fn>
  minter: ReturnType<typeof vi.fn>
  cleanup: () => void
}

// Why: builds the full real chain. The desktop + mobile persistent keypairs are
// generated up front so the device's mobilePublicKeyB64 and the desktop's
// persistent secret produce a shared key the mobile half can re-derive. The
// fan-out is wired exactly the way src/main/index.ts wires it in production
// (createFcmFanOut over a registry + desktop secret + credentials + sender
// factory), and set on the runtime so dispatchMobileNotification triggers it.
function makeHarness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'orca-fcm-int-'))
  const registry = new DeviceRegistry(dir)
  const desktop = generateKeyPair()
  const minter = vi.fn(async (): Promise<FcmAccessToken> => ({ ...MINTED_TOKEN }))
  const fetchImpl = vi.fn(async (): Promise<Response> => makeResponse({ status: 200 }))
  const runtime = new OrcaRuntimeService(store)
  runtime.setFcmFanOut(
    createFcmFanOut({
      listFcmDevices: () => {
        return registry
          .listDevices()
          .filter((d) => typeof d.fcmToken === 'string' && typeof d.mobilePublicKeyB64 === 'string')
      },
      getDesktopPersistentSecret: () => desktop.secretKey,
      getFcmCredentials: () => CREDENTIALS,
      createSender: () => createFcmSender({ mintAccessToken: minter, fetchImpl })
    })
  )
  return {
    runtime,
    registry,
    desktop,
    fetchImpl,
    minter,
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  }
}

// Why: the fan-out hook is fired via `void fanOut().catch()` — non-blocking and
// off the sync dispatch caller's stack. The chain fans out through several
// awaits (Promise.all → per-device derive/encrypt/send → getAccessToken → fetch).
// vi.waitFor tolerates that scheduling without a brittle fixed await count.
async function flushUntilCalled(
  fetchImpl: ReturnType<typeof vi.fn>
): Promise<{ url: string; init: RequestInit }> {
  return vi.waitFor(() => {
    expect(fetchImpl).toHaveBeenCalled()
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    return { url, init }
  })
}

// Why: registers a paired device then attaches the FCM token + platform +
// persistent mobile public key via the same updateDevicePushToken path the M1
// notifications.registerPushToken RPC uses — so the device the fan-out
// enumerates is shaped exactly like production.
function registerDevice(
  registry: DeviceRegistry,
  mobilePublic: Uint8Array,
  overrides: { fcmToken?: string; pushPlatform?: 'android' | 'ios' }
): { deviceId: string; fcmToken: string } {
  const device = registry.addDevice('Pixel', 'mobile')
  const fcmToken = overrides.fcmToken ?? `fcm-token-${device.deviceId}`
  registry.updateDevicePushToken(device.deviceId, {
    fcmToken,
    pushPlatform: overrides.pushPlatform ?? 'android',
    mobilePublicKeyB64: Buffer.from(mobilePublic).toString('base64')
  })
  return { deviceId: device.deviceId, fcmToken }
}

const DISPATCH_EVENT: MobileNotificationEvent = {
  type: 'notification',
  source: 'agent-task-complete',
  title: 'Agent finished the task',
  body: 'Completed build + tests',
  notificationId: 'integration-notif-1'
}

let harnesses: Harness[] = []

beforeEach(() => {
  harnesses = []
})
afterEach(() => {
  for (const h of harnesses) {
    h.cleanup()
  }
  harnesses = []
})

function track<T extends Harness>(h: T): T {
  harnesses.push(h)
  return h
}

describe('dispatch-path integration — M1→M6 chain fires end-to-end when no WS listener is connected', () => {
  it('POSTs a data-only FCM v1 message to every FCM-registered device (AC-FCM-002a end-to-end)', async () => {
    const h = track(makeHarness())
    const mobile = generateKeyPair()
    const { fcmToken } = registerDevice(h.registry, mobile.publicKey, {
      fcmToken: 'pixel-registration-token'
    })
    expect(h.runtime.getMobileNotificationListenerCount()).toBe(0)

    h.runtime.dispatchMobileNotification(DISPATCH_EVENT)
    const { url, init } = await flushUntilCalled(h.fetchImpl)

    // M3 sender URL + auth shape.
    expect(url).toBe('https://fcm.googleapis.com/v1/projects/orca-fcm-project/messages:send')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer integration-access-token'
    )
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')

    // M1 device enumeration: the device's fcmToken is the FCM message target.
    const body = JSON.parse(init.body as string) as {
      message: { token: string; data: Record<string, string> }
    }
    expect(body.message.token).toBe(fcmToken)
    expect(body.message.token).toBe('pixel-registration-token')

    // AC-FCM-005: notificationId rides in the data map as the cross-channel
    // dedupe carrier.
    expect(body.message.data.notificationId).toBe('integration-notif-1')
    // E2EE: data carries an opaque base64 payload, never plaintext title/body.
    expect(body.message.data.payload).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    expect(JSON.stringify(body.message)).not.toContain('Agent finished the task')
    expect(JSON.stringify(body.message)).not.toContain('Completed build + tests')
  })

  it('produces a ciphertext the mobile half decrypts to the byte-identical original (M2 ↔ M5 cross-platform round-trip)', async () => {
    const h = track(makeHarness())
    const mobile = generateKeyPair()
    registerDevice(h.registry, mobile.publicKey, {})

    h.runtime.dispatchMobileNotification(DISPATCH_EVENT)
    const { init } = await flushUntilCalled(h.fetchImpl)
    const body = JSON.parse(init.body as string) as {
      message: { data: { payload: string } }
    }

    // Why: the mobile half re-derives the persistent FCM-shared key from its
    // OWN secret + the desktop's PUBLIC key (symmetric ECDH). If M2's desktop
    // derivation used the wrong arg order or a stale key, this decrypt fails.
    const mobileDerived = deriveSharedKey(mobile.secretKey, h.desktop.publicKey)
    const bundle = Uint8Array.from(Buffer.from(body.message.data.payload, 'base64'))
    const plaintext = decryptBytes(bundle, mobileDerived)
    expect(plaintext).not.toBeNull()
    expect(JSON.parse(new TextDecoder().decode(plaintext!))).toEqual({
      title: 'Agent finished the task',
      body: 'Completed build + tests'
    })

    // The OAuth cache mints exactly once across the single device's single send.
    expect(h.minter).toHaveBeenCalledTimes(1)
  })

  it('shapes the FCM message per M6 platform branching — android direct HIGH priority, ios via APNs content-available', async () => {
    // android device
    const androidH = track(makeHarness())
    const androidMobile = generateKeyPair()
    registerDevice(androidH.registry, androidMobile.publicKey, {
      fcmToken: 'tok-android',
      pushPlatform: 'android'
    })
    androidH.runtime.dispatchMobileNotification(DISPATCH_EVENT)
    const androidCall = await flushUntilCalled(androidH.fetchImpl)
    const androidBody = JSON.parse(androidCall.init.body as string) as {
      message: {
        android?: { priority: string }
        apns?: unknown
        notification?: unknown
        data: Record<string, string>
      }
    }
    expect(androidBody.message.android).toEqual({ priority: 'HIGH' })
    expect(androidBody.message.apns).toBeUndefined()
    expect(androidBody.message.notification).toBeUndefined()

    // ios device
    const iosH = track(makeHarness())
    const iosMobile = generateKeyPair()
    registerDevice(iosH.registry, iosMobile.publicKey, {
      fcmToken: 'tok-ios',
      pushPlatform: 'ios'
    })
    iosH.runtime.dispatchMobileNotification(DISPATCH_EVENT)
    const iosCall = await flushUntilCalled(iosH.fetchImpl)
    const iosBody = JSON.parse(iosCall.init.body as string) as {
      message: {
        android?: unknown
        apns?: { headers: Record<string, string>; payload: { aps: Record<string, number> } }
        notification?: unknown
      }
    }
    expect(iosBody.message.apns).toEqual({
      headers: { 'apns-priority': '5', 'apns-push-type': 'background' },
      payload: { aps: { 'content-available': 1 } }
    })
    expect(iosBody.message.android).toBeUndefined()
    expect(iosBody.message.notification).toBeUndefined()
  })

  it('stays WS-only and skips FCM entirely when a subscriber is connected (AC-FCM-002b integration)', async () => {
    const h = track(makeHarness())
    const mobile = generateKeyPair()
    registerDevice(h.registry, mobile.publicKey, {})
    // Why: a live subscriber makes the M4 gate short-circuit — the fan-out hook
    // is never invoked, so the real sender's fetch is never called even though a
    // fully-capable device + credentials are wired. This is the integration-level
    // proof that the gate, not the fan-out, owns the WS-first decision.
    h.runtime.onNotificationDispatched(() => undefined)
    expect(h.runtime.getMobileNotificationListenerCount()).toBe(1)

    h.runtime.dispatchMobileNotification(DISPATCH_EVENT)
    // Give the async hook every chance to have been (wrongly) called.
    await new Promise((resolve) => setTimeout(resolve, 5))

    expect(h.fetchImpl).not.toHaveBeenCalled()
    expect(h.minter).not.toHaveBeenCalled()
  })

  it('fan-out never throws into the synchronous dispatch caller even when the chain rejects (REQ-FCM-014 integration)', async () => {
    const h = track(makeHarness())
    const mobile = generateKeyPair()
    registerDevice(h.registry, mobile.publicKey, {})
    // Why: a throwing minter surfaces as a failed send inside the chain; the
    // dispatch caller is sync and must stay insulated. This is the integration
    // confirmation of M3/M4's non-blocking contract at the dispatch entry point.
    h.minter.mockRejectedValueOnce(new Error('oauth endpoint down'))

    expect(() => h.runtime.dispatchMobileNotification(DISPATCH_EVENT)).not.toThrow()
    // Let the swallowed rejection settle so it does not bleed into later tests.
    await new Promise((resolve) => setTimeout(resolve, 5))
  })
})
