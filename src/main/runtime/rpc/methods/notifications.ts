import { z } from 'zod'
import { defineStreamingMethod, defineMethod, type RpcAnyMethod } from '../core'

// Why: monotonically increasing per-process counter eliminates the
// Date.now() collision that could fire when two near-simultaneous
// notifications.subscribe calls landed on the same millisecond.
let notificationsSubscriptionSeq = 0

const NotificationUnsubscribeParams = z.object({
  subscriptionId: z
    .unknown()
    .transform((value) => (typeof value === 'string' && value.length > 0 ? value : ''))
    .pipe(z.string().min(1, 'Missing subscriptionId'))
})

// Why: the mobile app sends its FCM/APNs device token, the platform that
// selects FCM transport shaping (android direct vs ios via APNs), and its
// long-lived Curve25519 public key (base64) so the desktop can later derive
// the persistent FCM-shared key (REQ-FCM-008, REQ-FCM-009, REQ-FCM-019).
// zod v4 API: .min(1, msg) supplies the required-message — NOT required_error.
const RegisterPushTokenParams = z.object({
  token: z.string().min(1, 'Missing push token'),
  platform: z.enum(['android', 'ios']),
  mobilePublicKeyB64: z.string().min(1, 'Missing mobile public key')
})

// Why: notifications.subscribe streams desktop notification events to mobile
// clients over WebSocket. The mobile client shows a local push notification
// for each event. This avoids requiring Firebase/APNs — the existing
// persistent WebSocket connection doubles as the push channel.
export const NOTIFICATION_METHODS: readonly RpcAnyMethod[] = [
  defineStreamingMethod({
    name: 'notifications.subscribe',
    params: null,
    handler: async (_params, { runtime, connectionId }, emit) => {
      await new Promise<void>((resolve) => {
        const unsubscribe = runtime.onNotificationDispatched((event) => {
          emit(event)
        })

        // Why: scope by per-ws connectionId + per-process counter so
        // concurrent subscribes never collide on the cleanup map.
        const seq = ++notificationsSubscriptionSeq
        const subscriptionId = `notifications-${connectionId ?? 'inproc'}-${seq}`
        runtime.registerSubscriptionCleanup(
          subscriptionId,
          () => {
            unsubscribe()
            emit({ type: 'end' })
            resolve()
          },
          connectionId
        )

        emit({ type: 'ready', subscriptionId })
      })
    }
  }),
  defineMethod({
    name: 'notifications.unsubscribe',
    params: NotificationUnsubscribeParams,
    handler: async (params, { runtime }) => {
      runtime.cleanupSubscription(params.subscriptionId)
      return { unsubscribed: true }
    }
  }),
  defineMethod({
    name: 'notifications.registerPushToken',
    params: RegisterPushTokenParams,
    handler: async (params, { deviceRegistry, clientId }) => {
      // Why: resolve the caller from its auth token (clientId) — the mobile
      // never sends its own deviceId. OrcaRuntimeService has no device-registry
      // access, so the ctx-injected deviceRegistry is the one path to persist.
      // Fail closed when the registry or caller identity is absent (in-process
      // callers, unauthenticated transports).
      if (!deviceRegistry || !clientId) {
        return { ok: false as const, error: 'unauthorized' as const }
      }
      const device = deviceRegistry.validateToken(clientId)
      if (!device) {
        return { ok: false as const, error: 'invalid_token' as const }
      }
      const updated = deviceRegistry.updateDevicePushToken(device.deviceId, {
        fcmToken: params.token,
        pushPlatform: params.platform,
        mobilePublicKeyB64: params.mobilePublicKeyB64
      })
      if (!updated) {
        return { ok: false as const, error: 'device_not_found' as const }
      }
      return { ok: true as const }
    }
  })
]
