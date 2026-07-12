// File logger for the FCM supplemental push channel (SPEC-FCM-001).
//
// Why: main.trace.ndjson only records Effect-TS spans dominated by git.exec,
// so FCM dispatch events (gate decision, per-device fanout, OAuth2 token mint,
// FCM messages:send result) are invisible at runtime. This writes a plain
// line-per-event file under the Orca userData logs dir so push delivery can be
// debugged without a debugger attached.
//
// No Electron dependency: a dynamic `require('electron')` here broke the
// packaged main bundle launch (dist .app quit at startup), so the path is built
// from os.homedir() instead of app.getPath('userData'). Best-effort (never
// throws into the dispatch path).
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const LOG_PATH = join(homedir(), 'Library', 'Application Support', 'orca', 'logs', 'fcm-push.log')

function redact(value: unknown): unknown {
  if (typeof value === 'string' && value.length > 32) {
    return `${value.slice(0, 8)}…<${value.length}>`
  }
  return value
}

export function logFcmPush(event: string, data?: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true })
    const redacted = data
      ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, redact(v)]))
      : undefined
    const line = `${new Date().toISOString()} ${event}${
      redacted ? ` ${JSON.stringify(redacted)}` : ''
    }\n`
    appendFileSync(LOG_PATH, line)
  } catch {
    // Best-effort: never let logging break push delivery.
  }
}
