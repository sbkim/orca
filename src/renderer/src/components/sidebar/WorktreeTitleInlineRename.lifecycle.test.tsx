// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorktreeTitleInlineRename } from './WorktreeTitleInlineRename'

describe('WorktreeTitleInlineRename lifecycle', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (root) {
      act(() => {
        root?.unmount()
      })
    }
    root = null
    container?.remove()
    container = null
    document.documentElement.removeAttribute('data-worktree-title-rename-cursor-lock')
    document.getElementById('worktree-title-rename-cursor-lock-style')?.remove()
  })

  it('reports editing=false if it unmounts while renaming', () => {
    const onEditingChange = vi.fn()
    container = document.createElement('div')
    root = createRoot(container)

    act(() => {
      root?.render(
        <WorktreeTitleInlineRename
          displayName="Feature workspace"
          onEditingChange={onEditingChange}
          onRename={vi.fn()}
        />
      )
    })

    const title = container.querySelector('[data-worktree-title-inline-rename]')

    act(() => {
      title?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    })

    expect(onEditingChange).toHaveBeenLastCalledWith(true)

    act(() => {
      root?.unmount()
      root = null
    })

    expect(onEditingChange).toHaveBeenLastCalledWith(false)
    expect(onEditingChange).toHaveBeenCalledTimes(2)
  })

  it('selects the full title on focus by default', () => {
    const select = vi.spyOn(HTMLInputElement.prototype, 'select')
    const setSelectionRange = vi.spyOn(HTMLInputElement.prototype, 'setSelectionRange')
    const nextContainer = document.createElement('div')
    container = nextContainer
    root = createRoot(nextContainer)

    act(() => {
      root?.render(<WorktreeTitleInlineRename displayName="Feature workspace" onRename={vi.fn()} />)
    })

    act(() => {
      nextContainer
        .querySelector('[data-worktree-title-inline-rename]')
        ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    })

    expect(select).toHaveBeenCalledTimes(1)
    expect(setSelectionRange).not.toHaveBeenCalled()

    select.mockRestore()
    setSelectionRange.mockRestore()
  })

  it('places the caret at the end when selectOnFocus is false', () => {
    const displayName = 'Feature workspace'
    const select = vi.spyOn(HTMLInputElement.prototype, 'select')
    const setSelectionRange = vi.spyOn(HTMLInputElement.prototype, 'setSelectionRange')
    const nextContainer = document.createElement('div')
    container = nextContainer
    root = createRoot(nextContainer)

    act(() => {
      root?.render(
        <WorktreeTitleInlineRename
          displayName={displayName}
          selectOnFocus={false}
          onRename={vi.fn()}
        />
      )
    })

    act(() => {
      nextContainer
        .querySelector('[data-worktree-title-inline-rename]')
        ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    })

    expect(select).not.toHaveBeenCalled()
    expect(setSelectionRange).toHaveBeenCalledWith(displayName.length, displayName.length)

    select.mockRestore()
    setSelectionRange.mockRestore()
  })

  it('selects the full title when hovercard field mode starts editing', () => {
    const select = vi.spyOn(HTMLInputElement.prototype, 'select')
    const setSelectionRange = vi.spyOn(HTMLInputElement.prototype, 'setSelectionRange')
    const nextContainer = document.createElement('div')
    container = nextContainer
    root = createRoot(nextContainer)

    act(() => {
      root?.render(
        <WorktreeTitleInlineRename
          displayName="Feature workspace"
          editingPresentation="field"
          onRename={vi.fn()}
        />
      )
    })

    act(() => {
      nextContainer
        .querySelector('[data-worktree-title-inline-rename]')
        ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    })

    const input = nextContainer.querySelector('[data-worktree-title-rename-input]')
    expect(select).toHaveBeenCalledTimes(1)
    expect(setSelectionRange).not.toHaveBeenCalled()
    expect(input?.className).toContain('select-text')
    expect(input?.className).not.toContain('select-none')

    select.mockRestore()
    setSelectionRange.mockRestore()
  })

  it('locks the document cursor only while the hovercard field editor is active', () => {
    const nextContainer = document.createElement('div')
    container = nextContainer
    root = createRoot(nextContainer)

    act(() => {
      root?.render(
        <WorktreeTitleInlineRename
          displayName="Feature workspace"
          editingPresentation="field"
          onRename={vi.fn()}
        />
      )
    })

    expect(document.documentElement.hasAttribute('data-worktree-title-rename-cursor-lock')).toBe(
      false
    )

    act(() => {
      nextContainer
        .querySelector('[data-worktree-title-inline-rename]')
        ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    })

    expect(document.documentElement.hasAttribute('data-worktree-title-rename-cursor-lock')).toBe(
      true
    )
    expect(
      document.getElementById('worktree-title-rename-cursor-lock-style')?.textContent
    ).toContain('cursor: text !important')

    act(() => {
      nextContainer
        .querySelector('[data-worktree-title-rename-input]')
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        )
    })

    expect(document.documentElement.hasAttribute('data-worktree-title-rename-cursor-lock')).toBe(
      false
    )
    expect(document.getElementById('worktree-title-rename-cursor-lock-style')).toBeNull()
  })

  it('renders wrapped read text before mounting the hovercard field input', () => {
    const nextContainer = document.createElement('div')
    container = nextContainer
    root = createRoot(nextContainer)

    act(() => {
      root?.render(
        <WorktreeTitleInlineRename
          displayName="Feature workspace"
          editingPresentation="field"
          wrapTitle
          onRename={vi.fn()}
        />
      )
    })

    const readTitle = nextContainer.querySelector('[data-worktree-title-inline-rename]')
    expect(nextContainer.querySelector('input')).toBeNull()
    expect(readTitle?.className).toContain('break-words')
    expect(readTitle?.className).toContain('whitespace-normal')

    act(() => {
      nextContainer
        .querySelector('[data-worktree-title-inline-rename]')
        ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    })

    const editingInput = nextContainer.querySelector('[data-worktree-title-rename-input]')
    expect(editingInput).not.toBeNull()
    expect((editingInput as HTMLInputElement | null)?.readOnly).toBe(false)
    expect(editingInput?.className).toContain('bg-input/40')
    expect(editingInput?.className).toContain('select-text')

    act(() => {
      root?.unmount()
      root = null
    })
  })
})
