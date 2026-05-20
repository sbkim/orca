import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildTerminalTitlePaneCandidateId,
  buildTerminalTitleTabCandidateId
} from '@/lib/continuing-activation-candidate-ids'
import { createTestStore, makeTab, seedStore } from './store-test-helpers'

function stubDocumentVisibility({
  isFocused,
  visibilityState
}: {
  isFocused: boolean
  visibilityState: 'hidden' | 'visible'
}): void {
  vi.stubGlobal('document', {
    visibilityState,
    hasFocus: () => isFocused
  })
}

describe('continuing activation slice', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not record a review cue for the visible focused terminal tab', () => {
    const store = createTestStore()
    seedStore(store, {
      activeView: 'terminal',
      activeWorktreeId: 'wt-1',
      activeTabId: 'tab-1',
      tabsByWorktree: { 'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1' })] }
    })
    stubDocumentVisibility({ isFocused: true, visibilityState: 'visible' })

    store.getState().recordContinuingActivationCue({
      kind: 'agent_ready_for_review',
      tabId: 'tab-1',
      createdAt: 1_700_000_000_000
    })

    expect(store.getState().continuingActivationCues).toEqual({})
  })

  it('records review cues without persisting path-bearing worktree ids', () => {
    const store = createTestStore()
    seedStore(store, {
      activeView: 'terminal',
      activeWorktreeId: 'repo-1::/private/worktree',
      activeTabId: 'tab-1',
      tabsByWorktree: {
        'repo-1::/private/worktree': [
          makeTab({ id: 'tab-1', worktreeId: 'repo-1::/private/worktree' })
        ]
      }
    })
    stubDocumentVisibility({ isFocused: false, visibilityState: 'hidden' })

    store.getState().recordContinuingActivationCue({
      kind: 'agent_ready_for_review',
      tabId: 'tab-1',
      createdAt: 1_700_000_000_000
    })

    expect(store.getState().continuingActivationCues).toEqual({
      'agent_ready_for_review:tab-1': {
        id: 'agent_ready_for_review:tab-1',
        kind: 'agent_ready_for_review',
        tabId: 'tab-1',
        createdAt: 1_700_000_000_000
      }
    })
  })

  it('clears all cues for a worktree by deriving ownership from tabs', () => {
    const store = createTestStore()
    seedStore(store, {
      tabsByWorktree: {
        'wt-1': [
          makeTab({ id: 'tab-1', worktreeId: 'wt-1' }),
          makeTab({ id: 'tab-2', worktreeId: 'wt-1' })
        ],
        'wt-2': [makeTab({ id: 'tab-3', worktreeId: 'wt-2' })]
      },
      continuingActivationCues: {
        'agent_ready_for_review:tab-1': {
          id: 'agent_ready_for_review:tab-1',
          kind: 'agent_ready_for_review',
          tabId: 'tab-1',
          createdAt: 1
        },
        'agent_ready_for_review:tab-2': {
          id: 'agent_ready_for_review:tab-2',
          kind: 'agent_ready_for_review',
          tabId: 'tab-2',
          createdAt: 2
        },
        'agent_ready_for_review:tab-3': {
          id: 'agent_ready_for_review:tab-3',
          kind: 'agent_ready_for_review',
          tabId: 'tab-3',
          createdAt: 3
        }
      }
    })

    store.getState().clearContinuingActivationCuesForTarget({ worktreeId: 'wt-1' })

    expect(Object.keys(store.getState().continuingActivationCues)).toEqual([
      'agent_ready_for_review:tab-3'
    ])
  })

  it('allows a dismissed pane-title permission candidate to return after the title clears', () => {
    const store = createTestStore()
    const candidateId = buildTerminalTitlePaneCandidateId({ tabId: 'tab-1', paneId: 7 })
    seedStore(store, {
      runtimePaneTitlesByTabId: { 'tab-1': { 7: 'Claude permission required' } },
      dismissedContinuingActivationCandidateIds: { [candidateId]: true }
    })

    store.getState().setRuntimePaneTitle('tab-1', 7, 'bash')

    expect(store.getState().dismissedContinuingActivationCandidateIds[candidateId]).toBeUndefined()
  })

  it('allows a dismissed tab-title permission candidate to return after the title clears', () => {
    const store = createTestStore()
    const candidateId = buildTerminalTitleTabCandidateId({ tabId: 'tab-1' })
    seedStore(store, {
      tabsByWorktree: {
        'wt-1': [
          makeTab({
            id: 'tab-1',
            worktreeId: 'wt-1',
            title: 'Claude permission required'
          })
        ]
      },
      dismissedContinuingActivationCandidateIds: { [candidateId]: true }
    })

    store.getState().updateTabTitle('tab-1', 'bash')

    expect(store.getState().dismissedContinuingActivationCandidateIds[candidateId]).toBeUndefined()
  })
})
