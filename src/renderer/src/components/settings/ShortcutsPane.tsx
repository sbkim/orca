import React, { useMemo, useState } from 'react'
import { FileText, FolderOpen, RefreshCw, RotateCcw, Save, X } from 'lucide-react'
import { useAppStore } from '../../store'
import { ShortcutKeyCombo } from '../ShortcutKeyCombo'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Badge } from '../ui/badge'
import { SearchableSetting } from './SearchableSetting'
import { matchesSettingsSearch, type SettingsSearchEntry } from './settings-search'
import {
  KEYBINDING_DEFINITIONS,
  actionShouldWarnForTerminalReservation,
  findKeybindingConflicts,
  formatKeybinding,
  formatKeybindingList,
  getEffectiveKeybindingsForAction,
  getKeybindingDefinition,
  normalizeKeybindingList,
  type KeybindingActionId,
  type KeybindingOverrides
} from '../../../../shared/keybindings'

type ShortcutGroup = {
  title: string
  items: typeof KEYBINDING_DEFINITIONS
}

export const SHORTCUTS_PANE_SEARCH_ENTRIES: SettingsSearchEntry[] = KEYBINDING_DEFINITIONS.map(
  (item) => ({
    title: item.title,
    description: `${item.group} shortcut`,
    keywords: [...item.searchKeywords]
  })
)

const isMac = navigator.userAgent.includes('Mac')
const platform: NodeJS.Platform = isMac
  ? 'darwin'
  : navigator.userAgent.includes('Windows')
    ? 'win32'
    : 'linux'
function groupDefinitions(): ShortcutGroup[] {
  const groups = new Map<string, typeof KEYBINDING_DEFINITIONS>()
  for (const definition of KEYBINDING_DEFINITIONS) {
    groups.set(definition.group, [...(groups.get(definition.group) ?? []), definition])
  }
  return Array.from(groups.entries()).map(([title, items]) => ({ title, items }))
}

function sameBindings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((binding, index) => binding === b[index])
}

function hasOwnBindingOverride(
  overrides: KeybindingOverrides,
  actionId: KeybindingActionId
): boolean {
  return Object.prototype.hasOwnProperty.call(overrides, actionId)
}

function removeBindingOverride(
  overrides: KeybindingOverrides,
  actionId: KeybindingActionId
): KeybindingOverrides {
  const next = { ...overrides }
  delete next[actionId]
  return next
}

function bindingInputValue(actionId: KeybindingActionId, overrides: KeybindingOverrides): string {
  return getEffectiveKeybindingsForAction(actionId, platform, overrides).join(', ')
}

function hasCommonBindingOverride(
  snapshot: ReturnType<typeof useAppStore.getState>['keybindingSnapshot'],
  actionId: KeybindingActionId
): boolean {
  return hasOwnBindingOverride(snapshot?.commonOverrides ?? {}, actionId)
}

function BindingPreview({ bindings }: { bindings: readonly string[] }): React.JSX.Element {
  if (bindings.length === 0) {
    return <span className="text-xs text-muted-foreground">Unassigned</span>
  }
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {bindings.map((binding) => (
        <ShortcutKeyCombo key={binding} keys={formatKeybinding(binding, platform)} />
      ))}
    </div>
  )
}

export function ShortcutsPane(): React.JSX.Element {
  const searchQuery = useAppStore((state) => state.settingsSearchQuery)
  const keybindings = useAppStore((state) => state.keybindings)
  const keybindingSnapshot = useAppStore((state) => state.keybindingSnapshot)
  const setKeybindingOverride = useAppStore((state) => state.setKeybindingOverride)
  const resetKeybindingOverride = useAppStore((state) => state.resetKeybindingOverride)
  const disableKeybindingAction = useAppStore((state) => state.disableKeybindingAction)
  const reloadKeybindings = useAppStore((state) => state.reloadKeybindings)
  const openKeybindingsFile = useAppStore((state) => state.openKeybindingsFile)
  const revealKeybindingsFile = useAppStore((state) => state.revealKeybindingsFile)
  const [drafts, setDrafts] = useState<Partial<Record<KeybindingActionId, string>>>({})
  const [errors, setErrors] = useState<Partial<Record<KeybindingActionId, string>>>({})

  const groups = useMemo(groupDefinitions, [])
  const conflictByAction = useMemo(() => {
    const result = new Map<KeybindingActionId, string[]>()
    for (const conflict of findKeybindingConflicts(platform, keybindings)) {
      const labels = conflict.actionIds
        .map((id) => getKeybindingDefinition(id)?.title ?? id)
        .join(', ')
      for (const actionId of conflict.actionIds) {
        result.set(actionId, [
          ...(result.get(actionId) ?? []),
          `${formatKeybindingList([conflict.binding], platform)} conflicts with ${labels}.`
        ])
      }
    }
    return result
  }, [keybindings])

  const groupEntries = useMemo<Record<string, SettingsSearchEntry[]>>(
    () =>
      Object.fromEntries(
        groups.map((group) => [
          group.title,
          group.items.map((item) => ({
            title: item.title,
            description: `${group.title} shortcut`,
            keywords: [...item.searchKeywords]
          }))
        ])
      ),
    [groups]
  )

  const commitBinding = async (actionId: KeybindingActionId): Promise<void> => {
    const draft = drafts[actionId] ?? bindingInputValue(actionId, keybindings)
    const normalized = normalizeKeybindingList(draft)
    if (!Array.isArray(normalized)) {
      setErrors((prev) => ({
        ...prev,
        [actionId]: normalized.ok ? 'Unable to parse shortcut.' : normalized.error
      }))
      return
    }

    const defaults = getEffectiveKeybindingsForAction(actionId, platform, {})
    const next =
      sameBindings(normalized, defaults) || (normalized.length === 0 && defaults.length === 0)
        ? removeBindingOverride(keybindings, actionId)
        : { ...keybindings, [actionId]: normalized }
    const blockingConflict = findKeybindingConflicts(platform, next).find((conflict) =>
      conflict.actionIds.includes(actionId)
    )
    if (blockingConflict) {
      const labels = blockingConflict.actionIds
        .filter((id) => id !== actionId)
        .map((id) => getKeybindingDefinition(id)?.title ?? id)
        .join(', ')
      setErrors((prev) => ({
        ...prev,
        [actionId]: `${formatKeybindingList([blockingConflict.binding], platform)} conflicts with ${labels}.`
      }))
      return
    }

    setErrors((prev) => ({ ...prev, [actionId]: undefined }))
    try {
      const matchesDefault =
        sameBindings(normalized, defaults) || (normalized.length === 0 && defaults.length === 0)
      await (matchesDefault && !hasCommonBindingOverride(keybindingSnapshot, actionId)
        ? resetKeybindingOverride(actionId)
        : setKeybindingOverride(actionId, normalized))
      setDrafts((prev) => ({ ...prev, [actionId]: normalized.join(', ') }))
    } catch (error) {
      setErrors((prev) => ({
        ...prev,
        [actionId]: error instanceof Error ? error.message : 'Failed to save shortcut.'
      }))
    }
  }

  const resetBinding = async (actionId: KeybindingActionId): Promise<void> => {
    setErrors((prev) => ({ ...prev, [actionId]: undefined }))
    setDrafts((prev) => ({ ...prev, [actionId]: undefined }))
    try {
      await (hasCommonBindingOverride(keybindingSnapshot, actionId)
        ? setKeybindingOverride(actionId, getEffectiveKeybindingsForAction(actionId, platform, {}))
        : resetKeybindingOverride(actionId))
    } catch (error) {
      setErrors((prev) => ({
        ...prev,
        [actionId]: error instanceof Error ? error.message : 'Failed to reset shortcut.'
      }))
    }
  }

  const disableBinding = async (actionId: KeybindingActionId): Promise<void> => {
    setErrors((prev) => ({ ...prev, [actionId]: undefined }))
    setDrafts((prev) => ({ ...prev, [actionId]: '' }))
    try {
      await disableKeybindingAction(actionId)
    } catch (error) {
      setErrors((prev) => ({
        ...prev,
        [actionId]: error instanceof Error ? error.message : 'Failed to disable shortcut.'
      }))
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Keyboard Shortcuts</h2>
          <p className="text-xs text-muted-foreground">
            Customize shortcuts visually or edit the file directly. Terminal-reserved app shortcuts
            pass through while a terminal is focused.
          </p>
        </div>

        <div className="space-y-3 rounded-md border border-border bg-card p-3 text-card-foreground shadow-xs">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-medium">Keybindings file</p>
              <p className="truncate font-mono text-xs text-muted-foreground">
                {keybindingSnapshot?.path ?? '~/.orca/keybindings.json'}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => void openKeybindingsFile()}
              >
                <FileText className="size-3" />
                Open File
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => void revealKeybindingsFile()}
              >
                <FolderOpen className="size-3" />
                Reveal
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => void reloadKeybindings()}
              >
                <RefreshCw className="size-3" />
                Reload
              </Button>
            </div>
          </div>
          {keybindingSnapshot?.diagnostics.length ? (
            <div className="space-y-1 border-t border-border/50 pt-2">
              {keybindingSnapshot.diagnostics.map((diagnostic, index) => (
                <p
                  key={`${diagnostic.section ?? 'root'}-${diagnostic.actionId ?? index}`}
                  className={
                    diagnostic.severity === 'error'
                      ? 'text-xs text-destructive'
                      : 'text-xs text-muted-foreground'
                  }
                >
                  {diagnostic.message}
                </p>
              ))}
            </div>
          ) : null}
        </div>

        <div className="grid gap-8">
          {groups
            .filter((group) => matchesSettingsSearch(searchQuery, groupEntries[group.title] ?? []))
            .map((group) => (
              <div key={group.title} className="space-y-3">
                <h3 className="border-b border-border/50 pb-2 text-sm font-medium text-muted-foreground">
                  {group.title}
                </h3>
                <div className="grid gap-2">
                  {group.items.map((item) => {
                    const effective = getEffectiveKeybindingsForAction(
                      item.id,
                      platform,
                      keybindings
                    )
                    const draft = drafts[item.id] ?? effective.join(', ')
                    const modified = hasOwnBindingOverride(keybindings, item.id)
                    const warnings = [
                      ...(conflictByAction.get(item.id) ?? []),
                      ...effective
                        .filter((binding) =>
                          actionShouldWarnForTerminalReservation(item.id, binding, platform)
                        )
                        .map(
                          (binding) =>
                            `${formatKeybindingList([binding], platform)} is reserved for terminal input when a terminal is focused.`
                        )
                    ]

                    return (
                      <SearchableSetting
                        key={item.id}
                        title={item.title}
                        description={`${group.title} shortcut`}
                        keywords={[...item.searchKeywords]}
                        className="grid grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] items-start gap-4 py-2"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm text-foreground">{item.title}</span>
                            {modified ? (
                              <Badge variant="outline" className="shrink-0 text-[11px]">
                                Modified
                              </Badge>
                            ) : null}
                          </div>
                          <BindingPreview bindings={effective} />
                          {errors[item.id] ? (
                            <p className="text-xs text-destructive">{errors[item.id]}</p>
                          ) : null}
                          {warnings.map((warning) => (
                            <p key={warning} className="text-xs text-muted-foreground">
                              {warning}
                            </p>
                          ))}
                        </div>

                        <div className="min-w-0 space-y-2">
                          <Input
                            value={draft}
                            placeholder="Ctrl+Shift+P"
                            aria-invalid={Boolean(errors[item.id])}
                            onChange={(event) => {
                              setDrafts((prev) => ({
                                ...prev,
                                [item.id]: event.target.value
                              }))
                              setErrors((prev) => ({ ...prev, [item.id]: undefined }))
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                void commitBinding(item.id)
                              }
                            }}
                            className="h-8 text-xs"
                          />
                          <div className="flex justify-end gap-1.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={() => void disableBinding(item.id)}
                            >
                              <X className="size-3" />
                              Disable
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={() => void resetBinding(item.id)}
                            >
                              <RotateCcw className="size-3" />
                              Reset
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              onClick={() => void commitBinding(item.id)}
                            >
                              <Save className="size-3" />
                              Save
                            </Button>
                          </div>
                        </div>
                      </SearchableSetting>
                    )
                  })}
                </div>
              </div>
            ))}
        </div>
      </section>
    </div>
  )
}
