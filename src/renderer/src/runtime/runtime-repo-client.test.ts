import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearRuntimeCompatibilityCacheForTests,
  markRuntimeEnvironmentCompatible
} from './runtime-rpc-client'
import { createRuntimeRepoInitialCommit } from './runtime-repo-client'

const createInitialCommit = vi.fn()
const runtimeEnvironmentCall = vi.fn()

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  createInitialCommit.mockReset()
  runtimeEnvironmentCall.mockReset()
  vi.stubGlobal('window', {
    api: {
      repos: { createInitialCommit },
      runtimeEnvironments: { call: runtimeEnvironmentCall }
    }
  })
})

describe('createRuntimeRepoInitialCommit', () => {
  it('routes local runtime targets through preload IPC', async () => {
    createInitialCommit.mockResolvedValue({ ok: true, baseRef: 'main' })

    await expect(createRuntimeRepoInitialCommit(null, 'repo-1')).resolves.toEqual({
      ok: true,
      baseRef: 'main'
    })

    expect(createInitialCommit).toHaveBeenCalledWith({ repoId: 'repo-1' })
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
  })

  it('routes environment runtime targets through repo.createInitialCommit RPC', async () => {
    markRuntimeEnvironmentCompatible('env-1')
    runtimeEnvironmentCall.mockResolvedValue({
      id: 'rpc-1',
      ok: true,
      result: { ok: true, baseRef: 'trunk' },
      _meta: { runtimeId: 'runtime-1' }
    })

    await expect(
      createRuntimeRepoInitialCommit({ activeRuntimeEnvironmentId: 'env-1' }, 'repo-1')
    ).resolves.toEqual({ ok: true, baseRef: 'trunk' })

    expect(runtimeEnvironmentCall).toHaveBeenCalledWith({
      selector: 'env-1',
      method: 'repo.createInitialCommit',
      params: { repo: 'repo-1' },
      timeoutMs: 15_000
    })
    expect(createInitialCommit).not.toHaveBeenCalled()
  })
})
