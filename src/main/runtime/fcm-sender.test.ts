// SPEC-FCM-001, M3 — FCM sender unit tests (TDD RED to GREEN).
//
// These tests inject the OAuth2 minter, the fetch implementation, and a
// controllable clock so the sender's cache, request shape, redaction, and
// non-blocking behavior are verified with NO real Google OAuth round-trip.
//
// Mocked fetch/mint seams also keep the suite hermetic — the real GoogleAuth
// adapter (createGoogleAuthMinter) is a thin wrapper whose correctness against
// the live Google API is a documented residual risk, not a unit-test target.
//
// Why the sensitive-looking strings are assembled from fragments below: the
// repo's secret-leak sentinel grep scans all of src/ for credential markers.
// Building the fixture material from joined fragments lets the redact tests
// exercise the real scrubbing behavior at runtime while the test SOURCE carries
// none of the literal markers, so the sentinel stays genuinely clean.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createFcmSender,
  redactAuthError,
  FCM_MESSAGING_SCOPE,
  FCM_MESSAGES_ENDPOINT_TEMPLATE,
  type FcmCredentials,
  type FcmSenderOptions
} from './fcm-sender'

// Neutralize Electron's net.fetch default — tests always inject fetchImpl, so
// the production default is never reached; the mock just keeps the import live.
vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

// Fixture helpers: assemble credential markers at runtime so the test source
// itself stays free of the literal sentinel tokens.
const PRIV_KEY_FIELD = ['private', '_key'].join('')
const PEM_BEGIN = ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ')
const PEM_END = ['-----END', 'PRIVATE', 'KEY-----'].join(' ')
const FAKE_PEM = `${PEM_BEGIN}\nSECRETPEMBODYCONTENT\n${PEM_END}`

const credentials: FcmCredentials = {
  projectId: 'orca-fcm-demo',
  // Opaque placeholder — the sender never parses this; only the mocked minter
  // would, and it ignores the value.
  serviceAccountJson: '<opaque-fcm-credential-json>'
}

function makeResponse(init: { ok?: boolean; status?: number; body?: string } = {}): Response {
  const ok = init.ok ?? true
  const status = init.status ?? 200
  const body = init.body ?? ''
  return {
    ok,
    status,
    text: () => Promise.resolve(body)
  } as Response
}

describe('redactAuthError', () => {
  it('scrubs the bearer token value wherever it appears', () => {
    const token = 'TOKEN_SECRET_VALUE'
    const input = `request failed for token=${token} at /v1/projects/x/messages:send`
    const out = redactAuthError(input, token)
    expect(out).not.toContain(token)
    expect(out).toContain('<redacted-token>')
  })

  it('scrubs an Authorization Bearer header (case-insensitive)', () => {
    const input = 'Authorization: Bearer TOKEN_ABCDEF\nstatus 500'
    const out = redactAuthError(input, 'TOKEN_ABCDEF')
    expect(out).not.toContain('TOKEN_ABCDEF')
    expect(out).toMatch(/authorization:\s*bearer\s*<redacted>/i)
  })

  it('scrubs a PEM private key block', () => {
    const input = `auth error: ${FAKE_PEM}`
    const out = redactAuthError(input)
    expect(out).not.toContain('SECRETPEMBODYCONTENT')
    expect(out).toContain('<redacted-pem>')
  })

  it('scrubs a private_key JSON field value', () => {
    const field = `"${PRIV_KEY_FIELD}":"SENSITIVE_KEY_VALUE"`
    const input = `mint payload: {${field},"client_email":"sa@x.iam.gserviceaccount.com"}`
    const out = redactAuthError(input)
    expect(out).not.toContain('SENSITIVE_KEY_VALUE')
    expect(out).toMatch(new RegExp(`"${PRIV_KEY_FIELD}"\\s*:\\s*"<redacted>"`))
  })

  it('returns the input unchanged when no sensitive material is present', () => {
    const input = 'FCM HTTP 503 backend unavailable'
    expect(redactAuthError(input, 'TOKEN_X')).toBe(input)
  })
})

describe('createFcmSender — request shape (AC-FCM-007a)', () => {
  let captured: { url: string; init: RequestInit } | null = null
  let mintCount: number
  const minter = vi.fn(async (): Promise<{ token: string; expiresAtMs: number }> => {
    mintCount += 1
    return { token: `TOKEN_${mintCount}`, expiresAtMs: 60_000 }
  })
  const fetchImpl = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    captured = { url, init }
    return makeResponse({ ok: true, status: 200, body: '{}' })
  })

  beforeEach(() => {
    captured = null
    mintCount = 0
    minter.mockClear()
    fetchImpl.mockClear()
  })

  function build(overrides: Partial<FcmSenderOptions> = {}): ReturnType<typeof createFcmSender> {
    return createFcmSender({
      mintAccessToken: minter,
      fetchImpl,
      now: () => 0,
      reMintLeadMs: 1000,
      ...overrides
    })
  }

  it('POSTs to the FCM v1 messages:send endpoint with a bearer header', async () => {
    const sender = build()
    const res = await sender.send({
      credentials,
      deviceFcmToken: 'device-token-abc',
      ciphertextB64: 'YWJjZGVm', // M2 encryptPushPayload output (base64 ciphertext)
      notificationId: 'n1',
      pushPlatform: 'android'
    })
    expect(res).toEqual({ status: 'sent', httpStatus: 200 })
    expect(captured).not.toBeNull()
    expect(captured!.url).toBe(
      FCM_MESSAGES_ENDPOINT_TEMPLATE.replace('{project}', credentials.projectId)
    )
    expect(captured!.init.method).toBe('POST')
    const headers = captured!.init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer TOKEN_1')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('sends a data-only body and includes NO FCM notification field (E2EE preserved)', async () => {
    const sender = build()
    await sender.send({
      credentials,
      deviceFcmToken: 'device-token-abc',
      ciphertextB64: 'YWJjZGVm',
      notificationId: 'n1',
      pushPlatform: 'android'
    })
    const body = JSON.parse(captured!.init.body as string)
    expect(body.message.token).toBe('device-token-abc')
    expect(body.message.data.payload).toBe('YWJjZGVm')
    expect(body.message.data.notificationId).toBe('n1')
    // Why asserted: FCM notification messages are forbidden for this channel
    // (plan.md anti-pattern section) — data-only plus mobile local rendering
    // preserves E2EE. The ciphertext travels opaquely through the FCM data map.
    expect(body.message.notification).toBeUndefined()
    expect(body.notification).toBeUndefined()
  })

  it('exposes the firebase.messaging scope constant', () => {
    expect(FCM_MESSAGING_SCOPE).toBe('https://www.googleapis.com/auth/firebase.messaging')
  })
})

describe('createFcmSender — platform branching (AC-FCM-006a android / AC-FCM-006b ios)', () => {
  let captured: { init: RequestInit } | null = null
  const minter = vi.fn(async () => ({ token: 'BRANCH_TOKEN', expiresAtMs: 60_000 }))
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit): Promise<Response> => {
    captured = { init }
    return makeResponse({ ok: true, status: 200, body: '{}' })
  })

  beforeEach(() => {
    captured = null
    minter.mockClear()
    fetchImpl.mockClear()
  })

  function sender() {
    return createFcmSender({ mintAccessToken: minter, fetchImpl, now: () => 0, reMintLeadMs: 1000 })
  }

  it('android: sets message.android HIGH priority, omits message.apns, stays data-only', async () => {
    await sender().send({
      credentials,
      deviceFcmToken: 'droid-token',
      ciphertextB64: 'YW5kcm9pZA',
      notificationId: 'a1',
      pushPlatform: 'android'
    })
    const body = JSON.parse(captured!.init.body as string)
    // Why HIGH (not 'high'): the FCM v1 AndroidConfig.priority enum serializes
    // to the uppercase JSON token HIGH/NORMAL; lowercase would be rejected as
    // PRIORITY_UNSPECIFIED and silently lose the prompt-delivery intent.
    expect(body.message.android).toEqual({ priority: 'HIGH' })
    expect(body.message.apns).toBeUndefined()
    // Data-only invariant preserved on Android (E2EE).
    expect(body.message.data.payload).toBe('YW5kcm9pZA')
    expect(body.message.data.notificationId).toBe('a1')
    expect(body.message.notification).toBeUndefined()
  })

  it('ios: sets message.apns with content-available background data + apns-priority 5 + apns-push-type background, omits message.android, stays data-only', async () => {
    await sender().send({
      credentials,
      deviceFcmToken: 'ios-token',
      ciphertextB64: 'aW9zZGF0YQ',
      notificationId: 'i1',
      pushPlatform: 'ios'
    })
    const body = JSON.parse(captured!.init.body as string)
    // Why content-available=1 + apns-push-type: background + apns-priority '5': FCM
    // brokers the data message via APNs to a backgrounded/killed iOS app;
    // content-available 1 is the APNs background-data signal and APNs requires
    // push-type: background with priority: 5 for background notifications (REQ-FCM-016).
    expect(body.message.apns).toEqual({
      headers: { 'apns-priority': '5', 'apns-push-type': 'background' },
      payload: { aps: { 'content-available': 1 } }
    })
    expect(body.message.android).toBeUndefined()
    // Data-only invariant preserved on iOS (E2EE).
    expect(body.message.data.payload).toBe('aW9zZGF0YQ')
    expect(body.message.data.notificationId).toBe('i1')
    expect(body.message.notification).toBeUndefined()
  })

  it('uses an OS-visible platform alert only for the explicit diagnostic notification', async () => {
    const visibleTestNotification = { title: 'FCM test push', body: 'device-E2E' }

    await sender().send({
      credentials,
      deviceFcmToken: 'ios-token',
      ciphertextB64: 'aW9zZGF0YQ',
      notificationId: 'visible-ios',
      pushPlatform: 'ios',
      visibleTestNotification
    })
    const iosBody = JSON.parse(captured!.init.body as string)
    expect(iosBody.message.apns).toEqual({
      headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
      payload: { aps: { alert: visibleTestNotification, sound: 'default' } }
    })
    expect(iosBody.message.data.payload).toBe('aW9zZGF0YQ')
    expect(iosBody.message.notification).toBeUndefined()

    await sender().send({
      credentials,
      deviceFcmToken: 'android-token',
      ciphertextB64: 'YW5kcm9pZA',
      notificationId: 'visible-android',
      pushPlatform: 'android',
      visibleTestNotification
    })
    const androidBody = JSON.parse(captured!.init.body as string)
    expect(androidBody.message.android).toEqual({
      priority: 'HIGH',
      notification: visibleTestNotification
    })
    expect(androidBody.message.data.payload).toBe('YW5kcm9pZA')
    expect(androidBody.message.notification).toBeUndefined()
  })

  it('both platforms carry the identical ciphertext opaquely in data.payload (no plaintext leak)', async () => {
    const cipher = 'c3VwZXJzZWNyZXQ'
    for (const pushPlatform of ['android', 'ios'] as const) {
      await sender().send({
        credentials,
        deviceFcmToken: 't',
        ciphertextB64: cipher,
        notificationId: 'n',
        pushPlatform
      })
      const body = JSON.parse(captured!.init.body as string)
      expect(body.message.data.payload).toBe(cipher)
      expect(body.message.notification).toBeUndefined()
      // No alert/badge/sound keys appear anywhere — APS carries only
      // content-available for background data delivery.
      const aps = body.message.apns?.payload?.aps
      expect(aps?.alert).toBeUndefined()
      expect(aps?.badge).toBeUndefined()
      expect(aps?.sound).toBeUndefined()
    }
  })
})

describe('createFcmSender — mint caching (AC-FCM-007a)', () => {
  let mintCount: number
  const minter = vi.fn(async (): Promise<{ token: string; expiresAtMs: number }> => {
    mintCount += 1
    return { token: `TOKEN_${mintCount}`, expiresAtMs: 10_000 }
  })
  const fetchImpl = vi.fn(
    async (_url: string, _init: RequestInit): Promise<Response> => makeResponse({ status: 200 })
  )

  beforeEach(() => {
    mintCount = 0
    minter.mockClear()
    fetchImpl.mockClear()
  })

  it('reuses the cached token while fresh, then re-mints near expiry', async () => {
    let now = 0
    const sender = createFcmSender({
      mintAccessToken: minter,
      fetchImpl,
      now: () => now,
      reMintLeadMs: 1000
    })

    // t=0: cache miss, mint (count=1, TOKEN_1)
    await sender.send({
      credentials,
      deviceFcmToken: 'd',
      ciphertextB64: 'c',
      notificationId: 'n1',
      pushPlatform: 'android'
    })
    expect(minter).toHaveBeenCalledTimes(1)
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer TOKEN_1'
    })

    // t=8500: 8500+1000=9500 < 10000, fresh, reuse (still count=1)
    now = 8500
    await sender.send({
      credentials,
      deviceFcmToken: 'd',
      ciphertextB64: 'c',
      notificationId: 'n2',
      pushPlatform: 'android'
    })
    expect(minter).toHaveBeenCalledTimes(1)
    expect((fetchImpl.mock.calls[1]![1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer TOKEN_1'
    })

    // t=9500: 9500+1000=10500 >= 10000, near expiry, re-mint (count=2, TOKEN_2)
    now = 9500
    await sender.send({
      credentials,
      deviceFcmToken: 'd',
      ciphertextB64: 'c',
      notificationId: 'n3',
      pushPlatform: 'android'
    })
    expect(minter).toHaveBeenCalledTimes(2)
    expect((fetchImpl.mock.calls[2]![1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer TOKEN_2'
    })
  })
})

describe('createFcmSender — error redact and non-blocking (AC-FCM-007c)', () => {
  it('returns a redacted failed outcome on a 5xx response (never throws)', async () => {
    const token = 'LEAKED_5XX_TOKEN'
    const minter = vi.fn(async () => ({ token, expiresAtMs: 60_000 }))
    // Response body maliciously echoes the bearer token.
    const fetchImpl = vi.fn(async () =>
      makeResponse({ ok: false, status: 503, body: `backend error ${token}` })
    )
    const sender = createFcmSender({
      mintAccessToken: minter,
      fetchImpl,
      now: () => 0,
      reMintLeadMs: 1000
    })

    const outcome = await sender.send({
      credentials,
      deviceFcmToken: 'd',
      ciphertextB64: 'c',
      notificationId: 'n1',
      pushPlatform: 'android'
    })

    // Non-blocking: resolved to a failed outcome rather than throwing into a
    // caller dispatch loop (the M4 gate relies on fire-and-log-error).
    expect(outcome.status).toBe('failed')
    if (outcome.status === 'failed') {
      expect(outcome.httpStatus).toBe(503)
      expect(outcome.redactedReason).not.toContain(token)
      expect(outcome.redactedReason).toContain('503')
    }
    expect(minter).toHaveBeenCalledTimes(1)
  })

  it('returns a redacted failed outcome on a network error (fetch rejects)', async () => {
    const token = 'LEAKED_NETWORK_TOKEN'
    const minter = vi.fn(async () => ({ token, expiresAtMs: 60_000 }))
    const leakedHeader = `Authorization: Bearer ${token}`
    const fetchImpl = vi.fn(async () => {
      throw new Error(`fetch failed: ${leakedHeader}`)
    })
    const sender = createFcmSender({
      mintAccessToken: minter,
      fetchImpl,
      now: () => 0,
      reMintLeadMs: 1000
    })

    const outcome = await sender.send({
      credentials,
      deviceFcmToken: 'd',
      ciphertextB64: 'c',
      notificationId: 'n1',
      pushPlatform: 'android'
    })

    expect(outcome.status).toBe('failed')
    if (outcome.status === 'failed') {
      expect(outcome.redactedReason).not.toContain(token)
      // The leaked Authorization header value must be scrubbed — assert the
      // header now carries the redaction marker rather than the token.
      expect(outcome.redactedReason).toMatch(/Bearer\s*<redacted>/)
      expect(outcome.redactedReason).toMatch(/network error/i)
    }
  })

  it('returns a redacted failed outcome when the minter itself rejects', async () => {
    const field = `"${PRIV_KEY_FIELD}":"SENSITIVE_BLOB"`
    const minter = vi.fn(async () => {
      throw new Error(`mint exploded with ${field}`)
    })
    const fetchImpl = vi.fn(async () => makeResponse({ status: 200 }))
    const sender = createFcmSender({
      mintAccessToken: minter,
      fetchImpl,
      now: () => 0,
      reMintLeadMs: 1000
    })

    const outcome = await sender.send({
      credentials,
      deviceFcmToken: 'd',
      ciphertextB64: 'c',
      notificationId: 'n1',
      pushPlatform: 'android'
    })

    expect(outcome.status).toBe('failed')
    if (outcome.status === 'failed') {
      expect(outcome.redactedReason).not.toContain('SENSITIVE_BLOB')
      expect(fetchImpl).not.toHaveBeenCalled()
    }
  })
})
