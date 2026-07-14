import { useMemo, useRef, useState } from 'react'
import { ChevronDown, SquareTerminal } from 'lucide-react'
import { useAppStore } from '@/store'
import { Command, CommandEmpty, CommandInput, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { runQuickCommandInNewTab } from '@/lib/run-quick-command-in-new-tab'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree-id'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import type { TerminalQuickCommand } from '../../../../shared/types'
import type { PackageJsonScript } from '../../../../shared/package-json-scripts'
import { translate } from '@/i18n/i18n'
import { useWorktreePackageScripts } from './useWorktreePackageScripts'
import type { WorktreePackageJsonProject } from './worktree-package-script-scan'
import { PackageScriptTreeRows } from './PackageScriptTreeRows'

type TabBarRunScriptButtonProps = {
  worktreeId: string
  groupId: string
}

function getInitiallyExpandedPackageId(
  projects: readonly WorktreePackageJsonProject[]
): string | null {
  const rootProject = projects.find((project) => project.relativeDirectory === '') ?? projects[0]
  return rootProject ? `package:${rootProject.relativeDirectory || '.'}` : null
}

function packagePathLabel(relativeDirectory: string): string {
  if (!relativeDirectory) {
    return translate(
      'auto.components.tab.bar.TabBarRunScriptButton.workspaceRoot',
      'Workspace root'
    )
  }
  return relativeDirectory.split('/').join(' › ')
}

export function TabBarRunScriptButton({
  worktreeId,
  groupId
}: TabBarRunScriptButtonProps): React.JSX.Element | null {
  const packageScripts = useWorktreePackageScripts(worktreeId)
  const repos = useAppStore((state) => state.repos)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [expansionState, setExpansionState] = useState<{
    worktreeId: string
    ids: Set<string>
  } | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  // Why: package scripts run in the worktree regardless of repo scope, but a
  // real repoId keeps the synthetic quick command scoped like adjacent actions.
  const repoId = useMemo(() => {
    if (worktreeId === FLOATING_TERMINAL_WORKTREE_ID) {
      return null
    }
    const candidate = getRepoIdFromWorktreeId(worktreeId)
    return repos.some((repo) => repo.id === candidate) ? candidate : null
  }, [worktreeId, repos])

  const defaultExpandedIds = useMemo(() => {
    const initialId = getInitiallyExpandedPackageId(packageScripts?.packages ?? [])
    return new Set(initialId ? [initialId] : [])
  }, [packageScripts?.packages])
  const visibleExpandedIds =
    expansionState?.worktreeId === worktreeId ? expansionState.ids : defaultExpandedIds

  const handleToggle = (id: string): void => {
    setExpansionState((current) => {
      const next = new Set(current?.worktreeId === worktreeId ? current.ids : defaultExpandedIds)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return { worktreeId, ids: next }
    })
  }

  if (!packageScripts) {
    return null
  }

  const handleRun = (project: WorktreePackageJsonProject, script: PackageJsonScript): void => {
    const packageLabel = project.packageName ?? packagePathLabel(project.relativeDirectory)
    const command: TerminalQuickCommand = {
      id: `package-script-${encodeURIComponent(project.relativeDirectory || '.')}-${encodeURIComponent(script.name)}`,
      label: `${packageLabel}: ${script.name}`,
      action: 'terminal-command',
      command: packageScripts.runCommandFor(project, script),
      appendEnter: true,
      scope: repoId ? { type: 'repo', repoId } : { type: 'global' }
    }
    setPickerOpen(false)
    runQuickCommandInNewTab({
      command,
      worktreeId,
      groupId,
      initialCwd: project.directoryPath
    })
  }

  const label = translate('auto.components.tab.bar.TabBarRunScriptButton.runScript', 'Run Script')

  return (
    <Popover
      open={pickerOpen}
      onOpenChange={(next) => {
        setPickerOpen(next)
        if (next) {
          setQuery('')
          // Why: opening is an explicit freshness boundary, so edits appear
          // without a watcher or repeated background scans over SSH.
          packageScripts.refresh()
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="my-auto flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label={label}
        >
          <SquareTerminal className="size-3.5" />
          <span className="text-xs font-medium">{label}</span>
          <ChevronDown className="size-3" strokeWidth={2.5} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={6}
        className="w-88 p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          searchInputRef.current?.focus()
        }}
      >
        <Command shouldFilter={false} loop className="bg-transparent">
          <CommandInput
            ref={searchInputRef}
            value={query}
            onValueChange={setQuery}
            placeholder={translate(
              'auto.components.tab.bar.TabBarRunScriptButton.searchScripts',
              'Search scripts, commands, or packages...'
            )}
            className="h-9 py-2 text-xs"
            wrapperClassName="border-b border-border/50 px-2"
            iconClassName="size-3.5"
          />
          <CommandList className="max-h-80 py-1">
            <CommandEmpty className="py-5 text-center text-xs">
              {translate(
                'auto.components.tab.bar.TabBarRunScriptButton.noMatchingScripts',
                'No scripts match your search.'
              )}
            </CommandEmpty>
            {packageScripts.packages.map((project) => (
              <PackageScriptTreeRows
                key={project.relativeDirectory || '.'}
                project={project}
                query={query}
                expandedIds={visibleExpandedIds}
                onToggle={handleToggle}
                onRun={handleRun}
                packagePathLabel={packagePathLabel}
              />
            ))}
          </CommandList>
          <div className="border-t border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground">
            {translate(
              'auto.components.tab.bar.TabBarRunScriptButton.scriptSummary',
              '{{scripts}} scripts in {{packages}} packages',
              {
                scripts: packageScripts.scriptCount,
                packages: packageScripts.packages.length
              }
            )}
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
