import type {
  ManagedAgentSkillContext,
  ManagedAgentSkillFallbackReason
} from '../../../../shared/skills'
import { translate } from '@/i18n/i18n'

export type ManagedSkillContextWorkspaceCopy = {
  beforeWorkspace: string
  afterWorkspace: string
}

export function getManagedSkillContextCopy(
  context: ManagedAgentSkillContext,
  actionLabel: string
): string {
  switch (context) {
    case 'linear-worktree':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.linearWorktreeContext',
        'A worktree was started from a Linear task. {{actionLabel}} the Linear agent skill to enable agents to read and update Linear issues.',
        { actionLabel }
      )
    case 'agent-orchestration':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.agentOrchestrationContext',
        'Orca Orchestration was used. {{actionLabel}} the orchestration skill to enable agents to coordinate reliably.',
        { actionLabel }
      )
    case 'agent-computer-use':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.agentComputerUseContext',
        'Computer Use was used. {{actionLabel}} the Computer Use skill to enable agents to control apps reliably.',
        { actionLabel }
      )
    case 'agent-orca-cli':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.agentOrcaCliContext',
        'The Orca CLI skill was used. {{actionLabel}} the CLI skill to enable this workflow to continue reliably.',
        { actionLabel }
      )
  }
}

export function getManagedSkillContextWorkspaceCopy(
  context: ManagedAgentSkillContext,
  actionLabel: string
): ManagedSkillContextWorkspaceCopy {
  switch (context) {
    case 'linear-worktree':
      return {
        beforeWorkspace: translate(
          'auto.components.skills.ManagedAgentSkillSetupDialogHost.linearWorktreeContextBeforeWorkspace',
          'A worktree was started from a Linear task in '
        ),
        afterWorkspace: translate(
          'auto.components.skills.ManagedAgentSkillSetupDialogHost.linearWorktreeContextAfterWorkspace',
          '. {{actionLabel}} the Linear agent skill to enable agents to read and update Linear issues.',
          { actionLabel }
        )
      }
    case 'agent-orchestration':
      return {
        beforeWorkspace: translate(
          'auto.components.skills.ManagedAgentSkillSetupDialogHost.agentOrchestrationContextBeforeWorkspace',
          'Orca Orchestration was used in '
        ),
        afterWorkspace: translate(
          'auto.components.skills.ManagedAgentSkillSetupDialogHost.agentOrchestrationContextAfterWorkspace',
          '. {{actionLabel}} the orchestration skill to enable agents to coordinate reliably.',
          { actionLabel }
        )
      }
    case 'agent-computer-use':
      return {
        beforeWorkspace: translate(
          'auto.components.skills.ManagedAgentSkillSetupDialogHost.agentComputerUseContextBeforeWorkspace',
          'Computer Use was used in '
        ),
        afterWorkspace: translate(
          'auto.components.skills.ManagedAgentSkillSetupDialogHost.agentComputerUseContextAfterWorkspace',
          '. {{actionLabel}} the Computer Use skill to enable agents to control apps reliably.',
          { actionLabel }
        )
      }
    case 'agent-orca-cli':
      return {
        beforeWorkspace: translate(
          'auto.components.skills.ManagedAgentSkillSetupDialogHost.agentOrcaCliContextBeforeWorkspace',
          'The Orca CLI skill was used in '
        ),
        afterWorkspace: translate(
          'auto.components.skills.ManagedAgentSkillSetupDialogHost.agentOrcaCliContextAfterWorkspace',
          '. {{actionLabel}} the CLI skill to enable this workflow to continue reliably.',
          { actionLabel }
        )
      }
  }
}

export function getManagedSkillFallbackDisplayMessage(
  reason: ManagedAgentSkillFallbackReason
): string {
  switch (reason) {
    case 'target-required':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.targetRequired',
        "Orca couldn't tell which runtime should use this skill."
      )
    case 'unsupported-skill':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.unsupportedSkill',
        "This isn't an Orca-managed skill."
      )
    case 'repair-required-runtime':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.repairRequiredRuntime',
        'This runtime needs repair before Orca can inspect its skills.'
      )
    case 'remote-runtime':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.remoteRuntime',
        'This skill is on a remote runtime, so Orca needs you to update it there.'
      )
    case 'wsl-runtime':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.wslRuntime',
        'This skill is in WSL, so Orca needs you to update it there.'
      )
    case 'missing-install':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.missingInstall',
        "This skill isn't installed for this runtime yet."
      )
    case 'project-install':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.projectInstall',
        "This skill is installed in the project, so Orca won't update it automatically."
      )
    case 'ambiguous-install':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.ambiguousInstall',
        'Orca found more than one copy of this skill and needs you to choose the right one.'
      )
    case 'bundled-or-plugin-install':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.bundledOrPluginInstall',
        "This skill comes from Orca or a plugin, so Orca won't modify it here."
      )
    case 'symlinked-global-install':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.symlinkedGlobalInstall',
        "This global skill is symlinked, so Orca won't change it automatically."
      )
    case 'unsupported-cli-contract':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.unsupportedCliContract',
        "This Orca build can't verify skill updates yet."
      )
    case 'expected-hash-missing':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.expectedHashMissing',
        "This Orca build can't verify the expected version of this skill."
      )
    case 'lockfile-missing':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.lockfileMissing',
        "Orca couldn't find the global skills lockfile needed to verify this update."
      )
    case 'lockfile-malformed':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.lockfileMalformed',
        "Orca couldn't read the global skills lockfile needed to verify this update."
      )
    case 'lockfile-unsupported-schema':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.lockfileUnsupportedSchema',
        "The global skills lockfile uses a format Orca doesn't support yet."
      )
    case 'lock-entry-missing':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.lockEntryMissing',
        "The global skills lockfile doesn't track this skill, so Orca can't verify the update."
      )
    case 'lock-entry-unmanaged-source':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.lockEntryUnmanagedSource',
        "This installed skill isn't tracked as Orca-managed, so Orca won't update it automatically."
      )
    case 'background-update-disabled':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.backgroundUpdateDisabled',
        'Automatic skill updates are off, so Orca needs you to run this update.'
      )
    case 'cooldown':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.cooldown',
        'Orca recently tried this managed-skill check and is cooling down.'
      )
    case 'update-failed':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.updateFailed',
        'Orca tried to update this skill automatically, but the command failed.'
      )
    case 'update-timeout':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.updateTimeout',
        'Orca tried to update this skill automatically, but the command timed out.'
      )
  }
}
