import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteLocalFcmToken, unregisterPushTokenWithDesktop } from './push-token-deactivation'

const messagingMocks = vi.hoisted(() => ({
  messaging: { name: 'messaging' },
  deleteToken: vi.fn()
}))

vi.mock('@react-native-firebase/messaging', () => ({
  getMessaging: () => messagingMocks.messaging,
  deleteToken: messagingMocks.deleteToken
}))

describe('push token deactivation', () => {
  beforeEach(() => {
    messagingMocks.deleteToken.mockReset()
    messagingMocks.deleteToken.mockResolvedValue(undefined)
  })

  it('removes the authenticated device token from the desktop', async () => {
    const client = {
      sendRequest: vi.fn(async () => ({ ok: true, result: { ok: true } }))
    }

    await expect(unregisterPushTokenWithDesktop(client)).resolves.toBe(true)
    expect(client.sendRequest).toHaveBeenCalledWith('notifications.unregisterPushToken')
  })

  it('reports desktop rejection without throwing', async () => {
    const client = {
      sendRequest: vi.fn(async () => ({ ok: true, result: { ok: false } }))
    }

    await expect(unregisterPushTokenWithDesktop(client)).resolves.toBe(false)
  })

  it('deletes the local Firebase token to stop offline desktops from delivering', async () => {
    await expect(deleteLocalFcmToken()).resolves.toBe(true)
    expect(messagingMocks.deleteToken).toHaveBeenCalledWith(messagingMocks.messaging)
  })

  it('contains Firebase token deletion failures', async () => {
    messagingMocks.deleteToken.mockRejectedValue(new Error('native failure'))

    await expect(deleteLocalFcmToken()).resolves.toBe(false)
  })
})
