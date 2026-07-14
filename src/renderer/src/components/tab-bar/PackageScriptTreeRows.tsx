import { ChevronDown, ChevronRight, FolderTree, Package } from 'lucide-react'
import { CommandItem } from '@/components/ui/command'
import { translate } from '@/i18n/i18n'
import type { PackageJsonScript } from '../../../../shared/package-json-scripts'
import {
  buildPackageScriptTree,
  searchPackageScripts,
  type PackageScriptTreeNode
} from '../../../../shared/package-script-tree'
import type { WorktreePackageJsonProject } from './worktree-package-script-scan'

type PackageScriptTreeRowsProps = {
  project: WorktreePackageJsonProject
  query: string
  expandedIds: ReadonlySet<string>
  onToggle: (id: string) => void
  onRun: (project: WorktreePackageJsonProject, script: PackageJsonScript) => void
  packagePathLabel: (relativeDirectory: string) => string
}

function packageNodeId(project: WorktreePackageJsonProject): string {
  return `package:${project.relativeDirectory || '.'}`
}

function scriptNodeId(project: WorktreePackageJsonProject, node: PackageScriptTreeNode): string {
  return `script:${project.relativeDirectory || '.'}:${node.key}`
}

function ToggleIcon({ expanded }: { expanded: boolean }): React.JSX.Element {
  return expanded ? (
    <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
  ) : (
    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
  )
}

function ScriptNodeRows({
  project,
  node,
  forceExpanded,
  expandedIds,
  onToggle,
  onRun
}: {
  project: WorktreePackageJsonProject
  node: PackageScriptTreeNode
  forceExpanded: boolean
  expandedIds: ReadonlySet<string>
  onToggle: (id: string) => void
  onRun: (project: WorktreePackageJsonProject, script: PackageJsonScript) => void
}): React.JSX.Element {
  const id = scriptNodeId(project, node)
  const hasChildren = node.children.length > 0
  const expanded = hasChildren && (forceExpanded || expandedIds.has(id))
  const handleSelect = (): void => {
    if (node.script) {
      onRun(project, node.script)
      return
    }
    if (hasChildren) {
      onToggle(id)
    }
  }

  return (
    <>
      <CommandItem
        value={id}
        onSelect={handleSelect}
        className="min-h-8 items-start gap-1.5 border border-transparent px-2 py-1.5 data-[selected=true]:border-border"
      >
        {hasChildren ? (
          forceExpanded ? (
            <ToggleIcon expanded />
          ) : (
            <button
              type="button"
              aria-label={
                expanded
                  ? translate(
                      'auto.components.tab.bar.TabBarRunScriptButton.collapseNode',
                      'Collapse {{name}}',
                      { name: node.label }
                    )
                  : translate(
                      'auto.components.tab.bar.TabBarRunScriptButton.expandNode',
                      'Expand {{name}}',
                      { name: node.label }
                    )
              }
              className="-m-1 flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-accent"
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation()
                onToggle(id)
              }}
            >
              <ToggleIcon expanded={expanded} />
            </button>
          )
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium">{node.label}</span>
            {hasChildren ? (
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {node.children.length}
              </span>
            ) : null}
          </div>
          {node.script ? (
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {node.script.command}
            </p>
          ) : null}
        </div>
      </CommandItem>
      {expanded ? (
        <div className="ml-3 border-l border-border/60 pl-1">
          {node.children.map((child) => (
            <ScriptNodeRows
              key={child.key}
              project={project}
              node={child}
              forceExpanded={forceExpanded}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onRun={onRun}
            />
          ))}
        </div>
      ) : null}
    </>
  )
}

export function PackageScriptTreeRows({
  project,
  query,
  expandedIds,
  onToggle,
  onRun,
  packagePathLabel
}: PackageScriptTreeRowsProps): React.JSX.Element | null {
  const pathLabel = packagePathLabel(project.relativeDirectory)
  const visibleScripts = searchPackageScripts(
    project.scripts,
    query,
    `${project.packageName ?? ''} ${pathLabel} ${project.relativeDirectory}`
  )
  if (visibleScripts.length === 0) {
    return null
  }

  const id = packageNodeId(project)
  const forceExpanded = query.trim().length > 0
  const expanded = forceExpanded || expandedIds.has(id)
  const tree = buildPackageScriptTree(visibleScripts)

  return (
    <>
      <CommandItem
        value={id}
        onSelect={() => {
          if (!forceExpanded) {
            onToggle(id)
          }
        }}
        className="min-h-9 gap-1.5 border border-transparent px-2 py-1.5 data-[selected=true]:border-border"
      >
        <ToggleIcon expanded={expanded} />
        <Package className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium">{project.packageName ?? pathLabel}</span>
            <span className="shrink-0 font-mono text-[10px] uppercase text-muted-foreground">
              {project.packageManager}
            </span>
          </div>
          <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            <FolderTree className="size-3 shrink-0" />
            <span className="truncate">{pathLabel}</span>
            <span className="shrink-0">· {visibleScripts.length}</span>
          </p>
        </div>
      </CommandItem>
      {expanded ? (
        <div className="ml-3 border-l border-border/60 pl-1">
          {tree.map((node) => (
            <ScriptNodeRows
              key={node.key}
              project={project}
              node={node}
              forceExpanded={forceExpanded}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onRun={onRun}
            />
          ))}
        </div>
      ) : null}
    </>
  )
}
