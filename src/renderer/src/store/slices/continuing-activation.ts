import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type {
  ContinuingActivationCue,
  ContinuingActivationCueKind,
  WorkspaceSessionState
} from '../../../../shared/types'

const MAX_CUES = 40
const CUE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000

export type ContinuingActivationSlice = {
  continuingActivationCues: Record<string, ContinuingActivationCue>
  dismissedContinuingActivationCandidateIds: Record<string, true>
  hydrateContinuingActivationSession: (session: WorkspaceSessionState) => void
  recordContinuingActivationCue: (cue: {
    kind: ContinuingActivationCueKind
    tabId: string
    createdAt?: number
  }) => void
  dismissContinuingActivationCue: (cueId: string) => void
  dismissContinuingActivationCandidate: (candidateId: string) => void
  clearContinuingActivationCue: (cueId: string) => void
  clearContinuingActivationCuesForTarget: (target: { worktreeId: string; tabId?: string }) => void
}

function buildCueId(kind: ContinuingActivationCueKind, tabId: string): string {
  return `${kind}:${tabId}`
}

function isVisibleDocumentFocused(): boolean {
  if (typeof document === 'undefined') {
    return false
  }
  return document.visibilityState === 'visible' && document.hasFocus()
}

function isActiveVisibleTab(state: AppState, tabId: string): boolean {
  if (state.activeView !== 'terminal' || !state.activeWorktreeId || !isVisibleDocumentFocused()) {
    return false
  }
  const visibleTabId =
    state.activeTabId ?? state.tabsByWorktree[state.activeWorktreeId]?.[0]?.id ?? null
  return visibleTabId === tabId
}

function tabIdsForWorktree(state: AppState, worktreeId: string): Set<string> {
  return new Set((state.tabsByWorktree[worktreeId] ?? []).map((tab) => tab.id))
}

function pruneCues(
  cues: Record<string, ContinuingActivationCue>,
  now: number
): Record<string, ContinuingActivationCue> {
  const fresh = Object.values(cues).filter((cue) => now - cue.createdAt <= CUE_RETENTION_MS)
  if (fresh.length <= MAX_CUES) {
    return Object.fromEntries(fresh.map((cue) => [cue.id, cue]))
  }
  return Object.fromEntries(
    fresh
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_CUES)
      .map((cue) => [cue.id, cue])
  )
}

export const createContinuingActivationSlice: StateCreator<
  AppState,
  [],
  [],
  ContinuingActivationSlice
> = (set) => ({
  continuingActivationCues: {},
  dismissedContinuingActivationCandidateIds: {},

  hydrateContinuingActivationSession: (session) => {
    set({
      continuingActivationCues: pruneCues(session.continuingActivationCues ?? {}, Date.now()),
      dismissedContinuingActivationCandidateIds: {}
    })
  },

  recordContinuingActivationCue: ({ kind, tabId, createdAt }) => {
    const now = createdAt ?? Date.now()
    const id = buildCueId(kind, tabId)
    set((s) => {
      // Why: if the user is already looking at the completed tab, there is no
      // re-entry breadcrumb to preserve for later.
      if (isActiveVisibleTab(s, tabId)) {
        return s
      }
      return {
        // Why: a fresh completion in the same tab should re-open the cue even
        // if the user dismissed an earlier turn from that tab.
        continuingActivationCues: pruneCues(
          {
            ...s.continuingActivationCues,
            [id]: { id, kind, tabId, createdAt: now }
          },
          now
        )
      }
    })
  },

  dismissContinuingActivationCue: (cueId) => {
    set((s) => {
      const cue = s.continuingActivationCues[cueId]
      if (!cue || cue.dismissedAt) {
        return s
      }
      return {
        continuingActivationCues: {
          ...s.continuingActivationCues,
          [cueId]: { ...cue, dismissedAt: Date.now() }
        }
      }
    })
  },

  dismissContinuingActivationCandidate: (candidateId) => {
    set((s) =>
      s.dismissedContinuingActivationCandidateIds[candidateId]
        ? s
        : {
            dismissedContinuingActivationCandidateIds: {
              ...s.dismissedContinuingActivationCandidateIds,
              [candidateId]: true
            }
          }
    )
  },

  clearContinuingActivationCue: (cueId) => {
    set((s) => {
      if (!(cueId in s.continuingActivationCues)) {
        return s
      }
      const next = { ...s.continuingActivationCues }
      delete next[cueId]
      return { continuingActivationCues: next }
    })
  },

  clearContinuingActivationCuesForTarget: ({ worktreeId, tabId }) => {
    set((s) => {
      const worktreeTabIds = tabId ? undefined : tabIdsForWorktree(s, worktreeId)
      const next = Object.fromEntries(
        Object.entries(s.continuingActivationCues).filter(([, cue]) => {
          if (tabId) {
            return cue.tabId !== tabId
          }
          return !worktreeTabIds?.has(cue.tabId)
        })
      )
      return Object.keys(next).length === Object.keys(s.continuingActivationCues).length
        ? s
        : { continuingActivationCues: next }
    })
  }
})
