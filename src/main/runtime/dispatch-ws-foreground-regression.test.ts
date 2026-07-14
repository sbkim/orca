// AC-FCM-001 FULL WS-foreground regression suite (SPEC-FCM-001, M7).
//
// Why: M4 added the FCM supplemental fan-out gate as an ADDITIVE branch in
// dispatchMobileNotification. M4 also added a unit-level characterization that
// the WS listener iteration stays byte-identical with/without the gate armed.
// This file formalizes that characterization into the FULL regression the SPEC
// requires (acceptance.md AC-FCM-001): the WS streaming path MUST behave
// byte-identically to the pre-FCM baseline whenever ≥1 WS subscriber is
// connected — every event shape, every subscriber count, every ordering — and
// the FCM fan-out MUST stay dormant while a subscriber holds the foreground.
//
// Scope (P0 regression gate): drive the real OrcaRuntimeService across:
//   - many subscribers (1, 3, 5) — each receives the exact same event
//   - every notification source ('agent-task-complete', 'terminal-bell', 'test')
//   - dismiss events (foreground-only sync, never fans out)
//   - optional fields (notificationId, worktreeId) carried through verbatim
//   - ordering across a sequence of mixed dispatches
//   - mid-stream unsubscribe (a dropped subscriber stops receiving)
//   - the gate-armed vs gate-disarmed comparison (the core byte-identical
//     assertion — if the gate perturbed WS delivery, this catches it)
//
// The per-device M1+M2+M3+M6 fan-out chain is exercised end-to-end in
// dispatch-fcm-integration.test.ts; here the fan-out is a spy so the WS
// regression is observed in isolation.
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

function createRuntime(): OrcaRuntimeService {
  return new OrcaRuntimeService(store)
}

// Why: a no-op spy hook stands in for the real fan-out. The regression cares
// only that the hook is NOT called while subscribers are connected; asserting
// not.toHaveBeenCalled with ≥1 subscriber is the AC-FCM-001 FCM-dormant half.
function armGate(runtime: OrcaRuntimeService): ReturnType<typeof vi.fn> {
  const fanOut = vi.fn(async () => undefined)
  runtime.setFcmFanOut(fanOut)
  return fanOut
}

const NOTIFICATION_EVENT: MobileNotificationEvent = {
  type: 'notification',
  source: 'agent-task-complete',
  title: 'Agent finished',
  body: 'The task is complete',
  notificationId: 'notif-abc',
  worktreeId: 'wt-1'
}

describe('AC-FCM-001 — WS foreground regression (gate is ADDITIVE, no perturbation)', () => {
  it('delivers byte-identical events with 1, 3, and 5 subscribers whether or not the gate is armed', () => {
    for (const subscriberCount of [1, 3, 5]) {
      const withoutGate = dispatchTo(subscriberCount, /* armGate */ false)
      const withGate = dispatchTo(subscriberCount, /* armGate */ true)
      // Why: the byte-identical guarantee is the P0 regression assertion. If the
      // gate perturbed WS delivery (reordered, dropped, mutated, duplicated),
      // withGate would diverge from withoutGate and this assertion fires.
      expect(withGate).toEqual(withoutGate)
      // Every subscriber saw exactly one delivery of the event.
      expect(withGate).toHaveLength(subscriberCount)
      withGate.forEach((seen) => expect(seen).toEqual([NOTIFICATION_EVENT]))
    }
  })

  function dispatchTo(subscriberCount: number, armGateFlag: boolean): MobileNotificationEvent[][] {
    const runtime = createRuntime()
    if (armGateFlag) {
      armGate(runtime)
    }
    const boxes: MobileNotificationEvent[][] = Array.from({ length: subscriberCount }, () => [])
    for (const box of boxes) {
      runtime.onNotificationDispatched((e) => box.push(e))
    }
    runtime.dispatchMobileNotification(NOTIFICATION_EVENT)
    return boxes
  }

  it('delivers every notification source variant byte-identically to all subscribers with the gate armed', () => {
    const runtime = createRuntime()
    armGate(runtime)
    const seenByA: MobileNotificationEvent[] = []
    const seenByB: MobileNotificationEvent[] = []
    runtime.onNotificationDispatched((e) => seenByA.push(e))
    runtime.onNotificationDispatched((e) => seenByB.push(e))

    const sources = ['agent-task-complete', 'terminal-bell', 'test'] as const
    for (const source of sources) {
      runtime.dispatchMobileNotification({
        type: 'notification',
        source,
        title: `title-${source}`,
        body: `body-${source}`,
        notificationId: `id-${source}`,
        worktreeId: 'wt-x'
      })
    }

    const expected = sources.map(
      (source) =>
        ({
          type: 'notification',
          source,
          title: `title-${source}`,
          body: `body-${source}`,
          notificationId: `id-${source}`,
          worktreeId: 'wt-x'
        }) as MobileNotificationEvent
    )
    expect(seenByA).toEqual(expected)
    expect(seenByB).toEqual(expected)
  })

  it('preserves dispatch ordering across a sequence of mixed events (notification then dismiss then notification)', () => {
    const runtime = createRuntime()
    armGate(runtime)
    const seen: MobileNotificationEvent[] = []
    runtime.onNotificationDispatched((e) => seen.push(e))

    runtime.dispatchMobileNotification({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'first',
      body: 'b1',
      notificationId: 'n1'
    })
    runtime.dismissMobileNotification('n1')
    runtime.dispatchMobileNotification({
      type: 'notification',
      source: 'terminal-bell',
      title: 'second',
      body: 'b2',
      notificationId: 'n2'
    })

    // Why: ordering is part of the WS-no-regression guarantee. A gate that
    // deferred or buffered the listener iteration would reorder these.
    expect(seen).toEqual([
      {
        type: 'notification',
        source: 'agent-task-complete',
        title: 'first',
        body: 'b1',
        notificationId: 'n1'
      },
      { type: 'dismiss', notificationId: 'n1' },
      {
        type: 'notification',
        source: 'terminal-bell',
        title: 'second',
        body: 'b2',
        notificationId: 'n2'
      }
    ])
  })

  it('a subscriber that unsubscribes mid-sequence stops receiving but others keep receiving', () => {
    const runtime = createRuntime()
    armGate(runtime)
    const seenA: MobileNotificationEvent[] = []
    const seenB: MobileNotificationEvent[] = []
    runtime.onNotificationDispatched((e) => seenA.push(e))
    const unsubB = runtime.onNotificationDispatched((e) => seenB.push(e))

    runtime.dispatchMobileNotification({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'before',
      body: 'b',
      notificationId: 'n-before'
    })
    unsubB()
    runtime.dispatchMobileNotification({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'after',
      body: 'b',
      notificationId: 'n-after'
    })

    expect(seenA).toHaveLength(2)
    expect(seenB).toHaveLength(1)
    expect(seenB[0]).toMatchObject({ notificationId: 'n-before' })
  })
})

describe('AC-FCM-001 — FCM fan-out stays dormant while a WS subscriber holds the foreground', () => {
  it('does NOT invoke the fan-out for any notification source while ≥1 subscriber is connected', async () => {
    const runtime = createRuntime()
    const fanOut = armGate(runtime)
    runtime.onNotificationDispatched(() => undefined)
    expect(runtime.getMobileNotificationListenerCount()).toBe(1)

    const sources = ['agent-task-complete', 'terminal-bell', 'test'] as const
    for (const source of sources) {
      runtime.dispatchMobileNotification({
        type: 'notification',
        source,
        title: `t-${source}`,
        body: 'b',
        notificationId: `id-${source}`
      })
    }
    // Why: each dispatch fans out asynchronously; flush the microtask queue so
    // any errant fan-out call would have been recorded by the spy. With a live
    // subscriber the gate short-circuits and the hook is never touched.
    await Promise.resolve()
    await Promise.resolve()
    expect(fanOut).not.toHaveBeenCalled()
  })

  it('does NOT invoke the fan-out for a dismiss event even with zero notification subscribers', async () => {
    // Why: dismiss is a foreground-only sync (REQ-FCM-015 / M4 gate excludes
    // event.type !== 'notification'). Asserting this at zero listeners confirms
    // the gate filters on event shape, not just listener count.
    const runtime = createRuntime()
    const fanOut = armGate(runtime)
    expect(runtime.getMobileNotificationListenerCount()).toBe(0)

    runtime.dismissMobileNotification('dismiss-id-1')
    await Promise.resolve()
    await Promise.resolve()

    expect(fanOut).not.toHaveBeenCalled()
  })

  it('becomes FCM-eligible the moment the last subscriber unsubscribes (gate boundary)', async () => {
    // Why: the regression is about the foreground path, but the gate boundary —
    // the exact transition from "WS holds the foreground" to "FCM takes over" —
    // is the seam a regression would perturb. Pinning it keeps the listener
    // count the single source of truth for the gate decision.
    const runtime = createRuntime()
    const fanOut = armGate(runtime)
    const unsub = runtime.onNotificationDispatched(() => undefined)
    expect(runtime.getMobileNotificationListenerCount()).toBe(1)

    runtime.dispatchMobileNotification({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'while-connected',
      body: 'b',
      notificationId: 'n-connected'
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(fanOut).not.toHaveBeenCalled()

    unsub()
    expect(runtime.getMobileNotificationListenerCount()).toBe(0)
    runtime.dispatchMobileNotification({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'after-disconnect',
      body: 'b',
      notificationId: 'n-disconnected'
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(fanOut).toHaveBeenCalledTimes(1)
    expect(fanOut).toHaveBeenCalledWith({
      payload: {
        title: 'after-disconnect',
        body: 'b',
        worktreeId: undefined,
        source: 'agent-task-complete'
      },
      notificationId: 'n-disconnected'
    })
  })
})
