import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname

function componentSource(relativePath: string): string {
  return readFileSync(join(COMPONENT_ROOT, relativePath), 'utf8')
}

function sourceBetween(source: string, startPattern: string, endPattern: string): string {
  const start = source.indexOf(startPattern)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf(endPattern, start + startPattern.length)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('GitHubItemDialog source host boundaries', () => {
  it('does not keep the stale right-side sheet owner', () => {
    const source = componentSource('GitHubItemDialog.tsx')

    expect(source).not.toContain('@/components/ui/sheet')
    expect(source).not.toContain('<Sheet')
    expect(source).not.toContain('<SheetContent')
    expect(source).not.toContain("variant?: 'sheet'")
  })

  it('routes reviewer metadata and reviewer mutations through the task source context', () => {
    const source = componentSource('GitHubItemDialog.tsx')
    const section = sourceBetween(source, 'function PRReviewersPanel', 'function isPRFileViewed')

    expect(section).toContain('getTaskSourceRuntimeSettings(sourceContext)')
    expect(section).toContain('useRepoAssigneesBySlug(')
    expect(section).toContain('sourceSettings')
    expect(section).toContain('useRepoAssignees(')
    expect(section).toContain('sourceSettings')
    expect(section).toContain('getActiveRuntimeTarget(sourceSettings)')
  })

  it('routes edit metadata through the same task source as issue mutations', () => {
    const source = componentSource('GitHubItemDialog.tsx')
    const section = sourceBetween(source, 'function GHEditSection', 'const hasAttachedWorkspace')

    expect(section).toContain('getTaskSourceRuntimeSettings(sourceContext)')
    expect(section).toContain('useRepoLabels(')
    // Why (issue #1715): the slug lookups gained a trailing repoTarget arg for
    // multi-host gh routing; sourceSettings must still be the source-routing arg.
    expect(section).toContain(
      'useRepoLabelsBySlug(slugOwner, slugRepo, sourceSettings, repoTarget)'
    )
    expect(section).toContain('useRepoAssignees(')
    expect(section).toContain('useRepoAssigneesBySlug(')
    expect(section).toContain('sourceSettings')
  })
})
