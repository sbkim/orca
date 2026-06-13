import { describe, expect, it } from 'vitest'
import { getTaskSourceContextSummary } from './task-source-context-summary'

describe('task source context summary', () => {
  it('shows provider, host, and provider identity for a single repo-backed source', () => {
    const summary = getTaskSourceContextSummary({
      provider: 'github',
      providerLabel: 'GitHub',
      selectedRepoCount: 1,
      repoContexts: [
        {
          kind: 'task-source',
          provider: 'github',
          projectId: 'github:stablyai/orca',
          hostId: 'ssh:devbox',
          projectHostSetupId: 'setup-1',
          repoId: 'repo-1',
          providerIdentity: { provider: 'github', owner: 'stablyai', repo: 'orca' }
        }
      ]
    })

    expect(summary.label).toBe('GitHub · devbox · stablyai/orca')
    expect(summary.title).toBe('GitHub · Host: devbox · Source: stablyai/orca')
  })

  it('shows disconnected source-host availability for a single SSH repo source', () => {
    const summary = getTaskSourceContextSummary({
      provider: 'github',
      providerLabel: 'GitHub',
      selectedRepoCount: 1,
      repoContexts: [
        {
          kind: 'task-source',
          provider: 'github',
          projectId: 'github:stablyai/orca',
          hostId: 'ssh:devbox',
          repoId: 'repo-1',
          providerIdentity: { provider: 'github', owner: 'stablyai', repo: 'orca' }
        }
      ],
      hostAvailability: [{ hostId: 'ssh:devbox', status: 'disconnected' }]
    })

    expect(summary.label).toBe('GitHub · devbox · disconnected · stablyai/orca')
    expect(summary.title).toBe(
      'GitHub · Host: devbox · Availability: devbox disconnected · Source: stablyai/orca'
    )
  })

  it('summarizes multiple unavailable source hosts without cluttering the label', () => {
    const summary = getTaskSourceContextSummary({
      provider: 'github',
      providerLabel: 'GitHub',
      selectedRepoCount: 2,
      repoContexts: [
        {
          kind: 'task-source',
          provider: 'github',
          projectId: 'project-a',
          hostId: 'ssh:devbox',
          repoId: 'repo-a'
        },
        {
          kind: 'task-source',
          provider: 'github',
          projectId: 'project-b',
          hostId: 'ssh:buildbox',
          repoId: 'repo-b'
        }
      ],
      hostAvailability: [
        { hostId: 'ssh:devbox', status: 'auth-failed' },
        { hostId: 'ssh:buildbox', status: 'reconnecting' }
      ]
    })

    expect(summary.label).toBe('GitHub · devbox, buildbox · 2 unavailable · 2 projects')
    expect(summary.title).toBe(
      'GitHub · Host: devbox, buildbox · Availability: devbox auth needed, buildbox connecting · 2 selected projects'
    )
  })

  it('summarizes multiple repo-backed hosts without hiding the selected count', () => {
    const summary = getTaskSourceContextSummary({
      provider: 'gitlab',
      providerLabel: 'GitLab',
      selectedRepoCount: 3,
      repoContexts: [
        {
          kind: 'task-source',
          provider: 'gitlab',
          projectId: 'project-a',
          hostId: 'local',
          repoId: 'repo-a'
        },
        {
          kind: 'task-source',
          provider: 'gitlab',
          projectId: 'project-b',
          hostId: 'ssh:build',
          repoId: 'repo-b'
        },
        {
          kind: 'task-source',
          provider: 'gitlab',
          projectId: 'project-c',
          hostId: 'runtime:linux',
          repoId: 'repo-c'
        }
      ]
    })

    expect(summary.label).toBe('GitLab · Local Mac +2 · 3 projects')
    expect(summary.title).toBe('GitLab · Host: Local Mac, build, linux · 3 selected projects')
  })

  it('shows blocked remote-server source-host availability', () => {
    const summary = getTaskSourceContextSummary({
      provider: 'github',
      providerLabel: 'GitHub',
      selectedRepoCount: 1,
      repoContexts: [
        {
          kind: 'task-source',
          provider: 'github',
          projectId: 'project-a',
          hostId: 'runtime:old-server',
          repoId: 'repo-a',
          providerIdentity: { provider: 'github', owner: 'stablyai', repo: 'orca' }
        }
      ],
      hostAvailability: [{ hostId: 'runtime:old-server', health: 'blocked' }]
    })

    expect(summary.label).toBe('GitHub · old-server · server update needed · stablyai/orca')
    expect(summary.title).toBe(
      'GitHub · Host: old-server · Availability: old-server server update needed · Source: stablyai/orca'
    )
  })

  it('shows account-backed Linear and Jira sources', () => {
    expect(
      getTaskSourceContextSummary({
        provider: 'linear',
        providerLabel: 'Linear',
        accountHostId: 'local',
        linearWorkspaceName: 'Stably'
      }).label
    ).toBe('Linear · Local Mac · Stably')

    expect(
      getTaskSourceContextSummary({
        provider: 'jira',
        providerLabel: 'Jira',
        accountHostId: 'runtime:server',
        jiraSiteName: 'Stably Jira'
      }).label
    ).toBe('Jira · server · Stably Jira')
  })

  it('shows account-backed source host availability', () => {
    const summary = getTaskSourceContextSummary({
      provider: 'linear',
      providerLabel: 'Linear',
      accountHostId: 'runtime:old-server',
      linearWorkspaceName: 'Stably',
      hostAvailability: [{ hostId: 'runtime:old-server', health: 'blocked' }]
    })

    expect(summary.label).toBe('Linear · old-server · server update needed · Stably')
    expect(summary.title).toBe(
      'Linear source · Host: old-server · Availability: old-server server update needed · Account: Stably'
    )
  })
})
