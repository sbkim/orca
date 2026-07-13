import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'
import {
  setScheduledNotificationsMaxForTests,
  showLocalNotification,
  subscribeToDesktopNotifications
} from './mobile-notifications'
import type { RpcClient } from '../transport/rpc-client'
import { loadPushNotificationsEnabled } from '../storage/preferences'

vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 'high' },
  setNotificationChannelAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  dismissNotificationAsync: vi.fn()
}))

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' }
}))

vi.mock('../storage/preferences', () => ({
  loadPushNotificationsEnabled: vi.fn()
}))

describe('subscribeToDesktopNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function flushAsync(): Promise<void> {
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve()
    }
  }

  function makeDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((next) => {
      resolve = next
    })
    return { promise, resolve }
  }

  it('drops the local stream when disposed before the desktop returns ready', () => {
    const unsubscribeStream = vi.fn()
    const client = {
      subscribe: vi.fn(() => unsubscribeStream),
      getState: vi.fn(() => 'connected'),
      sendRequest: vi.fn()
    } as unknown as RpcClient

    const unsubscribe = subscribeToDesktopNotifications(client, 'host-1')
    unsubscribe()

    expect(unsubscribeStream).toHaveBeenCalledTimes(1)
    expect(client.sendRequest).not.toHaveBeenCalled()
  })

  it('stores scheduled notification identifiers, replaces duplicates, and dismisses by id', async () => {
    vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: 'granted',
      canAskAgain: true
    } as never)
    vi.mocked(Notifications.scheduleNotificationAsync)
      .mockResolvedValueOnce('scheduled-1')
      .mockResolvedValueOnce('scheduled-2')
    vi.mocked(Notifications.dismissNotificationAsync).mockResolvedValue(undefined)
    let onEvent: ((data: unknown) => void) | null = null
    const client = {
      subscribe: vi.fn((_method, _params, callback: (data: unknown) => void) => {
        onEvent = callback
        return vi.fn()
      }),
      getState: vi.fn(() => 'connected'),
      sendRequest: vi.fn()
    } as unknown as RpcClient

    subscribeToDesktopNotifications(client, 'host-1')
    onEvent?.({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'Done',
      body: 'Finished.',
      worktreeId: 'repo::/tmp/worktree',
      notificationId: 'agent:one'
    })
    await flushAsync()
    onEvent?.({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'Done again',
      body: 'Finished again.',
      notificationId: 'agent:one'
    })
    await flushAsync()
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2)
    onEvent?.({ type: 'dismiss', notificationId: 'agent:one' })
    await flushAsync()

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2)
    expect(Notifications.scheduleNotificationAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        content: expect.objectContaining({
          data: expect.objectContaining({
            hostId: 'host-1',
            notificationId: 'agent:one',
            worktreeId: 'repo::/tmp/worktree'
          })
        })
      })
    )
    expect(Notifications.dismissNotificationAsync).toHaveBeenNthCalledWith(1, 'scheduled-1')
    expect(Notifications.dismissNotificationAsync).toHaveBeenNthCalledWith(2, 'scheduled-2')
  })

  it('dedupes concurrent notification events with the same desktop notification id', async () => {
    vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: 'granted',
      canAskAgain: true
    } as never)
    vi.mocked(Notifications.scheduleNotificationAsync).mockResolvedValue('scheduled-1')
    let onEvent: ((data: unknown) => void) | null = null
    const client = {
      subscribe: vi.fn((_method, _params, callback: (data: unknown) => void) => {
        onEvent = callback
        return vi.fn()
      }),
      getState: vi.fn(() => 'connected'),
      sendRequest: vi.fn()
    } as unknown as RpcClient

    subscribeToDesktopNotifications(client, 'host-concurrent')
    onEvent?.({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'Done',
      body: 'Finished.',
      notificationId: 'agent:concurrent'
    })
    onEvent?.({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'Done',
      body: 'Finished.',
      notificationId: 'agent:concurrent'
    })
    await flushAsync()

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1)
  })

  it('dismisses a notification when dismiss arrives while scheduling is pending', async () => {
    vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: 'granted',
      canAskAgain: true
    } as never)
    let resolveSchedule!: (identifier: string) => void
    vi.mocked(Notifications.scheduleNotificationAsync).mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveSchedule = resolve
        })
    )
    vi.mocked(Notifications.dismissNotificationAsync).mockResolvedValue(undefined)
    let onEvent: ((data: unknown) => void) | null = null
    const client = {
      subscribe: vi.fn((_method, _params, callback: (data: unknown) => void) => {
        onEvent = callback
        return vi.fn()
      }),
      getState: vi.fn(() => 'connected'),
      sendRequest: vi.fn()
    } as unknown as RpcClient

    subscribeToDesktopNotifications(client, 'host-dismiss-race')
    onEvent?.({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'Done',
      body: 'Finished.',
      notificationId: 'agent:pending'
    })
    await flushAsync()
    onEvent?.({ type: 'dismiss', notificationId: 'agent:pending' })
    resolveSchedule('scheduled-pending')
    await flushAsync()

    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('scheduled-pending')
  })

  it('does not carry a failed pending dismiss into a future schedule', async () => {
    const secondEnabled = makeDeferred<boolean>()
    vi.mocked(loadPushNotificationsEnabled)
      .mockResolvedValueOnce(true)
      .mockReturnValueOnce(secondEnabled.promise)
      .mockResolvedValueOnce(true)
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: 'granted',
      canAskAgain: true
    } as never)
    vi.mocked(Notifications.scheduleNotificationAsync)
      .mockResolvedValueOnce('scheduled-1')
      .mockResolvedValueOnce('scheduled-2')
    vi.mocked(Notifications.dismissNotificationAsync).mockResolvedValue(undefined)
    let onEvent: ((data: unknown) => void) | null = null
    const client = {
      subscribe: vi.fn((_method, _params, callback: (data: unknown) => void) => {
        onEvent = callback
        return vi.fn()
      }),
      getState: vi.fn(() => 'connected'),
      sendRequest: vi.fn()
    } as unknown as RpcClient

    subscribeToDesktopNotifications(client, 'host-dismiss-failed-replacement')
    onEvent?.({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'Done',
      body: 'Finished.',
      notificationId: 'agent:stale-dismiss'
    })
    await flushAsync()
    onEvent?.({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'Done again',
      body: 'Finished again.',
      notificationId: 'agent:stale-dismiss'
    })
    await flushAsync()
    onEvent?.({ type: 'dismiss', notificationId: 'agent:stale-dismiss' })
    secondEnabled.resolve(false)
    await flushAsync()

    onEvent?.({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'Done later',
      body: 'Finished later.',
      notificationId: 'agent:stale-dismiss'
    })
    await flushAsync()

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2)
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledTimes(1)
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('scheduled-1')
  })

  it('treats unknown dismiss events as no-ops', async () => {
    vi.mocked(Notifications.dismissNotificationAsync).mockResolvedValue(undefined)
    let onEvent: ((data: unknown) => void) | null = null
    const client = {
      subscribe: vi.fn((_method, _params, callback: (data: unknown) => void) => {
        onEvent = callback
        return vi.fn()
      }),
      getState: vi.fn(() => 'connected'),
      sendRequest: vi.fn()
    } as unknown as RpcClient

    subscribeToDesktopNotifications(client, 'host-unknown')
    onEvent?.({ type: 'dismiss', notificationId: 'agent:missing' })
    await flushAsync()

    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalled()
  })

  // Why: notificationId is unique per completion, so the map grew unbounded when
  // the desktop never sent a dismiss (the remote-mobile case). It is now capped.
  it('evicts the oldest scheduled entry once the cap is exceeded', async () => {
    setScheduledNotificationsMaxForTests(1)
    try {
      vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
      vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
        status: 'granted',
        canAskAgain: true
      } as never)
      vi.mocked(Notifications.scheduleNotificationAsync)
        .mockResolvedValueOnce('scheduled-old')
        .mockResolvedValueOnce('scheduled-new')
      vi.mocked(Notifications.dismissNotificationAsync).mockResolvedValue(undefined)
      let onEvent: ((data: unknown) => void) | null = null
      const client = {
        subscribe: vi.fn((_method, _params, callback: (data: unknown) => void) => {
          onEvent = callback
          return vi.fn()
        }),
        getState: vi.fn(() => 'connected'),
        sendRequest: vi.fn()
      } as unknown as RpcClient

      subscribeToDesktopNotifications(client, 'host-1')
      onEvent?.({ type: 'notification', title: 't', body: 'b', notificationId: 'agent:old' })
      await flushAsync()
      onEvent?.({ type: 'notification', title: 't', body: 'b', notificationId: 'agent:new' })
      await flushAsync()

      // The older entry was evicted by the cap: dismissing it is a no-op...
      onEvent?.({ type: 'dismiss', notificationId: 'agent:old' })
      await flushAsync()
      expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalledWith('scheduled-old')

      // ...while the most-recent entry is retained and still dismissable.
      onEvent?.({ type: 'dismiss', notificationId: 'agent:new' })
      await flushAsync()
      expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('scheduled-new')
    } finally {
      setScheduledNotificationsMaxForTests()
    }
  })
})

describe('showLocalNotification — headless-safe background permission path (M8)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Why: the RNFB setBackgroundMessageHandler headless path passes {background:true}.
  // It must only QUERY permission state and drop when not granted — never call
  // requestPermissionsAsync (no UI in headless context to surface a prompt).
  it('background path drops when permission not granted and never requests', async () => {
    vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: 'denied',
      canAskAgain: false
    } as never)

    await showLocalNotification(
      { type: 'notification', source: 'fcm-supplemental', title: 't', body: 'b' },
      'host-bg',
      { background: true }
    )

    expect(Notifications.getPermissionsAsync).toHaveBeenCalledTimes(1)
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled()
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
  })

  it('background path schedules when permission already granted (query only)', async () => {
    vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: 'granted',
      canAskAgain: true
    } as never)
    vi.mocked(Notifications.scheduleNotificationAsync).mockResolvedValue('bg-id')

    await showLocalNotification(
      { type: 'notification', source: 'fcm-supplemental', title: 't', body: 'b' },
      'host-bg',
      { background: true }
    )

    expect(Notifications.getPermissionsAsync).toHaveBeenCalledTimes(1)
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled()
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1)
  })

  // Why: foreground callers omit the option — they keep the request-permission UX
  // path. This guards against the background flag accidentally changing foreground.
  it('foreground path (no options) still requests permission when not granted', async () => {
    vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: 'denied',
      canAskAgain: true
    } as never)
    vi.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({
      status: 'granted'
    } as never)
    vi.mocked(Notifications.scheduleNotificationAsync).mockResolvedValue('fg-id')

    await showLocalNotification(
      { type: 'notification', source: 'fcm-supplemental', title: 't', body: 'b' },
      'host-fg'
    )

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1)
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1)
  })
})
