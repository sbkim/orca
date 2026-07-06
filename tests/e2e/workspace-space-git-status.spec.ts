import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'

test.describe('Workspace Space git status checks', () => {
  test('checks every scanned deletable row, including rows after the first 50', async ({
    orcaPage,
    testRepoPath
  }) => {
    const worktreeParent = mkdtempSync(path.join(os.tmpdir(), 'orca-space-git-status-'))
    const worktreePaths = Array.from({ length: 60 }, (_, index) =>
      path.join(worktreeParent, `worktree-${index}`)
    )

    try {
      for (const worktreePath of worktreePaths) {
        execFileSync('git', ['worktree', 'add', '--detach', worktreePath, 'HEAD'], {
          cwd: testRepoPath,
          stdio: 'pipe'
        })
      }
      await orcaPage.evaluate(
        async ({ testRepoPath, worktreeParent, expectedCount }) => {
          const store = window.__store
          if (!store) {
            throw new Error('Expected e2e store to be exposed')
          }

          const repo = store.getState().repos.find((item) => item.path === testRepoPath)
          if (!repo) {
            throw new Error('Expected test repo to be loaded')
          }

          // Why: worktrees are created via raw `git worktree add`, which git
          // records with the path as given (not symlink-canonicalized), so
          // match against the git-reported store paths rather than realpathSync'd
          // ones — otherwise on macOS the /var vs /private/var mismatch makes
          // git:status reject the probe as an unregistered path. Also poll:
          // fetchWorktrees serves a 5s scan cache that raw adds don't invalidate.
          const normalizeMacTmpPath = (value: string): string =>
            value.startsWith('/private/var/') ? value.slice('/private'.length) : value
          const parentKey = normalizeMacTmpPath(worktreeParent)
          const deadline = Date.now() + 20_000
          const findCreatedWorktrees = () =>
            (store.getState().worktreesByRepo[repo.id] ?? []).filter((worktree) =>
              normalizeMacTmpPath(worktree.path).startsWith(`${parentKey}/`)
            )
          await store.getState().fetchWorktrees(repo.id)
          let worktrees = findCreatedWorktrees()
          while (worktrees.length < expectedCount && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 250))
            await store.getState().fetchWorktrees(repo.id)
            worktrees = findCreatedWorktrees()
          }
          if (worktrees.length !== expectedCount) {
            throw new Error(
              `Expected ${expectedCount} registered worktrees, got ${
                worktrees.length
              } from ${(store.getState().worktreesByRepo[repo.id] ?? []).length}: ${(
                store.getState().worktreesByRepo[repo.id] ?? []
              )
                .slice(0, 5)
                .map((worktree) => worktree.path)
                .join(', ')}`
            )
          }
          // Probe with a git-reported store path (a registered worktree root).
          await window.api.git.status({ worktreePath: worktrees[0].path })

          const rows = worktrees.map((worktree, index) => ({
            worktreeId: worktree.id,
            repoId: repo.id,
            repoDisplayName: repo.displayName,
            repoPath: testRepoPath,
            displayName: worktree.displayName,
            path: worktree.path,
            branch: worktree.branch,
            isMainWorktree: false,
            isRemote: false,
            isSparse: worktree.isSparse,
            canDelete: true,
            lastActivityAt: worktree.lastActivityAt,
            status: 'ok' as const,
            error: null,
            scannedAt: Date.now(),
            sizeBytes: 1000 + index,
            reclaimableBytes: 1000 + index,
            skippedEntryCount: 0,
            topLevelItems: [],
            omittedTopLevelItemCount: 0,
            omittedTopLevelSizeBytes: 0
          }))

          store.setState({
            gitStatusByWorktree: {},
            workspaceSpaceAnalysis: {
              scannedAt: Date.now(),
              totalSizeBytes: rows.reduce((sum, row) => sum + row.sizeBytes, 0),
              reclaimableBytes: rows.reduce((sum, row) => sum + row.reclaimableBytes, 0),
              worktreeCount: rows.length,
              scannedWorktreeCount: rows.length,
              unavailableWorktreeCount: 0,
              repos: [
                {
                  repoId: repo.id,
                  displayName: repo.displayName,
                  path: repo.path,
                  isRemote: false,
                  worktreeCount: rows.length,
                  scannedWorktreeCount: rows.length,
                  unavailableWorktreeCount: 0,
                  totalSizeBytes: rows.reduce((sum, row) => sum + row.sizeBytes, 0),
                  reclaimableBytes: rows.reduce((sum, row) => sum + row.reclaimableBytes, 0),
                  error: null
                }
              ],
              worktrees: rows
            }
          })
          store.getState().openSpacePage()
        },
        { testRepoPath, worktreeParent, expectedCount: worktreePaths.length }
      )

      await expect
        .poll(
          () =>
            orcaPage.evaluate(() => {
              const state = window.__store?.getState()
              if (!state?.workspaceSpaceAnalysis) {
                return 60
              }
              return state.workspaceSpaceAnalysis.worktrees.filter(
                (row) => state.gitStatusByWorktree[row.worktreeId] === undefined
              ).length
            }),
          { timeout: 30_000 }
        )
        .toBe(0)

      await expect(orcaPage.getByText('Keep: git not checked')).toHaveCount(0)
    } finally {
      for (const worktreePath of worktreePaths) {
        try {
          execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
            cwd: testRepoPath,
            stdio: 'pipe'
          })
        } catch {
          // Best effort cleanup; the fixture removes the source repo after the test.
        }
      }
      rmSync(worktreeParent, { recursive: true, force: true })
    }
  })
})
