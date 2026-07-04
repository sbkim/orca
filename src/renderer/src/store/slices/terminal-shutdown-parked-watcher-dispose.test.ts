/**
 * Pins the shutdownWorktreeTerminals → disposeParkedTerminalWatchersForPtyIds
 * wiring (hidden-view parking). Live transports are silenced via
 * unregisterPtyDataHandlers, but parked byte watchers ride the dispatcher
 * sidecar channel — if shutdown stops disposing them, the teardown flush of a
 * just-slept/deleted worktree marks unread and arms notification timers (the
 * "phantom alerts" failure class that reverted the first parking attempt).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parkedWatchersByTabId,
  pruneParkedTerminalWatchers
} from '../../components/terminal-pane/terminal-parked-watcher-registry'
import type { AppState } from '../types'
import { createTestStore, makeTab } from './store-test-helpers'

const originalWindow = (globalThis as { window?: unknown }).window

beforeEach(() => {
  // Why: shutdown's final pty.kill fan-out runs in this node-env suite; only
  // the kill surface is needed for the wiring under test.
  ;(globalThis as { window?: unknown }).window = {
    api: { pty: { kill: vi.fn(async () => {}) } }
  }
})

afterEach(() => {
  ;(globalThis as { window?: unknown }).window = originalWindow
  pruneParkedTerminalWatchers(new Set())
})

function seedParkedWatcher(
  worktreeId: string,
  tabId: string,
  ptyId: string
): ReturnType<typeof vi.fn> {
  const dispose = vi.fn()
  parkedWatchersByTabId.set(tabId, {
    worktreeId,
    tabPtyId: ptyId,
    paneIdByPtyId: new Map([[ptyId, 1]]),
    disposersByPtyId: new Map([[ptyId, dispose]])
  })
  return dispose
}

describe('shutdownWorktreeTerminals parked watcher disposal', () => {
  it('synchronously disposes parked watchers for the shutdown PTYs', async () => {
    const store = createTestStore()
    const tab = makeTab({ id: 'tab-parked', worktreeId: 'wt-parked' })
    store.setState({
      tabsByWorktree: { 'wt-parked': [tab] },
      ptyIdsByTabId: { 'tab-parked': ['wt-parked@@session-1'] }
    } as Partial<AppState>)
    const dispose = seedParkedWatcher('wt-parked', 'tab-parked', 'wt-parked@@session-1')
    const untouched = seedParkedWatcher('wt-other', 'tab-other', 'wt-other@@session-9')

    await store.getState().shutdownWorktreeTerminals('wt-parked', { keepIdentifiers: true })

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(untouched).not.toHaveBeenCalled()
    // Why: the tab entry is deliberately kept (minus the disposed PTY) so a
    // sleeping parked tab cannot restart watchers against stale PTY ids.
    expect(parkedWatchersByTabId.get('tab-parked')?.disposersByPtyId.size).toBe(0)
  })
})

describe('shutdownCompletedAgentPaneForHibernation parked watcher disposal', () => {
  function seedHibernatablePane(store: ReturnType<typeof createTestStore>): void {
    const tab = makeTab({ id: 'tab-hib', worktreeId: 'wt-hib' })
    store.setState({
      tabsByWorktree: { 'wt-hib': [tab] },
      ptyIdsByTabId: { 'tab-hib': ['wt-hib@@session-1'] },
      terminalLayoutsByTabId: {
        'tab-hib': {
          root: { type: 'leaf', leafId: '41111111-1111-4111-8111-111111111111' },
          activeLeafId: '41111111-1111-4111-8111-111111111111',
          expandedLeafId: null,
          ptyIdsByLeafId: { '41111111-1111-4111-8111-111111111111': 'wt-hib@@session-1' }
        }
      }
    } as Partial<AppState>)
    store
      .getState()
      .setAgentStatus(
        'tab-hib:41111111-1111-4111-8111-111111111111',
        {
          state: 'done',
          prompt: 'finished task',
          agentType: 'codex',
          lastAssistantMessage: 'done'
        },
        'Codex',
        { updatedAt: 2000, stateStartedAt: 1000 },
        { tabId: 'tab-hib', worktreeId: 'wt-hib' },
        { providerSession: { key: 'session_id', id: 'hib-session' } }
      )
  }

  it('disposes the parked watcher once the hibernation kill succeeds', async () => {
    const store = createTestStore()
    seedHibernatablePane(store)
    const dispose = seedParkedWatcher('wt-hib', 'tab-hib', 'wt-hib@@session-1')

    await store.getState().shutdownCompletedAgentPaneForHibernation('wt-hib', {
      paneKey: 'tab-hib:41111111-1111-4111-8111-111111111111',
      tabId: 'tab-hib',
      leafId: '41111111-1111-4111-8111-111111111111',
      ptyId: 'wt-hib@@session-1'
    })

    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('keeps the watcher alive when the hibernation kill fails', async () => {
    const store = createTestStore()
    seedHibernatablePane(store)
    const dispose = seedParkedWatcher('wt-hib', 'tab-hib', 'wt-hib@@session-1')
    const windowWithApi = (globalThis as { window?: { api: { pty: { kill: unknown } } } }).window
    windowWithApi!.api.pty.kill = vi.fn(async () => {
      throw new Error('kill_failed')
    })

    await expect(
      store.getState().shutdownCompletedAgentPaneForHibernation('wt-hib', {
        paneKey: 'tab-hib:41111111-1111-4111-8111-111111111111',
        tabId: 'tab-hib',
        leafId: '41111111-1111-4111-8111-111111111111',
        ptyId: 'wt-hib@@session-1'
      })
    ).rejects.toThrow('kill_failed')

    // Why: on kill failure the session keeps running — disposing would leave
    // it silently unwatched (the kept entry blocks a restart until re-park).
    expect(dispose).not.toHaveBeenCalled()
  })
})
