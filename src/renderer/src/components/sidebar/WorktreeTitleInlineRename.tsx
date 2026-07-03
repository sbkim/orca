import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

export type WorktreeTitleRenameCommit = { kind: 'cancel' } | { kind: 'save'; displayName: string }

export function getWorktreeTitleRenameCommit(
  currentDisplayName: string,
  nextDisplayName: string
): WorktreeTitleRenameCommit {
  const trimmed = nextDisplayName.trim()
  if (!trimmed || trimmed === currentDisplayName) {
    return { kind: 'cancel' }
  }
  return { kind: 'save', displayName: trimmed }
}

export function isWorktreeTitleTruncated(
  element: Pick<HTMLElement, 'clientWidth' | 'scrollWidth'>
): boolean {
  return element.scrollWidth > element.clientWidth
}

const FIELD_RENAME_CURSOR_LOCK_ATTR = 'data-worktree-title-rename-cursor-lock'
const FIELD_RENAME_CURSOR_LOCK_STYLE_ID = 'worktree-title-rename-cursor-lock-style'
const useCursorLockEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

let fieldRenameCursorLockCount = 0

function acquireFieldRenameCursorLock(): () => void {
  if (typeof document === 'undefined') {
    return () => {}
  }

  fieldRenameCursorLockCount += 1
  document.documentElement.setAttribute(FIELD_RENAME_CURSOR_LOCK_ATTR, '')

  if (!document.getElementById(FIELD_RENAME_CURSOR_LOCK_STYLE_ID)) {
    const style = document.createElement('style')
    style.id = FIELD_RENAME_CURSOR_LOCK_STYLE_ID
    // Why: Chromium can leave the native cursor stale after a stationary pointer
    // swaps from wrapped text to an input. Lock cursor only while field editing.
    style.textContent = `
html[${FIELD_RENAME_CURSOR_LOCK_ATTR}],
html[${FIELD_RENAME_CURSOR_LOCK_ATTR}] body,
html[${FIELD_RENAME_CURSOR_LOCK_ATTR}] body * {
  cursor: text !important;
}
`
    document.head.append(style)
  }

  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    fieldRenameCursorLockCount = Math.max(0, fieldRenameCursorLockCount - 1)
    if (fieldRenameCursorLockCount > 0) {
      return
    }
    document.documentElement.removeAttribute(FIELD_RENAME_CURSOR_LOCK_ATTR)
    document.getElementById(FIELD_RENAME_CURSOR_LOCK_STYLE_ID)?.remove()
  }
}

type WorktreeTitleInlineRenameProps = {
  displayName: string
  disabled?: boolean
  showUnreadEmphasis?: boolean
  dimReadTitle?: boolean
  editingPresentation?: 'text' | 'field'
  className?: string
  editingClassName?: string
  inputClassName?: string
  titleWrapper?: (title: React.ReactElement) => React.ReactElement
  wrapTitle?: boolean
  onEditingChange?: (editing: boolean) => void
  onRename: (displayName: string) => Promise<void> | void
  // Why: lets a parent (e.g. the workspace.rename shortcut via WorktreeCard)
  // open the editor imperatively. The parent clears its trigger in
  // onBeginEditingConsumed so the request fires exactly once.
  beginEditing?: boolean
  onBeginEditingConsumed?: () => void
  // Why: parent-triggered rename can place the caret without selecting, while
  // double-click rename keeps the native one-keystroke replacement behavior.
  selectOnFocus?: boolean
}

export function WorktreeTitleInlineRename({
  displayName,
  disabled = false,
  showUnreadEmphasis = false,
  dimReadTitle = false,
  editingPresentation = 'text',
  className,
  editingClassName,
  inputClassName,
  titleWrapper,
  wrapTitle = false,
  onEditingChange,
  onRename,
  beginEditing = false,
  onBeginEditingConsumed,
  selectOnFocus = true
}: WorktreeTitleInlineRenameProps): React.JSX.Element {
  const editingRef = useRef(false)
  const savingRef = useRef(false)
  const mountedRef = useRef(true)
  const onEditingChangeRef = useRef(onEditingChange)
  const titleElementRef = useRef<HTMLSpanElement | null>(null)
  const titleResizeObserverRef = useRef<ResizeObserver | null>(null)
  const removeTitleResizeListenerRef = useRef<(() => void) | null>(null)
  const renameFocusFrameRef = useRef<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(displayName)
  const [saving, setSaving] = useState(false)
  const [titleTruncated, setTitleTruncated] = useState(false)

  onEditingChangeRef.current = onEditingChange

  useEffect(() => {
    return () => {
      if (!editingRef.current) {
        return
      }
      editingRef.current = false
      // Why: hovercards keep themselves mounted while renaming; if the title
      // unmounts after a save, the parent still needs the editing latch cleared.
      onEditingChangeRef.current?.(false)
    }
  }, [])

  const measureTitleTruncated = useCallback((element: HTMLSpanElement | null) => {
    const nextTruncated = element ? isWorktreeTitleTruncated(element) : false
    setTitleTruncated((current) => (current === nextTruncated ? current : nextTruncated))
  }, [])

  const handleRootRef = useCallback(
    (node: HTMLSpanElement | null): void => {
      titleResizeObserverRef.current?.disconnect()
      titleResizeObserverRef.current = null
      removeTitleResizeListenerRef.current?.()
      removeTitleResizeListenerRef.current = null

      // Why: rename can resolve after this inline title unmounts; the rendered
      // root owns that stale-write guard without a mount-only Effect.
      mountedRef.current = node !== null
      titleElementRef.current = node
      if (!node || editingRef.current) {
        measureTitleTruncated(null)
        return
      }

      measureTitleTruncated(node)
      const updateTitleTruncated = () => measureTitleTruncated(node)
      if (typeof ResizeObserver === 'undefined') {
        window.addEventListener('resize', updateTitleTruncated)
        removeTitleResizeListenerRef.current = () =>
          window.removeEventListener('resize', updateTitleTruncated)
        return
      }

      // Why: compact sidebar width changes can make a readable title become
      // clipped; the tooltip should track the rendered geometry, not just text.
      const observer = new ResizeObserver(updateTitleTruncated)
      observer.observe(node)
      titleResizeObserverRef.current = observer
    },
    [measureTitleTruncated]
  )

  const titleElementKey = `${displayName}:${showUnreadEmphasis ? 'unread' : 'read'}`
  // Why: the sidebar row needs a text-only editor to avoid layout jumps; the
  // hovercard can use a compact field that reads more like native rename UI.
  const editingInputClassName =
    editingPresentation === 'field'
      ? 'h-6 rounded-sm border border-input bg-input/40 px-1.5 py-0 shadow-xs selection:bg-[Highlight] selection:text-[HighlightText] focus-visible:border-ring focus-visible:ring-[1px] focus-visible:ring-ring/50 dark:bg-input/30'
      : 'h-[1lh] rounded-none border-0 !border-transparent !bg-transparent p-0 !shadow-none focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none dark:!bg-transparent'
  const savingInputClassName = editingPresentation === 'field' ? 'pr-6' : 'pr-4'
  const savingSpinnerClassName = editingPresentation === 'field' ? 'right-1.5' : 'right-0'

  useCursorLockEffect(() => {
    if (!editing || editingPresentation !== 'field') {
      return
    }
    return acquireFieldRenameCursorLock()
  }, [editing, editingPresentation])

  const setEditingMode = useCallback(
    (nextEditing: boolean) => {
      if (editingRef.current === nextEditing) {
        return
      }
      editingRef.current = nextEditing
      if (nextEditing) {
        measureTitleTruncated(null)
      }
      setEditing(nextEditing)
      // Why: the parent card disables drag while renaming; an Effect leaves one draggable commit.
      onEditingChange?.(nextEditing)
    },
    [measureTitleTruncated, onEditingChange]
  )

  const clearRenameFocusFrame = useCallback(() => {
    if (renameFocusFrameRef.current === null) {
      return
    }
    cancelAnimationFrame(renameFocusFrameRef.current)
    renameFocusFrameRef.current = null
  }, [])

  useEffect(() => () => clearRenameFocusFrame(), [clearRenameFocusFrame])

  const handleInputRef = useCallback(
    (input: HTMLInputElement | null) => {
      clearRenameFocusFrame()
      if (!input || !editing) {
        return
      }
      // Why: defer focus until after the opening double-click finishes so
      // intentional select-all wins over the browser's initiating click target.
      renameFocusFrameRef.current = requestAnimationFrame(() => {
        renameFocusFrameRef.current = null
        input.focus()
        if (selectOnFocus) {
          // Why: double-click rename should make replacing the workspace title a one-keystroke action.
          input.select()
          return
        }
        const caret = input.value.length
        input.setSelectionRange(caret, caret)
      })
    },
    [clearRenameFocusFrame, editing, selectOnFocus]
  )

  // Why: open the editor when a parent requests it (the workspace.rename
  // shortcut). Always consume the request so the parent's trigger can't linger;
  // skip the actual open when disabled or already editing.
  useEffect(() => {
    if (!beginEditing) {
      return
    }
    onBeginEditingConsumed?.()
    if (disabled || editing) {
      return
    }
    setValue(displayName)
    setEditing(true)
  }, [beginEditing, disabled, editing, displayName, onBeginEditingConsumed])

  const stopCardEvent = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation()
  }, [])

  const handleInputMouseDown = useCallback(
    (event: React.MouseEvent<HTMLInputElement>) => {
      stopCardEvent(event)
    },
    [stopCardEvent]
  )

  const handleInputDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLInputElement>) => {
      stopCardEvent(event)
    },
    [stopCardEvent]
  )

  const startRename = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (disabled) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      setValue(displayName)
      setEditingMode(true)
    },
    [disabled, displayName, setEditingMode]
  )

  const cancelRename = useCallback(() => {
    setValue(displayName)
    setEditingMode(false)
  }, [displayName, setEditingMode])

  const commitRename = useCallback(async () => {
    if (savingRef.current) {
      return
    }

    const commit = getWorktreeTitleRenameCommit(displayName, value)
    if (commit.kind === 'cancel') {
      cancelRename()
      return
    }

    savingRef.current = true
    setSaving(true)
    try {
      await onRename(commit.displayName)
      if (mountedRef.current) {
        setEditingMode(false)
      }
    } catch (err) {
      if (mountedRef.current) {
        toast.error(
          err instanceof Error
            ? err.message
            : translate(
                'auto.components.sidebar.WorktreeTitleInlineRename.8df295a78d',
                'Failed to rename workspace.'
              )
        )
      }
    } finally {
      savingRef.current = false
      if (mountedRef.current) {
        setSaving(false)
      }
    }
  }, [cancelRename, displayName, onRename, setEditingMode, value])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation()
      if (event.key === 'Enter') {
        event.preventDefault()
        void commitRename()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        cancelRename()
      }
    },
    [cancelRename, commitRename]
  )

  if (editing) {
    return (
      <span
        key={`editing:${titleElementKey}`}
        ref={handleRootRef}
        className={cn(
          'relative grid min-w-0 truncate leading-tight text-foreground',
          showUnreadEmphasis ? 'font-semibold' : 'font-normal',
          className,
          editingClassName
        )}
        data-worktree-title-inline-rename="editing"
      >
        <span
          className="pointer-events-none invisible col-start-1 row-start-1 min-w-0 truncate whitespace-pre"
          aria-hidden="true"
        >
          {displayName}
        </span>
        <Input
          ref={handleInputRef}
          value={value}
          style={{ font: 'inherit' }}
          disabled={saving}
          spellCheck={false}
          aria-label={translate(
            'auto.components.sidebar.WorktreeTitleInlineRename.bff3bdd00c',
            'Rename workspace'
          )}
          data-worktree-title-rename-input="true"
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => void commitRename()}
          onClick={stopCardEvent}
          onDoubleClick={handleInputDoubleClick}
          onMouseDown={handleInputMouseDown}
          onPointerDown={stopCardEvent}
          onKeyDown={handleKeyDown}
          className={cn(
            'col-start-1 row-start-1 min-w-0 cursor-text truncate text-foreground outline-none',
            'select-text',
            editingInputClassName,
            saving && savingInputClassName,
            inputClassName
          )}
        />
        {saving ? (
          <LoaderCircle
            className={cn(
              'pointer-events-none absolute top-1/2 size-3 -translate-y-1/2 animate-spin text-muted-foreground',
              savingSpinnerClassName
            )}
          />
        ) : null}
      </span>
    )
  }

  const titleEmphasisClassName = showUnreadEmphasis
    ? 'font-semibold text-foreground'
    : dimReadTitle
      ? 'font-normal text-foreground/80'
      : 'font-normal text-foreground'

  const title = (
    <span
      key={`title:${titleElementKey}`}
      ref={handleRootRef}
      className={cn(
        'block min-w-0 leading-tight focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring',
        wrapTitle ? 'break-words whitespace-normal' : 'truncate',
        titleEmphasisClassName,
        className
      )}
      data-worktree-title-inline-rename=""
      onDoubleClick={startRename}
      tabIndex={disabled ? undefined : 0}
    >
      {/* Why: visible text alone misses the unread state for assistive tech. */}
      {showUnreadEmphasis && (
        <span className="sr-only">
          {translate('auto.components.sidebar.WorktreeTitleInlineRename.2f42ae024f', 'Unread:')}
        </span>
      )}
      {displayName}
    </span>
  )

  if (titleWrapper) {
    return titleWrapper(title)
  }

  if (wrapTitle || !titleTruncated) {
    return title
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{title}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {displayName}
      </TooltipContent>
    </Tooltip>
  )
}
