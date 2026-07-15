import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const workflowPath = join(projectDir, '.github/workflows/dev-desktop-release.yml')

describe('dev desktop release workflow', () => {
  const source = readFileSync(workflowPath, 'utf8')
  const workflow = parse(source)

  it('runs only for the fork dev branch', () => {
    expect(workflow.on.push.branches).toEqual(['dev'])
    expect(workflow.jobs.prepare.if).toContain("github.repository == 'sbkim/orca'")
    expect(workflow.jobs.prepare.if).toContain("github.ref == 'refs/heads/dev'")
  })

  it('builds all desktop platforms with official updates disabled', () => {
    const build = workflow.jobs.build
    const platforms = build.strategy.matrix.include.map((entry) => entry.platform)

    expect(platforms).toEqual(['macos', 'windows', 'linux'])
    expect(build.env.ORCA_DISABLE_AUTO_UPDATE).toBe('1')
    expect(build.env.CSC_IDENTITY_AUTO_DISCOVERY).toBe('false')
    expect(source).toContain('pnpm build:desktop')
    expect(source).toContain('pnpm build:computer-macos')
    for (const entry of build.strategy.matrix.include) {
      expect(entry.package_command).toContain('--publish never')
    }
  })

  it('publishes only after every platform build succeeds', () => {
    const publish = workflow.jobs.publish
    const publishScript = publish.steps.find((step) => step.name === 'Publish fork dev prerelease')

    expect(publish.needs).toEqual(['prepare', 'build'])
    expect(publish.permissions.contents).toBe('write')
    expect(publishScript.run).toContain('gh release create')
    expect(publishScript.run).toContain('--draft')
    expect(publishScript.run).toContain('--prerelease')
    expect(publishScript.run).toContain('gh release upload')
    expect(publishScript.run).toContain('--draft=false')
  })
})
