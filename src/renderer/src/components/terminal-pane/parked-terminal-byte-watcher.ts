/**
 * Parked terminal byte watcher.
 *
 * Why: parking unmounts the TerminalPane subtree, which tears down the
 * transport byte parsers — the renderer's only source of bell, title,
 * agent-completion, mode-2031, and PR-link side effects. (Losing them is the
 * gap that sank the first parking attempt.) This watcher rides the dispatcher
 * sidecar channel — the same mechanism background agent launches use — so it
 * never disturbs pane handler registration or eager buffering, and keeps the
 * PTY side effects alive with no xterm while the tab is parked.
 * See docs/reference/terminal-hidden-view-parking.md.
 */
import { isClaudeAgent } from '../../../../shared/agent-detection'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import {
  mode2031SequenceFor,
  resolveTerminalColorSchemeMode,
  scanMode2031Sequences
} from '../../../../shared/terminal-color-scheme-protocol'
import { useAppStore } from '@/store'
import { getSystemPrefersDark } from '@/lib/terminal-theme'
import { createTerminalGitHubPRLinkDetector } from '@/lib/terminal-github-pr-link-detector'
import { subscribeToPtyData } from './pty-dispatcher'
import { createPtyOutputProcessor } from './pty-transport'
import { dispatchTerminalNotification } from './use-notification-dispatch'

// Why: mirrors AGENT_TASK_COMPLETE_NOTIFICATION_GRACE_MS in pty-connection.ts.
// The parked path must keep the live path's BEL-vs-completion race window so
// notification behavior is identical whether a tab is parked or mounted.
const PARKED_NOTIFICATION_GRACE_MS = 250

type StoreState = ReturnType<typeof useAppStore.getState>

// Why: these settings predicates are duplicated from pty-connection.ts instead
// of imported — that module drags the whole pane/xterm dependency graph into a
// watcher that exists precisely to run without a pane.
function isAgentTaskCompleteOsNotificationEnabled(state: StoreState): boolean {
  const notifications = state.settings?.notifications
  return notifications?.enabled !== false && notifications?.agentTaskComplete !== false
}

function isAgentTaskCompleteTrackingEnabled(state: StoreState): boolean {
  return (
    isAgentTaskCompleteOsNotificationEnabled(state) ||
    state.settings?.experimentalTerminalAttention === true
  )
}

export type ParkedTerminalByteWatcherOptions = {
  ptyId: string
  tabId: string
  worktreeId: string
  /** Stable terminal-layout leaf UUID. Combined with tabId into the paneKey
   *  used for cache-timer, unread, and notification attribution. */
  leafId: string
  /** PaneManager pane id the unmounted pane used. Runtime pane titles are
   *  keyed by it, so the watcher must write the slot the live path wrote —
   *  a different id would leave a stale (possibly "working") title behind. */
  paneId: number
  /** Whether this PTY's pane was the tab's active split pane. Mirrors the
   *  live path, where only the focused split drives the tab title. */
  drivesTabTitle?: boolean
  /** The pane's last known runtime title at park time. Seeds the agent
   *  tracker so an agent that was working when the pane unmounted still
   *  fires its completion when it goes idle while parked. */
  initialTitle?: string
  /** Out-of-band reply channel to the PTY (mode-2031 color-scheme answers). */
  sendInput: (data: string) => void
}

const parkedWatcherDisposersByPtyId = new Map<string, () => void>()

export function startParkedTerminalByteWatcher(
  options: ParkedTerminalByteWatcherOptions
): () => void {
  const { ptyId, tabId, worktreeId, paneId, sendInput } = options
  const drivesTabTitle = options.drivesTabTitle ?? true
  const paneKey = makePaneKey(tabId, options.leafId)

  // Why: one watcher per PTY. A stale watcher from a previous park cycle would
  // double-fire bell/completion side effects for the same bytes.
  parkedWatcherDisposersByPtyId.get(ptyId)?.()

  let disposed = false
  let pendingBellNotification = false
  // Why: a watcher-written runtime title (especially into a negative fallback
  // slot) has no live pane to overwrite it after reveal; a stale 'working'
  // entry would pin worktree status forever. Track writes so dispose can
  // clear exactly the slot this watcher touched.
  let wroteRuntimeTitleSlot = false
  let bellNotificationTimer: ReturnType<typeof setTimeout> | null = null
  let agentTaskCompleteTimer: ReturnType<typeof setTimeout> | null = null
  let mode2031ScanTail = ''
  const observeTerminalGitHubPRLink = createTerminalGitHubPRLinkDetector()

  const clearBellNotificationTimer = (): void => {
    if (bellNotificationTimer !== null) {
      clearTimeout(bellNotificationTimer)
      bellNotificationTimer = null
    }
  }

  const clearAgentTaskCompleteTimer = (): void => {
    if (agentTaskCompleteTimer !== null) {
      clearTimeout(agentTaskCompleteTimer)
      agentTaskCompleteTimer = null
    }
  }

  // Why: like the live path, a BEL OS notification only yields when the
  // pending completion would itself produce an OS notification.
  const hasPendingAgentTaskCompleteNotification = (): boolean =>
    agentTaskCompleteTimer !== null &&
    isAgentTaskCompleteOsNotificationEnabled(useAppStore.getState())

  const scheduleTerminalBellNotification = (): void => {
    if (bellNotificationTimer !== null) {
      return
    }
    bellNotificationTimer = setTimeout(() => {
      bellNotificationTimer = null
      if (disposed) {
        pendingBellNotification = false
        return
      }
      if (hasPendingAgentTaskCompleteNotification()) {
        return
      }
      pendingBellNotification = false
      dispatchTerminalNotification(worktreeId, { source: 'terminal-bell', paneKey })
    }, PARKED_NOTIFICATION_GRACE_MS)
  }

  // Why: reuse the transport's output processor so the parked path keeps the
  // exact live-path parsing semantics — all-titles ordering, title
  // normalization, the cursor-agent native-title drop, the OSC-aware stateful
  // bell detector, and the working/idle agent tracker.
  const processor = createPtyOutputProcessor({
    // Why: an agent that was already working at park time must still produce
    // a working→idle transition; the fresh tracker would otherwise start cold
    // and never fire the completion entry point while parked.
    ...(options.initialTitle !== undefined ? { initialAgentTitle: options.initialTitle } : {}),
    onTitleChange: (title) => {
      const state = useAppStore.getState()
      wroteRuntimeTitleSlot = true
      state.setRuntimePaneTitle(tabId, paneId, title)
      if (drivesTabTitle) {
        state.updateTabTitle(tabId, title)
      }
    },
    onBell: () => {
      const state = useAppStore.getState()
      state.markWorktreeUnread(worktreeId)
      state.markTerminalTabUnread(tabId)
      if (state.settings?.experimentalTerminalAttention === true) {
        state.markTerminalPaneUnread(paneKey)
      }
      // Why: agent CLIs often emit BEL in the same completion burst as their
      // working→idle title change. Delay only the OS notification so the
      // richer agent-task-complete notification can win (live-path parity).
      pendingBellNotification = true
      if (!hasPendingAgentTaskCompleteNotification()) {
        scheduleTerminalBellNotification()
      }
    },
    onAgentBecameIdle: (title) => {
      const state = useAppStore.getState()
      // Why: mirrors pty-connection — null settings means "not hydrated yet";
      // a spurious timestamp is harmless while a dropped one loses the timer.
      if (
        isClaudeAgent(title) &&
        (state.settings === null || state.settings.promptCacheTimerEnabled)
      ) {
        state.setCacheTimerStartedAt(paneKey, Date.now())
      }
      if (!isAgentTaskCompleteTrackingEnabled(state)) {
        return
      }
      clearAgentTaskCompleteTimer()
      agentTaskCompleteTimer = setTimeout(() => {
        agentTaskCompleteTimer = null
        if (disposed) {
          return
        }
        // Why: the completion supersedes a concurrent BEL so each completion
        // burst yields exactly one OS notification, same as the live path.
        pendingBellNotification = false
        clearBellNotificationTimer()
        dispatchTerminalNotification(worktreeId, {
          source: 'agent-task-complete',
          terminalTitle: title,
          paneKey,
          ...(isAgentTaskCompleteOsNotificationEnabled(useAppStore.getState())
            ? {}
            : { suppressOsNotification: true })
        })
      }, PARKED_NOTIFICATION_GRACE_MS)
    },
    onAgentBecameWorking: () => {
      // Why: a new API call refreshes the prompt-cache TTL, so clear any
      // running countdown; it restarts when the agent next becomes idle.
      useAppStore.getState().setCacheTimerStartedAt(paneKey, null)
      clearAgentTaskCompleteTimer()
      if (pendingBellNotification) {
        scheduleTerminalBellNotification()
      }
    },
    onAgentExited: () => {
      // Why: title reverting to a plain shell means the agent session ended;
      // a stale countdown must not survive in the sidebar while parked.
      useAppStore.getState().setCacheTimerStartedAt(paneKey, null)
    }
  })

  const respondToMode2031Subscribe = (data: string): void => {
    const scan = scanMode2031Sequences(mode2031ScanTail, data)
    mode2031ScanTail = scan.tail
    if (!scan.subscribe) {
      return
    }
    // Why: no xterm exists while parked, so nothing answers the DECSET 2031
    // subscription. Reply out-of-band so TUIs that subscribe while parked
    // still learn the theme before the pane is ever revealed.
    const settings = useAppStore.getState().settings
    sendInput(mode2031SequenceFor(resolveTerminalColorSchemeMode(settings, getSystemPrefersDark())))
  }

  const unsubscribe = subscribeToPtyData(ptyId, (data) => {
    // Why: empty pane callbacks — the watcher wants only the parser side
    // effects; there is no xterm to deliver bytes to.
    processor.processData(data, {})
    respondToMode2031Subscribe(data)
    for (const link of observeTerminalGitHubPRLink(data)) {
      useAppStore.getState().observeTerminalGitHubPullRequestLink(worktreeId, link)
    }
  })

  const dispose = (): void => {
    if (disposed) {
      return
    }
    disposed = true
    unsubscribe()
    // Why: cancels the deferred side-effect drain, stale-title timer, and
    // tracker/bell-detector state so the watcher cannot fire after the
    // revealed pane's live parsers take over.
    processor.clearAccumulatedState()
    clearBellNotificationTimer()
    clearAgentTaskCompleteTimer()
    pendingBellNotification = false
    // Why: the store merge never deletes title slots, so a watcher-written
    // entry would strand after reveal (the revealing pane re-registers under
    // its own pane id) and could pin worktree status 'working'. The revealed
    // pane repopulates its slot via its own title flow.
    if (wroteRuntimeTitleSlot) {
      wroteRuntimeTitleSlot = false
      useAppStore.getState().clearRuntimePaneTitle(tabId, paneId)
    }
    if (parkedWatcherDisposersByPtyId.get(ptyId) === dispose) {
      parkedWatcherDisposersByPtyId.delete(ptyId)
    }
  }
  parkedWatcherDisposersByPtyId.set(ptyId, dispose)
  return dispose
}
