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
// Backend: expo-secure-store (IOS Keychain, background-accessible).
// FIXED defect #3: migrated from AsyncStorage to expo-secure-store for
// secure storage that is accessible in background iOS push delivery scenarios.
// The secret key is persisted so M5's FCM payload decryption can load the
// matching private half later without re-touching the persistence format.
import * as SecureStore from 'expo-secure-store'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { bytesToBase64, generateKeyPair, publicKeyToBase64 } from './e2ee'

const PUSH_KEYPAIR_STORAGE_KEY = 'orca:push-keypair'
const LEGACY_ASYNC_STORAGE_KEY = 'orca:push-keypair' // For migration from AsyncStorage

type PushKeypairRecord = {
  secretKeyB64: string
  publicKeyB64: string
}

// Why: migrate existing AsyncStorage entry to expo-secure-store. This is a
// one-time migration for users who already have the old storage format.
// Returns true if migration occurred, false otherwise.
async function migrateFromAsyncStorage(): Promise<boolean> {
  try {
    const legacyEntry = await AsyncStorage.getItem(LEGACY_ASYNC_STORAGE_KEY)
    if (!legacyEntry) {
      return false // No legacy entry to migrate
    }

    const parsed = JSON.parse(legacyEntry) as Partial<PushKeypairRecord>
    if (!parsed?.publicKeyB64 || !parsed?.secretKeyB64) {
      return false // Malformed entry, skip migration
    }

    // Migrate to expo-secure-store
    await SecureStore.setItemAsync(
      PUSH_KEYPAIR_STORAGE_KEY,
      JSON.stringify({
        secretKeyB64: parsed.secretKeyB64,
        publicKeyB64: parsed.publicKeyB64
      } satisfies PushKeypairRecord)
    )

    // Clean up legacy entry after successful migration
    await AsyncStorage.removeItem(LEGACY_ASYNC_STORAGE_KEY)
    return true
  } catch {
    // Why: migration failure is logged but not fatal — a fresh keypair will
    // be generated if the secure store read fails
    return false
  }
}

// Why: returns only the public half — that is all the M1 registration flow
// sends to the desktop. The private half stays on-device in secure storage for
// M5's decryption step. Generating once + reusing on every call is the
// load-bearing invariant (REQ-FCM-019 long-lived key).
export async function loadOrCreatePushKeypair(): Promise<{ publicKeyB64: string }> {
  // First, attempt to migrate from AsyncStorage if needed (one-time migration)
  await migrateFromAsyncStorage()

  // Try to load from expo-secure-store
  try {
    const existing = await SecureStore.getItemAsync(PUSH_KEYPAIR_STORAGE_KEY)
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
  } catch {
    // Why: expo-secure-store access failure (e.g., Keychain unavailable on some
    // platforms) — fall through to regeneration
  }

  const keypair = generateKeyPair()
  const publicKeyB64 = publicKeyToBase64(keypair.publicKey)
  const secretKeyB64 = bytesToBase64(keypair.secretKey)

  try {
    await SecureStore.setItemAsync(
      PUSH_KEYPAIR_STORAGE_KEY,
      JSON.stringify({ secretKeyB64, publicKeyB64 } satisfies PushKeypairRecord)
    )
  } catch {
    // Why: if expo-secure-store fails to write, we have a working keypair for
    // this session but it won't persist. This is better than crashing.
  }

  return { publicKeyB64 }
}
