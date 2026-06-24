import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { isolatedScanRoots, jsonLines } from './isolated-scan-roots'
import { scanAiVaultSessions } from './session-scanner'

let tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })))
  tempRoots = []
})

describe('scanAiVaultSessions path-only Claude transcripts', () => {
  it('keeps cwd null because the scanner does not decode the project folder', async () => {
    // The scanner intentionally does NOT decode the Claude project folder name
    // back into a cwd (decoding is lossy for names with punctuation). It keeps
    // cwd null; the renderer's workspace filter and resume builder match the file
    // path against known worktree paths instead (see ai-vault-session-filters and
    // ai-vault-resume-command tests, which prove the user-visible bug is fixed).
    const root = await mkdtemp(join(tmpdir(), 'orca-ai-vault-claude-project-path-'))
    tempRoots.push(root)
    const roots = isolatedScanRoots(root)
    const claudeProjectDir = join(
      roots.claudeProjectsDir,
      '-Users-ada-orca-workspaces-orca-path-only-session'
    )
    await mkdir(claudeProjectDir, { recursive: true })

    const filePath = join(claudeProjectDir, '77777777-1111-4222-8333-444444444444.jsonl')
    await writeFile(
      filePath,
      jsonLines([
        {
          type: 'user',
          sessionId: '77777777-1111-4222-8333-444444444444',
          timestamp: '2026-06-12T10:00:00.000Z',
          isMeta: false,
          message: { role: 'user', content: 'Find the path-only Claude session' }
        }
      ])
    )

    const result = await scanAiVaultSessions({
      ...roots,
      platform: 'darwin'
    })

    expect(result.issues).toEqual([])
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0]).toMatchObject({
      agent: 'claude',
      sessionId: '77777777-1111-4222-8333-444444444444',
      cwd: null,
      filePath,
      resumeCommand: "claude --resume '77777777-1111-4222-8333-444444444444'"
    })
  })
})
