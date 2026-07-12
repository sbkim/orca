import { beforeEach, describe, expect, it, vi } from 'vitest'

// Why: isolate the receiver from the RN import chain + the decrypt/crypto
// primitives (those are proven independently in push-payload-decrypt.test.ts
// and fcm-payload-cross-platform.test.ts). Here we verify the receiver's own
// orchestration: per-host try-decrypt, field validation, event construction,
// and delegation to the local-notification path. The mocked bindings are vi.fn
// spies directly (no wrapper) so call/arg assertions work.
vi.mock('./push-payload-decrypt', () => ({
  // Why: opaque shared key — the real ECDH crypto is proven in the dedicated
  // cross-platform test. Here the key is just a per-call token so decryptPushPayload
  // can be keyed off the call sequence.
  deriveMobileFcmSharedKey: vi.fn(() => new Uint8Array(32).fill(7)),
  decryptPushPayload: vi.fn()
}))

vi.mock('../transport/host-store', () => ({
  loadHosts: vi.fn()
}))

vi.mock('./mobile-notifications', () => ({
  showLocalNotification: vi.fn()
}))

const storage = new Map<string, string>()
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      storage.set(key, value)
    }
  }
}))

import { decryptPushPayload, deriveMobileFcmSharedKey } from './push-payload-decrypt'
import { loadHosts } from '../transport/host-store'
import { showLocalNotification } from './mobile-notifications'
import { handleFcmDataNotification } from './fcm-push-receiver'

// Why: the M1 push-keypair record shape (push-keypair.ts writes this). The
// receiver reads secretKeyB64 read-only without modifying push-keypair.ts.
const PUSH_KEYPAIR_RECORD = JSON.stringify({
  secretKeyB64: Buffer.from(new Uint8Array(32).fill(9)).toString('base64'),
  publicKeyB64: Buffer.from(new Uint8Array(32).fill(3)).toString('base64')
})

// Why: makes decryptPushPayload return ok on a specific 1-based call index and
// error otherwise — simulating "only host N has the matching key" without
// coupling the test to the real key-derivation math.
function decryptOkOnCall(okCallIndex: number): void {
  let calls = 0
  const mocked = decryptPushPayload as unknown as ReturnType<typeof vi.fn>
  mocked.mockImplementation(() => {
    calls += 1
    if (calls === okCallIndex) {
      return { status: 'ok', payload: { title: `T-${okCallIndex}`, body: `B-${okCallIndex}` } }
    }
    return { status: 'error', reason: 'wrong key' }
  })
}

describe('handleFcmDataNotification — field validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.clear()
    storage.set('orca:push-keypair', PUSH_KEYPAIR_RECORD)
  })

  it('is a no-op when data.payload is missing', async () => {
    await handleFcmDataNotification({ notificationId: 'n1' })
    expect(showLocalNotification).not.toHaveBeenCalled()
  })

  it('is a no-op when notificationId is missing (no dedupe key)', async () => {
    await handleFcmDataNotification({ payload: 'abc' })
    expect(showLocalNotification).not.toHaveBeenCalled()
  })
})

describe('handleFcmDataNotification — per-host try-decrypt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.clear()
    storage.set('orca:push-keypair', PUSH_KEYPAIR_RECORD)
  })

  it('tries hosts in order, stops at the first that decrypts, presents once', async () => {
    ;(loadHosts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'host-a', publicKeyB64: 'pk-a', name: 'A', endpoint: 'e', deviceToken: 't' },
      { id: 'host-b', publicKeyB64: 'pk-b', name: 'B', endpoint: 'e', deviceToken: 't' }
    ])
    // Why: host-a fails, host-b succeeds (2nd call) — receiver must stop there.
    decryptOkOnCall(2)

    await handleFcmDataNotification({ payload: 'enc-bundle', notificationId: 'n3' })

    expect(showLocalNotification).toHaveBeenCalledTimes(1)
    const [event, hostId] = (showLocalNotification as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(hostId).toBe('host-b')
    expect(event.notificationId).toBe('n3')
    expect(event.title).toBe('T-2')
    expect(event.type).toBe('notification')

    // Why: the receiver MUST derive the key from each host's own desktop
    // persistent public key (host.publicKeyB64), in order, stopping at success.
    const derive = deriveMobileFcmSharedKey as unknown as ReturnType<typeof vi.fn>
    expect(derive).toHaveBeenCalledTimes(2)
    expect(derive.mock.calls[0][1]).toBe('pk-a')
    expect(derive.mock.calls[1][1]).toBe('pk-b')
  })

  it('presents on the first host when it decrypts immediately (no extra derivations)', async () => {
    ;(loadHosts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'host-a', publicKeyB64: 'pk-a', name: 'A', endpoint: 'e', deviceToken: 't' },
      { id: 'host-b', publicKeyB64: 'pk-b', name: 'B', endpoint: 'e', deviceToken: 't' }
    ])
    decryptOkOnCall(1)

    await handleFcmDataNotification({ payload: 'enc-bundle', notificationId: 'n3' })

    expect(showLocalNotification).toHaveBeenCalledTimes(1)
    expect((showLocalNotification as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe('host-a')
    // Why: first host succeeded — the receiver must NOT derive for host-b.
    expect(deriveMobileFcmSharedKey).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when no host can decrypt (foreign/tampered payload)', async () => {
    ;(loadHosts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'host-a', publicKeyB64: 'pk-a', name: 'A', endpoint: 'e', deviceToken: 't' }
    ])
    const mocked = decryptPushPayload as unknown as ReturnType<typeof vi.fn>
    mocked.mockReturnValue({ status: 'error', reason: 'wrong key' })

    await handleFcmDataNotification({ payload: 'enc-bundle', notificationId: 'n3' })

    expect(showLocalNotification).not.toHaveBeenCalled()
  })

  it('is a no-op when the mobile persistent secret is absent', async () => {
    // Why: a device that never generated/loaded its persistent push keypair
    // cannot derive the shared key — must never present a notification.
    storage.delete('orca:push-keypair')
    ;(loadHosts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'host-a', publicKeyB64: 'pk-a', name: 'A', endpoint: 'e', deviceToken: 't' }
    ])
    decryptOkOnCall(1)

    await handleFcmDataNotification({ payload: 'enc-bundle', notificationId: 'n3' })

    expect(showLocalNotification).not.toHaveBeenCalled()
    expect(deriveMobileFcmSharedKey).not.toHaveBeenCalled()
  })

  it('is a no-op when no hosts are paired', async () => {
    ;(loadHosts as ReturnType<typeof vi.fn>).mockResolvedValue([])
    decryptOkOnCall(1)

    await handleFcmDataNotification({ payload: 'enc-bundle', notificationId: 'n3' })

    expect(showLocalNotification).not.toHaveBeenCalled()
  })

  it('constructs the event with the fcm-supplemental source marker', async () => {
    ;(loadHosts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'host-a', publicKeyB64: 'pk-a', name: 'A', endpoint: 'e', deviceToken: 't' }
    ])
    decryptOkOnCall(1)

    await handleFcmDataNotification({ payload: 'enc-bundle', notificationId: 'n3' })

    const event = (showLocalNotification as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(event.source).toBe('fcm-supplemental')
    expect(event.notificationId).toBe('n3')
  })
})
