import { beforeEach, describe, expect, it, vi } from 'vitest'

// Why: AC-FCM-005 (single-notificationId cross-channel dedupe) and AC-FCM-009
// (permission/toggle gate) MUST be exercised through the REAL showLocalNotification
// path — the dedupe map + gate live there and the FCM receiver reuses them. So
// this file does NOT mock ./mobile-notifications; instead it mocks the lower-level
// RN/permissions dependencies that showLocalNotification calls, and the receiver's
// own decrypt/host/secret dependencies.

vi.mock('./push-payload-decrypt', () => ({
  deriveMobileFcmSharedKey: vi.fn(() => new Uint8Array(32).fill(7)),
  decryptPushPayload: vi.fn(() => ({
    status: 'ok',
    payload: { title: 'FCM title', body: 'FCM body' }
  }))
}))

vi.mock('../transport/host-store', () => ({
  loadHosts: vi.fn(async () => [
    { id: 'host-1', publicKeyB64: 'pk-1', name: 'H1', endpoint: 'e', deviceToken: 't' }
  ])
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

// Why: vi.mock factories are hoisted above imports, so the schedule spy must be
// created via vi.hoisted to avoid a temporal-dead-zone reference.
const { scheduleAsync } = vi.hoisted(() => ({
  scheduleAsync: vi.fn(async () => 'sched-id')
}))
vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 'high' },
  setNotificationChannelAsync: vi.fn(async () => undefined),
  getPermissionsAsync: vi.fn(async () => ({ status: 'granted', canAskAgain: true })),
  requestPermissionsAsync: vi.fn(async () => ({ status: 'granted' })),
  scheduleNotificationAsync: scheduleAsync,
  dismissNotificationAsync: vi.fn(async () => undefined)
}))

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))

vi.mock('../storage/preferences', () => ({
  loadPushNotificationsEnabled: vi.fn(async () => true)
}))

import { loadPushNotificationsEnabled } from '../storage/preferences'
import * as Notifications from 'expo-notifications'
import { setScheduledNotificationsMaxForTests, showLocalNotification } from './mobile-notifications'
import { handleFcmDataNotification } from './fcm-push-receiver'

const PUSH_KEYPAIR_RECORD = JSON.stringify({
  secretKeyB64: Buffer.from(new Uint8Array(32).fill(9)).toString('base64'),
  publicKeyB64: Buffer.from(new Uint8Array(32).fill(3)).toString('base64')
})

describe('AC-FCM-009 — permission/toggle gate (FCM reuses the WS gate)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.clear()
    storage.set('orca:push-keypair', PUSH_KEYPAIR_RECORD)
    setScheduledNotificationsMaxForTests(256)
    ;(loadPushNotificationsEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    ;(Notifications.getPermissionsAsync as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'granted',
      canAskAgain: true
    })
    ;(
      Notifications.requestPermissionsAsync as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      status: 'granted'
    })
    scheduleAsync.mockResolvedValue('sched-id')
  })

  it('presents a local notification when toggle is ON and permission is GRANTED', async () => {
    await handleFcmDataNotification({ payload: 'enc', notificationId: 'g1' })
    expect(scheduleAsync).toHaveBeenCalledTimes(1)
  })

  it('suppresses the notification when the toggle is OFF', async () => {
    // Why: AC-FCM-009 — loadPushNotificationsEnabled === false means FCM-received
    // notifications MUST NOT be shown, same gate as the WS path.
    ;(loadPushNotificationsEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    await handleFcmDataNotification({ payload: 'enc', notificationId: 'g2' })
    expect(scheduleAsync).not.toHaveBeenCalled()
  })

  it('suppresses the notification when permission is DENIED', async () => {
    ;(Notifications.getPermissionsAsync as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'denied',
      canAskAgain: false
    })
    ;(
      Notifications.requestPermissionsAsync as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      status: 'denied'
    })
    await handleFcmDataNotification({ payload: 'enc', notificationId: 'g3' })
    expect(scheduleAsync).not.toHaveBeenCalled()
  })
})

describe('AC-FCM-005 — single notificationId dedupe across WS + FCM', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.clear()
    storage.set('orca:push-keypair', PUSH_KEYPAIR_RECORD)
    setScheduledNotificationsMaxForTests(256)
    ;(loadPushNotificationsEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    ;(Notifications.getPermissionsAsync as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'granted',
      canAskAgain: true
    })
    scheduleAsync.mockResolvedValue('sched-id')
  })

  function makeDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((next) => {
      resolve = next
    })
    return { promise, resolve }
  }

  it('suppresses the FCM arrival while a WS delivery of the same notificationId is in flight', async () => {
    // Why: AC-FCM-005 — the dedupe map is keyed ${hostId}:notificationId and is
    // SHARED between the WS path (showLocalNotification) and the FCM path
    // (receiver -> showLocalNotification). A notification delivered via BOTH
    // channels must show exactly once. The pending window (the WS schedule
    // still in flight when FCM arrives) is the deterministic suppression path.
    const sharedNotificationId = 'ws-fcm-001'
    const deferred = makeDeferred<string>()
    scheduleAsync.mockReturnValue(deferred.promise)

    // WS path delivers first — fire WITHOUT awaiting so its in-flight pending
    // state stays live (it resolves only when the deferred resolves).
    void showLocalNotification(
      {
        type: 'notification',
        source: 'agent-task-complete',
        title: 'WS title',
        body: 'WS body',
        notificationId: sharedNotificationId
      },
      'host-1'
    )
    // Let the WS pending IIFE reach the schedule call + set state.pending.
    await Promise.resolve()

    // FCM path delivers the SAME notificationId for the SAME host while the WS
    // schedule is still in flight.
    await handleFcmDataNotification({ payload: 'enc', notificationId: sharedNotificationId })

    // Why: exactly one schedule call — the FCM arrival was suppressed because
    // the WS arrival holds the shared ${hostId}:notificationId entry's pending
    // slot. Resolving the deferred lets the WS schedule settle.
    expect(scheduleAsync).toHaveBeenCalledTimes(1)
    deferred.resolve('sched-id')
    await Promise.resolve()
  })

  it('shows two local notifications when WS and FCM carry DIFFERENT notificationIds', async () => {
    // Why: converse of AC-FCM-005 — distinct notificationIds are distinct
    // events and must NOT be deduped against each other.
    await showLocalNotification(
      {
        type: 'notification',
        source: 'agent-task-complete',
        title: 'WS',
        body: 'b',
        notificationId: 'distinct-a'
      },
      'host-1'
    )
    await handleFcmDataNotification({ payload: 'enc', notificationId: 'distinct-b' })
    expect(scheduleAsync).toHaveBeenCalledTimes(2)
  })
})
