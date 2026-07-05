import type { HostedReviewProvider } from '../../../../shared/hosted-review'
import type { GitPushTarget } from '../../../../shared/types'

type ManualReviewProvider = Exclude<HostedReviewProvider, 'unsupported'>

type RemoteRepoRef = {
  provider: ManualReviewProvider | null
  webBaseUrl: string
  path: string
}

type ManualReviewUrlInput = {
  baseRef: string | null | undefined
  branchName: string | null | undefined
  repoRemoteName?: string | null
  repoRemoteUrl?: string | null
  provider?: HostedReviewProvider | null
  pushTarget?: GitPushTarget | null
  /** Tracking upstream in `<remote>/<branch>` form (git `branch.upstream`). */
  upstreamName?: string | null
}

type ParsedUpstream = { remoteName: string; branchName: string }

function parseUpstream(name: string | null | undefined): ParsedUpstream | null {
  const trimmed = name?.trim()
  if (!trimmed) {
    return null
  }
  const slash = trimmed.indexOf('/')
  if (slash <= 0 || slash === trimmed.length - 1) {
    return null
  }
  return { remoteName: trimmed.slice(0, slash), branchName: trimmed.slice(slash + 1) }
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

function cleanPath(path: string): string | null {
  const parts = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .map(decodeSegment)
  return parts.length >= 2 ? parts.join('/') : null
}

function providerForHost(host: string): ManualReviewProvider | null {
  const normalized = host.toLowerCase()
  if (normalized === 'github.com' || normalized === 'ssh.github.com') {
    return 'github'
  }
  if (normalized === 'gitlab.com') {
    return 'gitlab'
  }
  if (normalized === 'bitbucket.org') {
    return 'bitbucket'
  }
  if (
    normalized === 'dev.azure.com' ||
    normalized === 'ssh.dev.azure.com' ||
    normalized.endsWith('.visualstudio.com')
  ) {
    return 'azure-devops'
  }
  return null
}

function normalizeProvider(
  provider: HostedReviewProvider | null | undefined
): ManualReviewProvider | null {
  return provider && provider !== 'unsupported' ? provider : null
}

function buildWebOrigin(protocol: string, host: string, hostname: string): string {
  return protocol === 'http:' || protocol === 'https:'
    ? `${protocol}//${host}`
    : `https://${hostname}`
}

function parseAzureDevOpsRemote(trimmed: string): RemoteRepoRef | null {
  const scpLike = trimmed.match(/^(?:[^@/:]+@)?([^:\s/]+):([^\s]+?)(?:\.git)?$/)
  if (scpLike && scpLike[1].toLowerCase() === 'ssh.dev.azure.com') {
    const parts = cleanPath(scpLike[2])?.split('/') ?? []
    if (parts.length >= 4 && parts[0].toLowerCase() === 'v3') {
      const [, organization, project, repository] = parts
      return {
        provider: 'azure-devops',
        path: `${organization}/${project}/_git/${repository}`,
        webBaseUrl: `https://dev.azure.com/${encodePath(organization)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repository)}`
      }
    }
  }

  try {
    const url = new URL(trimmed)
    const protocol = url.protocol.toLowerCase()
    if (!['http:', 'https:', 'ssh:', 'git+ssh:'].includes(protocol)) {
      return null
    }
    const host = url.hostname.toLowerCase()
    const parts = cleanPath(url.pathname)?.split('/') ?? []
    if (host === 'ssh.dev.azure.com' && parts.length >= 4 && parts[0].toLowerCase() === 'v3') {
      const [, organization, project, repository] = parts
      return {
        provider: 'azure-devops',
        path: `${organization}/${project}/_git/${repository}`,
        webBaseUrl: `https://dev.azure.com/${encodePath(organization)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repository)}`
      }
    }

    const gitIndex = parts.findIndex((part) => part.toLowerCase() === '_git')
    if (gitIndex < 1 || gitIndex + 1 >= parts.length) {
      return null
    }
    const project = parts[gitIndex - 1]
    const repository = parts[gitIndex + 1]
    const prefix = parts.slice(0, gitIndex - 1)
    const organization =
      host === 'dev.azure.com' ? prefix[0] : host.endsWith('.visualstudio.com') ? null : undefined
    const webPath =
      organization === undefined
        ? [...prefix, project, '_git', repository]
        : organization
          ? [organization, project, '_git', repository]
          : [...prefix, project, '_git', repository]
    return {
      provider: 'azure-devops',
      path: webPath.join('/'),
      webBaseUrl: `${buildWebOrigin(protocol, url.host, url.hostname).replace(/\/+$/, '')}/${encodePath(webPath.join('/'))}`
    }
  } catch {
    return null
  }
}

function parseRemoteRepo(
  remoteUrl: string,
  providerHint?: HostedReviewProvider | null
): RemoteRepoRef | null {
  const trimmed = remoteUrl.trim().replace(/^git\+/, '')
  if (!trimmed || /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('/')) {
    return null
  }

  const azure = parseAzureDevOpsRemote(trimmed)
  if (azure && (providerHint == null || providerHint === 'azure-devops')) {
    return azure
  }

  const scpLike = !trimmed.includes('://')
    ? trimmed.match(/^(?:[^@/:]+@)?([^:\s/]+):([^\s]+?)(?:\.git)?$/)
    : null
  if (scpLike) {
    const host = scpLike[1].toLowerCase()
    const path = cleanPath(scpLike[2])
    if (!path) {
      return null
    }
    const hintedProvider = normalizeProvider(providerHint)
    return {
      provider: hintedProvider ?? providerForHost(host) ?? null,
      path,
      webBaseUrl: `https://${host}/${encodePath(path)}`
    }
  }

  try {
    const url = new URL(trimmed)
    const protocol = url.protocol.toLowerCase()
    if (!['git:', 'http:', 'https:', 'ssh:'].includes(protocol)) {
      return null
    }
    const path = cleanPath(url.pathname)
    if (!path) {
      return null
    }
    const host = url.hostname.toLowerCase()
    const hintedProvider = normalizeProvider(providerHint)
    const inferredProvider = providerForHost(host)
    const provider = hintedProvider ?? inferredProvider
    const webOrigin =
      host === 'ssh.github.com'
        ? 'https://github.com'
        : buildWebOrigin(protocol, url.host, url.hostname).replace(/\/+$/, '')
    return {
      provider,
      path,
      webBaseUrl: `${webOrigin}/${encodePath(path)}`
    }
  } catch {
    return null
  }
}

function branchFromRef(ref: string | null | undefined, remoteName?: string | null): string | null {
  const trimmed = ref?.trim()
  if (!trimmed) {
    return null
  }
  const prefixes = remoteName
    ? [`refs/remotes/${remoteName}/`, `remotes/${remoteName}/`, `${remoteName}/`]
    : ['refs/heads/']
  for (const prefix of prefixes) {
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length) || null
    }
  }
  if (trimmed.startsWith('refs/remotes/')) {
    const remoteAndBranch = trimmed.slice('refs/remotes/'.length)
    const slashIndex = remoteAndBranch.indexOf('/')
    return slashIndex > 0 ? remoteAndBranch.slice(slashIndex + 1) : null
  }
  if (trimmed.startsWith('remotes/')) {
    const remoteAndBranch = trimmed.slice('remotes/'.length)
    const slashIndex = remoteAndBranch.indexOf('/')
    return slashIndex > 0 ? remoteAndBranch.slice(slashIndex + 1) : null
  }
  if (trimmed.startsWith('refs/heads/')) {
    return trimmed.slice('refs/heads/'.length) || null
  }
  return trimmed
}

function githubHeadRef(base: RemoteRepoRef, head: RemoteRepoRef, branch: string): string {
  if (base.path.toLowerCase() === head.path.toLowerCase()) {
    return branch
  }
  const owner = head.path.split('/')[0]
  return owner ? `${owner}:${branch}` : branch
}

function appendQuery(url: string, values: Record<string, string>): string {
  const search = new URLSearchParams(values)
  return `${url}?${search.toString()}`
}

// GitHub/Gitea compare refs keep '/' (slashed branch names like feature/foo) and
// ':' (the owner:branch fork qualifier) literal; percent-encoding those separators
// makes GitHub fail to resolve the branch. Only the segments between them are encoded.
function encodeCompareRef(ref: string): string {
  return ref
    .split(':')
    .map((segment) => segment.split('/').map(encodeURIComponent).join('/'))
    .join(':')
}

export function buildSourceControlManualReviewUrl(input: ManualReviewUrlInput): string | null {
  const baseBranch = branchFromRef(input.baseRef, input.repoRemoteName)
  const localBranch = input.branchName?.trim()
  if (!baseBranch || !localBranch || localBranch === 'HEAD') {
    return null
  }

  const baseRemoteUrl = input.repoRemoteUrl?.trim() || input.pushTarget?.remoteUrl?.trim()
  const headRemoteUrl = input.pushTarget?.remoteUrl?.trim() || baseRemoteUrl
  if (!baseRemoteUrl || !headRemoteUrl) {
    return null
  }

  // Why: the tracking upstream is the source of truth for where the branch
  // actually lives on the remote. When it tracks a remote we can't resolve to a
  // URL (a fork tracked via plain git, so pushTarget is empty), a base-repo
  // compare link would 404 — suppress instead of pointing at a missing branch.
  const upstream = parseUpstream(input.upstreamName)
  const baseRemoteName = input.repoRemoteName?.trim() || null
  const hasResolvableForkUrl = Boolean(input.pushTarget?.remoteUrl?.trim())
  if (
    upstream &&
    baseRemoteName &&
    upstream.remoteName !== baseRemoteName &&
    !hasResolvableForkUrl
  ) {
    return null
  }

  const baseRepo = parseRemoteRepo(baseRemoteUrl, input.provider)
  const headRepo = parseRemoteRepo(headRemoteUrl, input.provider)
  if (!baseRepo || !headRepo) {
    return null
  }

  // Why: without a pushTarget or tracking upstream there's no evidence the branch
  // exists on any remote, so a compare/PR-create link would land on GitHub's
  // "There isn't anything to compare" page. No link beats a broken one.
  const pushedBranch = input.pushTarget?.branchName?.trim()
  if (!pushedBranch && !upstream) {
    return null
  }

  const provider = normalizeProvider(input.provider) ?? baseRepo.provider ?? headRepo.provider
  // Prefer the pushed branch name (pushTarget, else the tracking upstream on the
  // base remote) so the link matches what exists remotely, not the local name.
  const headBranch =
    pushedBranch ||
    (upstream && (!baseRemoteName || upstream.remoteName === baseRemoteName)
      ? upstream.branchName
      : localBranch)

  switch (provider) {
    case 'github':
      return `${baseRepo.webBaseUrl}/compare/${encodeCompareRef(baseBranch)}...${encodeCompareRef(
        githubHeadRef(baseRepo, headRepo, headBranch)
      )}?expand=1`
    case 'gitlab':
      return appendQuery(`${baseRepo.webBaseUrl}/-/merge_requests/new`, {
        'merge_request[source_branch]': headBranch,
        'merge_request[target_branch]': baseBranch
      })
    case 'bitbucket':
      return appendQuery(`${baseRepo.webBaseUrl}/pull-requests/new`, {
        source: headBranch,
        dest: baseBranch
      })
    case 'azure-devops':
      return appendQuery(`${baseRepo.webBaseUrl}/pullrequestcreate`, {
        sourceRef: `refs/heads/${headBranch}`,
        targetRef: `refs/heads/${baseBranch}`
      })
    case 'gitea':
      return `${baseRepo.webBaseUrl}/compare/${encodeCompareRef(baseBranch)}...${encodeCompareRef(headBranch)}`
    default:
      return null
  }
}
