import { describe, expect, it } from 'vitest'
import { getProviderAccountScope } from './provider-account-scope'

describe('getProviderAccountScope', () => {
  it('describes provider accounts as client-owned without an active runtime', () => {
    expect(getProviderAccountScope({ activeRuntimeEnvironmentId: null })).toEqual({
      label: 'Local Mac',
      description:
        'Credentials and account checks for this provider are owned by this desktop client.'
    })
  })

  it('describes provider accounts as remote-server-owned with an active runtime', () => {
    expect(getProviderAccountScope({ activeRuntimeEnvironmentId: ' env-1 ' })).toEqual({
      label: 'Remote server: env-1',
      description:
        'Credentials and account checks for this provider are owned by this remote server.'
    })
  })
})
