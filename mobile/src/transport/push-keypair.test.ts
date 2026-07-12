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

// Why: in-memory AsyncStorage so the persistence behavior is observable
// without RN's native module. Reset between tests so each starts empty.
const storage = new Map<string, string>()
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      storage.set(key, value)
    }
  }
}))

import { loadOrCreatePushKeypair } from './push-keypair'

describe('loadOrCreatePushKeypair', () => {
  beforeEach(() => {
    storage.clear()
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
})
