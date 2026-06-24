import { describe, expect, it } from 'vitest'
import {
  encodeClaudeProjectPath,
  isClaudeSessionFileForWorkspace,
  resolveClaudeSessionWorkspaceCwd
} from './claude-project-path'

describe('encodeClaudeProjectPath', () => {
  it('replaces every non-alphanumeric char with a dash without collapsing runs', () => {
    expect(encodeClaudeProjectPath('/Users/ada/orca/workspaces/orca/path-only-session')).toBe(
      '-Users-ada-orca-workspaces-orca-path-only-session'
    )
    // `/.` produces `--`, not a single dash (no run collapsing).
    expect(encodeClaudeProjectPath('/Users/ada/.superset/worktrees/foo')).toBe(
      '-Users-ada--superset-worktrees-foo'
    )
    expect(encodeClaudeProjectPath('/Users/ada/source/orca/.claude/worktrees/foo')).toBe(
      '-Users-ada-source-orca--claude-worktrees-foo'
    )
  })

  it('preserves POSIX case but lowercases Windows-flavored paths', () => {
    expect(encodeClaudeProjectPath('/Users/Ada/Repo')).toBe('-Users-Ada-Repo')
    expect(encodeClaudeProjectPath('C:\\Users\\Ada\\repo')).toBe('c--users-ada-repo')
  })

  it('trims a trailing separator before encoding', () => {
    expect(encodeClaudeProjectPath('/Users/ada/repo/')).toBe('-Users-ada-repo')
  })
})

describe('resolveClaudeSessionWorkspaceCwd', () => {
  const fileFor = (folder: string): string =>
    `/Users/ada/.claude/projects/${folder}/77777777-1111-4222-8333-444444444444.jsonl`

  it('matches an all-slash workspace path to its Claude folder', () => {
    const workspace = '/Users/ada/orca/workspaces/orca/path-only-session'
    expect(
      resolveClaudeSessionWorkspaceCwd(
        fileFor('-Users-ada-orca-workspaces-orca-path-only-session'),
        workspace
      )
    ).toBe(workspace)
  })

  it('matches a dotted/underscored worktree path a slash-only encoder would miss', () => {
    const workspace = '/Users/ada/source/orca/.claude/worktrees/my_project'
    expect(
      resolveClaudeSessionWorkspaceCwd(
        fileFor('-Users-ada-source-orca--claude-worktrees-my-project'),
        workspace
      )
    ).toBe(workspace)
  })

  it('does not match when a single encoded character differs', () => {
    expect(
      resolveClaudeSessionWorkspaceCwd(
        fileFor('-Users-ada-orca-workspaces-orca-path-only-sessions'),
        '/Users/ada/orca/workspaces/orca/path-only-session'
      )
    ).toBeNull()
  })

  it('documents punctuation-variant paths collide under Claude project encoding', () => {
    const folder = fileFor('-Users-ada-orca-workspaces-foo-bar')

    expect(resolveClaudeSessionWorkspaceCwd(folder, '/Users/ada/orca/workspaces/foo-bar')).toBe(
      '/Users/ada/orca/workspaces/foo-bar'
    )
    expect(resolveClaudeSessionWorkspaceCwd(folder, '/Users/ada/orca/workspaces/foo_bar')).toBe(
      '/Users/ada/orca/workspaces/foo_bar'
    )
  })

  it('matches a WSL UNC worktree against its linux-encoded folder and returns the linux cwd', () => {
    expect(
      resolveClaudeSessionWorkspaceCwd(
        fileFor('-home-ada-repo'),
        '\\\\wsl.localhost\\Ubuntu\\home\\ada\\repo'
      )
    ).toBe('/home/ada/repo')
  })

  it('tolerates Windows case drift between recorded cwd and stored worktree path', () => {
    expect(
      resolveClaudeSessionWorkspaceCwd(fileFor('c--users-ada-repo'), 'C:\\Users\\Ada\\repo')
    ).toBe('C:\\Users\\Ada\\repo')
  })

  it('exposes a boolean predicate', () => {
    expect(isClaudeSessionFileForWorkspace(fileFor('-Users-ada-repo'), '/Users/ada/repo')).toBe(
      true
    )
    expect(isClaudeSessionFileForWorkspace(fileFor('-Users-ada-repo'), '/Users/ada/other')).toBe(
      false
    )
  })
})
