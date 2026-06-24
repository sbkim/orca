import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCompatibleRuntimeStatusResponseIfNeeded } from '../runtime/runtime-compatibility-test-fixture'
import { clearRuntimeCompatibilityCacheForTests } from '../runtime/runtime-rpc-client'

const mockSpawn = vi.fn()
const mockKill = vi.fn()
const mockRuntimeEnvironmentCall = vi.fn()
const mockRuntimeEnvironmentTransportCall = vi.fn()
const mockRuntimeEnvironmentSubscribe = vi.fn()
const mockCreateTab = vi.fn()
const mockSetTabCustomTitle = vi.fn()
const mockUpdateTabPtyId = vi.fn()
const mockCloseTab = vi.fn()
const mockSetTabLayout = vi.fn()
const mockRegisterEagerPtyBuffer = vi.fn()
const mockSubscribeToPtyData = vi.fn()
const mockSubscribeToPtyExit = vi.fn()
const mockSubscribeToRuntimeTerminalData = vi.fn()

const SETUP: { runnerScriptPath: string; envVars: Record<string, string> } = {
  runnerScriptPath: '/tmp/orca-setup.sh',
  envVars: { ORCA_WORKTREE_PATH: '/repo/worktree' }
}

function getCompletionToken(command: string): string {
  const match = command.match(/ORCA_SETUP_DONE_[A-Za-z0-9]+/)
  if (!match) {
    throw new Error(`completion token missing from command: ${command}`)
  }
  return match[0]
}

function completeLocalSetup(code: number): void {
  const command = mockSpawn.mock.calls[0]?.[0]?.command
  const dataSidecar = mockSubscribeToPtyData.mock.calls[0]?.[1] as (chunk: string) => void
  dataSidecar(`${getCompletionToken(command)}:${code}\n`)
}

async function completeRuntimeSetup(code: number): Promise<void> {
  await vi.waitFor(() =>
    expect(
      mockRuntimeEnvironmentTransportCall.mock.calls.some(
        (call) => call[0]?.method === 'terminal.create'
      )
    ).toBe(true)
  )
  const createCall = mockRuntimeEnvironmentTransportCall.mock.calls.find(
    (call) => call[0]?.method === 'terminal.create'
  )
  const command = createCall?.[0]?.params?.command
  const dataSidecar = mockSubscribeToRuntimeTerminalData.mock.calls[0]?.[3] as (
    chunk: string
  ) => void
  dataSidecar(`${getCompletionToken(command)}:${code}\n`)
}

const state = {
  settings: { agentCmdOverrides: {}, activeRuntimeEnvironmentId: null as string | null },
  projects: [
    { id: 'repo-1', localWindowsRuntimePreference: { kind: 'inherit-global' as const } }
  ] as {
    id: string
    localWindowsRuntimePreference:
      | { kind: 'inherit-global' }
      | { kind: 'windows-host' }
      | { kind: 'wsl'; distro: string | null }
  }[],
  repos: [{ id: 'repo-1', connectionId: null as string | null, path: '/repo' }],
  worktreesByRepo: {
    'repo-1': [
      {
        id: 'wt-1',
        repoId: 'repo-1',
        projectId: 'repo-1',
        path: '/repo/worktree',
        displayName: 'main'
      }
    ]
  },
  allWorktrees: vi.fn(() => state.worktreesByRepo['repo-1'] ?? []),
  createTab: mockCreateTab,
  setTabCustomTitle: mockSetTabCustomTitle,
  updateTabPtyId: mockUpdateTabPtyId,
  closeTab: mockCloseTab,
  setTabLayout: mockSetTabLayout,
  clearTabPtyId: vi.fn()
}

vi.mock('@/store', () => ({
  useAppStore: { getState: () => state }
}))

vi.mock('@/lib/setup-runner', () => ({
  buildSetupRunnerCommand: (path: string) => `bash '${path}'`
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('@/components/terminal-pane/pty-dispatcher', () => ({
  registerEagerPtyBuffer: mockRegisterEagerPtyBuffer,
  subscribeToPtyExit: mockSubscribeToPtyExit
}))

vi.mock('@/components/terminal-pane/pty-data-sidecar-subscriptions', () => ({
  subscribeToPtyData: mockSubscribeToPtyData
}))

vi.mock('@/runtime/runtime-terminal-stream', () => ({
  subscribeToRuntimeTerminalData: mockSubscribeToRuntimeTerminalData,
  getRemoteRuntimeTerminalHandle: (ptyId: string) => {
    const handle = ptyId.startsWith('remote:') ? ptyId.split('@@')[1] : ''
    return handle || null
  },
  toRemoteRuntimePtyId: (handle: string, envId: string) => `remote:${envId}@@${handle}`
}))

describe('launchSetupBackgroundSession', () => {
  beforeEach(() => {
    clearRuntimeCompatibilityCacheForTests()
    vi.clearAllMocks()
    mockRuntimeEnvironmentTransportCall.mockImplementation(
      (args) =>
        createCompatibleRuntimeStatusResponseIfNeeded(args) ?? mockRuntimeEnvironmentCall(args)
    )
    state.settings = { agentCmdOverrides: {}, activeRuntimeEnvironmentId: null }
    state.projects = [{ id: 'repo-1', localWindowsRuntimePreference: { kind: 'inherit-global' } }]
    state.repos = [{ id: 'repo-1', connectionId: null, path: '/repo' }]
    state.worktreesByRepo = {
      'repo-1': [
        {
          id: 'wt-1',
          repoId: 'repo-1',
          projectId: 'repo-1',
          path: '/repo/worktree',
          displayName: 'main'
        }
      ]
    }
    mockCreateTab.mockReturnValue({ id: 'tab-setup', title: 'Setup' })
    mockSpawn.mockResolvedValue({ id: 'pty-setup' })
    mockKill.mockResolvedValue(undefined)
    mockRuntimeEnvironmentCall.mockResolvedValue({
      ok: true,
      result: { terminal: { handle: 'terminal-setup', worktreeId: 'wt-1', title: 'Setup' } }
    })
    mockRuntimeEnvironmentSubscribe.mockImplementation(async (_args, callbacks) => {
      queueMicrotask(() => callbacks.onResponse({ ok: true, result: { type: 'ready' } }))
      return { unsubscribe: vi.fn(), sendBinary: vi.fn() }
    })
    mockSubscribeToPtyData.mockReturnValue(vi.fn())
    mockSubscribeToPtyExit.mockReturnValue(vi.fn())
    mockSubscribeToRuntimeTerminalData.mockResolvedValue(vi.fn())
    vi.stubGlobal('window', {
      api: {
        pty: { spawn: mockSpawn, kill: mockKill },
        runtime: { call: vi.fn() },
        runtimeEnvironments: {
          call: mockRuntimeEnvironmentTransportCall,
          subscribe: mockRuntimeEnvironmentSubscribe
        }
      }
    })
  })

  it('returns null immediately when setup is undefined and creates no tab', async () => {
    const { launchSetupBackgroundSession } = await import('./launch-setup-background-session')

    const result = await launchSetupBackgroundSession({ worktreeId: 'wt-1', setup: undefined })

    expect(result).toBeNull()
    expect(mockCreateTab).not.toHaveBeenCalled()
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('creates an inactive Setup tab with recordInteraction: false and spawns with correct args', async () => {
    const { launchSetupBackgroundSession } = await import('./launch-setup-background-session')

    const promise = launchSetupBackgroundSession({ worktreeId: 'wt-1', setup: SETUP })

    await Promise.resolve() // flush spawn
    completeLocalSetup(0)

    const result = await promise

    expect(mockCreateTab).toHaveBeenCalledWith('wt-1', undefined, undefined, {
      activate: false,
      recordInteraction: false
    })
    expect(mockSetTabCustomTitle).toHaveBeenCalledWith('tab-setup', 'Setup', {
      recordInteraction: false
    })
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/repo/worktree',
        command: expect.stringContaining("bash '/tmp/orca-setup.sh'"),
        env: { ORCA_WORKTREE_PATH: '/repo/worktree' },
        connectionId: null,
        worktreeId: 'wt-1',
        tabId: 'tab-setup'
      })
    )
    expect(mockUpdateTabPtyId).toHaveBeenCalledWith('tab-setup', 'pty-setup')
    expect(mockRegisterEagerPtyBuffer).toHaveBeenCalledWith('pty-setup', expect.any(Function))
    expect(mockSubscribeToPtyData).toHaveBeenCalledWith('pty-setup', expect.any(Function))
    expect(mockSubscribeToPtyExit).toHaveBeenCalledWith('pty-setup', expect.any(Function))
    expect(result).toEqual({ tabId: 'tab-setup' })
  })

  it('passes setup envVars as env to spawn', async () => {
    const customSetup = {
      runnerScriptPath: '/tmp/setup.sh',
      envVars: { MY_VAR: 'hello', ANOTHER: 'world' }
    }
    const { launchSetupBackgroundSession } = await import('./launch-setup-background-session')

    const promise = launchSetupBackgroundSession({ worktreeId: 'wt-1', setup: customSetup })
    await Promise.resolve()
    completeLocalSetup(0)
    await promise

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.objectContaining({ env: { MY_VAR: 'hello', ANOTHER: 'world' } })
    )
  })

  it('uses the repo connectionId for SSH repos', async () => {
    state.repos = [{ id: 'repo-1', connectionId: 'ssh-conn-1', path: '/remote/repo' }]
    const { launchSetupBackgroundSession } = await import('./launch-setup-background-session')

    const promise = launchSetupBackgroundSession({ worktreeId: 'wt-1', setup: SETUP })
    await Promise.resolve()
    completeLocalSetup(0)
    await promise

    expect(mockSpawn).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'ssh-conn-1' }))
  })

  it('rejects and leaves the Setup tab available when exit code is nonzero', async () => {
    const { launchSetupBackgroundSession } = await import('./launch-setup-background-session')

    const promise = launchSetupBackgroundSession({ worktreeId: 'wt-1', setup: SETUP })
    await Promise.resolve()
    completeLocalSetup(1)

    await expect(promise).rejects.toThrow('Setup exited with code 1.')
    // Tab must NOT be closed — user should be able to inspect setup output.
    expect(mockCloseTab).not.toHaveBeenCalled()
  })

  it('clears the tab PTY id after exit', async () => {
    const { launchSetupBackgroundSession } = await import('./launch-setup-background-session')

    const promise = launchSetupBackgroundSession({ worktreeId: 'wt-1', setup: SETUP })
    await Promise.resolve()
    completeLocalSetup(0)
    await promise

    expect(state.clearTabPtyId).toHaveBeenCalledWith('tab-setup', 'pty-setup')
  })

  it('unsubscribes data and exit sidecars on successful exit', async () => {
    const unsubData = vi.fn()
    const unsubExit = vi.fn()
    mockSubscribeToPtyData.mockReturnValue(unsubData)
    mockSubscribeToPtyExit.mockReturnValue(unsubExit)
    const { launchSetupBackgroundSession } = await import('./launch-setup-background-session')

    const promise = launchSetupBackgroundSession({ worktreeId: 'wt-1', setup: SETUP })
    await Promise.resolve()
    completeLocalSetup(0)
    await promise

    expect(unsubData).toHaveBeenCalled()
    expect(unsubExit).toHaveBeenCalled()
  })

  it('unsubscribes data and exit sidecars on nonzero exit', async () => {
    const unsubData = vi.fn()
    const unsubExit = vi.fn()
    mockSubscribeToPtyData.mockReturnValue(unsubData)
    mockSubscribeToPtyExit.mockReturnValue(unsubExit)
    const { launchSetupBackgroundSession } = await import('./launch-setup-background-session')

    const promise = launchSetupBackgroundSession({ worktreeId: 'wt-1', setup: SETUP })
    await Promise.resolve()
    completeLocalSetup(2)
    await promise.catch(() => {})

    expect(unsubData).toHaveBeenCalled()
    expect(unsubExit).toHaveBeenCalled()
  })

  it('closes the setup tab and re-throws when spawn fails before PTY is attached', async () => {
    mockSpawn.mockRejectedValueOnce(new Error('pty spawn failed'))
    const { launchSetupBackgroundSession } = await import('./launch-setup-background-session')

    await expect(
      launchSetupBackgroundSession({ worktreeId: 'wt-1', setup: SETUP })
    ).rejects.toThrow('pty spawn failed')

    expect(mockCloseTab).toHaveBeenCalledWith('tab-setup', { recordInteraction: false })
    expect(mockUpdateTabPtyId).not.toHaveBeenCalled()
  })

  it('forwards PTY output chunks to the onData callback', async () => {
    const onData = vi.fn()
    const { launchSetupBackgroundSession } = await import('./launch-setup-background-session')

    const promise = launchSetupBackgroundSession({ worktreeId: 'wt-1', setup: SETUP, onData })
    await Promise.resolve()

    const dataSidecar = mockSubscribeToPtyData.mock.calls[0]?.[1] as (chunk: string) => void
    dataSidecar('hello from setup\n')

    completeLocalSetup(0)
    await promise

    expect(onData).toHaveBeenCalledWith('hello from setup\n')
  })

  it('times out local setup and kills the PTY while keeping history', async () => {
    vi.useFakeTimers()
    try {
      const { launchSetupBackgroundSession } = await import('./launch-setup-background-session')

      const promise = launchSetupBackgroundSession({ worktreeId: 'wt-1', setup: SETUP })
      await Promise.resolve()
      const rejected = expect(promise).rejects.toThrow('Setup timed out after 60 minutes.')
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

      await rejected
      expect(mockKill).toHaveBeenCalledWith('pty-setup', { keepHistory: true })
      expect(state.clearTabPtyId).toHaveBeenCalledWith('tab-setup', 'pty-setup')
    } finally {
      vi.useRealTimers()
    }
  })

  it('throws when the worktree is not found', async () => {
    state.allWorktrees.mockReturnValueOnce([])
    const { launchSetupBackgroundSession } = await import('./launch-setup-background-session')

    await expect(
      launchSetupBackgroundSession({ worktreeId: 'wt-missing', setup: SETUP })
    ).rejects.toThrow('no longer available')
  })

  it('routes runtime-environment worktrees through terminal.create and waits for setup completion', async () => {
    state.settings = { agentCmdOverrides: {}, activeRuntimeEnvironmentId: 'env-1' }
    const unsubData = vi.fn()
    mockSubscribeToRuntimeTerminalData.mockResolvedValue(unsubData)

    mockRuntimeEnvironmentTransportCall.mockImplementation(async (args) => {
      const compatResp = createCompatibleRuntimeStatusResponseIfNeeded(args)
      if (compatResp) {
        return compatResp
      }
      if (args.method === 'terminal.create') {
        return {
          ok: true,
          result: { terminal: { handle: 'terminal-setup', worktreeId: 'wt-1', title: 'Setup' } }
        }
      }
      return { ok: true, result: {} }
    })

    const { launchSetupBackgroundSession } = await import('./launch-setup-background-session')

    const promise = launchSetupBackgroundSession({ worktreeId: 'wt-1', setup: SETUP })
    await Promise.resolve()
    await completeRuntimeSetup(0)
    const result = await promise

    expect(mockSpawn).not.toHaveBeenCalled()
    const createCall = mockRuntimeEnvironmentTransportCall.mock.calls.find(
      (c) => c[0]?.method === 'terminal.create'
    )
    expect(createCall?.[0]).toMatchObject({
      method: 'terminal.create',
      params: expect.objectContaining({
        command: expect.stringContaining("bash '/tmp/orca-setup.sh'"),
        env: { ORCA_WORKTREE_PATH: '/repo/worktree' },
        title: 'Setup',
        tabId: 'tab-setup'
      })
    })
    expect(mockSubscribeToRuntimeTerminalData).toHaveBeenCalledWith(
      expect.anything(),
      'remote:env-1@@terminal-setup',
      'desktop:setup:tab-setup',
      expect.any(Function)
    )
    expect(unsubData).toHaveBeenCalled()
    expect(result).toEqual({ tabId: 'tab-setup' })
  })

  it('unsubscribes runtime data when runtime setup exits nonzero', async () => {
    state.settings = { agentCmdOverrides: {}, activeRuntimeEnvironmentId: 'env-1' }
    const unsubData = vi.fn()
    mockSubscribeToRuntimeTerminalData.mockResolvedValue(unsubData)
    mockRuntimeEnvironmentTransportCall.mockImplementation(async (args) => {
      const compatResp = createCompatibleRuntimeStatusResponseIfNeeded(args)
      if (compatResp) {
        return compatResp
      }
      if (args.method === 'terminal.create') {
        return {
          ok: true,
          result: { terminal: { handle: 'terminal-setup', worktreeId: 'wt-1', title: 'Setup' } }
        }
      }
      if (args.method === 'terminal.wait') {
        return { ok: true, result: { wait: { exitCode: 1 } } }
      }
      return { ok: true, result: {} }
    })
    const { launchSetupBackgroundSession } = await import('./launch-setup-background-session')

    const promise = launchSetupBackgroundSession({ worktreeId: 'wt-1', setup: SETUP })
    await Promise.resolve()
    await completeRuntimeSetup(1)

    await expect(promise).rejects.toThrow('Setup exited with code 1.')

    expect(unsubData).toHaveBeenCalled()
  })

  it('times out runtime setup and closes the runtime terminal', async () => {
    vi.useFakeTimers()
    state.settings = { agentCmdOverrides: {}, activeRuntimeEnvironmentId: 'env-1' }
    const unsubData = vi.fn()
    mockSubscribeToRuntimeTerminalData.mockResolvedValue(unsubData)
    mockRuntimeEnvironmentTransportCall.mockImplementation(async (args) => {
      const compatResp = createCompatibleRuntimeStatusResponseIfNeeded(args)
      if (compatResp) {
        return compatResp
      }
      if (args.method === 'terminal.create') {
        return {
          ok: true,
          result: { terminal: { handle: 'terminal-setup', worktreeId: 'wt-1', title: 'Setup' } }
        }
      }
      if (args.method === 'terminal.close') {
        return { ok: true, result: { close: { closed: true } } }
      }
      return { ok: true, result: {} }
    })
    try {
      const { launchSetupBackgroundSession } = await import('./launch-setup-background-session')

      const promise = launchSetupBackgroundSession({ worktreeId: 'wt-1', setup: SETUP })
      await Promise.resolve()
      const rejected = expect(promise).rejects.toThrow('Setup timed out after 60 minutes.')
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

      await rejected
      expect(unsubData).toHaveBeenCalled()
      expect(
        mockRuntimeEnvironmentTransportCall.mock.calls.some(
          (call) =>
            call[0]?.method === 'terminal.close' && call[0]?.params?.terminal === 'terminal-setup'
        )
      ).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cleans up when runtime terminal handle cannot be adopted', async () => {
    state.settings = { agentCmdOverrides: {}, activeRuntimeEnvironmentId: 'env-1' }
    mockRuntimeEnvironmentTransportCall.mockImplementation(async (args) => {
      const compatResp = createCompatibleRuntimeStatusResponseIfNeeded(args)
      if (compatResp) {
        return compatResp
      }
      if (args.method === 'terminal.create') {
        return {
          ok: true,
          result: { terminal: { handle: '', worktreeId: 'wt-1', title: 'Setup' } }
        }
      }
      if (args.method === 'terminal.close') {
        return { ok: true, result: { close: { closed: true } } }
      }
      return { ok: true, result: {} }
    })
    const { launchSetupBackgroundSession } = await import('./launch-setup-background-session')

    await expect(
      launchSetupBackgroundSession({ worktreeId: 'wt-1', setup: SETUP })
    ).rejects.toThrow('Runtime terminal id is invalid.')

    expect(state.clearTabPtyId).toHaveBeenCalledWith('tab-setup', 'remote:env-1@@')
    expect(mockCloseTab).toHaveBeenCalledWith('tab-setup', { recordInteraction: false })
  })

  it('cleans up when runtime data subscription fails', async () => {
    state.settings = { agentCmdOverrides: {}, activeRuntimeEnvironmentId: 'env-1' }
    mockSubscribeToRuntimeTerminalData.mockRejectedValueOnce(new Error('subscribe failed'))
    mockRuntimeEnvironmentTransportCall.mockImplementation(async (args) => {
      const compatResp = createCompatibleRuntimeStatusResponseIfNeeded(args)
      if (compatResp) {
        return compatResp
      }
      if (args.method === 'terminal.create') {
        return {
          ok: true,
          result: { terminal: { handle: 'terminal-setup', worktreeId: 'wt-1', title: 'Setup' } }
        }
      }
      if (args.method === 'terminal.close') {
        return { ok: true, result: { close: { closed: true } } }
      }
      return { ok: true, result: {} }
    })
    const { launchSetupBackgroundSession } = await import('./launch-setup-background-session')

    await expect(
      launchSetupBackgroundSession({ worktreeId: 'wt-1', setup: SETUP })
    ).rejects.toThrow('subscribe failed')

    expect(state.clearTabPtyId).toHaveBeenCalledWith('tab-setup', 'remote:env-1@@terminal-setup')
    expect(mockCloseTab).toHaveBeenCalledWith('tab-setup', { recordInteraction: false })
  })
})
