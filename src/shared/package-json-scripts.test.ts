import { describe, expect, it } from 'vitest'
import {
  buildPackageManagerRunCommand,
  detectPackageManagerFromField,
  detectPackageManagerFromLockfiles,
  getPackageJsonField,
  parsePackageJsonScripts,
  resolvePackageManager
} from './package-json-scripts'
import {
  buildPackageJsonProjects,
  getRunnablePackageJsonPaths,
  isRunnablePackageJsonPath
} from './package-json-projects'

describe('parsePackageJsonScripts', () => {
  it('extracts string-valued scripts in declared order', () => {
    const content = JSON.stringify({
      scripts: { dev: 'vite', build: 'vite build', test: 'vitest' }
    })
    expect(parsePackageJsonScripts(content)).toEqual([
      { name: 'dev', command: 'vite' },
      { name: 'build', command: 'vite build' },
      { name: 'test', command: 'vitest' }
    ])
  })

  it('ignores non-string script values and blank names', () => {
    const content = JSON.stringify({
      scripts: { dev: 'vite', bad: 42, nested: { a: 1 }, '': 'noop' }
    })
    expect(parsePackageJsonScripts(content)).toEqual([{ name: 'dev', command: 'vite' }])
  })

  it('returns an empty array for missing, empty, or invalid input', () => {
    expect(parsePackageJsonScripts(null)).toEqual([])
    expect(parsePackageJsonScripts('')).toEqual([])
    expect(parsePackageJsonScripts('not json')).toEqual([])
    expect(parsePackageJsonScripts(JSON.stringify({}))).toEqual([])
    expect(parsePackageJsonScripts(JSON.stringify({ scripts: [] }))).toEqual([])
  })
})

describe('package manager detection', () => {
  it('reads the packageManager field', () => {
    expect(detectPackageManagerFromField('pnpm@9.1.0')).toBe('pnpm')
    expect(detectPackageManagerFromField('yarn@4.0.0')).toBe('yarn')
    expect(detectPackageManagerFromField('bun@1.1.0')).toBe('bun')
    expect(detectPackageManagerFromField('npm@10.0.0')).toBe('npm')
    expect(detectPackageManagerFromField('deno@1.0.0')).toBeNull()
    expect(detectPackageManagerFromField(undefined)).toBeNull()
  })

  it('reads a single lockfile', () => {
    expect(detectPackageManagerFromLockfiles(['pnpm-lock.yaml', 'README.md'])).toBe('pnpm')
    expect(detectPackageManagerFromLockfiles(['yarn.lock'])).toBe('yarn')
    expect(detectPackageManagerFromLockfiles(['bun.lockb'])).toBe('bun')
  })

  it('returns null on conflicting or absent lockfiles', () => {
    expect(detectPackageManagerFromLockfiles(['pnpm-lock.yaml', 'yarn.lock'])).toBeNull()
    expect(detectPackageManagerFromLockfiles(['README.md'])).toBeNull()
  })

  it('prefers the field, then lockfiles, then npm', () => {
    expect(resolvePackageManager('pnpm@9', ['yarn.lock'])).toBe('pnpm')
    expect(resolvePackageManager(undefined, ['yarn.lock'])).toBe('yarn')
    expect(resolvePackageManager(undefined, [])).toBe('npm')
  })
})

describe('buildPackageManagerRunCommand', () => {
  it('builds a uniform run command per manager', () => {
    expect(buildPackageManagerRunCommand('npm', 'dev')).toBe('npm run dev')
    expect(buildPackageManagerRunCommand('pnpm', 'build')).toBe('pnpm run build')
    expect(buildPackageManagerRunCommand('yarn', 'test')).toBe('yarn run test')
    expect(buildPackageManagerRunCommand('bun', 'lint')).toBe('bun run lint')
  })
})

describe('getPackageJsonField', () => {
  it('returns a top-level field or undefined', () => {
    const content = JSON.stringify({ name: 'orca', packageManager: 'pnpm@9' })
    expect(getPackageJsonField(content, 'packageManager')).toBe('pnpm@9')
    expect(getPackageJsonField(content, 'missing')).toBeUndefined()
    expect(getPackageJsonField(null, 'name')).toBeUndefined()
  })
})

describe('package.json project discovery', () => {
  it('finds root and nested packages while excluding dependency and generated trees', () => {
    const paths = [
      'package.json',
      'packages/app/package.json',
      'packages\\api\\package.json',
      'node_modules/pkg/package.json',
      'packages/app/node_modules/pkg/package.json',
      'dist/package.json',
      '.next/package.json',
      'packages/readme.md'
    ]

    expect(getRunnablePackageJsonPaths(paths)).toEqual([
      'package.json',
      'packages/api/package.json',
      'packages/app/package.json'
    ])
    expect(isRunnablePackageJsonPath('coverage/report/package.json')).toBe(false)
  })

  it('groups scripts by package and inherits the nearest package manager signal', () => {
    const files = [
      {
        relativePath: 'package.json',
        content: JSON.stringify({
          name: 'root',
          packageManager: 'pnpm@9',
          scripts: { dev: 'vite' }
        })
      },
      {
        relativePath: 'packages/web/package.json',
        content: JSON.stringify({ name: '@acme/web', scripts: { build: 'vite build' } })
      },
      {
        relativePath: 'tools/legacy/package.json',
        content: JSON.stringify({ scripts: { test: 'jest' } })
      }
    ]

    expect(
      buildPackageJsonProjects(files, [
        'package.json',
        'pnpm-lock.yaml',
        'packages/web/package.json',
        'tools/legacy/package.json',
        'tools/legacy/package-lock.json'
      ])
    ).toEqual([
      {
        relativeDirectory: '',
        packageName: 'root',
        packageManager: 'pnpm',
        scripts: [{ name: 'dev', command: 'vite' }]
      },
      {
        relativeDirectory: 'packages/web',
        packageName: '@acme/web',
        packageManager: 'pnpm',
        scripts: [{ name: 'build', command: 'vite build' }]
      },
      {
        relativeDirectory: 'tools/legacy',
        packageName: null,
        packageManager: 'npm',
        scripts: [{ name: 'test', command: 'jest' }]
      }
    ])
  })

  it('uses package metadata without scripts as an inheritance boundary', () => {
    const files = [
      {
        relativePath: 'package.json',
        content: JSON.stringify({ packageManager: 'pnpm@9' })
      },
      {
        relativePath: 'apps/package.json',
        content: JSON.stringify({ packageManager: 'yarn@4' })
      },
      {
        relativePath: 'apps/web/package.json',
        content: JSON.stringify({ scripts: { dev: 'next dev' } })
      }
    ]

    expect(
      buildPackageJsonProjects(
        files,
        files.map((file) => file.relativePath)
      )
    ).toEqual([
      {
        relativeDirectory: 'apps/web',
        packageName: null,
        packageManager: 'yarn',
        scripts: [{ name: 'dev', command: 'next dev' }]
      }
    ])
  })
})
