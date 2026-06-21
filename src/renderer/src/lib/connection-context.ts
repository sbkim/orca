import { useAppStore } from '@/store'
import { getRepoIdFromWorktreeId } from '../../../shared/worktree-id'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'
import { isPathInsideOrEqual } from '../../../shared/cross-platform-path'
import {
  getFolderWorkspaceCandidateRepos,
  getFolderWorkspaceConnectionId
} from './folder-workspace-connection'

/**
 * Resolve the SSH connectionId for a worktree. Returns null for local repos,
 * the target ID string for remote repos, or undefined if the worktree/repo
 * cannot be found (e.g., store not yet hydrated).
 */
export function getConnectionId(worktreeId: string | null): string | null | undefined {
  if (!worktreeId) {
    return null
  }
  const parsedWorkspaceKey = parseWorkspaceKey(worktreeId)
  if (parsedWorkspaceKey?.type === 'folder') {
    return getFolderWorkspaceConnectionId(
      useAppStore.getState(),
      parsedWorkspaceKey.folderWorkspaceId
    )
  }
  const state = useAppStore.getState()
  const allWorktrees = Object.values(state.worktreesByRepo ?? {}).flat()
  const worktree = allWorktrees.find((w) => w.id === worktreeId)
  // Why: SSH worktrees can be restored from session IDs before relay discovery
  // repopulates worktreesByRepo. The composite ID still carries the repo ID.
  const repoId = worktree?.repoId ?? getRepoIdFromWorktreeId(worktreeId)
  const repo = state.repos?.find((r) => r.id === repoId)
  if (!repo) {
    return undefined
  }
  return repo.connectionId ?? null
}

export function getConnectionIdForFile(
  worktreeId: string | null,
  filePath: string
): string | null | undefined {
  const connectionId = getConnectionId(worktreeId)
  if (connectionId !== undefined || !worktreeId) {
    return connectionId
  }
  const parsedWorkspaceKey = parseWorkspaceKey(worktreeId)
  if (parsedWorkspaceKey?.type !== 'folder') {
    return undefined
  }
  // Why: mixed local/SSH folder workspaces cannot pick one owner globally, but
  // a concrete file path can still belong unambiguously to a child repo.
  const state = useAppStore.getState()
  const candidateRepos = getFolderWorkspaceCandidateRepos(
    state,
    parsedWorkspaceKey.folderWorkspaceId
  )
  return resolveConnectionIdForRepoPath(candidateRepos, filePath)
}

function resolveConnectionIdForRepoPath(
  repos: readonly { path: string; connectionId?: string | null }[],
  filePath: string
): string | null | undefined {
  const matchingRepos = repos
    .filter((repo) => isPathInsideOrEqual(repo.path, filePath))
    .sort((a, b) => b.path.length - a.path.length)
  const longestPath = matchingRepos[0]?.path
  if (!longestPath) {
    return undefined
  }
  const bestMatches = matchingRepos.filter((repo) => repo.path.length === longestPath.length)
  const connectionIds = new Set(bestMatches.map((repo) => repo.connectionId ?? null))
  return connectionIds.size === 1 ? ([...connectionIds][0] ?? null) : undefined
}
