// File logger for the FCM supplemental push channel (SPEC-FCM-001).
//
// Why: main.trace.ndjson only records Effect-TS spans dominated by git.exec,
// so FCM dispatch events (gate decision, per-device fanout, OAuth2 token mint,
// FCM messages:send result) are invisible at runtime. This writes a plain
// line-per-event file under the Orca userData logs dir so push delivery can be
// debugged without a debugger attached.
//
// No Electron dependency: a dynamic `require('electron')` here broke the
// packaged main bundle launch. Main seeds ORCA_USER_DATA_PATH before runtime
// construction, which also keeps production and dev logs isolated.
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

type LogPathOptions = {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  homeDir?: string
}

export function resolveFcmPushLogPath(options: LogPathOptions = {}): string | null {
  const env = options.env ?? process.env
  if (env.ORCA_FCM_PUSH_LOG_PATH?.trim()) {
    return env.ORCA_FCM_PUSH_LOG_PATH.trim()
  }
  // Why: unit tests must not append synthetic sends to a developer's real Orca log.
  if (env.VITEST === 'true') {
    return null
  }
  const platform = options.platform ?? process.platform
  const homeDir = options.homeDir ?? homedir()
  const userDataPath =
    env.ORCA_USER_DATA_PATH?.trim() ||
    (platform === 'darwin'
      ? join(homeDir, 'Library', 'Application Support', 'orca')
      : platform === 'win32'
        ? join(env.APPDATA?.trim() || join(homeDir, 'AppData', 'Roaming'), 'orca')
        : join(env.XDG_CONFIG_HOME?.trim() || join(homeDir, '.config'), 'orca'))
  return join(userDataPath, 'logs', 'fcm-push.log')
}

function redact(value: unknown): unknown {
  if (typeof value === 'string' && value.length > 32) {
    return `${value.slice(0, 8)}…<${value.length}>`
  }
  return value
}

export function logFcmPush(event: string, data?: Record<string, unknown>): void {
  try {
    const logPath = resolveFcmPushLogPath()
    if (!logPath) {
      return
    }
    mkdirSync(dirname(logPath), { recursive: true })
    const redacted = data
      ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, redact(v)]))
      : undefined
    const line = `${new Date().toISOString()} ${event}${
      redacted ? ` ${JSON.stringify(redacted)}` : ''
    }\n`
    appendFileSync(logPath, line)
  } catch {
    // Best-effort: never let logging break push delivery.
  }
}
