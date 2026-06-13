import type { Automation } from '../../../../shared/automations-types'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../../../shared/execution-host'
import type { SshConnectionState } from '../../../../shared/ssh-types'
import type { Repo, Worktree } from '../../../../shared/types'

export type AutomationTargetAvailability =
  | {
      canRunNow: true
      reason: 'available'
      message: null
    }
  | {
      canRunNow: false
      reason:
        | 'missing-project'
        | 'missing-workspace'
        | 'host-mismatch'
        | 'unsupported-host'
        | 'ssh-auth-needed'
        | 'ssh-unavailable'
        | 'ssh-connecting'
      message: string
    }

type AutomationTargetAvailabilityArgs = {
  automation: Automation
  repo: Repo | null | undefined
  workspace: Worktree | null | undefined
  sshConnectionStates: ReadonlyMap<string, Pick<SshConnectionState, 'status'>>
}

export function getAutomationTargetAvailability({
  automation,
  repo,
  workspace,
  sshConnectionStates
}: AutomationTargetAvailabilityArgs): AutomationTargetAvailability {
  if (!repo) {
    return unavailable('missing-project', 'The target project is no longer available.')
  }
  if (automation.runContext) {
    const parsedHost = parseExecutionHostId(automation.runContext.hostId)
    if (parsedHost?.kind === 'runtime') {
      return unavailable(
        'unsupported-host',
        'This automation targets a remote server that this client cannot run manually yet.'
      )
    }
    if (
      automation.runContext.repoId !== repo.id ||
      automation.runContext.path !== repo.path ||
      automation.runContext.hostId !== getRepoExecutionHostId(repo)
    ) {
      return unavailable(
        'host-mismatch',
        'The saved run host no longer matches this project setup.'
      )
    }
  }
  if (automation.workspaceMode === 'existing' && !workspace) {
    return unavailable('missing-workspace', 'The target workspace is no longer available.')
  }

  const sshTargetId = getAutomationSshTargetId(automation, repo)
  if (!sshTargetId) {
    return { canRunNow: true, reason: 'available', message: null }
  }

  const status = sshConnectionStates.get(sshTargetId)?.status ?? 'disconnected'
  switch (status) {
    case 'connected':
      return { canRunNow: true, reason: 'available', message: null }
    case 'auth-failed':
    case 'reconnection-failed':
      return unavailable('ssh-auth-needed', 'Connect this SSH host before running manually.')
    case 'connecting':
    case 'deploying-relay':
    case 'reconnecting':
      return unavailable('ssh-connecting', 'This SSH host is still connecting.')
    case 'disconnected':
    case 'error':
      return unavailable('ssh-unavailable', 'Connect this SSH host before running manually.')
  }
}

function getAutomationSshTargetId(automation: Automation, repo: Repo): string | null {
  const parsedHost = parseExecutionHostId(automation.runContext?.hostId)
  if (parsedHost?.kind === 'ssh') {
    return parsedHost.targetId
  }
  if (automation.executionTargetType === 'ssh' && automation.executionTargetId.trim()) {
    return automation.executionTargetId
  }
  return repo.connectionId?.trim() || null
}

function unavailable(
  reason: Exclude<AutomationTargetAvailability['reason'], 'available'>,
  message: string
): AutomationTargetAvailability {
  return { canRunNow: false, reason, message }
}
