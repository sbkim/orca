import { detectAgentStatusFromTitle } from '../agent-detection'
import type { AgentStatus } from '../agent-detection'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStateHistoryEntry,
  type AgentStatusEntry,
  type MigrationUnsupportedPtyEntry
} from '../agent-status-types'
import { parsePaneKey } from '../stable-pane-id'
import type { TerminalLayoutSnapshot, TerminalTab, Worktree } from '../types'
import { isExplicitAgentStatusFresh } from './workspace-agent-status-freshness'
import { migrationUnsupportedToAgentStatusEntry } from './workspace-migration-agent-entry'
import { resolveRuntimePaneTitleLeafId } from './workspace-runtime-pane-title'
import { tabHasLivePty } from './workspace-terminal-liveness'

export type SmartClass = 1 | 2 | 3 | 4
export type AttentionCause = 'blocked' | 'waiting' | 'title-heuristic'

export type WorktreeAttention = {
  cls: SmartClass
  attentionTimestamp: number
  cause?: AttentionCause
}

export const IDLE: WorktreeAttention = { cls: 4, attentionTimestamp: 0 }

export function mostRecentAttentionInHistory(history: AgentStateHistoryEntry[]): number | null {
  let max = 0
  for (const h of history) {
    if (h.state === 'done' && h.interrupted) {
      continue
    }
    if (h.state === 'done' || h.state === 'blocked' || h.state === 'waiting') {
      if (!Number.isFinite(h.startedAt)) {
        continue
      }
      if (h.startedAt > max) {
        max = h.startedAt
      }
    }
  }
  return max > 0 ? max : null
}

export type PaneInput =
  | { kind: 'hook'; entry: AgentStatusEntry }
  | { kind: 'title'; status: AgentStatus | null; worktreeLastActivityAt: number }

export function resolveAttention(panes: PaneInput[], now: number): WorktreeAttention {
  let bestCls: SmartClass = 4
  let bestTs = 0
  let bestCause: AttentionCause | undefined

  for (const pane of panes) {
    let cls: SmartClass
    let ts: number
    let cause: AttentionCause | undefined

    if (pane.kind === 'hook') {
      const entry = pane.entry
      if (!isExplicitAgentStatusFresh(entry, now, AGENT_STATUS_STALE_AFTER_MS)) {
        continue
      }
      if (!Number.isFinite(entry.stateStartedAt)) {
        continue
      }

      if (entry.state === 'blocked' || entry.state === 'waiting') {
        cls = 1
        ts = entry.stateStartedAt
        cause = entry.state
      } else if (entry.state === 'done') {
        if (entry.interrupted) {
          continue
        }
        cls = 2
        ts = entry.stateStartedAt
      } else {
        cls = 3
        const prior = mostRecentAttentionInHistory(entry.stateHistory)
        ts = prior ?? entry.stateStartedAt
      }
    } else if (pane.status === 'permission') {
      cls = 1
      ts = now
      cause = 'title-heuristic'
    } else if (pane.status === 'working') {
      cls = 3
      ts = pane.worktreeLastActivityAt
    } else {
      continue
    }

    if (cls < bestCls || (cls === bestCls && ts > bestTs)) {
      bestCls = cls
      bestTs = ts
      bestCause = cause
    }
  }

  return bestCls === 1 && bestCause
    ? { cls: bestCls, attentionTimestamp: bestTs, cause: bestCause }
    : { cls: bestCls, attentionTimestamp: bestTs }
}

export function buildExplicitEntriesByTabId(
  agentStatusByPaneKey: Record<string, AgentStatusEntry> | undefined,
  migrationUnsupportedByPtyId?: Record<string, MigrationUnsupportedPtyEntry>
): Map<string, AgentStatusEntry[]> {
  const byTab = new Map<string, AgentStatusEntry[]>()
  const entries = [
    ...Object.values(agentStatusByPaneKey ?? {}),
    ...Object.values(migrationUnsupportedByPtyId ?? {}).flatMap((entry) => {
      const agentEntry = migrationUnsupportedToAgentStatusEntry(entry)
      return agentEntry ? [agentEntry] : []
    })
  ]
  for (const entry of entries) {
    const parsed = parsePaneKey(entry.paneKey)
    if (!parsed) {
      continue
    }
    const bucket = byTab.get(parsed.tabId)
    if (bucket) {
      bucket.push(entry)
    } else {
      byTab.set(parsed.tabId, [entry])
    }
  }
  return byTab
}

function leafIdFromPaneKey(paneKey: string): string | null {
  return parsePaneKey(paneKey)?.leafId ?? null
}

export function buildAttentionByWorktree(
  worktrees: Worktree[],
  tabsByWorktree: Record<string, TerminalTab[]> | null,
  agentStatusByPaneKey: Record<string, AgentStatusEntry> | undefined,
  runtimePaneTitlesByTabId: Record<string, Record<number, string>>,
  ptyIdsByTabId: Record<string, string[]>,
  now: number,
  migrationUnsupportedByPtyId?: Record<string, MigrationUnsupportedPtyEntry>,
  terminalLayoutsByTabId?: Record<string, TerminalLayoutSnapshot | undefined>
): Map<string, WorktreeAttention> {
  const byTab = buildExplicitEntriesByTabId(agentStatusByPaneKey, migrationUnsupportedByPtyId)
  const result = new Map<string, WorktreeAttention>()

  for (const worktree of worktrees) {
    const tabs = tabsByWorktree?.[worktree.id]
    if (!tabs || tabs.length === 0) {
      result.set(worktree.id, IDLE)
      continue
    }
    const panes: PaneInput[] = []
    for (const tab of tabs) {
      const hookEntries = byTab.get(tab.id)
      const hookLeafIds = new Set<string>()
      if (hookEntries) {
        for (const entry of hookEntries) {
          panes.push({ kind: 'hook', entry })
          if (!isExplicitAgentStatusFresh(entry, now, AGENT_STATUS_STALE_AFTER_MS)) {
            continue
          }
          const leafId = leafIdFromPaneKey(entry.paneKey)
          if (leafId !== null) {
            hookLeafIds.add(leafId)
          }
        }
      }

      if (!tabHasLivePty(ptyIdsByTabId, tab.id)) {
        continue
      }

      const paneTitles = runtimePaneTitlesByTabId[tab.id]
      if (paneTitles && Object.keys(paneTitles).length > 0) {
        const tabLayout = terminalLayoutsByTabId?.[tab.id]
        for (const [runtimePaneId, title] of Object.entries(paneTitles)) {
          const leafId = resolveRuntimePaneTitleLeafId(tabLayout, runtimePaneId)
          if (leafId !== null && hookLeafIds.has(leafId)) {
            continue
          }
          panes.push({
            kind: 'title',
            status: detectAgentStatusFromTitle(title),
            worktreeLastActivityAt: worktree.lastActivityAt
          })
        }
      } else if (hookLeafIds.size === 0) {
        panes.push({
          kind: 'title',
          status: detectAgentStatusFromTitle(tab.title),
          worktreeLastActivityAt: worktree.lastActivityAt
        })
      }
    }
    result.set(worktree.id, resolveAttention(panes, now))
  }

  return result
}
