import { waitForAgentReady } from '@/lib/agent-ready-wait'
import { useAppStore } from '@/store'

// Why: bracketed paste markers let modern TUIs (Claude Code / Codex / Gemini)
// treat the inserted text as a single atomic paste — they put it in their
// input buffer as a draft instead of echoing character-by-character or
// triggering line-edit shortcuts. Intentionally omit a trailing '\r' so the
// draft never auto-submits; the user gets to review and send themselves.
const BRACKETED_PASTE_BEGIN = '\x1b[200~'
const BRACKETED_PASTE_END = '\x1b[201~'

/**
 * Wait for the agent on `tabId` to be ready, then paste `content` into its
 * input buffer using bracketed-paste mode. Never appends `\r`, so the draft
 * stays editable for the user to review/append before sending.
 *
 * Returns true when the paste was issued, false on timeout or missing PTY.
 * `onTimeout` lets the caller surface a UI hint (e.g. toast) when the agent
 * doesn't reach a ready state inside `timeoutMs`.
 */
export async function pasteDraftWhenAgentReady(args: {
  tabId: string
  expectedProcess: string
  content: string
  timeoutMs?: number
  onTimeout?: () => void
}): Promise<boolean> {
  const { tabId, expectedProcess, content, timeoutMs = 15000, onTimeout } = args
  const readyResult = await waitForAgentReady(tabId, expectedProcess, { timeoutMs })
  if (!readyResult.ready) {
    onTimeout?.()
    return false
  }

  const ptyId = useAppStore.getState().ptyIdsByTabId[tabId]?.[0]
  if (!ptyId) {
    return false
  }

  // Why: TUIs must enable bracketed paste mode (\x1b[?2004h) before they can
  // interpret our paste markers. `title-idle` means the TUI has fully rendered
  // its input box and enabled paste mode; weaker signals (`foreground-match`,
  // `child-process`) only confirm the binary is running — the TUI's input
  // setup may still be in-flight, especially on slow shell environments.
  const graceMs = readyResult.reason === 'title-idle' ? 150 : 600
  await new Promise((resolve) => window.setTimeout(resolve, graceMs))

  window.api.pty.write(ptyId, `${BRACKETED_PASTE_BEGIN}${content}${BRACKETED_PASTE_END}`)
  return true
}
