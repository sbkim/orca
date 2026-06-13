import type { GlobalSettings } from '../../../../shared/types'

export type ProviderAccountScope = {
  label: string
  description: string
}

export function getProviderAccountScope(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
): ProviderAccountScope {
  const runtimeId = settings?.activeRuntimeEnvironmentId?.trim()
  if (runtimeId) {
    return {
      label: `Remote server: ${runtimeId}`,
      description: 'Credentials and account checks for this provider are owned by this remote server.'
    }
  }
  return {
    label: 'Local Mac',
    description: 'Credentials and account checks for this provider are owned by this desktop client.'
  }
}
