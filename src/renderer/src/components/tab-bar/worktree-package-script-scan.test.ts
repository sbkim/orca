import { beforeEach, describe, expect, it, vi } from 'vitest'
import { scanWorktreePackageScripts } from './worktree-package-script-scan'

const mocks = vi.hoisted(() => ({
  listRuntimeFiles: vi.fn(),
  readRuntimeFileContent: vi.fn()
}))

vi.mock('@/runtime/runtime-file-client', () => ({
  listRuntimeFiles: mocks.listRuntimeFiles,
  readRuntimeFileContent: mocks.readRuntimeFileContent
}))

describe('scanWorktreePackageScripts', () => {
  beforeEach(() => {
    mocks.listRuntimeFiles.mockReset()
    mocks.readRuntimeFileContent.mockReset()
  })

  it('reads discovered packages and assigns each package its execution directory', async () => {
    mocks.listRuntimeFiles.mockResolvedValue([
      'package.json',
      'pnpm-lock.yaml',
      'packages/web/package.json',
      'node_modules/dep/package.json'
    ])
    mocks.readRuntimeFileContent.mockImplementation(
      ({ relativePath }: { relativePath: string }) => {
        const packageJson =
          relativePath === 'package.json'
            ? { name: 'root', packageManager: 'pnpm@9', scripts: { lint: 'eslint .' } }
            : { name: '@acme/web', scripts: { dev: 'vite' } }
        return Promise.resolve({ content: JSON.stringify(packageJson), isBinary: false })
      }
    )

    const result = await scanWorktreePackageScripts({
      context: {
        settings: { activeRuntimeEnvironmentId: null },
        worktreeId: 'repo::worktree',
        worktreePath: '/repo',
        connectionId: 'ssh-1'
      },
      excludePaths: ['/repo/linked-worktree'],
      requestToken: 'request-1'
    })

    expect(mocks.listRuntimeFiles).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: 'repo::worktree', connectionId: 'ssh-1' }),
      {
        rootPath: '/repo',
        excludePaths: ['/repo/linked-worktree'],
        requestToken: 'request-1'
      }
    )
    expect(mocks.readRuntimeFileContent).toHaveBeenCalledTimes(2)
    expect(result).toEqual([
      expect.objectContaining({
        packageName: 'root',
        packageManager: 'pnpm',
        relativeDirectory: '',
        directoryPath: '/repo'
      }),
      expect.objectContaining({
        packageName: '@acme/web',
        packageManager: 'pnpm',
        relativeDirectory: 'packages/web',
        directoryPath: '/repo/packages/web'
      })
    ])
  })

  it('keeps readable packages when another package disappears during the scan', async () => {
    mocks.listRuntimeFiles.mockResolvedValue(['package.json', 'packages/gone/package.json'])
    mocks.readRuntimeFileContent.mockImplementation(({ relativePath }: { relativePath: string }) =>
      relativePath === 'package.json'
        ? Promise.resolve({
            content: JSON.stringify({ scripts: { test: 'vitest' } }),
            isBinary: false
          })
        : Promise.reject(new Error('ENOENT'))
    )

    const result = await scanWorktreePackageScripts({
      context: {
        settings: { activeRuntimeEnvironmentId: null },
        worktreeId: 'repo::worktree',
        worktreePath: 'C:\\repo'
      },
      requestToken: 'request-2'
    })

    expect(result).toEqual([
      expect.objectContaining({
        relativeDirectory: '',
        directoryPath: 'C:\\repo',
        scripts: [{ name: 'test', command: 'vitest' }]
      })
    ])
  })
})
