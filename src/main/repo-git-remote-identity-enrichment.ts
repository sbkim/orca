import type { Repo } from '../shared/types'
import { detectGitRemoteIdentity } from './repo-git-remote-identity'

const NO_IDENTITY_RETRY_TTL_MS = 5 * 60 * 1000
export const MAX_REPO_REMOTE_IDENTITY_NEGATIVE_CACHE_LOCATIONS = 512

type RepoIdentityStore = {
  getRepos(): Repo[]
  getRepo?(id: string): Repo | undefined
  updateRepo(id: string, updates: Pick<Partial<Repo>, 'gitRemoteIdentity'>): Repo | null
}

type EnrichmentOptions = {
  onChanged?: () => void
}

const inFlightProbesByLocation = new Map<string, Promise<boolean>>()
const noIdentityRetryAfterByLocation = new Map<string, number>()

function getRepoLocationKey(repo: Pick<Repo, 'path' | 'connectionId'>): string {
  return `${repo.connectionId ?? 'local'}\0${repo.path}`
}

function pruneNoIdentityRetryLocations(liveLocationKeys: ReadonlySet<string>, now: number): void {
  for (const [locationKey, retryAfter] of noIdentityRetryAfterByLocation) {
    if (retryAfter <= now || !liveLocationKeys.has(locationKey)) {
      noIdentityRetryAfterByLocation.delete(locationKey)
    }
  }
  while (noIdentityRetryAfterByLocation.size > MAX_REPO_REMOTE_IDENTITY_NEGATIVE_CACHE_LOCATIONS) {
    const oldestLocationKey = noIdentityRetryAfterByLocation.keys().next().value
    if (oldestLocationKey === undefined) {
      break
    }
    noIdentityRetryAfterByLocation.delete(oldestLocationKey)
  }
}

function rememberNoIdentityRetryLocation(locationKey: string, retryAfter: number): void {
  noIdentityRetryAfterByLocation.delete(locationKey)
  noIdentityRetryAfterByLocation.set(locationKey, retryAfter)
  while (noIdentityRetryAfterByLocation.size > MAX_REPO_REMOTE_IDENTITY_NEGATIVE_CACHE_LOCATIONS) {
    const oldestLocationKey = noIdentityRetryAfterByLocation.keys().next().value
    if (oldestLocationKey === undefined) {
      break
    }
    noIdentityRetryAfterByLocation.delete(oldestLocationKey)
  }
}

function getCurrentRepo(store: RepoIdentityStore, id: string): Repo | undefined {
  return store.getRepo?.(id) ?? store.getRepos().find((repo) => repo.id === id)
}

function isSameUnenrichedRepo(snapshot: Repo, current: Repo | undefined): boolean {
  return (
    !!current &&
    current.kind !== 'folder' &&
    !current.gitRemoteIdentity &&
    current.path === snapshot.path &&
    (current.connectionId ?? null) === (snapshot.connectionId ?? null)
  )
}

async function enrichRepoGitRemoteIdentity(store: RepoIdentityStore, repo: Repo): Promise<boolean> {
  const locationKey = getRepoLocationKey(repo)
  const retryAfter = noIdentityRetryAfterByLocation.get(locationKey) ?? 0
  if (retryAfter > Date.now()) {
    rememberNoIdentityRetryLocation(locationKey, retryAfter)
    return false
  }
  const inFlight = inFlightProbesByLocation.get(locationKey)
  if (inFlight) {
    return inFlight
  }
  const probe = (async () => {
    const identity = await detectGitRemoteIdentity(repo.path, repo.connectionId)
    if (!identity) {
      // Why: repos without a parseable remote are common; cache misses briefly so
      // list calls stay cheap while still allowing recent remote changes to land.
      rememberNoIdentityRetryLocation(locationKey, Date.now() + NO_IDENTITY_RETRY_TTL_MS)
      return false
    }

    noIdentityRetryAfterByLocation.delete(locationKey)
    const current = getCurrentRepo(store, repo.id)
    if (!isSameUnenrichedRepo(repo, current)) {
      return false
    }
    return !!store.updateRepo(repo.id, { gitRemoteIdentity: identity })
  })().finally(() => {
    if (inFlightProbesByLocation.get(locationKey) === probe) {
      inFlightProbesByLocation.delete(locationKey)
    }
  })
  inFlightProbesByLocation.set(locationKey, probe)
  return probe
}

async function enrichMissingRepoGitRemoteIdentitiesInBackground(
  store: RepoIdentityStore,
  options: EnrichmentOptions
): Promise<void> {
  const repos = store.getRepos()
  const liveLocationKeys = new Set(
    repos.filter((repo) => repo.kind !== 'folder').map((repo) => getRepoLocationKey(repo))
  )
  // Why: removed repos may never revisit their retry key; prune against the
  // current store before applying the short negative-cache TTL.
  pruneNoIdentityRetryLocations(liveLocationKeys, Date.now())
  const candidates = repos.filter((repo) => repo.kind !== 'folder' && !repo.gitRemoteIdentity)
  let changed = false
  for (const repo of candidates) {
    // Why: enrichment runs later; capture the location we probed so a mutable
    // store cannot make the stale-write guard compare against changed fields.
    if (await enrichRepoGitRemoteIdentity(store, { ...repo })) {
      changed = true
    }
  }
  if (changed) {
    options.onChanged?.()
  }
}

export function enrichMissingRepoGitRemoteIdentities(
  store: RepoIdentityStore,
  options: EnrichmentOptions = {}
): void {
  void enrichMissingRepoGitRemoteIdentitiesInBackground(store, options).catch((error: unknown) => {
    console.error('[repo-identity] Failed to enrich git remote identities:', error)
  })
}

export async function flushRepoGitRemoteIdentityEnrichmentForTests(): Promise<void> {
  await Promise.all(inFlightProbesByLocation.values())
}

export function resetRepoGitRemoteIdentityEnrichmentForTests(): void {
  inFlightProbesByLocation.clear()
  noIdentityRetryAfterByLocation.clear()
}

export function getRepoGitRemoteIdentityEnrichmentCountsForTests(): {
  inFlight: number
  negativeCache: number
} {
  return {
    inFlight: inFlightProbesByLocation.size,
    negativeCache: noIdentityRetryAfterByLocation.size
  }
}

export function hasRepoGitRemoteIdentityNegativeCacheForTests(repo: Repo): boolean {
  return noIdentityRetryAfterByLocation.has(getRepoLocationKey(repo))
}
