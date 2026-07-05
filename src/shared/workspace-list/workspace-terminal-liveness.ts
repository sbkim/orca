import type { TerminalTab } from '../types'

type TerminalLikeTab = Pick<TerminalTab, 'id'>
type BrowserLikeTab = { id: string }

export function tabHasLivePty(ptyIdsByTabId: Record<string, string[]>, tabId: string): boolean {
  return (ptyIdsByTabId[tabId]?.length ?? 0) > 0
}

export function hasActiveWorkspaceActivity(
  worktreeId: string,
  tabsByWorktree: Record<string, readonly TerminalLikeTab[]> | null | undefined,
  ptyIdsByTabId: Record<string, string[]> | null | undefined,
  browserTabsByWorktree: Record<string, readonly BrowserLikeTab[]> | null | undefined
): boolean {
  const tabs = tabsByWorktree?.[worktreeId] ?? []
  const hasLiveTerminal =
    ptyIdsByTabId != null && tabs.some((tab) => tabHasLivePty(ptyIdsByTabId, tab.id))
  const hasBrowser = (browserTabsByWorktree?.[worktreeId] ?? []).length > 0
  return hasLiveTerminal || hasBrowser
}

export function isInactiveWorkspace(
  worktreeId: string,
  tabsByWorktree: Record<string, readonly TerminalLikeTab[]> | null | undefined,
  ptyIdsByTabId: Record<string, string[]> | null | undefined,
  browserTabsByWorktree: Record<string, readonly BrowserLikeTab[]> | null | undefined
): boolean {
  return !hasActiveWorkspaceActivity(
    worktreeId,
    tabsByWorktree,
    ptyIdsByTabId,
    browserTabsByWorktree
  )
}
