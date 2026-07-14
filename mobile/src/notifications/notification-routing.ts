// Why: 'fcm-supplemental' marks a notification that arrived via the FCM
// supplemental push channel (SPEC-FCM-001, M5). M4's fan-out encrypts only
// {title, body} for FCM, so the original desktop source is not carried and the
// mobile records this transport marker instead. The value is metadata-only —
// navigation uses hostId/worktreeId, never source.
export type DesktopNotificationSource =
  | 'agent-task-complete'
  | 'terminal-bell'
  | 'test'
  | 'fcm-supplemental'

export type DesktopNotificationEvent = {
  source: DesktopNotificationSource
  worktreeId?: string
  notificationId?: string
}

export type LocalNotificationData = {
  source: DesktopNotificationSource
  hostId: string
  worktreeId?: string
  notificationId?: string
}

export type NotificationNavigationOptions = {
  knownHostIds?: ReadonlySet<string>
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export function buildLocalNotificationData(
  event: DesktopNotificationEvent,
  hostId: string
): LocalNotificationData {
  const data: LocalNotificationData = {
    source: event.source,
    hostId
  }
  if (event.worktreeId) {
    data.worktreeId = event.worktreeId
  }
  if (event.notificationId) {
    data.notificationId = event.notificationId
  }
  return data
}

export function getNotificationNavigationPath(
  data: unknown,
  options: NotificationNavigationOptions = {}
): string | null {
  if (!data || typeof data !== 'object') {
    return null
  }

  const record = data as Record<string, unknown>
  const hostId = readNonEmptyString(record.hostId)
  if (!hostId) {
    return null
  }
  if (options.knownHostIds && !options.knownHostIds.has(hostId)) {
    return null
  }

  const hostPath = `/h/${encodeURIComponent(hostId)}`
  const worktreeId = readNonEmptyString(record.worktreeId)
  if (!worktreeId) {
    return hostPath
  }

  return `${hostPath}/session/${encodeURIComponent(worktreeId)}`
}
