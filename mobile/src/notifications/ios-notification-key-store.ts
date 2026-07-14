import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { bytesToBase64 } from '../transport/e2ee'
import { loadHosts } from '../transport/host-store'
import { loadPushKeypairSecret } from '../transport/push-keypair'
import { deriveMobileFcmSharedKey } from './push-payload-decrypt'

const KEYCHAIN_ACCESS_GROUP = '3F566TG5CC.com.omninetworks.orca.mobile.push'
const KEYCHAIN_SERVICE = 'orca.notification-service.keys'
const KEY_PREFIX = 'orca.ios-push-key.'

const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  accessGroup: KEYCHAIN_ACCESS_GROUP,
  keychainService: KEYCHAIN_SERVICE,
  // Why: the extension must read the key while the phone is locked, but the
  // key must never migrate to another device through a backup restore.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
}

type IosNotificationKeyRecord = {
  keyB64: string
  hostId: string
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function deriveIosNotificationKeyId(sharedKey: Uint8Array): Promise<string> {
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    Uint8Array.from(sharedKey)
  )
  return toHex(new Uint8Array(digest))
}

export async function storeIosNotificationKey(hostId: string): Promise<boolean> {
  if (Platform.OS !== 'ios') {
    return true
  }
  try {
    const [mobileSecret, hosts] = await Promise.all([loadPushKeypairSecret(), loadHosts()])
    const host = hosts.find((candidate) => candidate.id === hostId)
    if (!mobileSecret || !host?.publicKeyB64) {
      return false
    }
    const sharedKey = deriveMobileFcmSharedKey(mobileSecret, host.publicKeyB64)
    const keyId = await deriveIosNotificationKeyId(sharedKey)
    const record: IosNotificationKeyRecord = {
      keyB64: bytesToBase64(sharedKey),
      hostId
    }
    await SecureStore.setItemAsync(
      `${KEY_PREFIX}${keyId}`,
      JSON.stringify(record),
      KEYCHAIN_OPTIONS
    )
    return true
  } catch {
    return false
  }
}
