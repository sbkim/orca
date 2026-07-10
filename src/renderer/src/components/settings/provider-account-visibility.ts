import type {
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState
} from '../../../../shared/types'

type ProviderAccount =
  | ClaudeRateLimitAccountsState['accounts'][number]
  | CodexRateLimitAccountsState['accounts'][number]

type ProviderAccountSelection = {
  activeAccountId: string | null
  activeAccountIdsByRuntime?: {
    host: string | null
    wsl: Record<string, string | null>
  }
}

export type ProviderAccountRuntimeView = {
  runtime: 'host' | 'wsl'
  wslDistro?: string | null
}

function getAccountRuntime(account: ProviderAccount): {
  runtime: 'host' | 'wsl'
  wslDistro: string | null
} {
  const runtime =
    'authMethod' in account
      ? (account.managedAuthRuntime ?? 'host')
      : (account.managedHomeRuntime ?? 'host')
  return {
    runtime,
    wslDistro: account.wslDistro ?? null
  }
}

function getSelectedAccountIdForRuntime(
  selection: ProviderAccountSelection,
  runtime: ProviderAccountRuntimeView
): string | null {
  if (runtime.runtime === 'host') {
    return selection.activeAccountIdsByRuntime?.host ?? selection.activeAccountId ?? null
  }
  if (runtime.wslDistro) {
    return selection.activeAccountIdsByRuntime?.wsl?.[runtime.wslDistro] ?? null
  }
  const wsl = selection.activeAccountIdsByRuntime?.wsl ?? {}
  if (wsl.__default__) {
    return wsl.__default__
  }
  const selectedIds = Array.from(new Set(Object.values(wsl).filter(Boolean)))
  return selectedIds.length === 1 ? selectedIds[0] : null
}

export function providerAccountMatchesView(
  account: ProviderAccount,
  runtime: ProviderAccountRuntimeView,
  options: {
    remoteOwner: boolean
    ownerPlatform: NodeJS.Platform | null
  }
): boolean {
  const accountView = getAccountRuntime(account)

  if (options.remoteOwner) {
    // Why: provider accounts belong to the Orca runtime, not its client or a
    // downstream SSH host; a Windows runtime owns both host and WSL accounts.
    return options.ownerPlatform === 'win32' || accountView.runtime !== 'wsl'
  }
  if (runtime.runtime === 'host') {
    return accountView.runtime !== 'wsl'
  }
  if (accountView.runtime !== 'wsl') {
    return false
  }
  return runtime.wslDistro ? accountView.wslDistro === runtime.wslDistro : true
}

export function providerAccountIsActiveInView(
  account: ProviderAccount,
  selection: ProviderAccountSelection,
  runtime: ProviderAccountRuntimeView,
  options: {
    remoteOwner: boolean
  }
): boolean {
  if (options.remoteOwner) {
    // Why: remote Windows lists host and WSL accounts in one roster; Active must
    // follow each account's own runtime slot, not the forced host view filter.
    return getSelectedAccountIdForRuntime(selection, getAccountRuntime(account)) === account.id
  }
  return getSelectedAccountIdForRuntime(selection, runtime) === account.id
}
