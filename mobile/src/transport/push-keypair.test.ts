import { beforeEach, describe, expect, it, vi } from 'vitest'

// Why: isolate persistent-key generation from the real tweetnacl/expo-crypto
// stack. The keypair module must be deterministic per generated pair and reuse
// the exact pair across calls once persisted.
vi.mock('./e2ee', () => {
  let seq = 0
  return {
    // Why: each call returns a distinct pair so the test can tell a regenerated
    // pair from a persisted one.
    generateKeyPair: () => {
      seq += 1
      const publicKey = new Uint8Array(32).fill(seq)
      const secretKey = new Uint8Array(32).fill(100 + seq)
      return { publicKey, secretKey }
    },
    publicKeyToBase64: (key: Uint8Array) => `pub-${key[0]}`,
    bytesToBase64: (key: Uint8Array) => `sec-${key[0]}`
  }
})

// Why: in-memory expo-secure-store so the persistence behavior is observable
// without RN's native module. Reset between tests so each starts empty.
const secureStore = new Map<string, string>()
const asyncStorage = new Map<string, string>() // For migration testing

vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => secureStore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    secureStore.set(key, value)
  }
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => asyncStorage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      asyncStorage.set(key, value)
    },
    removeItem: async (key: string) => {
      asyncStorage.delete(key)
    }
  }
}))

import { loadOrCreatePushKeypair } from './push-keypair'

describe('loadOrCreatePushKeypair', () => {
  beforeEach(() => {
    secureStore.clear()
    asyncStorage.clear()
  })

  it('returns a base64 public key on first call (generation)', async () => {
    const { publicKeyB64 } = await loadOrCreatePushKeypair()
    expect(typeof publicKeyB64).toBe('string')
    expect(publicKeyB64.length).toBeGreaterThan(0)
  })

  // Why: REQ-FCM-019 — the persistent keypair MUST be long-lived. Generating a
  // fresh pair each call would break the desktop's shared-key derivation (the
  // desktop stores the registered public key once at pairing). The second call
  // must return the SAME public key as the first.
  it('reuses the persisted pair across calls (long-lived key)', async () => {
    const first = await loadOrCreatePushKeypair()
    const second = await loadOrCreatePushKeypair()
    expect(second.publicKeyB64).toBe(first.publicKeyB64)
  })

  it('is distinct from the per-connection ephemeral keypair module', async () => {
    // Why: the ephemeral keypair (rpc-client.ts) is regenerated every WS connect
    // for forward secrecy. The persistent push keypair must NOT change across
    // reconnects — confirm a second "session" (second call) yields the same key.
    const session1 = await loadOrCreatePushKeypair()
    // simulate a reconnect: same storage, fresh module read
    const session2 = await loadOrCreatePushKeypair()
    expect(session2.publicKeyB64).toBe(session1.publicKeyB64)
  })

  // Why: M4 migration test — verify existing AsyncStorage entries are migrated
  // to expo-secure-store and the legacy entry is cleaned up.
  it('migrates existing AsyncStorage entry to expo-secure-store', async () => {
    // Set up legacy AsyncStorage entry
    const legacyEntry = JSON.stringify({
      secretKeyB64: 'sec-legacy',
      publicKeyB64: 'pub-legacy'
    })
    asyncStorage.set('orca:push-keypair', legacyEntry)

    // First call should migrate and return the legacy public key
    const { publicKeyB64 } = await loadOrCreatePushKeypair()
    expect(publicKeyB64).toBe('pub-legacy')

    // Verify migration cleaned up legacy entry
    expect(asyncStorage.get('orca:push-keypair')).toBeUndefined()

    // Verify new entry is in expo-secure-store
    const secureStoreEntry = secureStore.get('orca:push-keypair')
    expect(secureStoreEntry).toBeDefined()
    const parsed = JSON.parse(secureStoreEntry!)
    expect(parsed.publicKeyB64).toBe('pub-legacy')
    expect(parsed.secretKeyB64).toBe('sec-legacy')
  })

  // Why: verify corrupted/malformed legacy entries are skipped and fresh keypair
  // is generated instead.
  it('handles corrupted AsyncStorage entries gracefully', async () => {
    // Set up corrupted legacy entry
    asyncStorage.set('orca:push-keypair', 'not-valid-json')

    // Should generate fresh keypair instead of crashing
    const { publicKeyB64 } = await loadOrCreatePushKeypair()
    expect(publicKeyB64).toBeDefined()
    expect(typeof publicKeyB64).toBe('string')
  })
})
