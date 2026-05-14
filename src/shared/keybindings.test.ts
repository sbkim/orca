import { describe, expect, it } from 'vitest'
import {
  actionShouldWarnForTerminalReservation,
  bindingIsTerminalReserved,
  findKeybindingConflicts,
  formatKeybindingList,
  getEffectiveKeybindingsForAction,
  keybindingMatchesAction,
  normalizeKeybinding,
  normalizeKeybindingList
} from './keybindings'

describe('keybindings', () => {
  it('normalizes editable shortcut input and rejects unsafe bindings', () => {
    expect(normalizeKeybinding(' ctrl + shift + p ')).toEqual({
      ok: true,
      value: 'Ctrl+Shift+P'
    })
    expect(normalizeKeybinding('shift+insert')).toEqual({ ok: true, value: 'Shift+Insert' })
    expect(normalizeKeybinding('cmdorctrl+p')).toEqual({ ok: true, value: 'Mod+P' })
    expect(normalizeKeybindingList('Ctrl+Shift+P, ctrl+shift+p, ⌘+k')).toEqual([
      'Ctrl+Shift+P',
      'Cmd+K'
    ])

    expect(normalizeKeybinding('Shift+P')).toMatchObject({ ok: false })
    expect(normalizeKeybinding('Mod+Ctrl+P')).toMatchObject({ ok: false })
    expect(normalizeKeybinding('Ctrl+Nope')).toMatchObject({ ok: false })
  })

  it('formats keybindings with platform labels', () => {
    expect(formatKeybindingList(['Mod+Shift+J'], 'darwin')).toBe('⌘⇧J')
    expect(formatKeybindingList(['Mod+Shift+J'], 'linux')).toBe('Ctrl+Shift+J')
    expect(formatKeybindingList([], 'win32')).toBe('Unassigned')
  })

  it('uses overrides as the complete effective binding list for an action', () => {
    const overrides = {
      'worktree.quickOpen': ['Ctrl+Alt+O', 'not-a-shortcut']
    }

    expect(getEffectiveKeybindingsForAction('worktree.quickOpen', 'linux', overrides)).toEqual([
      'Ctrl+Alt+O'
    ])
    expect(
      keybindingMatchesAction(
        'worktree.quickOpen',
        { key: 'o', code: 'KeyO', control: true, meta: false, alt: true, shift: false },
        'linux',
        overrides
      )
    ).toBe(true)
    expect(
      keybindingMatchesAction(
        'worktree.quickOpen',
        { key: 'p', code: 'KeyP', control: true, meta: false, alt: false, shift: false },
        'linux',
        overrides
      )
    ).toBe(false)
  })

  it('reports conflicts across default and customized actions', () => {
    const conflicts = findKeybindingConflicts('linux', { 'view.tasks': ['Mod+P'] })

    expect(conflicts).toContainEqual({
      binding: 'Mod+P',
      actionIds: expect.arrayContaining(['worktree.quickOpen', 'view.tasks'])
    })
  })

  it('keeps app shortcuts out of terminal-reserved chords unless explicitly terminal-safe', () => {
    const ctrlP = {
      key: 'p',
      code: 'KeyP',
      control: true,
      meta: false,
      alt: false,
      shift: false
    }

    expect(keybindingMatchesAction('worktree.quickOpen', ctrlP, 'linux')).toBe(true)
    expect(
      keybindingMatchesAction('worktree.quickOpen', ctrlP, 'linux', undefined, {
        context: 'terminal'
      })
    ).toBe(false)
    expect(
      keybindingMatchesAction(
        'terminal.search',
        { key: 'f', code: 'KeyF', control: true, meta: false, alt: false, shift: true },
        'linux',
        undefined,
        { context: 'terminal' }
      )
    ).toBe(true)
    expect(
      keybindingMatchesAction(
        'floatingTerminal.toggle',
        { key: 't', code: 'KeyT', control: true, meta: false, alt: true, shift: false },
        'linux',
        undefined,
        { context: 'terminal' }
      )
    ).toBe(true)
  })

  it('warns when non-terminal actions are assigned terminal-reserved chords', () => {
    expect(bindingIsTerminalReserved('Mod+P', 'linux')).toBe(true)
    expect(bindingIsTerminalReserved('Mod+P', 'darwin')).toBe(false)
    expect(actionShouldWarnForTerminalReservation('worktree.quickOpen', 'Mod+P', 'linux')).toBe(
      true
    )
    expect(actionShouldWarnForTerminalReservation('terminal.search', 'Ctrl+Shift+F', 'linux')).toBe(
      false
    )
    expect(
      actionShouldWarnForTerminalReservation('floatingTerminal.toggle', 'Mod+Alt+T', 'linux')
    ).toBe(false)
    expect(actionShouldWarnForTerminalReservation('voice.dictation', 'Mod+E', 'linux')).toBe(true)
    expect(actionShouldWarnForTerminalReservation('tab.previousRecent', 'Ctrl+Tab', 'linux')).toBe(
      false
    )
  })

  it('uses terminal-safe paste defaults on Windows and Linux', () => {
    expect(getEffectiveKeybindingsForAction('terminal.paste', 'darwin')).toEqual(['Mod+V'])
    expect(getEffectiveKeybindingsForAction('terminal.paste', 'linux')).toEqual([
      'Ctrl+Shift+V',
      'Shift+Insert'
    ])
    expect(
      keybindingMatchesAction(
        'terminal.paste',
        { key: 'v', code: 'KeyV', control: true, meta: false, alt: false, shift: false },
        'linux'
      )
    ).toBe(false)
    expect(
      keybindingMatchesAction(
        'terminal.paste',
        { key: 'Insert', code: 'Insert', control: false, meta: false, alt: false, shift: true },
        'linux'
      )
    ).toBe(true)
  })
})
