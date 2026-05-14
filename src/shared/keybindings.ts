/* eslint-disable max-lines -- Why: the central shortcut registry, parser,
 * formatter, conflict detector, and terminal-reservation policy must stay in
 * one shared module so main, renderer, browser guests, and Settings cannot
 * drift apart. */
export type KeybindingScope = 'global' | 'tabs' | 'terminal' | 'browser' | 'editor'

export type KeybindingContext = 'app' | 'terminal' | 'browser'

export type KeybindingPlatform = 'darwin' | 'linux' | 'win32'

export type KeybindingActionId =
  | 'worktree.quickOpen'
  | 'worktree.palette'
  | 'workspace.create'
  | 'voice.dictation'
  | 'view.tasks'
  | 'sidebar.left.toggle'
  | 'sidebar.right.toggle'
  | 'floatingTerminal.toggle'
  | 'zoom.in'
  | 'zoom.out'
  | 'zoom.reset'
  | 'worktree.history.back'
  | 'worktree.history.forward'
  | 'tab.newTerminal'
  | 'tab.newBrowser'
  | 'tab.newMarkdown'
  | 'tab.close'
  | 'tab.reopenClosed'
  | 'tab.nextSameType'
  | 'tab.previousSameType'
  | 'tab.nextAllTypes'
  | 'tab.previousAllTypes'
  | 'tab.previousRecent'
  | 'tab.nextTerminal'
  | 'tab.previousTerminal'
  | 'terminal.copySelection'
  | 'terminal.paste'
  | 'terminal.search'
  | 'terminal.clear'
  | 'terminal.focusNextPane'
  | 'terminal.focusPreviousPane'
  | 'terminal.expandPane'
  | 'terminal.closePane'
  | 'terminal.splitRight'
  | 'terminal.splitDown'

export type KeybindingOverrides = Partial<Record<KeybindingActionId, string[]>>

export type KeybindingFileDiagnostic = {
  severity: 'warning' | 'error'
  message: string
  actionId?: string
  section?: string
}

export type KeybindingFileSnapshot = {
  path: string
  platform: KeybindingPlatform
  exists: boolean
  overrides: KeybindingOverrides
  commonOverrides: KeybindingOverrides
  platformOverrides: Partial<Record<KeybindingPlatform, KeybindingOverrides>>
  diagnostics: KeybindingFileDiagnostic[]
}

type PlatformBindings = {
  darwin: readonly string[]
  linux: readonly string[]
  win32: readonly string[]
}

export type KeybindingDefinition = {
  id: KeybindingActionId
  title: string
  group: string
  scope: KeybindingScope
  searchKeywords: readonly string[]
  defaultBindings: PlatformBindings
  allowInTerminal?: boolean
}

export type KeybindingInput = {
  key?: string
  code?: string
  alt?: boolean
  meta?: boolean
  control?: boolean
  shift?: boolean
  altKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
}

type ParsedKeybinding = {
  mod: boolean
  meta: boolean
  control: boolean
  alt: boolean
  shift: boolean
  key: string
}

export type KeybindingValidationResult = { ok: true; value: string } | { ok: false; error: string }

export type KeybindingConflict = {
  binding: string
  actionIds: KeybindingActionId[]
}

export const KEYBINDING_DEFINITIONS: readonly KeybindingDefinition[] = [
  {
    id: 'worktree.quickOpen',
    title: 'Go to File',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'global', 'file', 'quick open'],
    defaultBindings: platformBindings(['Mod+P'])
  },
  {
    id: 'worktree.palette',
    title: 'Switch worktree',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'global', 'worktree', 'switch', 'jump'],
    defaultBindings: {
      darwin: ['Mod+J'],
      linux: ['Mod+Shift+J'],
      win32: ['Mod+Shift+J']
    }
  },
  {
    id: 'workspace.create',
    title: 'Create worktree',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'global', 'worktree', 'create', 'new workspace'],
    defaultBindings: platformBindings(['Mod+N', 'Mod+Shift+N'])
  },
  {
    id: 'voice.dictation',
    title: 'Dictation',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'dictation', 'voice', 'speech', 'microphone'],
    defaultBindings: platformBindings(['Mod+E'])
  },
  {
    id: 'view.tasks',
    title: 'Open Tasks',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'tasks', 'github issues', 'linear'],
    defaultBindings: platformBindings([])
  },
  {
    id: 'sidebar.left.toggle',
    title: 'Toggle Sidebar',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'sidebar', 'left'],
    defaultBindings: platformBindings(['Mod+B'])
  },
  {
    id: 'sidebar.right.toggle',
    title: 'Toggle Right Sidebar',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'sidebar', 'right'],
    defaultBindings: platformBindings(['Mod+L'])
  },
  {
    id: 'floatingTerminal.toggle',
    title: 'Toggle Floating Terminal',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'floating terminal', 'terminal'],
    defaultBindings: platformBindings(['Mod+Alt+T']),
    allowInTerminal: true
  },
  {
    id: 'zoom.in',
    title: 'Zoom In',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'zoom', 'in', 'scale'],
    defaultBindings: platformBindings(['Mod+Equal', 'Mod+Shift+Plus', 'Mod+NumpadAdd'])
  },
  {
    id: 'zoom.out',
    title: 'Zoom Out',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'zoom', 'out', 'scale'],
    defaultBindings: platformBindings(['Mod+Minus', 'Mod+NumpadSubtract'])
  },
  {
    id: 'zoom.reset',
    title: 'Reset Size',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'zoom', 'reset', 'size', 'actual'],
    defaultBindings: platformBindings(['Mod+0'])
  },
  {
    id: 'worktree.history.back',
    title: 'Worktree History Back',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'worktree', 'history', 'back'],
    defaultBindings: platformBindings(['Mod+Alt+ArrowLeft']),
    allowInTerminal: true
  },
  {
    id: 'worktree.history.forward',
    title: 'Worktree History Forward',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'worktree', 'history', 'forward'],
    defaultBindings: platformBindings(['Mod+Alt+ArrowRight']),
    allowInTerminal: true
  },
  {
    id: 'tab.newTerminal',
    title: 'New terminal tab',
    group: 'Tabs',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'tab', 'terminal', 'new'],
    defaultBindings: platformBindings(['Mod+T'])
  },
  {
    id: 'tab.newBrowser',
    title: 'New browser tab',
    group: 'Tabs',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'tab', 'browser', 'new'],
    defaultBindings: platformBindings(['Mod+Shift+B'])
  },
  {
    id: 'tab.newMarkdown',
    title: 'New markdown tab',
    group: 'Tabs',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'tab', 'markdown', 'file', 'new'],
    defaultBindings: platformBindings(['Mod+Shift+M'])
  },
  {
    id: 'tab.close',
    title: 'Close active tab',
    group: 'Tabs',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'close', 'tab', 'pane'],
    defaultBindings: platformBindings(['Mod+W'])
  },
  {
    id: 'tab.reopenClosed',
    title: 'Reopen closed tab',
    group: 'Tabs',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'tab', 'reopen', 'restore', 'closed'],
    defaultBindings: platformBindings(['Mod+Shift+T'])
  },
  {
    id: 'tab.nextSameType',
    title: 'Next tab (same type)',
    group: 'Tab Navigation',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'tab', 'next', 'switch', 'cycle'],
    defaultBindings: platformBindings(['Mod+Shift+BracketRight'])
  },
  {
    id: 'tab.previousSameType',
    title: 'Previous tab (same type)',
    group: 'Tab Navigation',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'tab', 'previous', 'switch', 'cycle'],
    defaultBindings: platformBindings(['Mod+Shift+BracketLeft'])
  },
  {
    id: 'tab.nextAllTypes',
    title: 'Next tab (all types)',
    group: 'Tab Navigation',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'tab', 'next', 'switch', 'cycle', 'all', 'any'],
    defaultBindings: platformBindings(['Mod+Alt+BracketRight'])
  },
  {
    id: 'tab.previousAllTypes',
    title: 'Previous tab (all types)',
    group: 'Tab Navigation',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'tab', 'previous', 'switch', 'cycle', 'all', 'any'],
    defaultBindings: platformBindings(['Mod+Alt+BracketLeft'])
  },
  {
    id: 'tab.previousRecent',
    title: 'Previous recent tab',
    group: 'Tab Navigation',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'tab', 'recent', 'mru', 'switch', 'last used'],
    defaultBindings: platformBindings(['Ctrl+Tab']),
    allowInTerminal: true
  },
  {
    id: 'tab.nextTerminal',
    title: 'Next terminal tab',
    group: 'Tab Navigation',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'tab', 'terminal', 'next', 'switch'],
    defaultBindings: platformBindings(['Ctrl+PageDown']),
    allowInTerminal: true
  },
  {
    id: 'tab.previousTerminal',
    title: 'Previous terminal tab',
    group: 'Tab Navigation',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'tab', 'terminal', 'previous', 'switch'],
    defaultBindings: platformBindings(['Ctrl+PageUp']),
    allowInTerminal: true
  },
  {
    id: 'terminal.copySelection',
    title: 'Copy terminal selection',
    group: 'Terminal Panes',
    scope: 'terminal',
    searchKeywords: ['shortcut', 'terminal', 'copy', 'selection'],
    defaultBindings: platformBindings(['Mod+Shift+C'])
  },
  {
    id: 'terminal.paste',
    title: 'Paste into terminal',
    group: 'Terminal Panes',
    scope: 'terminal',
    searchKeywords: ['shortcut', 'terminal', 'paste', 'clipboard'],
    defaultBindings: {
      darwin: ['Mod+V'],
      linux: ['Ctrl+Shift+V', 'Shift+Insert'],
      win32: ['Ctrl+Shift+V', 'Shift+Insert']
    }
  },
  {
    id: 'terminal.search',
    title: 'Search active pane',
    group: 'Terminal Panes',
    scope: 'terminal',
    searchKeywords: ['shortcut', 'terminal', 'search', 'find'],
    defaultBindings: {
      darwin: ['Mod+F'],
      linux: ['Ctrl+Shift+F'],
      win32: ['Ctrl+Shift+F']
    }
  },
  {
    id: 'terminal.clear',
    title: 'Clear active pane',
    group: 'Terminal Panes',
    scope: 'terminal',
    searchKeywords: ['shortcut', 'pane', 'clear'],
    defaultBindings: {
      darwin: ['Mod+K'],
      linux: ['Ctrl+Shift+K'],
      win32: ['Ctrl+Shift+K']
    }
  },
  {
    id: 'terminal.focusNextPane',
    title: 'Focus next pane',
    group: 'Terminal Panes',
    scope: 'terminal',
    searchKeywords: ['shortcut', 'pane', 'focus', 'next'],
    defaultBindings: {
      darwin: ['Mod+BracketRight'],
      linux: [],
      win32: []
    }
  },
  {
    id: 'terminal.focusPreviousPane',
    title: 'Focus previous pane',
    group: 'Terminal Panes',
    scope: 'terminal',
    searchKeywords: ['shortcut', 'pane', 'focus', 'previous'],
    defaultBindings: {
      darwin: ['Mod+BracketLeft'],
      linux: [],
      win32: []
    }
  },
  {
    id: 'terminal.expandPane',
    title: 'Expand / collapse pane',
    group: 'Terminal Panes',
    scope: 'terminal',
    searchKeywords: ['shortcut', 'pane', 'expand', 'collapse'],
    defaultBindings: {
      darwin: ['Mod+Shift+Enter'],
      linux: ['Ctrl+Shift+Enter'],
      win32: ['Ctrl+Shift+Enter']
    }
  },
  {
    id: 'terminal.closePane',
    title: 'Close active pane',
    group: 'Terminal Panes',
    scope: 'terminal',
    searchKeywords: ['shortcut', 'pane', 'close'],
    defaultBindings: {
      darwin: ['Mod+W'],
      linux: ['Ctrl+Shift+W'],
      win32: ['Ctrl+Shift+W']
    }
  },
  {
    id: 'terminal.splitRight',
    title: 'Split terminal right',
    group: 'Terminal Panes',
    scope: 'terminal',
    searchKeywords: ['shortcut', 'pane', 'split', 'right'],
    defaultBindings: {
      darwin: ['Mod+D'],
      linux: ['Ctrl+Shift+D'],
      win32: ['Ctrl+Shift+D']
    }
  },
  {
    id: 'terminal.splitDown',
    title: 'Split terminal down',
    group: 'Terminal Panes',
    scope: 'terminal',
    searchKeywords: ['shortcut', 'pane', 'split', 'down'],
    defaultBindings: {
      darwin: ['Mod+Shift+D'],
      linux: ['Alt+Shift+D'],
      win32: ['Alt+Shift+D']
    }
  }
]

const DEFINITIONS_BY_ID = new Map<KeybindingActionId, KeybindingDefinition>(
  KEYBINDING_DEFINITIONS.map((definition) => [definition.id, definition])
)

const DEFINITION_IDS = new Set<KeybindingActionId>(
  KEYBINDING_DEFINITIONS.map((definition) => definition.id)
)

function platformBindings(bindings: readonly string[]): PlatformBindings {
  return {
    darwin: bindings,
    linux: bindings,
    win32: bindings
  }
}

export function getKeybindingPlatform(platform: NodeJS.Platform): KeybindingPlatform {
  return platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'win32' : 'linux'
}

export function isKeybindingActionId(value: string): value is KeybindingActionId {
  return DEFINITION_IDS.has(value as KeybindingActionId)
}

function hasModifier(
  input: KeybindingInput,
  modifier: 'alt' | 'meta' | 'control' | 'shift'
): boolean {
  if (modifier === 'alt') {
    return Boolean(input.alt ?? input.altKey)
  }
  if (modifier === 'meta') {
    return Boolean(input.meta ?? input.metaKey)
  }
  if (modifier === 'control') {
    return Boolean(input.control ?? input.ctrlKey)
  }
  return Boolean(input.shift ?? input.shiftKey)
}

function normalizeKeyToken(token: string): string | null {
  const trimmed = token.trim()
  if (!trimmed) {
    return null
  }
  const upper = trimmed.toUpperCase()
  if (upper.length === 1 && upper >= 'A' && upper <= 'Z') {
    return upper
  }
  if (upper.length === 1 && upper >= '0' && upper <= '9') {
    return upper
  }

  const simple: Record<string, string> = {
    '[': 'BracketLeft',
    ']': 'BracketRight',
    '{': 'BracketLeft',
    '}': 'BracketRight',
    '-': 'Minus',
    _: 'Underscore',
    '=': 'Equal',
    '+': 'Plus',
    ',': 'Comma',
    '.': 'Period',
    '/': 'Slash',
    '\\': 'Backslash',
    ';': 'Semicolon',
    "'": 'Quote',
    '`': 'Backquote',
    RETURN: 'Enter',
    ESC: 'Escape',
    SPACEBAR: 'Space',
    PGUP: 'PageUp',
    PGDN: 'PageDown',
    PLUS: 'Plus',
    MINUS: 'Minus',
    EQUAL: 'Equal',
    UNDERSCORE: 'Underscore',
    ARROWLEFT: 'ArrowLeft',
    LEFT: 'ArrowLeft',
    ARROWRIGHT: 'ArrowRight',
    RIGHT: 'ArrowRight',
    ARROWUP: 'ArrowUp',
    UP: 'ArrowUp',
    ARROWDOWN: 'ArrowDown',
    DOWN: 'ArrowDown',
    PAGEUP: 'PageUp',
    PAGEDOWN: 'PageDown',
    BACKSPACE: 'Backspace',
    DELETE: 'Delete',
    DEL: 'Delete',
    INSERT: 'Insert',
    INS: 'Insert',
    ENTER: 'Enter',
    TAB: 'Tab',
    ESCAPE: 'Escape',
    SPACE: 'Space',
    BRACKETLEFT: 'BracketLeft',
    BRACKETRIGHT: 'BracketRight',
    NUMPADADD: 'NumpadAdd',
    NUMPADSUBTRACT: 'NumpadSubtract'
  }

  return simple[upper] ?? null
}

function parseKeybinding(binding: string): ParsedKeybinding | null {
  const rawParts = binding
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  if (rawParts.length === 0) {
    return null
  }

  const parsed: ParsedKeybinding = {
    mod: false,
    meta: false,
    control: false,
    alt: false,
    shift: false,
    key: ''
  }

  for (const rawPart of rawParts) {
    const part = rawPart.toLowerCase()
    if (part === 'mod' || part === 'cmdorctrl' || part === 'commandorcontrol') {
      parsed.mod = true
      continue
    }
    if (part === 'cmd' || part === 'command' || part === 'meta' || rawPart === '⌘') {
      parsed.meta = true
      continue
    }
    if (part === 'ctrl' || part === 'control' || rawPart === '⌃') {
      parsed.control = true
      continue
    }
    if (part === 'alt' || part === 'option' || part === 'opt' || rawPart === '⌥') {
      parsed.alt = true
      continue
    }
    if (part === 'shift' || rawPart === '⇧') {
      parsed.shift = true
      continue
    }
    if (parsed.key) {
      return null
    }
    const key = normalizeKeyToken(rawPart)
    if (!key) {
      return null
    }
    parsed.key = key
  }

  return parsed.key ? parsed : null
}

function canonicalizeParsedKeybinding(parsed: ParsedKeybinding): string {
  const parts: string[] = []
  if (parsed.mod) {
    parts.push('Mod')
  }
  if (parsed.meta) {
    parts.push('Cmd')
  }
  if (parsed.control) {
    parts.push('Ctrl')
  }
  if (parsed.alt) {
    parts.push('Alt')
  }
  if (parsed.shift) {
    parts.push('Shift')
  }
  parts.push(parsed.key)
  return parts.join('+')
}

export function normalizeKeybinding(binding: string): KeybindingValidationResult {
  const parsed = parseKeybinding(binding)
  if (!parsed) {
    return { ok: false, error: 'Use a shortcut like Ctrl+Shift+P or Cmd+K.' }
  }
  if (parsed.mod && (parsed.meta || parsed.control)) {
    return { ok: false, error: 'Use either Mod or a platform-specific modifier, not both.' }
  }
  const isShiftInsert = parsed.shift && parsed.key === 'Insert'
  if (!parsed.mod && !parsed.meta && !parsed.control && !parsed.alt && !isShiftInsert) {
    return { ok: false, error: 'Include at least one modifier key.' }
  }
  return { ok: true, value: canonicalizeParsedKeybinding(parsed) }
}

export function normalizeKeybindingList(input: string): KeybindingValidationResult | string[] {
  const trimmed = input.trim()
  if (!trimmed) {
    return []
  }
  const normalized: string[] = []
  for (const piece of trimmed.split(',')) {
    const result = normalizeKeybinding(piece)
    if (!result.ok) {
      return result
    }
    if (!normalized.includes(result.value)) {
      normalized.push(result.value)
    }
  }
  return normalized
}

export function normalizeKeybindingArray(
  input: readonly string[]
): KeybindingValidationResult | string[] {
  const normalized: string[] = []
  for (const binding of input) {
    const piece = normalizeKeybindingList(binding)
    if (!Array.isArray(piece)) {
      return piece
    }
    for (const normalizedBinding of piece) {
      if (!normalized.includes(normalizedBinding)) {
        normalized.push(normalizedBinding)
      }
    }
  }
  return normalized
}

function getDefaultBindings(definition: KeybindingDefinition, platform: NodeJS.Platform): string[] {
  return definition.defaultBindings[getKeybindingPlatform(platform)].map((binding) => {
    const normalized = normalizeKeybinding(binding)
    return normalized.ok ? normalized.value : binding
  })
}

export function getEffectiveKeybindingsForAction(
  actionId: KeybindingActionId,
  platform: NodeJS.Platform,
  overrides?: KeybindingOverrides
): string[] {
  const definition = DEFINITIONS_BY_ID.get(actionId)
  if (!definition) {
    return []
  }
  const override = overrides?.[actionId]
  if (Array.isArray(override)) {
    return override.flatMap((binding) => {
      const normalized = normalizeKeybinding(binding)
      return normalized.ok ? [normalized.value] : []
    })
  }
  return getDefaultBindings(definition, platform)
}

export function getKeybindingDefinition(actionId: KeybindingActionId): KeybindingDefinition | null {
  return DEFINITIONS_BY_ID.get(actionId) ?? null
}

function platformModifiers(
  parsed: ParsedKeybinding,
  platform: NodeJS.Platform
): { meta: boolean; control: boolean; alt: boolean; shift: boolean } {
  const isMac = platform === 'darwin'
  return {
    meta: parsed.meta || (parsed.mod && isMac),
    control: parsed.control || (parsed.mod && !isMac),
    alt: parsed.alt,
    shift: parsed.shift
  }
}

function modifierStateMatches(
  parsed: ParsedKeybinding,
  input: KeybindingInput,
  platform: NodeJS.Platform
): boolean {
  const expected = platformModifiers(parsed, platform)
  return (
    hasModifier(input, 'meta') === expected.meta &&
    hasModifier(input, 'control') === expected.control &&
    hasModifier(input, 'alt') === expected.alt &&
    hasModifier(input, 'shift') === expected.shift
  )
}

function letterKeyMatches(input: KeybindingInput, letter: string): boolean {
  const key = (input.key ?? '').toLowerCase()
  if (key.length === 1 && key >= 'a' && key <= 'z') {
    return key === letter.toLowerCase()
  }
  return input.code === `Key${letter.toUpperCase()}`
}

function keyMatches(parsedKey: string, input: KeybindingInput): boolean {
  if (parsedKey.length === 1 && parsedKey >= 'A' && parsedKey <= 'Z') {
    return letterKeyMatches(input, parsedKey)
  }
  if (parsedKey.length === 1 && parsedKey >= '0' && parsedKey <= '9') {
    return input.key === parsedKey || input.code === `Digit${parsedKey}`
  }

  const key = input.key ?? ''
  const code = input.code ?? ''
  switch (parsedKey) {
    case 'BracketLeft':
      return code === 'BracketLeft'
    case 'BracketRight':
      return code === 'BracketRight'
    case 'Minus':
      return key === '-' || key === 'Minus' || code === 'Minus'
    case 'Underscore':
      return key === '_' || key === 'Underscore'
    case 'Equal':
      return key === '=' || key === 'Equal' || code === 'Equal'
    case 'Plus':
      return key === '+' || key === 'Plus'
    case 'NumpadAdd':
      return code === 'NumpadAdd' || key === 'Add'
    case 'NumpadSubtract':
      return code === 'NumpadSubtract' || key === 'Subtract'
    case 'Enter':
      return key === 'Enter' && (code === 'Enter' || code === 'NumpadEnter' || code === '')
    default:
      return key === parsedKey || code === parsedKey
  }
}

export function keybindingMatchesInput(
  binding: string,
  input: KeybindingInput,
  platform: NodeJS.Platform
): boolean {
  const parsed = parseKeybinding(binding)
  if (!parsed) {
    return false
  }
  return modifierStateMatches(parsed, input, platform) && keyMatches(parsed.key, input)
}

export function isTerminalReservedInput(
  input: KeybindingInput,
  platform: NodeJS.Platform
): boolean {
  const control = hasModifier(input, 'control')
  const meta = hasModifier(input, 'meta')
  const alt = hasModifier(input, 'alt')
  if (control && !meta) {
    return true
  }
  if (!meta && alt) {
    return true
  }
  return platform === 'darwin' ? control && !meta : control
}

export function keybindingMatchesAction(
  actionId: KeybindingActionId,
  input: KeybindingInput,
  platform: NodeJS.Platform,
  overrides?: KeybindingOverrides,
  options: { context?: KeybindingContext } = {}
): boolean {
  const definition = DEFINITIONS_BY_ID.get(actionId)
  if (!definition) {
    return false
  }
  if (
    options.context === 'terminal' &&
    definition.scope !== 'terminal' &&
    definition.allowInTerminal !== true &&
    isTerminalReservedInput(input, platform)
  ) {
    return false
  }
  return getEffectiveKeybindingsForAction(actionId, platform, overrides).some((binding) =>
    keybindingMatchesInput(binding, input, platform)
  )
}

export function formatKeybinding(binding: string, platform: NodeJS.Platform): string[] {
  const parsed = parseKeybinding(binding)
  if (!parsed) {
    return [binding]
  }
  const isMac = platform === 'darwin'
  const parts: string[] = []
  if (parsed.mod) {
    parts.push(isMac ? '⌘' : 'Ctrl')
  }
  if (parsed.meta) {
    parts.push(isMac ? '⌘' : 'Cmd')
  }
  if (parsed.control) {
    parts.push(isMac ? '⌃' : 'Ctrl')
  }
  if (parsed.alt) {
    parts.push(isMac ? '⌥' : 'Alt')
  }
  if (parsed.shift) {
    parts.push(isMac ? '⇧' : 'Shift')
  }
  parts.push(formatKeyToken(parsed.key))
  return parts
}

export function formatKeybindingList(
  bindings: readonly string[],
  platform: NodeJS.Platform
): string {
  if (bindings.length === 0) {
    return 'Unassigned'
  }
  return bindings
    .map((binding) => formatKeybinding(binding, platform).join(platform === 'darwin' ? '' : '+'))
    .join(', ')
}

function formatKeyToken(token: string): string {
  const labels: Record<string, string> = {
    BracketLeft: '[',
    BracketRight: ']',
    Minus: '-',
    Underscore: '_',
    Equal: '=',
    Plus: '+',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    NumpadAdd: 'Numpad +',
    NumpadSubtract: 'Numpad -',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Tab: 'Tab',
    Escape: 'Esc',
    Space: 'Space'
  }
  return labels[token] ?? token
}

export function findKeybindingConflicts(
  platform: NodeJS.Platform,
  overrides?: KeybindingOverrides
): KeybindingConflict[] {
  const owners = new Map<string, KeybindingActionId[]>()
  for (const definition of KEYBINDING_DEFINITIONS) {
    for (const binding of getEffectiveKeybindingsForAction(definition.id, platform, overrides)) {
      const current = owners.get(binding) ?? []
      current.push(definition.id)
      owners.set(binding, current)
    }
  }

  return Array.from(owners.entries())
    .filter(([, actionIds]) => actionIds.length > 1)
    .map(([binding, actionIds]) => ({ binding, actionIds }))
}

export function bindingIsTerminalReserved(binding: string, platform: NodeJS.Platform): boolean {
  const parsed = parseKeybinding(binding)
  if (!parsed) {
    return false
  }
  const modifiers = platformModifiers(parsed, platform)
  if (modifiers.control && !modifiers.meta) {
    return true
  }
  return modifiers.alt && !modifiers.meta
}

export function actionShouldWarnForTerminalReservation(
  actionId: KeybindingActionId,
  binding: string,
  platform: NodeJS.Platform
): boolean {
  const definition = DEFINITIONS_BY_ID.get(actionId)
  if (!definition || definition.scope === 'terminal' || definition.allowInTerminal) {
    return false
  }
  return bindingIsTerminalReserved(binding, platform)
}

export function getDefaultKeybindingOverrides(): KeybindingOverrides {
  return {}
}
