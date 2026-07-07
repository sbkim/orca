import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mutable Electron app stub, hoisted so the vi.mock factory closes over it.
const { electronApp } = vi.hoisted(() => ({
  electronApp: {
    isPackaged: true,
    userDataPath: '',
    version: '9.9.9',
    getPath: (): string => electronApp.userDataPath,
    getVersion: (): string => electronApp.version
  }
}))

vi.mock('electron', () => ({ app: electronApp }))

import {
  buildDaemonHostManifest,
  collectPinnedDaemonVersions,
  getRelocatedDaemonHost,
  materializeRelocatedDaemonHost,
  pruneOldDaemonHosts
} from './daemon-host-relocation'

let tempDir: string
let installDir: string
let userDataDir: string
const originalPlatform = process.platform
const originalExecPath = process.execPath
const originalResourcesPath = process.resourcesPath

function setProcessProp(key: string, value: unknown): void {
  Object.defineProperty(process, key, { value, configurable: true, writable: true })
}

// Build a win-unpacked fixture: exe + blobs + DLLs at root, daemon bundle and
// node-pty under resources, mirroring the packaged layout the copy expects.
function buildInstallFixture(root: string): void {
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'Orca.exe'), 'exe-bytes')
  for (const name of ['icudtl.dat', 'snapshot_blob.bin', 'v8_context_snapshot.bin']) {
    writeFileSync(join(root, name), name)
  }
  writeFileSync(join(root, 'ffmpeg.dll'), 'dll')
  writeFileSync(join(root, 'libEGL.dll'), 'dll')
  const mainDir = join(root, 'resources', 'app.asar.unpacked', 'out', 'main')
  mkdirSync(join(mainDir, 'chunks'), { recursive: true })
  writeFileSync(join(mainDir, 'daemon-entry.js'), 'entry')
  writeFileSync(join(mainDir, 'chunks', 'a.js'), 'chunk')
  writeFileSync(join(root, 'resources', 'app.asar.unpacked', 'out', 'package.json'), '{}')
  const nativeDir = join(root, 'resources', 'node_modules', 'node-pty', 'build', 'Release')
  mkdirSync(nativeDir, { recursive: true })
  writeFileSync(join(nativeDir, 'conpty.node'), 'native')
  mkdirSync(join(nativeDir, 'conpty'), { recursive: true })
  writeFileSync(join(nativeDir, 'conpty', 'conpty.dll'), 'conpty-dll')
}

beforeEach(() => {
  tempDir = mkdtempSync(join(os.tmpdir(), 'daemon-host-relocation-'))
  installDir = join(tempDir, 'app')
  userDataDir = join(tempDir, 'userData')
  mkdirSync(userDataDir, { recursive: true })
  buildInstallFixture(installDir)
  electronApp.isPackaged = true
  electronApp.userDataPath = userDataDir
  electronApp.version = '9.9.9'
  setProcessProp('platform', 'win32')
  setProcessProp('execPath', join(installDir, 'Orca.exe'))
  setProcessProp('resourcesPath', join(installDir, 'resources'))
})

afterEach(() => {
  setProcessProp('platform', originalPlatform)
  setProcessProp('execPath', originalExecPath)
  setProcessProp('resourcesPath', originalResourcesPath)
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // Best-effort
  }
})

describe('buildDaemonHostManifest', () => {
  it('mirrors the win-unpacked layout: root exe/blobs/dlls, resources tree verbatim', () => {
    const appDir = 'C:\\app'
    const ops = buildDaemonHostManifest(
      {
        appDir,
        execPath: 'C:\\app\\Orca.exe',
        resourcesPath: 'C:\\app\\resources',
        entrySourcePath: 'C:\\app\\resources\\app.asar.unpacked\\out\\main\\daemon-entry.js',
        entryRelPath: 'resources/app.asar.unpacked/out/main/daemon-entry.js'
      },
      ['ffmpeg.dll', 'libEGL.dll']
    )
    const byDest = new Map(ops.map((op) => [op.destRel, op]))
    // The host exe is renamed to a distinct image name (NOT the source basename)
    // so the NSIS updater's name-based `taskkill /IM Orca.exe` can't kill it.
    expect(byDest.get('orca-terminal-daemon.exe')?.kind).toBe('file')
    expect(byDest.has('Orca.exe')).toBe(false)
    const exeOp = ops.find((op) => op.sourcePath === 'C:\\app\\Orca.exe')
    expect(exeOp?.destRel).not.toBe('Orca.exe')
    expect(byDest.has('icudtl.dat')).toBe(true)
    expect(byDest.has('ffmpeg.dll')).toBe(true)
    expect(byDest.has('libEGL.dll')).toBe(true)
    // Daemon bundle + node-pty mirrored at their real resources-relative paths.
    expect(byDest.get('resources/app.asar.unpacked/out/main/daemon-entry.js')?.kind).toBe('file')
    expect(byDest.get('resources/app.asar.unpacked/out/main/chunks')?.kind).toBe('dir')
    expect(byDest.get('resources/node_modules/node-pty')?.kind).toBe('dir')
  })
})

describe('materializeRelocatedDaemonHost', () => {
  it('copies the tree, writes the marker, and returns mirrored fork paths', () => {
    const result = materializeRelocatedDaemonHost()
    expect(result).not.toBeNull()
    const dest = join(userDataDir, 'daemon-host', '9.9.9')
    expect(result?.execPath).toBe(join(dest, 'orca-terminal-daemon.exe'))
    expect(result?.entryPath).toBe(
      join(dest, 'resources', 'app.asar.unpacked', 'out', 'main', 'daemon-entry.js')
    )
    expect(existsSync(result!.execPath)).toBe(true)
    expect(existsSync(result!.entryPath)).toBe(true)
    // node-pty native + conpty runtime copied at the require-resolvable path.
    expect(
      existsSync(
        join(dest, 'resources', 'node_modules', 'node-pty', 'build', 'Release', 'conpty.node')
      )
    ).toBe(true)
    expect(
      existsSync(join(dest, 'resources', 'app.asar.unpacked', 'out', 'main', 'chunks', 'a.js'))
    ).toBe(true)
    // Marker records the version + entry rel path, written into the published dir.
    const marker = JSON.parse(readFileSync(join(dest, '.materialized.json'), 'utf8'))
    expect(marker.version).toBe('9.9.9')
    expect(marker.entryRelPath).toBe('resources/app.asar.unpacked/out/main/daemon-entry.js')
  })

  it('is idempotent: a valid marker short-circuits without recopying', () => {
    materializeRelocatedDaemonHost()
    const dest = join(userDataDir, 'daemon-host', '9.9.9')
    // A recopy would rm the dest; a sentinel inside it must survive the 2nd call.
    const sentinel = join(dest, 'sentinel.txt')
    writeFileSync(sentinel, 'keep')
    const result = materializeRelocatedDaemonHost()
    expect(result?.execPath).toBe(join(dest, 'orca-terminal-daemon.exe'))
    expect(existsSync(sentinel)).toBe(true)
  })

  it('fails open on a missing required input, leaving no dest or staging dir', () => {
    rmSync(join(installDir, 'resources', 'node_modules', 'node-pty'), {
      recursive: true,
      force: true
    })
    const result = materializeRelocatedDaemonHost()
    expect(result).toBeNull()
    const hostRoot = join(userDataDir, 'daemon-host')
    // Neither the published dest nor any leftover staging dir remains.
    const remaining = existsSync(hostRoot) ? readdirSync(hostRoot) : []
    expect(remaining).toEqual([])
  })

  it('returns null off win32', () => {
    setProcessProp('platform', 'darwin')
    expect(materializeRelocatedDaemonHost()).toBeNull()
    expect(existsSync(join(userDataDir, 'daemon-host'))).toBe(false)
  })
})

describe('getRelocatedDaemonHost', () => {
  it('returns null when the marker version does not match the current version', () => {
    const dest = join(userDataDir, 'daemon-host', '9.9.9')
    mkdirSync(dirname(join(dest, 'x')), { recursive: true })
    writeFileSync(join(dest, 'Orca.exe'), 'exe')
    mkdirSync(join(dest, 'resources', 'app.asar.unpacked', 'out', 'main'), { recursive: true })
    writeFileSync(
      join(dest, 'resources', 'app.asar.unpacked', 'out', 'main', 'daemon-entry.js'),
      'e'
    )
    writeFileSync(
      join(dest, '.materialized.json'),
      JSON.stringify({
        version: '8.8.8',
        completedAt: '',
        entryRelPath: 'resources/app.asar.unpacked/out/main/daemon-entry.js'
      })
    )
    expect(getRelocatedDaemonHost()).toBeNull()
  })
})

describe('pruneOldDaemonHosts', () => {
  it('removes unpinned non-current version dirs, keeping current and pinned', () => {
    const root = join(userDataDir, 'daemon-host')
    for (const v of ['9.9.9', '1.0.0', '2.0.0']) {
      mkdirSync(join(root, v), { recursive: true })
    }
    pruneOldDaemonHosts(new Set(['2.0.0']))
    expect(existsSync(join(root, '9.9.9'))).toBe(true)
    expect(existsSync(join(root, '2.0.0'))).toBe(true)
    expect(existsSync(join(root, '1.0.0'))).toBe(false)
  })
})

describe('collectPinnedDaemonVersions', () => {
  it('pins the app version of a live daemon pid file and skips dead ones', () => {
    const runtimeDir = join(userDataDir, 'daemon')
    mkdirSync(runtimeDir, { recursive: true })
    writeFileSync(
      join(runtimeDir, 'daemon-v4.pid'),
      JSON.stringify({ pid: process.pid, startedAtMs: null, appVersion: '7.0.0' })
    )
    writeFileSync(
      join(runtimeDir, 'daemon-v3.pid'),
      JSON.stringify({ pid: 2147483646, startedAtMs: null, appVersion: '6.0.0' })
    )
    const pinned = collectPinnedDaemonVersions(runtimeDir)
    expect(pinned.has('7.0.0')).toBe(true)
    expect(pinned.has('6.0.0')).toBe(false)
  })
})
