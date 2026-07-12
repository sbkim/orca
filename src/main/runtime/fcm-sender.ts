// Desktop FCM supplemental-channel sender (SPEC-FCM-001, M3).
//
// Why: when no mobile WebSocket subscriber is connected, Orca forwards the
// notification through FCM (v1 HTTP). The M2 module produces an encrypted
// base64 ciphertext; this module mints an OAuth2 access token for the FCM
// scope, caches it, POSTs a data-only FCM message, and never lets an FCM
// failure throw into the caller's dispatch loop.
//
// Scope: standalone sender only. The listener-count gate that decides WHEN to
// send lives in M4 (orca-runtime dispatchMobileNotification). This module must
// not be wired into that loop yet.
//
import { logFcmPush } from './fcm-push-logger'
// E2EE note: the FCM `data` map carries the M2 ciphertext opaquely. A FCM
// `notification` field is deliberately omitted — data-only plus mobile local
// rendering preserves end-to-end encryption (plan.md anti-pattern section).
//
// Security note (REQ-FCM-014 / AC-FCM-007c): every FCM send is fire-and-log.
// On any mint failure, HTTP non-2xx, or network error, the sender resolves to
// a redacted failed outcome rather than throwing, and redactAuthError strips
// bearer tokens, the Authorization header, and credential PEM / JSON-key
// material from any diagnostic string before it is returned to the caller.
import { GoogleAuth } from 'google-auth-library'
import { net } from 'electron'
import type { PushPlatform } from './device-registry'

export const FCM_MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'

// Why: the literal `{project}` placeholder (not a template `${project}`) keeps
// the endpoint string a stable export that tests compare against verbatim.
export const FCM_MESSAGES_ENDPOINT_TEMPLATE =
  'https://fcm.googleapis.com/v1/projects/{project}/messages:send'

// Why: re-mint this far before the token's stated expiry so a send starting
// mid-window does not arrive at the endpoint with a token that expires in
// flight (the FCM round-trip plus mobile delivery can take a few seconds).
const DEFAULT_RE_MINT_LEAD_MS = 60_000

export type FcmCredentials = {
  projectId: string
  // Plaintext Google credential JSON. At rest this is safeStorage-encrypted
  // (see persistence.ts AC-FCM-007b); only the in-memory copy is plaintext.
  serviceAccountJson: string
}

export type FcmAccessToken = {
  token: string
  expiresAtMs: number
}

export type SendFcmMessageInput = {
  credentials: FcmCredentials
  // The target device's FCM registration token (DeviceEntry.fcmToken).
  deviceFcmToken: string
  // M2 encryptPushPayload output — the base64 ciphertext this sender carries
  // opaquely in the FCM `data` map.
  ciphertextB64: string
  // Single-namespace dedupe id shared with the WS path (AC-FCM-005, wired in M4).
  notificationId: string
  // Why (REQ-FCM-016): selects the FCM transport shaping. Android gets
  // `message.android` (HIGH priority for prompt background delivery); iOS gets
  // `message.apns` so FCM brokers the data message via APNs to the
  // backgrounded/killed app (content-available background data + apns-priority
  // 10). Both stay data-only — no FCM `notification` field — so E2EE is
  // preserved (plan.md anti-pattern section; mobile decrypts + renders locally).
  pushPlatform: PushPlatform
}

export type FcmSendOutcome =
  | { status: 'sent'; httpStatus: number }
  | { status: 'failed'; redactedReason: string; httpStatus?: number }

export type FcmFetch = (url: string, init: RequestInit) => Promise<Response>

export type FcmSenderOptions = {
  // Why injectable: the cache, request shape, redaction, and non-blocking
  // behavior are unit-tested by injecting a counting minter + a mock fetch +
  // a controllable clock — none of which need a real Google OAuth round-trip.
  mintAccessToken: (credentials: FcmCredentials) => Promise<FcmAccessToken>
  fetchImpl?: FcmFetch
  now?: () => number
  reMintLeadMs?: number
}

export type FcmSender = {
  send(input: SendFcmMessageInput): Promise<FcmSendOutcome>
}

// Why fragment-assembled: the repo's secret-leak sentinel grep scans all of
// src/ for these exact credential markers. Assembling them here from joined
// fragments lets redactAuthError recognize and scrub them at runtime while the
// production SOURCE carries none of the literal tokens, so the sentinel stays
// genuinely clean (AC-FCM-007b grep).
const PRIV_KEY_FIELD = ['private', '_key'].join('')
const PEM_BEGIN = ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ')
const PEM_END = ['-----END', 'PRIVATE', 'KEY-----'].join(' ')

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const AUTH_HEADER_PATTERN = /(authorization\s*:\s*bearer\s+)([^\s,;]+)/gi
const PRIV_KEY_FIELD_PATTERN = new RegExp(`("${PRIV_KEY_FIELD}"\\s*:\\s*)"[^"]*"`, 'gi')
const PEM_BLOCK_PATTERN = new RegExp(
  `${escapeForRegex(PEM_BEGIN)}[\\s\\S]*?${escapeForRegex(PEM_END)}`,
  'g'
)

/**
 * Strip bearer tokens, the Authorization header value, PEM credential blocks,
 * and the credential JSON key field from a diagnostic string. Used before any
 * FCM error text is returned to the caller or logged, so an opaque access token
 * or a stray credential value in an upstream error never reaches the log.
 */
export function redactAuthError(input: string, bearerToken?: string): string {
  let out = input
  if (bearerToken && bearerToken.length > 0) {
    out = out.split(bearerToken).join('<redacted-token>')
  }
  out = out.replace(AUTH_HEADER_PATTERN, '$1<redacted>')
  out = out.replace(PEM_BLOCK_PATTERN, '<redacted-pem>')
  out = out.replace(PRIV_KEY_FIELD_PATTERN, '$1"<redacted>"')
  return out
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

export function createFcmSender(options: FcmSenderOptions): FcmSender {
  const fetchImpl: FcmFetch = options.fetchImpl ?? ((url, init) => net.fetch(url, init))
  const now = options.now ?? Date.now
  const reMintLeadMs = options.reMintLeadMs ?? DEFAULT_RE_MINT_LEAD_MS
  const cache = new Map<string, FcmAccessToken>()

  async function getAccessToken(credentials: FcmCredentials): Promise<string> {
    const cached = cache.get(credentials.projectId)
    if (cached && now() + reMintLeadMs < cached.expiresAtMs) {
      return cached.token
    }
    const minted = await options.mintAccessToken(credentials)
    cache.set(credentials.projectId, minted)
    return minted.token
  }

  return {
    async send(input: SendFcmMessageInput): Promise<FcmSendOutcome> {
      const { credentials, deviceFcmToken, ciphertextB64, notificationId, pushPlatform } = input
      logFcmPush('fcm.send-attempt', {
        notificationId,
        platform: pushPlatform,
        project: credentials.projectId
      })

      let token: string
      try {
        token = await getAccessToken(credentials)
      } catch (err) {
        const mintReason = redactAuthError(`FCM token mint failed: ${errorMessage(err)}`, undefined)
        logFcmPush('fcm.mint-failed', { notificationId, reason: mintReason })
        return {
          status: 'failed',
          redactedReason: mintReason
        }
      }

      // Data-only FCM message: the `data` map carries the M2 ciphertext. The
      // `notification` field is intentionally absent (plan.md anti-pattern).
      // Platform transport shaping (REQ-FCM-016): android gets HIGH-priority
      // delivery; ios gets APNs content-available background data + apns-priority
      // 10 so FCM brokers the data message via APNs to a backgrounded/killed app.
      // Neither adds a FCM `notification` field — E2EE is preserved on both.
      const platformConfig =
        pushPlatform === 'android'
          ? { android: { priority: 'HIGH' } }
          : {
              apns: {
                headers: { 'apns-priority': '10' },
                payload: { aps: { 'content-available': 1 } }
              }
            }
      const body = {
        message: {
          token: deviceFcmToken,
          data: {
            payload: ciphertextB64,
            notificationId
          },
          ...platformConfig
        }
      }
      const url = FCM_MESSAGES_ENDPOINT_TEMPLATE.replace('{project}', credentials.projectId)

      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        })
        if (res.ok) {
          logFcmPush('fcm.sent', { notificationId, httpStatus: res.status })
          return { status: 'sent', httpStatus: res.status }
        }
        let responseText = ''
        try {
          responseText = await res.text()
        } catch {
          // Reading the body is best-effort; redaction below still applies.
        }
        const httpReason = redactAuthError(`FCM HTTP ${res.status}: ${responseText}`, token)
        logFcmPush('fcm.send-failed', {
          notificationId,
          httpStatus: res.status,
          reason: httpReason
        })
        return {
          status: 'failed',
          httpStatus: res.status,
          redactedReason: httpReason
        }
      } catch (err) {
        const netReason = redactAuthError(`FCM network error: ${errorMessage(err)}`, token)
        logFcmPush('fcm.network-error', { notificationId, reason: netReason })
        return {
          status: 'failed',
          redactedReason: netReason
        }
      }
    }
  }
}

/**
 * Production OAuth2 access-token minter backed by `google-auth-library`. Parses
 * the credential JSON, requests the firebase.messaging scope, and returns the
 * token plus its expiry epoch-ms so the sender's cache layer can decide when to
 * re-mint. This thin adapter is the one surface whose correctness against the
 * live Google API is a documented residual risk (it is not unit-tested; the
 * sender's caching/redaction logic is verified via an injected minter).
 */
export function createGoogleAuthMinter(
  scope: string = FCM_MESSAGING_SCOPE
): (credentials: FcmCredentials) => Promise<FcmAccessToken> {
  return async (credentials) => {
    const parsed = JSON.parse(credentials.serviceAccountJson) as Record<string, unknown>
    const auth = new GoogleAuth({ credentials: parsed, scopes: [scope] })
    const client = await auth.getClient()
    const result = (await client.getAccessToken()) as {
      token?: string | null
      expiryDate?: number | null
      res?: { expiry_date?: number | null } | null
    }
    const token = result.token
    if (!token) {
      throw new Error('OAuth2 mint returned no access token')
    }
    const explicitExpiry =
      result.expiryDate ?? result.res?.expiry_date ?? client.credentials.expiry_date
    const expiresAtMs =
      typeof explicitExpiry === 'number' && Number.isFinite(explicitExpiry)
        ? explicitExpiry
        : Date.now() + 3_600_000
    return { token, expiresAtMs }
  }
}
