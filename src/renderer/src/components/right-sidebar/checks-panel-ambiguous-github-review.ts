type HostedReviewProviderLike = {
  provider?: string | null
}

type PRCacheEntryLike = {
  data?: unknown
}

export function hasAmbiguousGitHubHostedReviewForChecksPanel(input: {
  hostedReview: HostedReviewProviderLike | null | undefined
  prCacheEntry: PRCacheEntryLike | null | undefined
  prCacheKey: string
}): boolean {
  return (
    input.hostedReview?.provider === 'github' &&
    input.prCacheKey !== '' &&
    input.prCacheEntry?.data == null
  )
}
