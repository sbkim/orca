import type { Repo, Worktree } from '../../../../shared/types'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree-id'
import type { LoadedMcpConfigInspection } from './McpConfigFileRow'

export const EMPTY_MCP_WORKTREES: Worktree[] = []

export function isMissingMcpConfigFileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /ENOENT|no such file|not found/i.test(message)
}

export function countMcpConfigServers(configs: LoadedMcpConfigInspection[]): number {
  return configs.reduce((sum, config) => sum + config.servers.length, 0)
}

export function selectMcpTargetWorktree(
  repo: Repo,
  worktreesForRepo: readonly Worktree[],
  activeWorktreeId: string | null
): Pick<Worktree, 'id' | 'path'> {
  if (activeWorktreeId && getRepoIdFromWorktreeId(activeWorktreeId) === repo.id) {
    return (
      worktreesForRepo.find((worktree) => worktree.id === activeWorktreeId) ?? {
        id: activeWorktreeId,
        path: repo.path
      }
    )
  }
  return (
    worktreesForRepo.find((worktree) => worktree.isMainWorktree) ??
    worktreesForRepo.find((worktree) => worktree.path === repo.path) ??
    worktreesForRepo[0] ?? { id: `${repo.id}::${repo.path}`, path: repo.path }
  )
}
