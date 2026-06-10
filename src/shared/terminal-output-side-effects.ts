/**
 * Shared per-PTY terminal title side-effect tracking — the parser core behind
 * both the renderer transport (`createPtyOutputProcessor`) and main's
 * per-PTY tracker in `OrcaRuntimeService.onPtyData`.
 *
 * Why shared: docs/reference/terminal-side-effect-authority.md makes main the
 * side-effect parser for every PTY whose bytes transit local main. Title
 * semantics (all-titles ordering, cursor-agent literal drop, normalization,
 * stale-working-title clearing) must not drift between the two paths.
 */

import {
  clearWorkingIndicators,
  createAgentStatusTracker,
  detectAgentStatusFromTitle,
  extractAllOscTitles,
  isCursorNativeAgentTitle,
  normalizeTerminalTitle
} from './agent-detection'

/** Ms of title-less output after a working title before it is cleared. */
export const STALE_WORKING_TITLE_TIMEOUT_MS = 3000

export type TerminalTitleTrackerCallbacks = {
  /**
   * Fired once per observed OSC title, in byte order — including the
   * synthesized cleared title when the stale-working timer fires.
   */
  onTitle?: (normalizedTitle: string, rawTitle: string) => void
  onAgentBecameIdle?: (title: string) => void
  onAgentBecameWorking?: () => void
  onAgentExited?: () => void
}

export type TerminalTitleTracker = {
  /** Feed one raw PTY chunk; titles are applied synchronously in byte order. */
  handleChunk: (data: string) => void
  /** Last title surfaced through onTitle, after normalization. */
  getLastNormalizedTitle: () => string | null
  /** Cancel the stale-title timer and clear accumulated tracker state. */
  dispose: () => void
}

export function createTerminalTitleTracker(
  callbacks: TerminalTitleTrackerCallbacks,
  options: { initialTitle?: string } = {}
): TerminalTitleTracker {
  const { onTitle, onAgentBecameIdle, onAgentBecameWorking, onAgentExited } = callbacks
  // Why: seed both the emitted-title memory (stale-title probe) and the agent
  // tracker so a mid-session tracker behaves as if it had observed the pane's
  // last live title — parity with the renderer processor's seeding.
  let lastEmittedTitle: string | null =
    options.initialTitle !== undefined ? normalizeTerminalTitle(options.initialTitle) : null
  let staleTitleTimer: ReturnType<typeof setTimeout> | null = null
  const agentTracker =
    onAgentBecameIdle || onAgentBecameWorking || onAgentExited
      ? createAgentStatusTracker(
          (title) => {
            onAgentBecameIdle?.(title)
          },
          onAgentBecameWorking,
          onAgentExited,
          options.initialTitle
        )
      : null

  function clearStaleTitleTimer(): void {
    if (staleTitleTimer) {
      clearTimeout(staleTitleTimer)
      staleTitleTimer = null
    }
  }

  function applyObservedTitle(rawTitle: string): void {
    // Why: cursor-agent re-emits its bare native title many times per turn
    // while still working; letting it through would stomp Orca's synthesized
    // "⠋ Cursor Agent" spinner state back to agentless within a second.
    if (isCursorNativeAgentTitle(rawTitle)) {
      return
    }
    lastEmittedTitle = normalizeTerminalTitle(rawTitle)
    onTitle?.(lastEmittedTitle, rawTitle)
    agentTracker?.handleTitle(rawTitle)
  }

  function handleChunk(data: string): void {
    // Why: feed EVERY OSC title in the chunk in byte order, never just the
    // last one. node-pty plus the main-process batch window commonly coalesce
    // multiple title updates into a single payload; a last-title reader drops
    // intra-chunk working→idle transitions (issue #1083).
    const titles = data.includes('\x1b]') ? extractAllOscTitles(data) : []
    if (titles.length > 0) {
      clearStaleTitleTimer()
      for (const title of titles) {
        applyObservedTitle(title)
      }
      return
    }
    // Why: agents that exit without resetting their title leave a stale
    // working spinner behind. Any title-less output while the last title
    // classifies as working restarts a 3s timer that rewrites the title to
    // its cleared form — the renderer transport's stale-title semantics.
    if (
      data.length > 0 &&
      lastEmittedTitle !== null &&
      detectAgentStatusFromTitle(lastEmittedTitle) === 'working'
    ) {
      clearStaleTitleTimer()
      staleTitleTimer = setTimeout(() => {
        staleTitleTimer = null
        if (lastEmittedTitle && detectAgentStatusFromTitle(lastEmittedTitle) === 'working') {
          const cleared = clearWorkingIndicators(lastEmittedTitle)
          lastEmittedTitle = cleared
          onTitle?.(cleared, cleared)
          agentTracker?.handleTitle(cleared)
        }
      }, STALE_WORKING_TITLE_TIMEOUT_MS)
    }
  }

  return {
    handleChunk,
    getLastNormalizedTitle: () => lastEmittedTitle,
    dispose(): void {
      clearStaleTitleTimer()
      agentTracker?.reset()
    }
  }
}
