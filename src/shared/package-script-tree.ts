import type { PackageJsonScript } from './package-json-scripts'

export type PackageScriptTreeNode = {
  key: string
  label: string
  script: PackageJsonScript | null
  children: PackageScriptTreeNode[]
}

function canUseNamespaceTree(name: string): boolean {
  const segments = name.split(':')
  return segments.length > 1 && segments.every((segment) => segment.length > 0)
}

function findOrCreateNode(
  nodes: PackageScriptTreeNode[],
  label: string,
  key: string
): PackageScriptTreeNode {
  const existing = nodes.find((node) => node.label === label)
  if (existing) {
    return existing
  }
  const node: PackageScriptTreeNode = { key, label, script: null, children: [] }
  nodes.push(node)
  return node
}

/** Preserve package.json declaration order while grouping colon namespaces. */
export function buildPackageScriptTree(
  scripts: readonly PackageJsonScript[]
): PackageScriptTreeNode[] {
  const roots: PackageScriptTreeNode[] = []
  for (const script of scripts) {
    const segments = canUseNamespaceTree(script.name) ? script.name.split(':') : [script.name]
    let siblings = roots
    let prefix = ''
    for (const [index, segment] of segments.entries()) {
      prefix = prefix ? `${prefix}:${segment}` : segment
      const node = findOrCreateNode(siblings, segment, prefix)
      if (index === segments.length - 1) {
        node.script = script
      }
      siblings = node.children
    }
  }
  return roots
}

export function searchPackageScripts(
  scripts: readonly PackageJsonScript[],
  query: string,
  packageSearchText: string
): PackageJsonScript[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) {
    return [...scripts]
  }
  return scripts.filter((script) => {
    const searchable = `${packageSearchText} ${script.name} ${script.command}`.toLocaleLowerCase()
    return terms.every((term) => searchable.includes(term))
  })
}
