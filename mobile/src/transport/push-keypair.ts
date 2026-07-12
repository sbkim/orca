// Why: long-lived Curve25519 keypair for the FCM supplemental push channel
// (SPEC-FCM-001, REQ-FCM-019). This is DISTINCT from the per-connection
// ephemeral keypair generated in rpc-client.ts on every WebSocket connect —
// that one provides forward secrecy and is discarded on disconnect. This
// persistent pair survives across reconnects so the desktop can derive a
// stable FCM-shared key (desktop persistent secret x this public key) to
// encrypt push payloads even when no WebSocket is live. Generating it fresh
// each call would break the desktop's shared-key derivation, so it is created
// once and read from secure storage on every subsequent call.
//
// Backend: AsyncStorage (key orca:push-keypair). The secret key is persisted
// so M5's FCM payload decryption can load the matching private half later
// without re-touching the persistence format.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { bytesToBase64, generateKeyPair, publicKeyToBase64 } from './e2ee'

const PUSH_KEYPAIR_STORAGE_KEY = 'orca:push-keypair'

type PushKeypairRecord = {
  secretKeyB64: string
  publicKeyB64: string
}

// Why: returns only the public half — that is all the M1 registration flow
// sends to the desktop. The private half stays on-device in secure storage for
// M5's decryption step. Generating once + reusing on every call is the
// load-bearing invariant (REQ-FCM-019 long-lived key).
export async function loadOrCreatePushKeypair(): Promise<{ publicKeyB64: string }> {
  const existing = await AsyncStorage.getItem(PUSH_KEYPAIR_STORAGE_KEY)
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as Partial<PushKeypairRecord>
      if (parsed?.publicKeyB64 && parsed?.secretKeyB64) {
        return { publicKeyB64: parsed.publicKeyB64 }
      }
    } catch {
      // Why: malformed/corrupt record — fall through and regenerate so a bad
      // write never permanently bricks push delivery.
    }
  }

  const keypair = generateKeyPair()
  const publicKeyB64 = publicKeyToBase64(keypair.publicKey)
  const secretKeyB64 = bytesToBase64(keypair.secretKey)
  await AsyncStorage.setItem(
    PUSH_KEYPAIR_STORAGE_KEY,
    JSON.stringify({ secretKeyB64, publicKeyB64 } satisfies PushKeypairRecord)
  )
  return { publicKeyB64 }
}
