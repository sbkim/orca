import type { GitPushTarget, GitUpstreamStatus } from '../../../../shared/types'
import type { HostedReviewState } from '../../../../shared/hosted-review'
import { getPublishTargetDisplayName } from '../../../../shared/git-publish-target-status'

export function hasUsableHostedReviewPushTarget(args: {
  pushTarget?: GitPushTarget
  upstreamStatus?: GitUpstreamStatus
  hasResolvableHostedReviewPushTargetLink?: boolean
  branchName?: string
}): boolean {
  if (args.pushTarget) {
    return (
      args.upstreamStatus === undefined ||
      args.upstreamStatus.upstreamName === getPublishTargetDisplayName(args.pushTarget)
    )
  }
  if (args.hasResolvableHostedReviewPushTargetLink) {
    // Why: a resolver-backed link normally needs hydrated target metadata to
    // prove which head it pushes to. But a same-repo review's head IS the
    // checked-out branch, so a real upstream already tracking that branch is
    // that head and is safe to use before the resolver hydrates. Fork/cross-repo
    // reviews track a differently-named head, so a mismatched (or missing)
    // upstream stays blocked until the resolver proves the real target.
    return (
      args.upstreamStatus?.hasUpstream === true &&
      upstreamTracksBranch(args.upstreamStatus.upstreamName, args.branchName)
    )
  }
  return args.upstreamStatus?.hasConfiguredPushTarget === true
}

function upstreamTracksBranch(
  upstreamName: string | undefined,
  branchName: string | undefined
): boolean {
  if (!upstreamName || !branchName) {
    return false
  }
  // Why: upstreamName is `<remote>/<branch>`; remote names cannot contain `/`,
  // so the branch is everything past the first slash (branches may contain `/`).
  const separatorIndex = upstreamName.indexOf('/')
  return separatorIndex >= 0 && upstreamName.slice(separatorIndex + 1) === branchName
}

function isResolvableHostedReviewNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

export function hasPositiveHostedReviewNumberLink(args: {
  linkedGitHubPR?: number | null
  fallbackGitHubPR?: number | null
  linkedGitLabMR?: number | null
  linkedBitbucketPR?: number | null
  linkedAzureDevOpsPR?: number | null
  linkedGiteaPR?: number | null
}): boolean {
  return (
    isResolvableHostedReviewNumber(args.linkedGitHubPR) ||
    isResolvableHostedReviewNumber(args.fallbackGitHubPR) ||
    isResolvableHostedReviewNumber(args.linkedGitLabMR) ||
    isResolvableHostedReviewNumber(args.linkedBitbucketPR) ||
    isResolvableHostedReviewNumber(args.linkedAzureDevOpsPR) ||
    isResolvableHostedReviewNumber(args.linkedGiteaPR)
  )
}

export function hasResolvableHostedReviewPushTargetLink(args: {
  linkedGitHubPR?: number | null
  linkedGitLabMR?: number | null
}): boolean {
  return (
    isResolvableHostedReviewNumber(args.linkedGitHubPR) ||
    isResolvableHostedReviewNumber(args.linkedGitLabMR)
  )
}

export function resolveHostedReviewActionUpstreamStatus(args: {
  hasHostedReviewLink: boolean
  hasResolvableHostedReviewPushTargetLink: boolean
  hostedReviewState?: HostedReviewState | null
  isHostedReviewStateLoading: boolean
  canUseHostedReviewPushTarget: boolean
  upstreamStatus?: GitUpstreamStatus
}): GitUpstreamStatus | undefined {
  const hostedReviewMayStillNeedItsOwnTarget =
    // Why: SSH-backed linked reviews may not fetch live review state, but
    // their explicit link metadata still needs target-safe push behavior.
    (args.hasResolvableHostedReviewPushTargetLink && !args.hostedReviewState) ||
    args.isHostedReviewStateLoading ||
    args.hostedReviewState === 'open' ||
    args.hostedReviewState === 'draft'
  if (
    args.hasHostedReviewLink &&
    hostedReviewMayStillNeedItsOwnTarget &&
    !args.canUseHostedReviewPushTarget
  ) {
    // Why: a linked hosted review can coexist with an unrelated branch upstream;
    // push/status actions must not use that upstream until the review target is known.
    return { hasUpstream: false, ahead: 0, behind: 0 }
  }
  return args.upstreamStatus
}

export function resolveHostedReviewStateForActions(args: {
  hostedReviewState?: HostedReviewState | null
  hasResolvableHostedReviewPushTargetLink: boolean
}): HostedReviewState | null {
  if (args.hostedReviewState) {
    return args.hostedReviewState
  }
  // Why: SSH-backed linked reviews may not have live review state, but Publish
  // Branch is unsafe until the linked review target is usable.
  return args.hasResolvableHostedReviewPushTargetLink ? 'open' : null
}
