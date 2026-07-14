import { joinPath } from '@/lib/path'
import {
  readRuntimeFileContent,
  listRuntimeFiles,
  type RuntimeFileOperationArgs
} from '@/runtime/runtime-file-client'
import {
  buildPackageJsonProjects,
  getRunnablePackageJsonPaths,
  type PackageJsonProject
} from '../../../../shared/package-json-projects'

export type WorktreePackageJsonProject = PackageJsonProject & {
  directoryPath: string
}

type ScanWorktreePackageScriptsArgs = {
  context: RuntimeFileOperationArgs
  excludePaths?: string[]
  requestToken: string
}

const PACKAGE_READ_CONCURRENCY = 6

async function readPackageJsonFiles(
  context: RuntimeFileOperationArgs,
  relativePaths: readonly string[]
): Promise<{ relativePath: string; content: string }[]> {
  const results: ({ relativePath: string; content: string } | null)[] = Array.from(
    { length: relativePaths.length },
    () => null
  )
  let cursor = 0

  const readNext = async (): Promise<void> => {
    while (cursor < relativePaths.length) {
      const index = cursor++
      const relativePath = relativePaths[index]
      try {
        const result = await readRuntimeFileContent({
          settings: context.settings,
          filePath: joinPath(context.worktreePath ?? '', relativePath),
          relativePath,
          worktreeId: context.worktreeId ?? undefined,
          connectionId: context.connectionId
        })
        if (!result.isBinary) {
          results[index] = { relativePath, content: result.content }
        }
      } catch {
        // Why: one deleted or unreadable package should not hide runnable
        // scripts from the rest of the workspace, especially over SSH.
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(PACKAGE_READ_CONCURRENCY, relativePaths.length) }, readNext)
  )
  return results.filter((result): result is { relativePath: string; content: string } => !!result)
}

export async function scanWorktreePackageScripts({
  context,
  excludePaths,
  requestToken
}: ScanWorktreePackageScriptsArgs): Promise<WorktreePackageJsonProject[]> {
  if (!context.worktreePath) {
    return []
  }
  const filePaths = await listRuntimeFiles(context, {
    rootPath: context.worktreePath,
    excludePaths,
    requestToken
  })
  const packageJsonPaths = getRunnablePackageJsonPaths(filePaths)
  const packageJsonFiles = await readPackageJsonFiles(context, packageJsonPaths)

  return buildPackageJsonProjects(packageJsonFiles, filePaths).map((project) => ({
    ...project,
    directoryPath: project.relativeDirectory
      ? joinPath(context.worktreePath ?? '', project.relativeDirectory)
      : (context.worktreePath ?? '')
  }))
}
