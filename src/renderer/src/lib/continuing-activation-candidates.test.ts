import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import type { ContinuingActivationCue, TerminalTab, Worktree } from '../../../shared/types'
import {
  getContinuingActivationCandidates,
  getTopContinuingActivationCandidate,
  type ContinuingActivationCandidateState
} from './continuing-activation-candidates'
import type { RetainedAgentEntry } from '@/store/slices/agent-status'

function makeWorktree(overrides: Partial<Worktree> & { id: string }): Worktree {
  const { id, ...rest } = overrides
  return {
    id,
    repoId: 'repo-1',
    path: '/private/repo/worktree',
    head: 'abc123',
    branch: 'refs/heads/feature',
    isBare: false,
    isMainWorktree: false,
    displayName: 'Customer Repo',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ...rest
  }
}

function makeTab(
  overrides: Partial<TerminalTab> & { id: string; worktreeId: string }
): TerminalTab {
  return {
    ptyId: 'pty-1',
    title: 'Terminal 1',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 100,
    ...overrides
  }
}

function makeEntry(overrides: Partial<AgentStatusEntry>): AgentStatusEntry {
  return {
    state: 'working',
    prompt: '',
    updatedAt: 1_000,
    stateStartedAt: 1_000,
    paneKey: 'tab-1:1',
    stateHistory: [],
    ...overrides
  }
}

function makeState(
  overrides: Partial<ContinuingActivationCandidateState> = {}
): ContinuingActivationCandidateState {
  const worktree = makeWorktree({ id: 'wt-1' })
  const tab = makeTab({ id: 'tab-1', worktreeId: worktree.id })
  return {
    activeView: 'terminal',
    activeWorktreeId: null,
    activeTabId: null,
    worktreesByRepo: { [worktree.repoId]: [worktree] },
    tabsByWorktree: { [worktree.id]: [tab] },
    runtimePaneTitlesByTabId: {},
    agentStatusByPaneKey: {},
    retainedAgentsByPaneKey: {},
    continuingActivationCues: {},
    acknowledgedAgentsByPaneKey: {},
    dismissedContinuingActivationCandidateIds: {},
    ...overrides
  }
}

describe('getContinuingActivationCandidates', () => {
  it('prioritizes agent input over review candidates', () => {
    const state = makeState({
      agentStatusByPaneKey: {
        'tab-1:1': makeEntry({
          state: 'done',
          paneKey: 'tab-1:1',
          stateStartedAt: 1_000
        }),
        'tab-1:2': makeEntry({
          state: 'waiting',
          paneKey: 'tab-1:2',
          stateStartedAt: 900
        })
      }
    })

    expect(getTopContinuingActivationCandidate(state, 1_100)?.kind).toBe('agent_needs_input')
  })

  it('omits raw terminal-title text from fallback candidate ids', () => {
    const sensitiveTitle = 'Cursor - action required in /Users/alice/secret-project'
    const state = makeState({
      runtimePaneTitlesByTabId: {
        'tab-1': {
          7: sensitiveTitle
        }
      }
    })

    const candidate = getTopContinuingActivationCandidate(state, 1_100)
    expect(candidate).toMatchObject({
      kind: 'agent_needs_input',
      source: 'terminal_title',
      id: 'agent_needs_input:terminal_title:tab-1:7'
    })
    expect(candidate?.id).not.toContain('secret-project')
    expect(candidate?.id).not.toContain('/Users')
    expect(candidate?.id).not.toContain('action required')
  })

  it('uses content-neutral ids for tab-title fallback candidates too', () => {
    const state = makeState({
      tabsByWorktree: {
        'wt-1': [
          makeTab({
            id: 'tab-1',
            worktreeId: 'wt-1',
            title: 'Claude needs permission for C:\\Users\\Alice\\secret'
          })
        ]
      }
    })

    const candidate = getTopContinuingActivationCandidate(state, 1_100)
    expect(candidate?.id).toBe('agent_needs_input:terminal_title:tab-1:tab')
    expect(candidate?.id).not.toContain('Alice')
    expect(candidate?.id).not.toContain('secret')
  })

  it('hides candidates already visible in the active terminal tab', () => {
    const state = makeState({
      activeWorktreeId: 'wt-1',
      activeTabId: 'tab-1',
      agentStatusByPaneKey: {
        'tab-1:1': makeEntry({ state: 'waiting', paneKey: 'tab-1:1' })
      }
    })

    expect(getContinuingActivationCandidates(state, 1_100)).toEqual([])
  })

  it('treats the first tab as visible when no active tab id is stored', () => {
    const state = makeState({
      activeWorktreeId: 'wt-1',
      activeTabId: null,
      agentStatusByPaneKey: {
        'tab-1:1': makeEntry({ state: 'waiting', paneKey: 'tab-1:1' })
      }
    })

    expect(getContinuingActivationCandidates(state, 1_100)).toEqual([])
  })

  it('surfaces local review cues and respects cue dismissal', () => {
    const cue: ContinuingActivationCue = {
      id: 'agent_ready_for_review:tab-1',
      kind: 'agent_ready_for_review',
      tabId: 'tab-1',
      createdAt: 1_000
    }
    const state = makeState({ continuingActivationCues: { [cue.id]: cue } })
    expect(getTopContinuingActivationCandidate(state, 1_100)?.source).toBe('agent_completion_cue')

    const dismissed = makeState({
      continuingActivationCues: { [cue.id]: { ...cue, dismissedAt: 1_050 } }
    })
    expect(getTopContinuingActivationCandidate(dismissed, 1_100)).toBeNull()
  })

  it('derives cue targets from the tab index instead of persisted worktree ids', () => {
    const cue: ContinuingActivationCue = {
      id: 'agent_ready_for_review:tab-1',
      kind: 'agent_ready_for_review',
      tabId: 'tab-1',
      createdAt: 1_000
    }
    const candidate = getTopContinuingActivationCandidate(
      makeState({ continuingActivationCues: { [cue.id]: cue } }),
      1_100
    )

    expect(candidate).toMatchObject({
      source: 'agent_completion_cue',
      worktreeId: 'wt-1',
      tabId: 'tab-1'
    })
  })

  it('does not resurface acknowledged retained done rows', () => {
    const entry = makeEntry({
      state: 'done',
      paneKey: 'tab-1:1',
      stateStartedAt: 1_000
    })
    const retained: RetainedAgentEntry = {
      entry,
      worktreeId: 'wt-1',
      tab: makeTab({ id: 'tab-1', worktreeId: 'wt-1' }),
      agentType: 'claude',
      startedAt: 900
    }

    const state = makeState({
      retainedAgentsByPaneKey: { 'tab-1:1': retained },
      acknowledgedAgentsByPaneKey: { 'tab-1:1': 1_001 }
    })

    expect(getTopContinuingActivationCandidate(state, 1_100)).toBeNull()
  })
})
