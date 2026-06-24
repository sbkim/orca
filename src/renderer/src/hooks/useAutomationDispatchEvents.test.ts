import type * as ReactModule from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLaunchAgentBackgroundSession = vi.fn()
const mockLaunchSetupBackgroundSession = vi.fn()
const mockSubmitPromptToAgentTab = vi.fn()
const mockFindReusableAutomationSession = vi.fn()
const mockObserveExistingAutomationSession = vi.fn()
const mockCreateWorktree = vi.fn()
const mockMarkDispatchResult = vi.fn()
const mockOnDispatchRequested = vi.fn()
const mockRendererReady = vi.fn()

const setupLaunch = {
  runnerScriptPath: '/tmp/setup.sh',
  envVars: { ORCA_WORKTREE_PATH: '/repo/worktree' }
}

const createdWorktree = {
  id: 'wt-created',
  repoId: 'repo-1',
  displayName: 'Automation worktree',
  path: '/repo/worktree'
}

const state = {
  activeView: 'terminal' as const,
  activeWorktreeId: 'wt-active',
  activeTabId: 'tab-active',
  activeTabType: 'terminal' as const,
  repos: [{ id: 'repo-1', connectionId: null }],
  agentStatusByPaneKey: {},
  allWorktrees: vi.fn(() => []),
  createWorktree: mockCreateWorktree,
  subscribe: vi.fn(() => () => {}),
  setActiveView: vi.fn(),
  setActiveWorktree: vi.fn(),
  setActiveTab: vi.fn(),
  setActiveTabType: vi.fn()
}

function makeAutomation() {
  return {
    id: 'automation-1',
    projectId: 'repo-1',
    prompt: 'run this',
    precheck: null,
    agentId: 'claude',
    workspaceMode: 'new_per_run',
    workspaceId: null,
    baseBranch: null,
    reuseSession: false
  }
}

function makeRun() {
  return {
    id: 'run-1',
    automationId: 'automation-1',
    title: 'Nightly setup run',
    scheduledFor: Date.parse('2026-06-24T03:00:00Z'),
    trigger: 'scheduled',
    workspaceId: null,
    workspaceDisplayName: null
  }
}

async function registerAndDispatch(): Promise<void> {
  vi.doMock('react', async () => {
    const actual = await vi.importActual<typeof ReactModule>('react')
    return {
      ...actual,
      useEffect: (effect: () => void | (() => void)) => {
        effect()
      }
    }
  })
  const { useAutomationDispatchEvents: registerAutomationDispatchEvents } =
    await import('./useAutomationDispatchEvents')
  registerAutomationDispatchEvents()
  const handler = mockOnDispatchRequested.mock.calls[0]?.[0]
  if (!handler) {
    throw new Error('dispatch handler was not registered')
  }
  await handler({
    automation: makeAutomation(),
    run: makeRun(),
    dispatchToken: 'dispatch-token'
  })
}

vi.mock('@/lib/launch-agent-background-session', () => ({
  launchAgentBackgroundSession: mockLaunchAgentBackgroundSession
}))

vi.mock('@/lib/launch-setup-background-session', () => ({
  launchSetupBackgroundSession: mockLaunchSetupBackgroundSession
}))

vi.mock('@/lib/agent-paste-draft', () => ({
  submitPromptToAgentTab: mockSubmitPromptToAgentTab
}))

vi.mock('@/lib/automation-session-reuse', () => ({
  findReusableAutomationSession: mockFindReusableAutomationSession
}))

vi.mock('@/lib/automation-session-observer', () => ({
  observeExistingAutomationSession: mockObserveExistingAutomationSession
}))

vi.mock('@/components/automations/automation-run-output-snapshot', () => ({
  createAutomationRunOutputSnapshotBuffer: () => ({
    append: vi.fn(),
    snapshot: () => ''
  }),
  selectAutomationRunOutputSnapshot: () => null
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('@/lib/browser-uuid', () => ({
  createBrowserUuid: () => 'create-request-id'
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => state,
    subscribe: vi.fn(() => () => {})
  }
}))

describe('useAutomationDispatchEvents setup launch', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    state.activeView = 'terminal'
    state.activeWorktreeId = 'wt-active'
    state.activeTabId = 'tab-active'
    state.activeTabType = 'terminal'
    state.repos = [{ id: 'repo-1', connectionId: null }]
    state.agentStatusByPaneKey = {}
    state.allWorktrees.mockReturnValue([])
    mockCreateWorktree.mockResolvedValue({ worktree: createdWorktree, setup: setupLaunch })
    mockLaunchSetupBackgroundSession.mockResolvedValue({ tabId: 'setup-tab' })
    mockLaunchAgentBackgroundSession.mockResolvedValue({
      tabId: 'agent-tab',
      ptyId: 'agent-pty',
      startupPlan: {}
    })
    mockOnDispatchRequested.mockReturnValue(() => {})
    vi.stubGlobal('window', {
      api: {
        automations: {
          onDispatchRequested: mockOnDispatchRequested,
          rendererReady: mockRendererReady,
          markDispatchResult: mockMarkDispatchResult,
          runPrecheck: vi.fn(),
          listRuns: vi.fn().mockResolvedValue([])
        },
        ssh: {
          needsPassphrasePrompt: vi.fn().mockResolvedValue(false),
          getState: vi.fn().mockResolvedValue({ status: 'connected' }),
          connect: vi.fn()
        }
      },
      dispatchEvent: vi.fn()
    })
  })

  it('awaits new-per-run setup before launching the automation agent', async () => {
    const order: string[] = []
    mockLaunchSetupBackgroundSession.mockImplementation(async () => {
      order.push('setup')
      await Promise.resolve()
    })
    mockLaunchAgentBackgroundSession.mockImplementation(async () => {
      order.push('agent')
      return { tabId: 'agent-tab', ptyId: 'agent-pty', startupPlan: {} }
    })

    await registerAndDispatch()

    expect(mockCreateWorktree).toHaveBeenCalled()
    expect(mockLaunchSetupBackgroundSession).toHaveBeenCalledWith({
      worktreeId: 'wt-created',
      setup: setupLaunch
    })
    expect(mockLaunchAgentBackgroundSession).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeId: 'wt-created',
        prompt: 'run this'
      })
    )
    expect(order).toEqual(['setup', 'agent'])
    expect(mockMarkDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        status: 'dispatched',
        workspaceId: 'wt-created',
        terminalSessionId: 'agent-tab'
      })
    )
  })

  it('marks dispatch failed and skips the agent when setup fails', async () => {
    mockLaunchSetupBackgroundSession.mockRejectedValue(new Error('Setup exited with code 1.'))

    await registerAndDispatch()

    expect(mockLaunchAgentBackgroundSession).not.toHaveBeenCalled()
    expect(mockMarkDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        status: 'dispatch_failed',
        workspaceId: 'wt-created',
        workspaceDisplayName: 'Automation worktree',
        error: 'Setup exited with code 1.'
      })
    )
  })
})
