import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusEntry
} from '../../../shared/agent-status-types'
import type { ContinuingActivationCue, TerminalTab, Worktree } from '../../../shared/types'
import { detectAgentStatusFromTitle, isExplicitAgentStatusFresh } from './agent-status'
import type { RetainedAgentEntry } from '@/store/slices/agent-status'
import {
  buildTerminalTitlePaneCandidateId,
  buildTerminalTitleTabCandidateId
} from './continuing-activation-candidate-ids'

export type ContinuingActivationCandidateKind = 'agent_needs_input' | 'agent_ready_for_review'

export type ContinuingActivationCandidateSource =
  | 'live_agent_status'
  | 'retained_agent_status'
  | 'terminal_title'
  | 'agent_completion_cue'

export type ContinuingActivationCandidate = {
  id: string
  kind: ContinuingActivationCandidateKind
  source: ContinuingActivationCandidateSource
  worktreeId: string
  tabId: string | null
  paneKey?: string
  cueId?: string
  rank: number
  updatedAt: number
}

export type ContinuingActivationCandidateState = {
  activeView: 'terminal' | 'settings' | 'tasks'
  activeWorktreeId: string | null
  activeTabId: string | null
  worktreesByRepo: Record<string, Worktree[]>
  tabsByWorktree: Record<string, TerminalTab[]>
  runtimePaneTitlesByTabId: Record<string, Record<number, string>>
  agentStatusByPaneKey: Record<string, AgentStatusEntry>
  retainedAgentsByPaneKey: Record<string, RetainedAgentEntry>
  continuingActivationCues: Record<string, ContinuingActivationCue>
  acknowledgedAgentsByPaneKey: Record<string, number>
  dismissedContinuingActivationCandidateIds: Record<string, true>
}

type TabIndexEntry = {
  worktreeId: string
  tab: TerminalTab
}

function collectLiveWorktreeIds(worktreesByRepo: Record<string, Worktree[]>): Set<string> {
  const ids = new Set<string>()
  for (const worktrees of Object.values(worktreesByRepo)) {
    for (const worktree of worktrees) {
      if (!worktree.isArchived) {
        ids.add(worktree.id)
      }
    }
  }
  return ids
}

function buildTabIndex(tabsByWorktree: Record<string, TerminalTab[]>): Map<string, TabIndexEntry> {
  const index = new Map<string, TabIndexEntry>()
  for (const [worktreeId, tabs] of Object.entries(tabsByWorktree)) {
    for (const tab of tabs) {
      index.set(tab.id, { worktreeId, tab })
    }
  }
  return index
}

function tabIdFromPaneKey(paneKey: string): string | null {
  const sepIdx = paneKey.indexOf(':')
  return sepIdx > 0 ? paneKey.slice(0, sepIdx) : null
}

function isVisibleTarget(
  state: ContinuingActivationCandidateState,
  worktreeId: string,
  tabId: string | null
): boolean {
  if (state.activeView !== 'terminal' || state.activeWorktreeId !== worktreeId) {
    return false
  }
  const visibleTabId = state.activeTabId ?? state.tabsByWorktree[worktreeId]?.[0]?.id ?? null
  return tabId === null || visibleTabId === tabId
}

function isUnvisitedAgentState(
  entry: Pick<AgentStatusEntry, 'stateStartedAt'>,
  paneKey: string,
  acknowledgedAgentsByPaneKey: Record<string, number>
): boolean {
  return (acknowledgedAgentsByPaneKey[paneKey] ?? 0) < entry.stateStartedAt
}

function candidateSort(
  left: ContinuingActivationCandidate,
  right: ContinuingActivationCandidate
): number {
  return (
    right.rank - left.rank || right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)
  )
}

export function getContinuingActivationCandidates(
  state: ContinuingActivationCandidateState,
  now: number = Date.now()
): ContinuingActivationCandidate[] {
  const liveWorktreeIds = collectLiveWorktreeIds(state.worktreesByRepo)
  const tabIndex = buildTabIndex(state.tabsByWorktree)
  const candidates = new Map<string, ContinuingActivationCandidate>()

  const addCandidate = (candidate: ContinuingActivationCandidate): void => {
    if (!liveWorktreeIds.has(candidate.worktreeId)) {
      return
    }
    if (candidate.tabId && !tabIndex.has(candidate.tabId)) {
      return
    }
    if (isVisibleTarget(state, candidate.worktreeId, candidate.tabId)) {
      return
    }
    if (state.dismissedContinuingActivationCandidateIds[candidate.id]) {
      return
    }
    const existing = candidates.get(candidate.id)
    if (!existing || candidateSort(candidate, existing) < 0) {
      candidates.set(candidate.id, candidate)
    }
  }

  for (const [paneKey, entry] of Object.entries(state.agentStatusByPaneKey)) {
    if (!isExplicitAgentStatusFresh(entry, now, AGENT_STATUS_STALE_AFTER_MS)) {
      continue
    }
    const tabId = tabIdFromPaneKey(paneKey)
    const target = tabId ? tabIndex.get(tabId) : null
    if (!target) {
      continue
    }
    if (entry.state === 'blocked' || entry.state === 'waiting') {
      addCandidate({
        id: `agent_needs_input:${paneKey}:${entry.stateStartedAt}`,
        kind: 'agent_needs_input',
        source: 'live_agent_status',
        worktreeId: target.worktreeId,
        tabId,
        paneKey,
        rank: 100,
        updatedAt: entry.stateStartedAt
      })
      continue
    }
    if (
      entry.state === 'done' &&
      !entry.interrupted &&
      isUnvisitedAgentState(entry, paneKey, state.acknowledgedAgentsByPaneKey)
    ) {
      addCandidate({
        id: `agent_ready_for_review:${paneKey}:${entry.stateStartedAt}`,
        kind: 'agent_ready_for_review',
        source: 'live_agent_status',
        worktreeId: target.worktreeId,
        tabId,
        paneKey,
        rank: 85,
        updatedAt: entry.stateStartedAt
      })
    }
  }

  for (const [paneKey, retained] of Object.entries(state.retainedAgentsByPaneKey)) {
    const tabId = retained.tab.id
    if (!tabIndex.has(tabId)) {
      continue
    }
    if (
      retained.entry.interrupted ||
      !isUnvisitedAgentState(retained.entry, paneKey, state.acknowledgedAgentsByPaneKey)
    ) {
      continue
    }
    addCandidate({
      id: `agent_ready_for_review:${paneKey}:${retained.entry.stateStartedAt}`,
      kind: 'agent_ready_for_review',
      source: 'retained_agent_status',
      worktreeId: retained.worktreeId,
      tabId,
      paneKey,
      rank: 82,
      updatedAt: retained.entry.stateStartedAt
    })
  }

  for (const [worktreeId, tabs] of Object.entries(state.tabsByWorktree)) {
    for (const tab of tabs) {
      if (!tab.ptyId) {
        continue
      }
      const paneTitles = state.runtimePaneTitlesByTabId[tab.id]
      if (paneTitles && Object.keys(paneTitles).length > 0) {
        for (const [paneId, title] of Object.entries(paneTitles)) {
          if (detectAgentStatusFromTitle(title) !== 'permission') {
            continue
          }
          addCandidate({
            id: buildTerminalTitlePaneCandidateId({ tabId: tab.id, paneId }),
            kind: 'agent_needs_input',
            source: 'terminal_title',
            worktreeId,
            tabId: tab.id,
            paneKey: `${tab.id}:${paneId}`,
            rank: 95,
            updatedAt: tab.createdAt
          })
        }
        continue
      }
      if (detectAgentStatusFromTitle(tab.title) === 'permission') {
        addCandidate({
          id: buildTerminalTitleTabCandidateId({ tabId: tab.id }),
          kind: 'agent_needs_input',
          source: 'terminal_title',
          worktreeId,
          tabId: tab.id,
          rank: 90,
          updatedAt: tab.createdAt
        })
      }
    }
  }

  for (const cue of Object.values(state.continuingActivationCues)) {
    if (cue.dismissedAt) {
      continue
    }
    const target = tabIndex.get(cue.tabId)
    if (!target) {
      continue
    }
    addCandidate({
      id: `agent_ready_for_review:${cue.id}:${cue.createdAt}`,
      kind: 'agent_ready_for_review',
      source: 'agent_completion_cue',
      worktreeId: target.worktreeId,
      tabId: cue.tabId,
      cueId: cue.id,
      rank: 75,
      updatedAt: cue.createdAt
    })
  }

  return [...candidates.values()].sort(candidateSort)
}

export function getTopContinuingActivationCandidate(
  state: ContinuingActivationCandidateState,
  now: number = Date.now()
): ContinuingActivationCandidate | null {
  return getContinuingActivationCandidates(state, now)[0] ?? null
}
