import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagedAgentSkillFallback } from '../../../../shared/skills'
import {
  getManagedSkillFallbackDisplayMessage,
  getManagedSkillContextCopy,
  getManagedSkillContextWorkspaceCopy
} from './managed-agent-skill-dialog-copy'
import {
  advanceManagedAgentSkillFallbackQueue,
  enqueueManagedAgentSkillFallback,
  getInstalledStateSourceKinds,
  prepareManagedAgentSkillSetupTerminal,
  replaceActiveAfterManagedAgentSkillRecheck
} from './managed-agent-skill-dialog-state'

const cliPrerequisiteMocks = vi.hoisted(() => ({
  ensureOrcaCliAvailableForAgentSkillTerminal: vi.fn()
}))

vi.mock('@/lib/agent-skill-cli-prerequisite', () => ({
  AGENT_SKILL_CLI_PREREQUISITE_NOTICE: 'CLI registration notice',
  ensureOrcaCliAvailableForAgentSkillTerminal:
    cliPrerequisiteMocks.ensureOrcaCliAvailableForAgentSkillTerminal,
  isOrcaCliAvailableOnPath: vi.fn()
}))

function fallback(
  patch: Partial<ManagedAgentSkillFallback> & Pick<ManagedAgentSkillFallback, 'context'>
): ManagedAgentSkillFallback {
  const skillName = patch.skillName ?? 'orchestration'
  const runtime = patch.runtime ?? 'host'
  const scope = patch.scope ?? 'global'
  return {
    status: 'fallback',
    skillName,
    context: patch.context,
    runtime,
    scope,
    reason: patch.reason ?? 'background-update-disabled',
    uiKey: patch.uiKey ?? [runtime, '', skillName, patch.context].join(':'),
    message: patch.message ?? 'Fallback message.',
    manualCommand: patch.manualCommand,
    request: patch.request ?? {
      skillName,
      context: patch.context,
      ...(runtime === 'remote' ? { remoteRuntime: true } : { discoveryTarget: { runtime: 'host' } })
    }
  }
}

beforeEach(() => {
  cliPrerequisiteMocks.ensureOrcaCliAvailableForAgentSkillTerminal.mockReset()
})

describe('ManagedAgentSkillSetupDialogHost copy', () => {
  it('uses neutral orchestration context copy when no workspace is available', () => {
    expect(getManagedSkillContextCopy('agent-orchestration', 'Update')).toBe(
      'Orca Orchestration was used. Update the orchestration skill to enable agents to coordinate reliably.'
    )
  })

  it('names the Linear worktree context', () => {
    expect(getManagedSkillContextCopy('linear-worktree', 'Install')).toBe(
      'A worktree was started from a Linear task. Install the Linear agent skill to enable agents to read and update Linear issues.'
    )
  })

  it('splits workspace-aware context copy so the workspace can expose its full path', () => {
    expect(getManagedSkillContextWorkspaceCopy('agent-computer-use', 'Install')).toEqual({
      beforeWorkspace: 'Computer Use was used in ',
      afterWorkspace: '. Install the Computer Use skill to enable agents to control apps reliably.'
    })
  })

  it('localizes fallback reason copy in the renderer', () => {
    expect(getManagedSkillFallbackDisplayMessage('remote-runtime')).toBe(
      'This skill is on a remote runtime, so Orca needs you to update it there.'
    )
  })
})

describe('ManagedAgentSkillSetupDialogHost queue state', () => {
  it('prepares the Orca CLI before opening the setup terminal', async () => {
    cliPrerequisiteMocks.ensureOrcaCliAvailableForAgentSkillTerminal.mockResolvedValue(null)

    await prepareManagedAgentSkillSetupTerminal()

    expect(cliPrerequisiteMocks.ensureOrcaCliAvailableForAgentSkillTerminal).toHaveBeenCalledOnce()
  })

  it('returns stable source-kind filters for installed-state refreshes', () => {
    expect(getInstalledStateSourceKinds('global')).toBe(getInstalledStateSourceKinds('global'))
    expect(getInstalledStateSourceKinds('project')).toBe(getInstalledStateSourceKinds('project'))
    expect(getInstalledStateSourceKinds('bundled')).toBe(getInstalledStateSourceKinds('bundled'))
    expect(getInstalledStateSourceKinds('plugin')).toBe(getInstalledStateSourceKinds('plugin'))
  })

  it('shows the first fallback immediately and queues later fallbacks FIFO', () => {
    const first = fallback({
      context: 'agent-orchestration',
      uiKey: 'host::orchestration:agent-orchestration'
    })
    const second = fallback({
      skillName: 'computer-use',
      context: 'agent-computer-use',
      uiKey: 'host::computer-use:agent-computer-use'
    })

    const withFirst = enqueueManagedAgentSkillFallback({ active: null, queue: [] }, first)
    const withSecond = enqueueManagedAgentSkillFallback(withFirst, second)

    expect(withSecond).toEqual({ active: first, queue: [second] })
    expect(advanceManagedAgentSkillFallbackQueue(withSecond)).toEqual({
      active: second,
      queue: []
    })
  })

  it('clears the active fallback when the queue is empty', () => {
    const event = fallback({
      context: 'agent-orchestration',
      uiKey: 'host::orchestration:agent-orchestration'
    })

    expect(advanceManagedAgentSkillFallbackQueue({ active: event, queue: [] })).toEqual({
      active: null,
      queue: []
    })
  })

  it('does not replace the active modal with a non-actionable re-check fallback', () => {
    const active = fallback({
      context: 'agent-orchestration',
      uiKey: 'host::orchestration:agent-orchestration',
      manualCommand: {
        kind: 'install',
        command: 'npx skills install orchestration',
        runtime: 'host',
        scope: 'global'
      }
    })
    const deadEndFallback = fallback({
      context: 'agent-orchestration',
      reason: 'lockfile-malformed',
      uiKey: 'host::orchestration:agent-orchestration'
    })

    expect(
      replaceActiveAfterManagedAgentSkillRecheck({ active, queue: [] }, deadEndFallback)
    ).toEqual({
      active: null,
      queue: []
    })
  })
})
