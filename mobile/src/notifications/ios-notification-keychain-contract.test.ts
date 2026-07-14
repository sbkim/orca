import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const keyStoreSource = readFileSync(
  new URL('./ios-notification-key-store.ts', import.meta.url),
  'utf8'
)
const extensionSource = readFileSync(
  new URL('../../targets/orca-notification-service/NotificationService.swift', import.meta.url),
  'utf8'
)

function capture(source: string, pattern: RegExp): string {
  const value = source.match(pattern)?.[1]
  if (!value) {
    throw new Error(`Missing source contract: ${pattern}`)
  }
  return value
}

describe('iOS notification Keychain contract', () => {
  it('queries the physical SecureStore service alias used for unauthenticated records', () => {
    const configuredService = capture(keyStoreSource, /KEYCHAIN_SERVICE = '([^']+)'/)
    const queriedService = capture(extensionSource, /keychainService = "([^"]+)"/)

    // Why: Expo SecureStore 55 appends this suffix internally even though JS
    // passes the unsuffixed keychainService option.
    expect(queriedService).toBe(`${configuredService}:no-auth`)
    expect(extensionSource).toContain('kSecAttrGeneric as String: account')
    expect(extensionSource).toContain('kSecAttrAccount as String: account')
  })
})
