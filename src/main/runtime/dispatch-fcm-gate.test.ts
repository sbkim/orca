// Gate tests for the FCM supplemental push channel (SPEC-FCM-001, M4).
//
// These tests drive the real OrcaRuntimeService.dispatchMobileNotification to
// verify the listener-count GATE that decides WHEN FCM fan-out runs:
//   - AC-FCM-002a: zero WS listeners → fan-out hook IS invoked
//   - AC-FCM-002b: ≥1 WS listener   → fan-out hook is NOT invoked (WS-only)
//   - AC-FCM-001 : the WS listener iteration + delivered events are
//                  byte-identical whether or not the FCM gate is armed
//                  (the gate is ADDITIVE and must not perturb WS delivery)
//
// The per-device M1+M2+M3 fan-out chain is unit-tested in fcm-fanout.test.ts;
// here the fan-out is a spy hook so the gate decision is observed in isolation.
import { describe, expect, it, vi } from 'vitest'
import type * as GitUsernameModule from '../git/git-username'
import { OrcaRuntimeService, type MobileNotificationEvent } from './orca-runtime'

vi.mock('../git/worktree', () => ({
  listWorktrees: vi.fn().mockResolvedValue([]),
  listWorktreesStrict: vi.fn().mockResolvedValue([])
}))
vi.mock('../hooks', () => ({
  createSetupRunnerScript: vi.fn(),
  getEffectiveHooks: vi.fn().mockReturnValue(null),
  runHook: vi.fn().mockResolvedValue({ success: true, output: '' })
}))
vi.mock('../ipc/worktree-logic', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, computeWorktreePath: vi.fn(), ensurePathWithinWorkspace: vi.fn() }
})
vi.mock('../ipc/filesystem-auth', () => ({ invalidateAuthorizedRootsCache: vi.fn() }))
vi.mock('../git/repo', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    getDefaultBaseRef: vi.fn().mockReturnValue('origin/main'),
    getBranchConflictKind: vi.fn().mockResolvedValue(null)
  }
})
vi.mock('../git/git-username', async () => {
  const actual = await vi.importActual<typeof GitUsernameModule>('../git/git-username')
  return { ...actual, resolveLocalGitUsername: vi.fn(async () => '') }
})

const store = {
  getRepo: () => ({
    id: 'repo-1',
    path: '/tmp/repo',
    displayName: 'repo',
    badgeColor: 'blue',
    addedAt: 1
  }),
  getRepos: () => [store.getRepo()],
  addRepo: () => {},
  updateRepo: () => undefined as never,
  getAllWorktreeMeta: () => ({}),
  getWorktreeMeta: () => undefined,
  getGitHubCache: () => ({ pr: {}, issue: {} }),
  setWorktreeMeta: () => undefined as never,
  removeWorktreeMeta: () => {},
  getSettings: () => ({
    workspaceDir: '/tmp/workspaces',
    nestWorkspaces: false,
    refreshLocalBaseRefOnWorktreeCreate: false,
    branchPrefix: 'none',
    branchPrefixCustom: '',
    mobileAutoRestoreFitMs: 5_000
  })
}

const DISPATCH_EVENT: MobileNotificationEvent = {
  type: 'notification',
  source: 'agent-task-complete',
  title: 'Agent finished',
  body: 'The task is complete',
  notificationId: 'notif-abc'
}

function createRuntime(): OrcaRuntimeService {
  return new OrcaRuntimeService(store)
}

describe('dispatchMobileNotification — AC-FCM-002a (zero listeners → FCM fan-out invoked)', () => {
  it('invokes the FCM fan-out hook with the payload + notificationId when no WS listener is connected', async () => {
    const runtime = createRuntime()
    const fanOut = vi.fn(async () => undefined)
    runtime.setFcmFanOut(fanOut)
    expect(runtime.getMobileNotificationListenerCount()).toBe(0)

    runtime.dispatchMobileNotification(DISPATCH_EVENT)

    // Why: the dispatch method is sync and fires the async hook without
    // awaiting (non-blocking). Await a microtask so the spy records the call.
    await Promise.resolve()
    expect(fanOut).toHaveBeenCalledTimes(1)
    expect(fanOut).toHaveBeenCalledWith({
      payload: {
        title: 'Agent finished',
        body: 'The task is complete',
        worktreeId: undefined,
        source: 'agent-task-complete'
      },
      notificationId: 'notif-abc'
    })
  })

  it('passes an empty-string notificationId when the dispatch event omits one', async () => {
    const runtime = createRuntime()
    const fanOut = vi.fn(async () => undefined)
    runtime.setFcmFanOut(fanOut)

    runtime.dispatchMobileNotification({
      type: 'notification',
      source: 'terminal-bell',
      title: 'Bell',
      body: 'ding'
    })
    await Promise.resolve()

    expect(fanOut).toHaveBeenCalledWith({
      payload: {
        title: 'Bell',
        body: 'ding',
        worktreeId: undefined,
        source: 'terminal-bell'
      },
      notificationId: ''
    })
  })
})

describe('dispatchMobileNotification — AC-FCM-002b (≥1 listener → FCM NOT invoked, WS-only)', () => {
  it('does NOT invoke the fan-out hook when a WS listener is connected', async () => {
    const runtime = createRuntime()
    const fanOut = vi.fn(async () => undefined)
    runtime.setFcmFanOut(fanOut)
    const received: MobileNotificationEvent[] = []
    runtime.onNotificationDispatched((event) => {
      received.push(event)
    })
    expect(runtime.getMobileNotificationListenerCount()).toBe(1)

    runtime.dispatchMobileNotification(DISPATCH_EVENT)
    await Promise.resolve()

    // WS delivery happened…
    expect(received).toEqual([DISPATCH_EVENT])
    // …and FCM was skipped because a live subscriber took the event.
    expect(fanOut).not.toHaveBeenCalled()
  })

  it('allows the explicit diagnostic path to force FCM without changing the normal gate', async () => {
    const runtime = createRuntime()
    const fanOut = vi.fn(async () => undefined)
    runtime.setFcmFanOut(fanOut)
    runtime.onNotificationDispatched(() => {})

    runtime.dispatchMobileNotification(DISPATCH_EVENT, { forceFcm: true })
    await Promise.resolve()

    expect(fanOut).toHaveBeenCalledTimes(1)
  })
})

describe('dispatchMobileNotification — AC-FCM-001 (WS regression: gate is ADDITIVE)', () => {
  it('delivers byte-identical events to every listener whether or not the FCM gate is armed', () => {
    const eventWithoutGate = runWithListeners(DISPATCH_EVENT, /* armGate */ false)
    const eventWithGate = runWithListeners(DISPATCH_EVENT, /* armGate */ true)
    expect(eventWithGate).toEqual(eventWithoutGate)
  })

  function runWithListeners(
    event: MobileNotificationEvent,
    armGate: boolean
  ): MobileNotificationEvent[][] {
    const runtime = createRuntime()
    if (armGate) {
      runtime.setFcmFanOut(vi.fn(async () => undefined))
    }
    const seenByA: MobileNotificationEvent[] = []
    const seenByB: MobileNotificationEvent[] = []
    runtime.onNotificationDispatched((e) => seenByA.push(e))
    runtime.onNotificationDispatched((e) => seenByB.push(e))
    runtime.dispatchMobileNotification(event)
    return [seenByA, seenByB]
  }

  it('iterates listeners in the same shape with 3 subscribers (gate armed) — each gets exactly the event', () => {
    const runtime = createRuntime()
    runtime.setFcmFanOut(vi.fn(async () => undefined))
    const deliveries: MobileNotificationEvent[][] = [[], [], []]
    deliveries.forEach((box) => runtime.onNotificationDispatched((e) => box.push(e)))

    runtime.dispatchMobileNotification(DISPATCH_EVENT)

    expect(deliveries).toEqual([[DISPATCH_EVENT], [DISPATCH_EVENT], [DISPATCH_EVENT]])
  })

  it('does NOT invoke the fan-out for a dismiss event (only notification events carry a push payload)', async () => {
    const runtime = createRuntime()
    const fanOut = vi.fn(async () => undefined)
    runtime.setFcmFanOut(fanOut)
    const seen: MobileNotificationEvent[] = []
    runtime.onNotificationDispatched((e) => seen.push(e))

    runtime.dismissMobileNotification('notif-abc')
    await Promise.resolve()

    expect(seen).toEqual([{ type: 'dismiss', notificationId: 'notif-abc' }])
    expect(fanOut).not.toHaveBeenCalled()
  })
})

describe('dispatchMobileNotification — non-blocking into the dispatch loop', () => {
  it('a rejecting fan-out hook does not throw into the synchronous dispatch caller', () => {
    const runtime = createRuntime()
    runtime.setFcmFanOut(async () => {
      throw new Error('fan-out blew up')
    })

    // Why: dispatchMobileNotification is sync and must not surface the async
    // hook's rejection. The .not.toThrow assertion proves the sync caller is
    // insulated; the rejection is swallowed by the internal .catch().
    expect(() => runtime.dispatchMobileNotification(DISPATCH_EVENT)).not.toThrow()
  })
})
