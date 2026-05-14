import {
  isTerminalReservedInput,
  keybindingMatchesAction,
  type KeybindingContext,
  type KeybindingOverrides
} from './keybindings'

export type WindowShortcutInput = {
  type?: string
  key?: string
  code?: string
  alt?: boolean
  meta?: boolean
  control?: boolean
  shift?: boolean
}

export type WindowShortcutAction =
  | { type: 'zoom'; direction: 'in' | 'out' | 'reset' }
  | { type: 'toggleWorktreePalette' }
  | { type: 'toggleFloatingTerminal' }
  | { type: 'toggleLeftSidebar' }
  | { type: 'toggleRightSidebar' }
  | { type: 'openQuickOpen' }
  | { type: 'openNewWorkspace' }
  | { type: 'openTasks' }
  | { type: 'switchRecentTab' }
  | { type: 'jumpToWorktreeIndex'; index: number }
  | { type: 'worktreeHistoryNavigate'; direction: 'back' | 'forward' }
  | { type: 'dictationKeyDown' }

function platformPrimaryModifier(
  input: Pick<WindowShortcutInput, 'meta' | 'control'>,
  platform: NodeJS.Platform
): boolean {
  return platform === 'darwin' ? Boolean(input.meta) : Boolean(input.control)
}

export function isWindowShortcutModifierChord(
  input: Pick<WindowShortcutInput, 'meta' | 'control' | 'alt'>,
  platform: NodeJS.Platform
): boolean {
  return platformPrimaryModifier(input, platform) && !input.alt
}

export function resolveWindowShortcutAction(
  input: WindowShortcutInput,
  platform: NodeJS.Platform,
  keybindings?: KeybindingOverrides,
  context: KeybindingContext = 'app'
): WindowShortcutAction | null {
  if (keybindingMatchesAction('worktree.history.back', input, platform, keybindings, { context })) {
    return {
      type: 'worktreeHistoryNavigate',
      direction: 'back'
    }
  }

  if (
    keybindingMatchesAction('worktree.history.forward', input, platform, keybindings, { context })
  ) {
    return {
      type: 'worktreeHistoryNavigate',
      direction: 'forward'
    }
  }

  if (
    keybindingMatchesAction('floatingTerminal.toggle', input, platform, keybindings, { context })
  ) {
    return { type: 'toggleFloatingTerminal' }
  }

  if (keybindingMatchesAction('zoom.in', input, platform, keybindings, { context })) {
    return { type: 'zoom', direction: 'in' }
  }

  if (keybindingMatchesAction('zoom.out', input, platform, keybindings, { context })) {
    return { type: 'zoom', direction: 'out' }
  }

  if (keybindingMatchesAction('zoom.reset', input, platform, keybindings, { context })) {
    return { type: 'zoom', direction: 'reset' }
  }

  if (keybindingMatchesAction('worktree.palette', input, platform, keybindings, { context })) {
    return { type: 'toggleWorktreePalette' }
  }

  // Why: sidebar toggles must still work from webviews and editable surfaces,
  // but terminal-reserved Ctrl chords are blocked by keybindingMatchesAction()
  // when xterm owns focus so readline never receives a duplicated control byte.
  if (keybindingMatchesAction('sidebar.left.toggle', input, platform, keybindings, { context })) {
    return { type: 'toggleLeftSidebar' }
  }

  if (keybindingMatchesAction('sidebar.right.toggle', input, platform, keybindings, { context })) {
    return { type: 'toggleRightSidebar' }
  }

  if (keybindingMatchesAction('worktree.quickOpen', input, platform, keybindings, { context })) {
    return { type: 'openQuickOpen' }
  }

  // Why: Cmd/Ctrl+N opens the new-workspace composer. Routed through the
  // main process so it reaches the renderer even when focus lives inside
  // a contentEditable surface (markdown rich editor) or a browser guest
  // webContents, both of which bypass the renderer's window-level keydown.
  // Shift is accepted for compatibility with the former Create-from shortcut;
  // the unified composer now exposes source switching inside the name field.
  if (keybindingMatchesAction('workspace.create', input, platform, keybindings, { context })) {
    return { type: 'openNewWorkspace' }
  }

  // Why: dictation must be globally reachable from editable surfaces and
  // browser guests, but it also has to be user-editable and terminal-filtered
  // so Ctrl+E remains readline end-of-line while xterm owns focus.
  if (keybindingMatchesAction('voice.dictation', input, platform, keybindings, { context })) {
    return { type: 'dictationKeyDown' }
  }

  if (keybindingMatchesAction('view.tasks', input, platform, keybindings, { context })) {
    return { type: 'openTasks' }
  }

  if (keybindingMatchesAction('tab.previousRecent', input, platform, keybindings, { context })) {
    return { type: 'switchRecentTab' }
  }

  if (
    context !== 'terminal' &&
    platformPrimaryModifier(input, platform) &&
    !input.alt &&
    !input.shift &&
    input.key &&
    input.key >= '1' &&
    input.key <= '9'
  ) {
    return { type: 'jumpToWorktreeIndex', index: parseInt(input.key, 10) - 1 }
  }

  if (
    context === 'terminal' &&
    !isTerminalReservedInput(input, platform) &&
    platformPrimaryModifier(input, platform) &&
    !input.alt &&
    !input.shift &&
    input.key &&
    input.key >= '1' &&
    input.key <= '9'
  ) {
    return { type: 'jumpToWorktreeIndex', index: parseInt(input.key, 10) - 1 }
  }

  // Why: this helper is the explicit allowlist for main-process interception.
  // Anything not listed here must keep flowing to the renderer/PTTY so readline
  // chords like Ctrl+R, Ctrl+U, and Ctrl+E are not accidentally stolen while
  // terminals own focus.
  return null
}
