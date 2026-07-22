import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type {
  FcmServiceAccountClearResult,
  FcmServiceAccountSetResult,
  FcmServiceAccountStatus
} from '../../shared/types'
import {
  getFcmServiceAccountStatus,
  parseFcmServiceAccountJson
} from '../../shared/fcm-service-account'

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

export function registerFcmHandlers(store: Store): void {
  ipcMain.removeHandler(CHANNEL_SET)
  ipcMain.handle(CHANNEL_SET, (_event, raw: unknown): FcmServiceAccountSetResult => {
    const parsed = parseFcmServiceAccountJson(raw)
    if (!parsed.ok) {
      // Why: never log `raw` — it carries the private key. The error string is
      // a fixed, generic reason safe for the console and the renderer toast.
      return { ok: false, error: parsed.error }
    }
    store.setFcmServiceAccountJson(raw as string)
    return { ok: true, projectId: parsed.projectId }
  })

  ipcMain.removeHandler(CHANNEL_STATUS)
  ipcMain.handle(
    CHANNEL_STATUS,
    (): FcmServiceAccountStatus => getFcmServiceAccountStatus(store.getFcmServiceAccountJson())
  )

  ipcMain.removeHandler(CHANNEL_CLEAR)
  ipcMain.handle(CHANNEL_CLEAR, (): FcmServiceAccountClearResult => {
    store.setFcmServiceAccountJson(null)
    return { ok: true }
  })
}
