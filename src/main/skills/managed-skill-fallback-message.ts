import type { ManagedAgentSkillFallbackReason } from '../../shared/skills'

export function getManagedSkillFallbackMessage(reason: ManagedAgentSkillFallbackReason): string {
  switch (reason) {
    case 'target-required':
      return "Orca couldn't tell which runtime should use this skill."
    case 'unsupported-skill':
      return "This isn't an Orca-managed skill."
    case 'repair-required-runtime':
      return 'This runtime needs repair before Orca can inspect its skills.'
    case 'remote-runtime':
      return 'This skill is on a remote runtime, so Orca needs you to update it there.'
    case 'wsl-runtime':
      return 'This skill is in WSL, so Orca needs you to update it there.'
    case 'missing-install':
      return "This skill isn't installed for this runtime yet."
    case 'project-install':
      return "This skill is installed in the project, so Orca won't update it automatically."
    case 'ambiguous-install':
      return 'Orca found more than one copy of this skill and needs you to choose the right one.'
    case 'bundled-or-plugin-install':
      return "This skill comes from Orca or a plugin, so Orca won't modify it here."
    case 'symlinked-global-install':
      return "This global skill is symlinked, so Orca won't change it automatically."
    case 'unsupported-cli-contract':
      return "This Orca build can't verify skill updates yet."
    case 'expected-hash-missing':
      return "This Orca build can't verify the expected version of this skill."
    case 'lockfile-missing':
      return "Orca couldn't find the global skills lockfile needed to verify this update."
    case 'lockfile-malformed':
      return "Orca couldn't read the global skills lockfile needed to verify this update."
    case 'lockfile-unsupported-schema':
      return "The global skills lockfile uses a format Orca doesn't support yet."
    case 'lock-entry-missing':
      return "The global skills lockfile doesn't track this skill, so Orca can't verify the update."
    case 'lock-entry-unmanaged-source':
      return "This installed skill isn't tracked as Orca-managed, so Orca won't update it automatically."
    case 'background-update-disabled':
      return 'Automatic skill updates are off, so Orca needs you to run this update.'
    case 'cooldown':
      return 'Orca recently tried this managed-skill check and is cooling down.'
    case 'update-failed':
      return 'Orca tried to update this skill automatically, but the command failed.'
    case 'update-timeout':
      return 'Orca tried to update this skill automatically, but the command timed out.'
  }
}
