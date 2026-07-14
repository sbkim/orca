import {
  detectPackageManagerFromField,
  detectPackageManagerFromLockfiles,
  getPackageJsonField,
  parsePackageJsonScripts,
  type PackageJsonScript,
  type PackageManagerName
} from './package-json-scripts'

export type PackageJsonProject = {
  relativeDirectory: string
  packageName: string | null
  scripts: PackageJsonScript[]
  packageManager: PackageManagerName
}

export type PackageJsonFileContent = {
  relativePath: string
  content: string
}

const GENERATED_PACKAGE_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.cache',
  '.next',
  '.nuxt',
  '.output',
  '.pnpm-store',
  '.turbo',
  '.yarn',
  'build',
  'coverage',
  'dist',
  'out'
])

const LOCKFILE_NAMES = new Set([
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'yarn.lock',
  'package-lock.json',
  'npm-shrinkwrap.json'
])

function normalizeRelativePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
}

function relativeDirectory(path: string): string {
  const separator = path.lastIndexOf('/')
  return separator === -1 ? '' : path.slice(0, separator)
}

function ancestorDirectories(directory: string): string[] {
  if (!directory) {
    return ['']
  }
  const segments = directory.split('/')
  const result: string[] = []
  for (let length = segments.length; length > 0; length--) {
    result.push(segments.slice(0, length).join('/'))
  }
  result.push('')
  return result
}

export function isRunnablePackageJsonPath(path: string): boolean {
  const normalized = normalizeRelativePath(path)
  const segments = normalized.split('/')
  if (segments.pop() !== 'package.json') {
    return false
  }
  return !segments.some((segment) => GENERATED_PACKAGE_DIRECTORIES.has(segment.toLowerCase()))
}

export function getRunnablePackageJsonPaths(filePaths: readonly string[]): string[] {
  return filePaths
    .map(normalizeRelativePath)
    .filter(isRunnablePackageJsonPath)
    .sort((left, right) => {
      const leftDepth = left.split('/').length
      const rightDepth = right.split('/').length
      return leftDepth - rightDepth || left.localeCompare(right)
    })
}

function packageNameFromContent(content: string): string | null {
  const value = getPackageJsonField(content, 'name')
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * Build runnable package groups and inherit the nearest package-manager signal.
 * A nested lockfile can therefore override the workspace root without making
 * ordinary workspace packages repeat the root packageManager field.
 */
export function buildPackageJsonProjects(
  packageJsonFiles: readonly PackageJsonFileContent[],
  allFilePaths: readonly string[]
): PackageJsonProject[] {
  const normalizedFiles = allFilePaths.map(normalizeRelativePath)
  const lockfilesByDirectory = new Map<string, string[]>()
  for (const path of normalizedFiles) {
    const name = path.slice(path.lastIndexOf('/') + 1)
    if (!LOCKFILE_NAMES.has(name)) {
      continue
    }
    const directory = relativeDirectory(path)
    lockfilesByDirectory.set(directory, [...(lockfilesByDirectory.get(directory) ?? []), name])
  }

  const parsedPackages = packageJsonFiles
    .filter((file) => isRunnablePackageJsonPath(file.relativePath))
    .map((file) => ({
      relativeDirectory: relativeDirectory(normalizeRelativePath(file.relativePath)),
      packageName: packageNameFromContent(file.content),
      packageManagerField: getPackageJsonField(file.content, 'packageManager'),
      scripts: parsePackageJsonScripts(file.content)
    }))
  const packageByDirectory = new Map(
    parsedPackages.map((project) => [project.relativeDirectory, project])
  )

  return parsedPackages
    .filter((project) => project.scripts.length > 0)
    .map((project) => {
      let packageManager: PackageManagerName | null = null
      for (const directory of ancestorDirectories(project.relativeDirectory)) {
        packageManager =
          detectPackageManagerFromField(packageByDirectory.get(directory)?.packageManagerField) ??
          detectPackageManagerFromLockfiles(lockfilesByDirectory.get(directory) ?? [])
        if (packageManager) {
          break
        }
      }
      return { ...project, packageManager: packageManager ?? 'npm' }
    })
    .map(({ packageManagerField: _packageManagerField, ...project }) => project)
    .sort((left, right) => {
      const leftDepth = left.relativeDirectory ? left.relativeDirectory.split('/').length : 0
      const rightDepth = right.relativeDirectory ? right.relativeDirectory.split('/').length : 0
      return leftDepth - rightDepth || left.relativeDirectory.localeCompare(right.relativeDirectory)
    })
}
