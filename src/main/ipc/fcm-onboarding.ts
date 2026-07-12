import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type {
  FcmServiceAccountClearResult,
  FcmServiceAccountSetResult,
  FcmServiceAccountStatus
} from '../../shared/types'

// Why: the FCM supplemental push channel (SPEC-FCM-001) needs a Google service
// account credential to mint access tokens. The fan-out in index.ts parses
// `project_id` out of this JSON, so onboarding validates that same field before
// persisting — a credential without it would silently no-op at dispatch time.
// The credential carries a private key, so the status channel is the only
// post-paste surface the renderer ever sees, and it returns just configured-
// state + the non-secret projectId.

const CHANNEL_SET = 'fcm:setServiceAccount'
const CHANNEL_STATUS = 'fcm:getServiceAccountStatus'
const CHANNEL_CLEAR = 'fcm:clearServiceAccount'

type ServiceAccountShape = { project_id?: unknown }

/** Parses and validates the pasted credential. On success returns the
 *  projectId the fan-out will use; on failure returns a plain-text reason
 *  safe to surface in the renderer (never includes the credential body). */
function parseServiceAccountJson(
  raw: unknown
): { ok: true; projectId: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, error: 'Service-account JSON is empty.' }
  }
  let parsed: ServiceAccountShape
  try {
    parsed = JSON.parse(raw) as ServiceAccountShape
  } catch {
    return { ok: false, error: 'Service-account JSON could not be parsed.' }
  }
  if (typeof parsed.project_id !== 'string' || parsed.project_id.length === 0) {
    // Why: project_id is the one field the fan-out requires (index.ts
    // getFcmCredentials). Rejecting here keeps a malformed credential from
    // persisting as a silent no-op.
    return { ok: false, error: 'Service-account JSON is missing a string project_id.' }
  }
  return { ok: true, projectId: parsed.project_id }
}

/** Reads the stored credential and derives the renderer-facing status. A
 *  corrupt or hand-edited persisted value degrades to not-configured rather
 *  than throwing — mirrors the defensive parse the fan-out already does, so
 *  the renderer's status poll is always safe. Never returns the raw JSON. */
function readStatus(store: Store): FcmServiceAccountStatus {
  const json = store.getFcmServiceAccountJson()
  if (!json) {
    return { configured: false, projectId: null }
  }
  const parsed = parseServiceAccountJson(json)
  if (!parsed.ok) {
    return { configured: false, projectId: null }
  }
  return { configured: true, projectId: parsed.projectId }
}

export function registerFcmHandlers(store: Store): void {
  ipcMain.removeHandler(CHANNEL_SET)
  ipcMain.handle(CHANNEL_SET, (_event, raw: unknown): FcmServiceAccountSetResult => {
    const parsed = parseServiceAccountJson(raw)
    if (!parsed.ok) {
      // Why: never log `raw` — it carries the private key. The error string is
      // a fixed, generic reason safe for the console and the renderer toast.
      return { ok: false, error: parsed.error }
    }
    store.setFcmServiceAccountJson(raw as string)
    return { ok: true, projectId: parsed.projectId }
  })

  ipcMain.removeHandler(CHANNEL_STATUS)
  ipcMain.handle(CHANNEL_STATUS, (): FcmServiceAccountStatus => readStatus(store))

  ipcMain.removeHandler(CHANNEL_CLEAR)
  ipcMain.handle(CHANNEL_CLEAR, (): FcmServiceAccountClearResult => {
    store.setFcmServiceAccountJson(null)
    return { ok: true }
  })
}
