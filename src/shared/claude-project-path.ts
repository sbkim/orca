import {
  isWindowsAbsolutePathLike,
  normalizeRuntimePathForComparison,
  normalizeRuntimePathSeparators
} from './cross-platform-path'
import { parseWslUncPath } from './wsl-paths'

// Claude Code names each project directory after the session's absolute cwd by
// replacing EVERY non-alphanumeric character with '-' — it does not collapse
// runs of '-' and preserves case (verified against real on-disk names, e.g.
// `/Users/ada/.claude/worktrees/foo` -> `-Users-ada--claude-worktrees-foo`).
// We never decode these names (lossy and non-injective); instead we encode a
// KNOWN workspace path and compare, which keeps the fallback scoped to the
// worktree the user is currently viewing/resuming from.
export function encodeClaudeProjectPath(workspacePath: string): string {
  return normalizeRuntimePathForComparison(workspacePath).replace(/[^a-zA-Z0-9]/g, '-')
}

// Returns the effective cwd to use for a path-only Claude transcript when its
// project folder encodes exactly to one of the given workspace candidates, or
// null when none match. For WSL UNC worktrees the returned cwd is the Linux
// path so POSIX resume commands cd into a real directory, not a UNC path.
export function resolveClaudeSessionWorkspaceCwd(
  filePath: string,
  workspacePath: string
): string | null {
  const folder = claudeProjectFolderName(filePath)
  if (!folder) {
    return null
  }

  for (const candidate of claudeWorkspaceMatchCandidates(workspacePath)) {
    // Claude preserves the original cwd casing in the folder name, so lowercase
    // it only on the Windows branch to mirror normalizeRuntimePathForComparison.
    const folderKey = isWindowsAbsolutePathLike(candidate) ? folder.toLowerCase() : folder
    if (encodeClaudeProjectPath(candidate) === folderKey) {
      return candidate
    }
  }
  return null
}

export function isClaudeSessionFileForWorkspace(filePath: string, workspacePath: string): boolean {
  return resolveClaudeSessionWorkspaceCwd(filePath, workspacePath) !== null
}

function claudeProjectFolderName(filePath: string): string {
  // The transcript's immediate parent directory is Claude's encoded project
  // folder name. String-only (no fs): normalize separators then take the
  // second-to-last segment.
  const segments = normalizeRuntimePathSeparators(filePath).split('/').filter(Boolean)
  return segments.at(-2) ?? ''
}

function claudeWorkspaceMatchCandidates(workspacePath: string): string[] {
  // Claude under WSL encodes the Linux cwd, but Orca may store the worktree as a
  // Windows UNC path; try the Linux path too so the encoded folder can match.
  const wsl = parseWslUncPath(workspacePath)
  return wsl ? [workspacePath, wsl.linuxPath] : [workspacePath]
}
