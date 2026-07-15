import { deleteToken, getMessaging } from '@react-native-firebase/messaging'
import type { RpcResponse } from '../transport/types'

type PushTokenDeactivationClient = {
  sendRequest: (method: string, params?: unknown) => Promise<RpcResponse>
}

export async function unregisterPushTokenWithDesktop(
  client: PushTokenDeactivationClient
): Promise<boolean> {
  try {
    const response = await client.sendRequest('notifications.unregisterPushToken')
    return Boolean(
      response.ok &&
      response.result &&
      typeof response.result === 'object' &&
      (response.result as { ok?: unknown }).ok === true
    )
  } catch {
    return false
  }
}

export async function deleteLocalFcmToken(): Promise<boolean> {
  try {
    // Why: revoking locally stops APNs/FCM delivery even while every paired
    // desktop is offline and cannot process the unregister RPC yet.
    await deleteToken(getMessaging())
    return true
  } catch {
    return false
  }
}
