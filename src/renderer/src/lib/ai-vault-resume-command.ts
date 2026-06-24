import { buildAiVaultResumeCommand, type AiVaultSession } from '../../../shared/ai-vault-types'
import { resolveClaudeSessionWorkspaceCwd } from '../../../shared/claude-project-path'
import { parseWslUncPath } from '../../../shared/wsl-paths'
import type { AppState } from '@/store/types'
import { getLocalProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import { CLIENT_PLATFORM } from '@/lib/new-workspace'

type AiVaultResumeWorktree = { id: string; path?: string }

type AiVaultResumeState = Pick<
  AppState,
  'activeRepoId' | 'activeWorktreeId' | 'projects' | 'repos' | 'settings' | 'worktreesByRepo'
>

type AiVaultResumeCommandSession = Pick<
  AiVaultSession,
  'agent' | 'sessionId' | 'cwd' | 'codexHome' | 'filePath'
>

export function buildAiVaultResumeCommandForWorktree(args: {
  state: AiVaultResumeState
  worktreeId?: string | null
  session: AiVaultResumeCommandSession
  commandOverride?: string | null
}): string {
  const platform = getAiVaultResumePlatform(args.state, args.worktreeId)
  const codexHome = getAiVaultResumeCodexHome(args.session.codexHome, platform)
  const cwd = resolveAiVaultResumeCwd(args.state, args.worktreeId, args.session)
  return buildAiVaultResumeCommand({
    agent: args.session.agent,
    sessionId: args.session.sessionId,
    cwd,
    platform,
    commandOverride: args.commandOverride,
    codexHome
  })
}

function resolveAiVaultResumeCwd(
  state: AiVaultResumeState,
  worktreeId: string | null | undefined,
  session: AiVaultResumeCommandSession
): string | null {
  if (session.cwd) {
    return session.cwd
  }
  // Path-only Claude transcripts carry no cwd; resume into the target worktree
  // only when its path encodes to the transcript's Claude project folder.
  if (session.agent !== 'claude') {
    return null
  }
  const worktreePath = findAiVaultResumeWorktree(state, worktreeId)?.path
  if (!worktreePath) {
    return null
  }
  return resolveClaudeSessionWorkspaceCwd(session.filePath, worktreePath)
}

function findAiVaultResumeWorktree(
  state: AiVaultResumeState,
  worktreeId: string | null | undefined
): AiVaultResumeWorktree | null {
  const targetWorktreeId = worktreeId ?? state.activeWorktreeId
  if (!targetWorktreeId) {
    return null
  }
  return (
    Object.values(state.worktreesByRepo ?? {})
      .flat()
      .find((candidate) => candidate.id === targetWorktreeId) ?? null
  )
}

function getAiVaultResumeCodexHome(
  codexHome: string | null,
  platform: NodeJS.Platform
): string | null {
  // Why: WSL UNC Codex homes must be POSIX when invoking Linux commands.
  // Keep original paths unchanged for non-Linux targets.
  if (!codexHome || platform !== 'linux') {
    return codexHome
  }
  return parseWslUncPath(codexHome)?.linuxPath ?? codexHome
}

export function getAiVaultResumePlatform(
  state: AiVaultResumeState,
  worktreeId?: string | null
): NodeJS.Platform {
  const projectRuntime = getLocalProjectExecutionRuntimeContext(state, worktreeId, CLIENT_PLATFORM)
  if (projectRuntime?.status === 'repair-required') {
    return projectRuntime.repair.preferredRuntime.kind === 'wsl' ? 'linux' : CLIENT_PLATFORM
  }
  if (projectRuntime?.status === 'resolved' && projectRuntime.runtime.kind === 'wsl') {
    return 'linux'
  }

  const worktree = findAiVaultResumeWorktree(state, worktreeId)
  return worktree?.path && parseWslUncPath(worktree.path) ? 'linux' : CLIENT_PLATFORM
}
