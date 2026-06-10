export type ComposerBranchSelection = {
  baseBranch: string
  branchNameOverride: string | undefined
  branchAutoName: string
  name: string | undefined
  lastAutoName: string | undefined
}

export function resolveComposerBranchSelection(args: {
  refName: string
  localBranchName: string
  currentName: string
  lastAutoName: string
}): ComposerBranchSelection {
  const trimmedCurrentName = args.currentName.trim()
  const shouldAutoName =
    !trimmedCurrentName ||
    args.currentName === args.lastAutoName ||
    args.localBranchName.startsWith(trimmedCurrentName) ||
    args.refName.startsWith(trimmedCurrentName)
  if (!shouldAutoName) {
    return {
      baseBranch: args.refName,
      branchNameOverride: undefined,
      branchAutoName: '',
      name: undefined,
      lastAutoName: undefined
    }
  }
  return {
    baseBranch: args.refName,
    branchNameOverride: args.localBranchName,
    branchAutoName: args.localBranchName,
    name: args.localBranchName,
    lastAutoName: args.localBranchName
  }
}

/**
 * Base branch passed to createWorktree on submit. The initial-commit retry
 * supplies an explicit override - React state set during the recovery action
 * is not visible to the in-flight submit closure, and re-probing the default
 * would miss custom default-branch names.
 */
export function resolveComposerSubmitBaseBranch(args: {
  selectedRepoIsGit: boolean
  baseBranch: string | undefined
  baseBranchOverride: string | undefined
}): string | undefined {
  if (!args.selectedRepoIsGit) {
    return undefined
  }
  return args.baseBranchOverride ?? args.baseBranch
}

export function resolveComposerBranchNameOverrideForCreate(args: {
  branchNameOverride: string | undefined
  branchAutoName: string
  workspaceName: string
  preserveWorkspaceNameEdits: boolean
}): string | undefined {
  if (!args.branchNameOverride) {
    return undefined
  }
  if (args.preserveWorkspaceNameEdits) {
    return args.branchNameOverride
  }
  return args.workspaceName === args.branchAutoName ? args.branchNameOverride : undefined
}
