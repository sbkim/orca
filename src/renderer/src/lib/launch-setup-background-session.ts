import { useAppStore } from '@/store'
import { buildSetupRunnerCommand } from './setup-runner'
import type { WorktreeSetupLaunch } from '../../../shared/types'
import { singlePaneLayoutSnapshot } from '@/store/slices/terminal-helpers'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  registerEagerPtyBuffer,
  subscribeToPtyExit
} from '@/components/terminal-pane/pty-dispatcher'
import { subscribeToPtyData } from '@/components/terminal-pane/pty-data-sidecar-subscriptions'
import { callRuntimeRpc, getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { getSettingsForWorktreeRuntimeOwner } from '@/lib/worktree-runtime-owner'
import { toRuntimeWorktreeSelector } from '@/runtime/runtime-worktree-selector'
import {
  getRemoteRuntimeTerminalHandle,
  subscribeToRuntimeTerminalData,
  toRemoteRuntimePtyId
} from '@/runtime/runtime-terminal-stream'
import type { RuntimeTerminalCreate } from '../../../shared/runtime-types'
import { translate } from '@/i18n/i18n'

// Why: a hung setup script must not leave an automation run pending indefinitely.
const SETUP_WAIT_TIMEOUT_MS = 60 * 60 * 1000

export type LaunchSetupBackgroundSessionArgs = {
  worktreeId: string
  setup: WorktreeSetupLaunch | undefined
  onData?: (chunk: string) => void
}

export type LaunchSetupBackgroundSessionResult = {
  tabId: string
}

function buildSetupCompletionCommand(command: string, token: string): string {
  if (command.trimStart().toLowerCase().startsWith('cmd.exe /c')) {
    return `cmd.exe /c "${command.replace(/"/g, '""')} & echo ${token}:%ERRORLEVEL%"`
  }
  return `{ ${command}; __orca_setup_code=$?; printf '\\n${token}:%s\\n' "$__orca_setup_code"; }`
}

function readCompletionCode(buffer: string, token: string): number | null {
  const match = buffer.match(new RegExp(`${token}:(-?\\d+)`))
  return match ? Number(match[1]) : null
}

export async function launchSetupBackgroundSession(
  args: LaunchSetupBackgroundSessionArgs
): Promise<LaunchSetupBackgroundSessionResult | null> {
  const { worktreeId, setup, onData } = args
  if (!setup) {
    return null
  }

  const store = useAppStore.getState()
  const worktree = store.allWorktrees().find((entry) => entry.id === worktreeId)
  if (!worktree) {
    throw new Error('The target workspace is no longer available.')
  }
  const repo = store.repos.find((entry) => entry.id === worktree.repoId)
  const connectionId = repo?.connectionId ?? null

  // Why: background setup must not steal focus or create unread activity noise.
  const tab = store.createTab(worktreeId, undefined, undefined, {
    activate: false,
    recordInteraction: false
  })
  const setupTitle = translate('auto.lib.launch.setup.background.session.setupTitle', 'Setup')
  store.setTabCustomTitle(tab.id, setupTitle, { recordInteraction: false })
  const leafId = createBrowserUuid()
  store.setTabLayout(tab.id, singlePaneLayoutSnapshot(leafId))

  const completionToken = `ORCA_SETUP_DONE_${createBrowserUuid().replace(/-/g, '')}`
  const command = buildSetupCompletionCommand(
    buildSetupRunnerCommand(setup.runnerScriptPath),
    completionToken
  )
  const runtimeTarget = getActiveRuntimeTarget(
    getSettingsForWorktreeRuntimeOwner(store, worktreeId)
  )

  let ptyId = ''
  let runtimeTerminalHandle = ''
  try {
    if (runtimeTarget.kind === 'environment') {
      const created = await callRuntimeRpc<{ terminal: RuntimeTerminalCreate }>(
        runtimeTarget,
        'terminal.create',
        {
          worktree: toRuntimeWorktreeSelector(worktreeId),
          command,
          env: setup.envVars,
          title: setupTitle,
          tabId: tab.id,
          leafId
        },
        { timeoutMs: 15_000 }
      )
      runtimeTerminalHandle = created.terminal.handle
      ptyId = toRemoteRuntimePtyId(runtimeTerminalHandle, runtimeTarget.environmentId)
    } else {
      const result = await window.api.pty.spawn({
        cols: 120,
        rows: 40,
        cwd: worktree.path,
        command,
        env: setup.envVars,
        connectionId,
        worktreeId,
        tabId: tab.id,
        leafId
      })
      ptyId = result.id
    }
  } catch (error) {
    store.closeTab(tab.id, { recordInteraction: false })
    throw error
  }

  store.updateTabPtyId(tab.id, ptyId)
  store.setTabLayout(tab.id, singlePaneLayoutSnapshot(leafId, ptyId))

  if (runtimeTarget.kind === 'environment') {
    const terminal = getRemoteRuntimeTerminalHandle(ptyId)
    if (!terminal) {
      useAppStore.getState().clearTabPtyId(tab.id, ptyId)
      store.closeTab(tab.id, { recordInteraction: false })
      if (runtimeTerminalHandle) {
        try {
          await callRuntimeRpc(
            runtimeTarget,
            'terminal.close',
            { terminal: runtimeTerminalHandle },
            { timeoutMs: 15_000 }
          )
        } catch {
          // Best-effort: the terminal handle is already invalid from the renderer side.
        }
      }
      throw new Error('Runtime terminal id is invalid.')
    }
    let unsubscribeData = (): void => {}
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let handled = false
    let outputTail = ''
    let resolveRuntime: (result: LaunchSetupBackgroundSessionResult) => void = () => {}
    let rejectRuntime: (error: Error) => void = () => {}
    const cleanup = (): void => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      unsubscribeData()
      useAppStore.getState().clearTabPtyId(tab.id, ptyId)
    }
    try {
      unsubscribeData = await subscribeToRuntimeTerminalData(
        store.settings,
        ptyId,
        `desktop:setup:${tab.id}`,
        (chunk) => {
          onData?.(chunk)
          if (handled) {
            return
          }
          outputTail = `${outputTail}${chunk}`.slice(-4096)
          const code = readCompletionCode(outputTail, completionToken)
          if (code === null) {
            return
          }
          handled = true
          cleanup()
          if (code === 0) {
            resolveRuntime({ tabId: tab.id })
          } else {
            rejectRuntime(new Error(`Setup exited with code ${code}.`))
          }
        }
      )
    } catch (error) {
      useAppStore.getState().clearTabPtyId(tab.id, ptyId)
      store.closeTab(tab.id, { recordInteraction: false })
      if (runtimeTerminalHandle) {
        try {
          await callRuntimeRpc(
            runtimeTarget,
            'terminal.close',
            { terminal: runtimeTerminalHandle },
            { timeoutMs: 15_000 }
          )
        } catch {
          // Best-effort: the setup terminal cannot be observed from this renderer.
        }
      }
      throw error
    }
    return new Promise((resolve, reject) => {
      resolveRuntime = resolve
      rejectRuntime = reject
      timeoutId = setTimeout(() => {
        if (handled) {
          return
        }
        handled = true
        cleanup()
        if (runtimeTerminalHandle) {
          void callRuntimeRpc(
            runtimeTarget,
            'terminal.close',
            { terminal: runtimeTerminalHandle },
            { timeoutMs: 15_000 }
          ).catch(() => {})
        }
        reject(new Error('Setup timed out after 60 minutes.'))
      }, SETUP_WAIT_TIMEOUT_MS)
    })
  }

  // Local / SSH path: subscribe to eager-buffer sidecar and resolve on exit.
  return new Promise((resolve, reject) => {
    let exitHandled = false
    let unsubscribeExit = (): void => {}
    let unsubscribeData = (): void => {}
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let outputTail = ''

    const cleanup = (exitPtyId: string): void => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      unsubscribeExit()
      unsubscribeData()
      useAppStore.getState().clearTabPtyId(tab.id, exitPtyId)
    }

    const handleExit = (exitPtyId: string, code: number): void => {
      if (exitHandled) {
        return
      }
      exitHandled = true
      cleanup(exitPtyId)
      if (code === 0) {
        resolve({ tabId: tab.id })
      } else {
        reject(new Error(`Setup exited with code ${code}.`))
      }
    }

    const handleData = (chunk: string): void => {
      onData?.(chunk)
      if (exitHandled) {
        return
      }
      outputTail = `${outputTail}${chunk}`.slice(-4096)
      const code = readCompletionCode(outputTail, completionToken)
      if (code === null) {
        return
      }
      handleExit(ptyId, code)
    }

    unsubscribeData = subscribeToPtyData(ptyId, handleData)
    unsubscribeExit = subscribeToPtyExit(ptyId, (code) => handleExit(ptyId, code))
    registerEagerPtyBuffer(ptyId, () => {})
    timeoutId = setTimeout(() => {
      if (exitHandled) {
        return
      }
      exitHandled = true
      cleanup(ptyId)
      void window.api.pty.kill(ptyId, { keepHistory: true }).catch(() => {})
      reject(new Error('Setup timed out after 60 minutes.'))
    }, SETUP_WAIT_TIMEOUT_MS)
  })
}
