import React from 'react'
import { ArrowUp, Loader2, RefreshCw } from 'lucide-react'
import type { GitBranchCompareSummary } from '../../../../shared/types'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { SourceControlHeaderIconButton } from './source-control-header-icon-button'

export function shouldShowSourceControlBranchContextRow(
  summary: GitBranchCompareSummary | null
): boolean {
  if (!summary || summary.status === 'loading') {
    return true
  }
  if (summary.status !== 'ready') {
    return true
  }
  return typeof summary.commitsAhead === 'number' && summary.commitsAhead > 0
}

export function SourceControlBranchContextRow({
  summary,
  branchName,
  onChangeBaseRef,
  onRetry
}: {
  summary: GitBranchCompareSummary | null
  branchName: string
  onChangeBaseRef: () => void
  onRetry: () => void
}): React.JSX.Element | null {
  if (!shouldShowSourceControlBranchContextRow(summary)) {
    return null
  }

  if (!summary || summary.status === 'loading') {
    return (
      <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
        <Loader2 className="size-3 shrink-0 animate-spin" />
        <span className="min-w-0 truncate">
          {translate('auto.components.right.sidebar.SourceControl.11b5dd8e41', 'Comparing against')}
          {summary?.baseRef ?? '…'}
        </span>
      </div>
    )
  }

  if (summary.status !== 'ready') {
    return (
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate" title={summary.errorMessage ?? undefined}>
          {summary.errorMessage ??
            translate(
              'auto.components.right.sidebar.SourceControl.715d229c86',
              'Branch compare unavailable'
            )}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-5 shrink-0 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
          onClick={onChangeBaseRef}
        >
          {translate('auto.components.right.sidebar.SourceControl.493f963029', 'Change base ref')}
        </Button>
        <SourceControlHeaderIconButton
          icon={RefreshCw}
          label={translate('auto.components.right.sidebar.SourceControl.286dbda4d6', 'Retry')}
          onClick={onRetry}
        />
      </div>
    )
  }

  const commitsAhead = summary.commitsAhead
  const showCommitsAhead = typeof commitsAhead === 'number' && commitsAhead > 0
  if (!showCommitsAhead) {
    return null
  }

  const branchLabel = branchName || summary.compareRef
  const aheadLabel = `${commitsAhead} ${translate('auto.components.right.sidebar.SourceControl.3278b2767b', 'ahead')}`

  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
      <span
        className="min-w-0 flex-1 truncate font-mono text-[10.5px]"
        title={`${commitsAhead} ${commitsAhead === 1 ? 'commit' : 'commits'} ahead of ${summary.baseRef}`}
      >
        <span className="text-foreground/90">{branchLabel}</span>
        <span className="text-muted-foreground"> → {summary.baseRef}</span>
        <span className="text-muted-foreground"> · </span>
        <span className="inline-flex items-center gap-0.5 font-medium text-status-success">
          <ArrowUp className="size-2.5" />
          {aheadLabel}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-5 shrink-0 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
        onClick={onChangeBaseRef}
      >
        {translate('auto.components.right.sidebar.SourceControl.476b77745b', 'Change Base Ref')}
      </Button>
    </div>
  )
}
