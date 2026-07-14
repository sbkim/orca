import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { useWorktreesForRepo } from '@/store/selectors'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { cancelRuntimeFileList } from '@/runtime/runtime-file-client'
import { getNestedWorktreeExcludePaths } from '@/components/quick-open-file-list'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree-id'
import {
  buildPackageManagerRunCommand,
  type PackageJsonScript
} from '../../../../shared/package-json-scripts'
import {
  scanWorktreePackageScripts,
  type WorktreePackageJsonProject
} from './worktree-package-script-scan'

export type WorktreePackageScripts = {
  packages: WorktreePackageJsonProject[]
  scriptCount: number
  runCommandFor: (project: WorktreePackageJsonProject, script: PackageJsonScript) => string
  /** Re-scan package.json files when the picker opens to catch on-disk edits. */
  refresh: () => void
}

type LoadedPackageScripts = {
  requestKey: string
  packages: WorktreePackageJsonProject[]
}

export function useWorktreePackageScripts(worktreeId: string): WorktreePackageScripts | null {
  const worktree = useAppStore((state) => state.getKnownWorktreeById(worktreeId) ?? null)
  const worktreePath = worktree?.path ?? null
  const repoId = worktree?.repoId ?? getRepoIdFromWorktreeId(worktreeId)
  const connectionId = useAppStore(
    (state) => state.repos.find((repo) => repo.id === repoId)?.connectionId
  )
  const runtimeEnvironmentId = useAppStore((state) =>
    getRuntimeEnvironmentIdForWorktree(state, worktreeId)
  )
  const repoWorktrees = useWorktreesForRepo(repoId)
  const excludePaths = useMemo(
    () =>
      worktreePath ? getNestedWorktreeExcludePaths(worktreeId, worktreePath, repoWorktrees) : [],
    [repoWorktrees, worktreeId, worktreePath]
  )
  const excludeKey = JSON.stringify(excludePaths)
  const [loaded, setLoaded] = useState<LoadedPackageScripts | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const requestIdRef = useRef(0)
  const requestKey = `${worktreeId}\0${worktreePath ?? ''}\0${connectionId ?? ''}\0${runtimeEnvironmentId ?? ''}\0${excludeKey}`

  useEffect(() => {
    if (!worktreePath) {
      return
    }
    const requestId = ++requestIdRef.current
    const requestToken = createBrowserUuid()
    let cancelled = false
    const context = {
      settings: { activeRuntimeEnvironmentId: runtimeEnvironmentId },
      worktreeId,
      worktreePath,
      connectionId: connectionId ?? undefined
    }

    void scanWorktreePackageScripts({
      context,
      excludePaths: excludePaths.length > 0 ? excludePaths : undefined,
      requestToken
    })
      .then((packages) => {
        if (!cancelled && requestId === requestIdRef.current) {
          setLoaded({ requestKey, packages })
        }
      })
      .catch(() => {
        if (!cancelled && requestId === requestIdRef.current) {
          setLoaded({ requestKey, packages: [] })
        }
      })

    return () => {
      cancelled = true
      cancelRuntimeFileList(context, requestToken)
    }
  }, [
    connectionId,
    excludePaths,
    reloadToken,
    requestKey,
    runtimeEnvironmentId,
    worktreeId,
    worktreePath
  ])

  const refresh = useCallback(() => setReloadToken((token) => token + 1), [])

  return useMemo(() => {
    if (!loaded || loaded.requestKey !== requestKey || loaded.packages.length === 0) {
      return null
    }
    return {
      packages: loaded.packages,
      scriptCount: loaded.packages.reduce((count, project) => count + project.scripts.length, 0),
      runCommandFor: (project, script) =>
        buildPackageManagerRunCommand(project.packageManager, script.name),
      refresh
    }
  }, [loaded, refresh, requestKey])
}
