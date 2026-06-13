import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../shared/types'
import { getDefaultTaskRepoSelection } from './task-page-default-repo-selection'

function repo(overrides: Partial<Repo> & Pick<Repo, 'id'>): Repo {
  return {
    path: `/repos/${overrides.id}`,
    displayName: overrides.id,
    badgeColor: '#737373',
    addedAt: 100,
    kind: 'git',
    ...overrides
  }
}

describe('getDefaultTaskRepoSelection', () => {
  it('selects one source per logical GitHub project', () => {
    const selection = getDefaultTaskRepoSelection([
      repo({
        id: 'local-orca',
        upstream: { owner: 'StablyAI', repo: 'Orca' }
      }),
      repo({
        id: 'ssh-orca',
        connectionId: 'builder',
        upstream: { owner: 'stablyai', repo: 'orca' }
      }),
      repo({
        id: 'other',
        upstream: { owner: 'stablyai', repo: 'other' }
      })
    ])

    expect([...selection].sort()).toEqual(['local-orca', 'other'])
  })

  it('prefers local checkout over a remote checkout for the same project', () => {
    const selection = getDefaultTaskRepoSelection([
      repo({
        id: 'ssh-orca',
        addedAt: 1,
        connectionId: 'builder',
        upstream: { owner: 'stablyai', repo: 'orca' }
      }),
      repo({
        id: 'local-orca',
        addedAt: 2,
        upstream: { owner: 'stablyai', repo: 'orca' }
      })
    ])

    expect([...selection]).toEqual(['local-orca'])
  })

  it('keeps same-named folders separate when provider identity is missing', () => {
    const selection = getDefaultTaskRepoSelection([
      repo({ id: 'local-app', displayName: 'app' }),
      repo({ id: 'ssh-app', displayName: 'app', connectionId: 'builder' })
    ])

    expect([...selection].sort()).toEqual(['local-app', 'ssh-app'])
  })
})
