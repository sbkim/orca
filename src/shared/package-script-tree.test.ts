import { describe, expect, it } from 'vitest'
import { buildPackageScriptTree, searchPackageScripts } from './package-script-tree'

describe('buildPackageScriptTree', () => {
  it('groups colon-delimited scripts and keeps runnable namespace nodes', () => {
    expect(
      buildPackageScriptTree([
        { name: 'test', command: 'vitest' },
        { name: 'test:coverage', command: 'vitest --coverage' },
        { name: 'flutter:dev:android', command: 'flutter run' },
        { name: 'build', command: 'turbo build' }
      ])
    ).toEqual([
      {
        key: 'test',
        label: 'test',
        script: { name: 'test', command: 'vitest' },
        children: [
          {
            key: 'test:coverage',
            label: 'coverage',
            script: { name: 'test:coverage', command: 'vitest --coverage' },
            children: []
          }
        ]
      },
      {
        key: 'flutter',
        label: 'flutter',
        script: null,
        children: [
          {
            key: 'flutter:dev',
            label: 'dev',
            script: null,
            children: [
              {
                key: 'flutter:dev:android',
                label: 'android',
                script: { name: 'flutter:dev:android', command: 'flutter run' },
                children: []
              }
            ]
          }
        ]
      },
      {
        key: 'build',
        label: 'build',
        script: { name: 'build', command: 'turbo build' },
        children: []
      }
    ])
  })

  it('keeps malformed namespaces as one runnable leaf', () => {
    expect(buildPackageScriptTree([{ name: 'deploy::prod', command: 'deploy prod' }])).toEqual([
      {
        key: 'deploy::prod',
        label: 'deploy::prod',
        script: { name: 'deploy::prod', command: 'deploy prod' },
        children: []
      }
    ])
  })
})

describe('searchPackageScripts', () => {
  const scripts = [
    { name: 'flutter:build:ios:prod', command: 'flutter build ios --release' },
    { name: 'fastlane:ios:testflight', command: 'bundle exec fastlane ios testflight' }
  ]

  it('matches script names and commands with all query terms', () => {
    expect(searchPackageScripts(scripts, 'flutter release', 'workuul workspace root')).toEqual([
      scripts[0]
    ])
  })

  it('matches package names and paths', () => {
    expect(searchPackageScripts(scripts, 'workuul', 'workuul workspace root')).toEqual(scripts)
  })
})
