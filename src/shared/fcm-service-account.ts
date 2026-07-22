import type { FcmServiceAccountSetResult, FcmServiceAccountStatus } from './types'

export const FCM_SERVICE_ACCOUNT_JSON_MAX_CHARACTERS = 128 * 1024

// Why: desktop onboarding and headless RPC must accept and reject the same
// credential shape without ever echoing the private key in an error.
export function parseFcmServiceAccountJson(raw: unknown): FcmServiceAccountSetResult {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, error: 'Service-account JSON is empty.' }
  }
  if (raw.length > FCM_SERVICE_ACCOUNT_JSON_MAX_CHARACTERS) {
    return { ok: false, error: 'Service-account JSON is too large.' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return { ok: false, error: 'Service-account JSON could not be parsed.' }
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    !('project_id' in parsed) ||
    typeof parsed.project_id !== 'string' ||
    parsed.project_id.length === 0
  ) {
    return { ok: false, error: 'Service-account JSON is missing a string project_id.' }
  }
  return { ok: true, projectId: parsed.project_id }
}

// Why: status consumers need confirmation of the active project, but must
// never receive the stored credential or its private key.
export function getFcmServiceAccountStatus(raw: string | null): FcmServiceAccountStatus {
  if (!raw) {
    return { configured: false, projectId: null }
  }
  const parsed = parseFcmServiceAccountJson(raw)
  return parsed.ok
    ? { configured: true, projectId: parsed.projectId }
    : { configured: false, projectId: null }
}
