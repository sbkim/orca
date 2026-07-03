import React from 'react'
import { cn } from '@/lib/utils'
import { WorktreeTitleInlineRename } from './WorktreeTitleInlineRename'

type WorktreeCardHoverIdentityHeaderProps = {
  branchName?: string
  workspaceTitle?: string
  identityOrder: 'workspace-first' | 'branch-first'
  workspaceTitleRenameDisabled: boolean
  onRenameWorkspaceTitle?: (displayName: string) => Promise<void> | void
  onWorkspaceTitleEditingChange?: (editing: boolean) => void
}

export function WorktreeCardHoverIdentityHeader({
  branchName,
  workspaceTitle,
  identityOrder,
  workspaceTitleRenameDisabled,
  onRenameWorkspaceTitle,
  onWorkspaceTitleEditingChange
}: WorktreeCardHoverIdentityHeaderProps): React.JSX.Element | null {
  const hasEditableWorkspaceTitle = Boolean(
    workspaceTitle &&
    workspaceTitle !== branchName &&
    onRenameWorkspaceTitle &&
    !workspaceTitleRenameDisabled
  )
  // Why: an editable title shows the I-beam in both read and edit states so the
  // cursor never jumps when the rename field opens under a stationary pointer.
  const identityCursorClassName = hasEditableWorkspaceTitle ? 'cursor-text' : 'cursor-default'
  const branchIdentity = branchName ? (
    <div
      className={cn(
        // Why: the hover panel is where users read full git identity; wrap instead
        // of truncating so long branch names stay readable like issue titles below.
        'break-words font-mono text-[11px] leading-snug text-muted-foreground',
        identityCursorClassName,
        identityOrder === 'workspace-first' && 'mt-1'
      )}
    >
      {branchName}
    </div>
  ) : null
  const workspaceIdentity =
    workspaceTitle && workspaceTitle !== branchName ? (
      onRenameWorkspaceTitle ? (
        <WorktreeTitleInlineRename
          displayName={workspaceTitle}
          disabled={workspaceTitleRenameDisabled}
          editingPresentation="field"
          wrapTitle
          className={cn(
            'text-[13px] font-semibold leading-snug text-foreground',
            identityCursorClassName,
            identityOrder === 'branch-first' && 'mt-1'
          )}
          onEditingChange={onWorkspaceTitleEditingChange}
          onRename={onRenameWorkspaceTitle}
        />
      ) : (
        <div
          className={cn(
            'break-words text-[13px] font-semibold leading-snug text-foreground',
            identityCursorClassName,
            identityOrder === 'branch-first' && 'mt-1'
          )}
        >
          {workspaceTitle}
        </div>
      )
    ) : null

  if (!branchIdentity && !workspaceIdentity) {
    return null
  }

  return (
    // Why: detail sections keep the left rule; the hover title stays flush so
    // it reads as the panel heading rather than another inset section.
    <div className={cn('min-w-0', identityCursorClassName)} data-worktree-hover-identity-header="">
      {identityOrder === 'branch-first' ? branchIdentity : workspaceIdentity}
      {identityOrder === 'branch-first' ? workspaceIdentity : branchIdentity}
    </div>
  )
}
