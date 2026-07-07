import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GitRemoteIdentity } from '../shared/git-remote-identity'
import type { Repo } from '../shared/types'
import { detectGitRemoteIdentity } from './repo-git-remote-identity'
import {
  MAX_REPO_REMOTE_IDENTITY_NEGATIVE_CACHE_LOCATIONS,
  enrichMissingRepoGitRemoteIdentities,
  flushRepoGitRemoteIdentityEnrichmentForTests,
  getRepoGitRemoteIdentityEnrichmentCountsForTests,
  hasRepoGitRemoteIdentityNegativeCacheForTests,
  resetRepoGitRemoteIdentityEnrichmentForTests
} from './repo-git-remote-identity-enrichment'

vi.mock('./repo-git-remote-identity', () => ({
  detectGitRemoteIdentity: vi.fn()
}))

type RepoIdentityStore = {
  getRepos: () => Repo[]
  getRepo: (id: string) => Repo | undefined
  updateRepo: (id: string, updates: Pick<Partial<Repo>, 'gitRemoteIdentity'>) => Repo | null
}

const remoteIdentity: GitRemoteIdentity = {
  canonicalKey: 'git.company.test/team/sample-app',
  remoteName: 'origin',
  remoteUrl: 'git@git.company.test:team/sample-app.git'
}

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/workspace/sample-app',
    displayName: 'sample-app',
    badgeColor: '#737373',
    addedAt: 1,
    kind: 'git',
    ...overrides
  }
}

function makeStoreForRepos(
  repos: Repo[]
): RepoIdentityStore & { updateRepo: ReturnType<typeof vi.fn> } {
  return {
    getRepos: () => repos,
    getRepo: (id) => repos.find((candidate) => candidate.id === id),
    updateRepo: vi.fn((id, updates) => {
      const target = repos.find((candidate) => candidate.id === id)
      if (!target) {
        return null
      }
      Object.assign(target, updates)
      return target
    })
  }
}

function makeStore(repo: Repo): RepoIdentityStore & { updateRepo: ReturnType<typeof vi.fn> } {
  return makeStoreForRepos([repo])
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  resetRepoGitRemoteIdentityEnrichmentForTests()
})

describe('enrichMissingRepoGitRemoteIdentities', () => {
  it('schedules remote identity enrichment without blocking the caller', async () => {
    vi.mocked(detectGitRemoteIdentity).mockResolvedValue(remoteIdentity)
    const repo = makeRepo()
    const store = makeStore(repo)
    const onChanged = vi.fn()

    enrichMissingRepoGitRemoteIdentities(store, { onChanged })

    expect(repo.gitRemoteIdentity).toBeUndefined()
    expect(detectGitRemoteIdentity).toHaveBeenCalledWith('/workspace/sample-app', undefined)

    await flushRepoGitRemoteIdentityEnrichmentForTests()

    expect(repo.gitRemoteIdentity).toEqual(remoteIdentity)
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent probes for the same repo location', async () => {
    const probe = deferred<GitRemoteIdentity | null>()
    vi.mocked(detectGitRemoteIdentity).mockReturnValue(probe.promise)
    const repo = makeRepo()
    const store = makeStore(repo)

    enrichMissingRepoGitRemoteIdentities(store)
    enrichMissingRepoGitRemoteIdentities(store)

    expect(detectGitRemoteIdentity).toHaveBeenCalledTimes(1)

    probe.resolve(remoteIdentity)
    await flushRepoGitRemoteIdentityEnrichmentForTests()

    expect(store.updateRepo).toHaveBeenCalledTimes(1)
    expect(repo.gitRemoteIdentity).toEqual(remoteIdentity)
  })

  it('caches no-identity probes briefly so list calls do not retry every time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    vi.mocked(detectGitRemoteIdentity).mockResolvedValue(null)
    const repo = makeRepo()
    const store = makeStore(repo)

    enrichMissingRepoGitRemoteIdentities(store)
    await flushRepoGitRemoteIdentityEnrichmentForTests()
    enrichMissingRepoGitRemoteIdentities(store)
    await flushRepoGitRemoteIdentityEnrichmentForTests()

    expect(detectGitRemoteIdentity).toHaveBeenCalledTimes(1)
  })

  it('prunes no-identity retry entries for removed repo locations', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    vi.mocked(detectGitRemoteIdentity).mockResolvedValue(null)
    const oldRepo = makeRepo({ id: 'old', path: '/workspace/old' })
    const newRepo = makeRepo({ id: 'new', path: '/workspace/new' })
    const repos = [oldRepo]
    const store = makeStoreForRepos(repos)

    enrichMissingRepoGitRemoteIdentities(store)
    await flushRepoGitRemoteIdentityEnrichmentForTests()

    expect(getRepoGitRemoteIdentityEnrichmentCountsForTests()).toEqual({
      inFlight: 0,
      negativeCache: 1
    })
    expect(hasRepoGitRemoteIdentityNegativeCacheForTests(oldRepo)).toBe(true)

    repos.splice(0, repos.length, newRepo)
    enrichMissingRepoGitRemoteIdentities(store)
    await flushRepoGitRemoteIdentityEnrichmentForTests()

    expect(getRepoGitRemoteIdentityEnrichmentCountsForTests()).toEqual({
      inFlight: 0,
      negativeCache: 1
    })
    expect(hasRepoGitRemoteIdentityNegativeCacheForTests(oldRepo)).toBe(false)
    expect(hasRepoGitRemoteIdentityNegativeCacheForTests(newRepo)).toBe(true)
  })

  it('caps no-identity retry entries while retaining recently refreshed locations', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    vi.mocked(detectGitRemoteIdentity).mockResolvedValue(null)
    const repos = Array.from(
      { length: MAX_REPO_REMOTE_IDENTITY_NEGATIVE_CACHE_LOCATIONS - 1 },
      (_, index) => makeRepo({ id: `repo-${index}`, path: `/workspace/repo-${index}` })
    )
    const keepRepo = makeRepo({ id: 'keep', path: '/workspace/keep' })
    repos.push(keepRepo)
    const store = makeStoreForRepos(repos)

    enrichMissingRepoGitRemoteIdentities(store)
    await vi.waitFor(() =>
      expect(detectGitRemoteIdentity).toHaveBeenCalledTimes(
        MAX_REPO_REMOTE_IDENTITY_NEGATIVE_CACHE_LOCATIONS
      )
    )
    repos.push(makeRepo({ id: 'new', path: '/workspace/new' }))
    enrichMissingRepoGitRemoteIdentities(store)
    await vi.waitFor(() =>
      expect(detectGitRemoteIdentity).toHaveBeenCalledTimes(
        MAX_REPO_REMOTE_IDENTITY_NEGATIVE_CACHE_LOCATIONS + 1
      )
    )

    expect(getRepoGitRemoteIdentityEnrichmentCountsForTests()).toEqual({
      inFlight: 0,
      negativeCache: MAX_REPO_REMOTE_IDENTITY_NEGATIVE_CACHE_LOCATIONS
    })
    expect(hasRepoGitRemoteIdentityNegativeCacheForTests(repos[0]!)).toBe(false)
    expect(hasRepoGitRemoteIdentityNegativeCacheForTests(keepRepo)).toBe(true)
    expect(hasRepoGitRemoteIdentityNegativeCacheForTests(repos.at(-1)!)).toBe(true)
  })

  it('does not write stale identity data after the repo path changes', async () => {
    const probe = deferred<GitRemoteIdentity | null>()
    vi.mocked(detectGitRemoteIdentity).mockReturnValue(probe.promise)
    const repo = makeRepo()
    const store = makeStore(repo)

    enrichMissingRepoGitRemoteIdentities(store)
    repo.path = '/workspace/renamed-sample-app'
    probe.resolve(remoteIdentity)
    await flushRepoGitRemoteIdentityEnrichmentForTests()

    expect(store.updateRepo).not.toHaveBeenCalled()
    expect(repo.gitRemoteIdentity).toBeUndefined()
  })
})
