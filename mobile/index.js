// Why: RNFB background handler must be registered at module top-level, BEFORE
// expo-router loads, so cold-start/killed-state FCM data-only messages are caught.
// This is the entry point selected by package.json "main". The handler must never
// throw and must not request permissions (headless context — no UI available).
// @MX:NOTE: RNFB setBackgroundMessageHandler registration — must run before expo-router
import { getMessaging } from '@react-native-firebase/messaging'

getMessaging().setBackgroundMessageHandler(async (remoteMessage) => {
  // Why: diagnostic pushes include a platform notification that Android/iOS
  // already renders in the background; decrypting their data would show it twice.
  if (remoteMessage?.notification) {
    return
  }
  const data = remoteMessage?.data
  if (data && typeof data === 'object' && 'payload' in data) {
    try {
      // Why: require() (not import) so fcm-push-receiver loads lazily on the first
      // background message and the handler registration runs before expo-router.
      // Delegates to the same decryption path as foreground, with the background
      // flag set so the receiver uses the query-only permission path (no headless prompt).
      const { handleFcmDataNotification } = require('./src/notifications/fcm-push-receiver')
      await handleFcmDataNotification(data, { background: true })
    } catch {
      // Fire-and-forget: a headless task must never destabilize the OS push callback.
    }
  }
})

// Why: load expo-router entry AFTER the background handler is registered
require('expo-router/entry')
