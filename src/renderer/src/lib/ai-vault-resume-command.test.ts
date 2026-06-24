import { describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import {
  buildAiVaultResumeCommandForWorktree,
  getAiVaultResumePlatform
} from './ai-vault-resume-command'

vi.mock('@/lib/new-workspace', () => ({
  CLIENT_PLATFORM: 'win32'
}))

type RuntimePreference = { kind: 'windows-host' } | { kind: 'wsl'; distro: string }

function makeState(args: {
  worktreePath: string
  localWindowsRuntimePreference?: RuntimePreference
}): Pick<
  AppState,
  'activeRepoId' | 'activeWorktreeId' | 'projects' | 'repos' | 'settings' | 'worktreesByRepo'
> {
  return {
    activeRepoId: 'repo-1',
    activeWorktreeId: 'repo-1::worktree-1',
    repos: [{ id: 'repo-1', path: 'C:\\Users\\alice\\repo' }],
    projects: [
      {
        id: 'repo-1',
        sourceRepoIds: ['repo-1'],
        ...(args.localWindowsRuntimePreference
          ? { localWindowsRuntimePreference: args.localWindowsRuntimePreference }
          : {})
      }
    ],
    settings: { localWindowsRuntimeDefault: { kind: 'windows-host' } },
    worktreesByRepo: {
      'repo-1': [
        {
          id: 'repo-1::worktree-1',
          repoId: 'repo-1',
          path: args.worktreePath
        }
      ]
    }
  } as unknown as Pick<
    AppState,
    'activeRepoId' | 'activeWorktreeId' | 'projects' | 'repos' | 'settings' | 'worktreesByRepo'
  >
}

describe('ai vault resume command runtime', () => {
  it('uses Windows command wrapping for Windows-host projects', () => {
    const state = makeState({ worktreePath: 'C:\\Users\\alice\\repo' })

    expect(
      buildAiVaultResumeCommandForWorktree({
        state,
        worktreeId: 'repo-1::worktree-1',
        session: {
          agent: 'claude',
          sessionId: 'session one',
          cwd: 'C:\\Users\\alice\\repo',
          codexHome: null,
          filePath: 'C:\\Users\\alice\\.claude\\projects\\repo\\s.jsonl'
        }
      })
    ).toBe('cmd /d /s /c "cd /d ""C:\\Users\\alice\\repo"" && claude --resume ""session one"""')
  })

  it('resumes a path-only Claude session into the matching worktree cwd', () => {
    const state = makeState({
      worktreePath: '/Users/ada/orca/workspaces/orca/path-only-session',
      localWindowsRuntimePreference: { kind: 'wsl', distro: 'Ubuntu' }
    })

    expect(
      buildAiVaultResumeCommandForWorktree({
        state,
        worktreeId: 'repo-1::worktree-1',
        session: {
          agent: 'claude',
          sessionId: 'session one',
          cwd: null,
          codexHome: null,
          filePath:
            '/Users/ada/.claude/projects/-Users-ada-orca-workspaces-orca-path-only-session/s.jsonl'
        }
      })
    ).toBe(
      "cd '/Users/ada/orca/workspaces/orca/path-only-session' && claude --resume 'session one'"
    )
  })

  it('keeps a no-cwd command when a path-only Claude session does not match the worktree', () => {
    const state = makeState({
      worktreePath: '/Users/ada/orca/workspaces/orca/other-session',
      localWindowsRuntimePreference: { kind: 'wsl', distro: 'Ubuntu' }
    })

    expect(
      buildAiVaultResumeCommandForWorktree({
        state,
        worktreeId: 'repo-1::worktree-1',
        session: {
          agent: 'claude',
          sessionId: 'session one',
          cwd: null,
          codexHome: null,
          filePath:
            '/Users/ada/.claude/projects/-Users-ada-orca-workspaces-orca-path-only-session/s.jsonl'
        }
      })
    ).toBe("claude --resume 'session one'")
  })

  it('resumes a WSL path-only Claude session into the linux cwd', () => {
    const state = makeState({
      worktreePath: '\\\\wsl.localhost\\Ubuntu\\home\\ada\\repo'
    })

    expect(
      buildAiVaultResumeCommandForWorktree({
        state,
        worktreeId: 'repo-1::worktree-1',
        session: {
          agent: 'claude',
          sessionId: 'session one',
          cwd: null,
          codexHome: null,
          filePath: '/Users/ada/.claude/projects/-home-ada-repo/s.jsonl'
        }
      })
    ).toBe("cd '/home/ada/repo' && claude --resume 'session one'")
  })

  it('uses POSIX command wrapping for Windows-path projects forced to WSL', () => {
    const state = makeState({
      worktreePath: 'C:\\Users\\alice\\repo',
      localWindowsRuntimePreference: { kind: 'wsl', distro: 'Ubuntu' }
    })

    expect(getAiVaultResumePlatform(state, 'repo-1::worktree-1')).toBe('linux')
    expect(
      buildAiVaultResumeCommandForWorktree({
        state,
        worktreeId: 'repo-1::worktree-1',
        session: {
          agent: 'claude',
          sessionId: 'session one',
          cwd: '/home/alice/repo',
          codexHome: null,
          filePath: '/home/alice/.claude/projects/repo/s.jsonl'
        }
      })
    ).toBe("cd '/home/alice/repo' && claude --resume 'session one'")
  })

  it('keeps WSL UNC worktrees on POSIX command wrapping without an explicit override', () => {
    const state = makeState({
      worktreePath: '\\\\wsl.localhost\\Ubuntu\\home\\alice\\repo'
    })

    expect(getAiVaultResumePlatform(state, 'repo-1::worktree-1')).toBe('linux')
  })

  it('converts WSL UNC Codex homes before building Linux resume commands', () => {
    const state = makeState({
      worktreePath: '\\\\wsl.localhost\\Ubuntu\\home\\alice\\repo'
    })

    expect(
      buildAiVaultResumeCommandForWorktree({
        state,
        worktreeId: 'repo-1::worktree-1',
        session: {
          agent: 'codex',
          sessionId: 'session one',
          cwd: '/home/alice/repo',
          codexHome: '\\\\wsl.localhost\\Ubuntu\\home\\alice\\.codex',
          filePath: '/home/alice/.codex/sessions/s.jsonl'
        }
      })
    ).toBe("cd '/home/alice/repo' && CODEX_HOME='/home/alice/.codex' codex resume 'session one'")
  })
})
