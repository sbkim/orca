// Why: extracted for max-lines compliance, but kept outside src/app because Expo
// Router treats that directory as its route root.

import type { RpcClient } from '../transport/rpc-client'
import type { AccountsSnapshot } from '../components/AccountUsage'
import type { TaskProvider } from '../tasks/mobile-task-providers'
import {
  filterAvailableTaskProviders,
  normalizeVisibleTaskProviders
} from '../tasks/mobile-task-providers'
import { pickResumeWorktree } from '../worktree/resume-worktree'
import { setCachedWorktrees } from '../cache/worktree-cache'

export type StatsSummary = {
  totalAgentsSpawned: number
  totalPRsCreated: number
  totalAgentTimeMs: number
  firstEventAt: number | null
}

export type WorktreeSummary = {
  worktreeId: string
  repo: string
  branch: string
  displayName: string
  liveTerminalCount: number
  status?: 'working' | 'active' | 'permission' | 'done' | 'inactive'
  // The worktree the desktop currently has focused (exactly one is true).
  isActive?: boolean
  // Last terminal-output time (ms); breaks ties when nothing is focused.
  lastOutputAt?: number
}

export type HostWorktreeInfo = {
  hostId: string
  totalWorktrees: number
  activeCount: number
  lastActiveWorktree: WorktreeSummary | null
}

export type HomeTaskSettings = {
  visibleTaskProviders?: unknown
}

export type HomePreflightStatus = {
  glab?: { installed?: boolean }
}

export type HomeLinearStatus = {
  connected?: boolean
}

const TASK_PROVIDER_LABELS: Record<TaskProvider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  linear: 'Linear'
}

export function endpointLabel(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    return `${url.hostname}${url.port ? `:${url.port}` : ''}`
  } catch {
    return endpoint
  }
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const totalHours = Math.floor(totalMinutes / 60)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  if (days > 0) {
    return `${days}d ${hours}h`
  }
  const minutes = totalMinutes % 60
  if (totalHours > 0) {
    return `${totalHours}h ${minutes}m`
  }
  return `${totalMinutes}m`
}

// Why: derive a stable per-instance identity for RpcClient so the wireUp
// effect's dep key changes when forceReconnect swaps the underlying client
// for a host (without this, listeners stay attached to the closed client
// and notifications/accounts subs never re-attach).
const clientIdentities = new WeakMap<RpcClient, number>()
let nextClientIdentity = 1

export function clientKey(client: RpcClient): number {
  let id = clientIdentities.get(client)
  if (id == null) {
    id = nextClientIdentity++
    clientIdentities.set(client, id)
  }
  return id
}

export function fetchStats(
  client: RpcClient,
  setStats: (s: StatsSummary) => void,
  disposed: () => boolean
): void {
  client
    .sendRequest('stats.summary')
    .then((response) => {
      if (disposed()) {
        return
      }
      if (response.ok) {
        setStats(response.result as StatsSummary)
      }
    })
    .catch(() => {})
}

export function fetchWorktreeInfo(
  client: RpcClient,
  hostId: string,
  setInfo: (
    updater: (prev: Record<string, HostWorktreeInfo>) => Record<string, HostWorktreeInfo>
  ) => void,
  disposed: () => boolean
): void {
  // Why: only seed an empty zeroed entry when this host has no prior info
  // at all (e.g., first ever load before any cache hydration). On a
  // transient failure for a host that already has cached data, leave the
  // cached entry alone so the Resume card and host-meta line don't
  // momentarily flip to "0 worktrees" / disappear during reconnects.
  const markLoadedIfMissing = () => {
    setInfo((prev) => {
      if (prev[hostId]) {
        return prev
      }
      return {
        ...prev,
        [hostId]: {
          hostId,
          totalWorktrees: 0,
          activeCount: 0,
          lastActiveWorktree: null
        }
      }
    })
  }

  client
    // Why: worktree.ps defaults to 200 and silently truncates; request the full
    // set so the host worktree count and active count are accurate.
    .sendRequest('worktree.ps', { limit: 10000 })
    .then((response) => {
      if (disposed()) {
        return
      }
      if (response.ok) {
        const result = response.result as { worktrees: WorktreeSummary[] }
        const worktrees = result.worktrees ?? []
        setCachedWorktrees(hostId, worktrees)
        const activeStatuses = new Set(['working', 'active', 'permission'])
        const active = worktrees.filter((w) => w.status && activeStatuses.has(w.status))
        // Mirror the desktop's focused workspace (see pickResumeWorktree).
        const lastActive = pickResumeWorktree(worktrees)
        setInfo((prev) => ({
          ...prev,
          [hostId]: {
            hostId,
            totalWorktrees: worktrees.length,
            activeCount: active.length,
            lastActiveWorktree: lastActive
          }
        }))
      } else {
        markLoadedIfMissing()
      }
    })
    .catch(() => {
      if (!disposed()) {
        markLoadedIfMissing()
      }
    })
}

export function fetchAccountsSnapshot(
  client: RpcClient,
  hostId: string,
  setSnapshots: (
    updater: (prev: Record<string, AccountsSnapshot>) => Record<string, AccountsSnapshot>
  ) => void,
  disposed: () => boolean
): void {
  client
    .sendRequest('accounts.list')
    .then((response) => {
      if (disposed()) {
        return
      }
      if (response.ok) {
        const snapshot = response.result as AccountsSnapshot
        setSnapshots((prev) => ({ ...prev, [hostId]: snapshot }))
      }
    })
    .catch(() => {})
}

export function fetchTaskProviders(
  client: RpcClient,
  hostId: string,
  setProviders: (
    updater: (prev: Record<string, TaskProvider[]>) => Record<string, TaskProvider[]>
  ) => void,
  disposed: () => boolean
): void {
  Promise.all([
    client.sendRequest('settings.get'),
    client.sendRequest('preflight.check'),
    client.sendRequest('linear.status')
  ])
    .then(([settingsResponse, preflightResponse, linearResponse]) => {
      if (disposed()) {
        return
      }
      const settings = settingsResponse.ok
        ? (((settingsResponse.result as { settings?: HomeTaskSettings }).settings ??
            {}) as HomeTaskSettings)
        : {}
      const preflight = preflightResponse.ok
        ? (preflightResponse.result as HomePreflightStatus)
        : null
      const linear = linearResponse.ok ? (linearResponse.result as HomeLinearStatus) : null
      const providers = filterAvailableTaskProviders(
        normalizeVisibleTaskProviders(settings.visibleTaskProviders),
        {
          gitlabInstalled: preflight?.glab?.installed === true,
          linearConnected: linear?.connected === true
        }
      )
      setProviders((prev) => ({ ...prev, [hostId]: providers }))
    })
    .catch(() => {
      if (disposed()) {
        return
      }
      setProviders((prev) => (prev[hostId] ? prev : { ...prev, [hostId]: ['github'] }))
    })
}

// Why: repo names get a stable color derived from hashing, matching the
// host detail page's colored dots for visual consistency.
const REPO_COLORS = ['#8b5cf6', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4']

export function repoColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return REPO_COLORS[Math.abs(hash) % REPO_COLORS.length]
}

export { TASK_PROVIDER_LABELS }
