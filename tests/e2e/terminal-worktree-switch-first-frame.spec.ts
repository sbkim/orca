import type { Page, TestInfo } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  ensureTerminalVisible,
  getActiveWorktreeId,
  getAllWorktreeIds,
  switchToWorktree,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import { waitForActiveTerminalManager } from './helpers/terminal'

type ManagerEventName =
  | 'resumeRendering'
  | 'suspendRendering'
  | 'fitAllPanes'
  | 'resetWebglTextureAtlases'

type ManagerEvent = {
  name: ManagerEventName
  time: number
}

type TerminalSurfaceSample = {
  frame: number
  activeWorktreeId: string | null
  eventNames: ManagerEventName[]
  hasWebgl: boolean
  largestCanvasBottomGap: number | null
  largestCanvasHeightRatio: number | null
  proposedRows: number | null
  rowsBottomGap: number | null
  rowsHeightRatio: number | null
  screenHeight: number | null
  terminalRows: number | null
  visibleRowCount: number
}

type ProbeWindow = Window & {
  __terminalWorktreeSwitchFirstFrameEvents?: ManagerEvent[]
  __terminalWorktreeSwitchFirstFrameSample?: (frame: number) => TerminalSurfaceSample
}

type ProbeManager = Record<ManagerEventName, (...args: unknown[]) => unknown> & {
  __terminalWorktreeSwitchFirstFramePatched?: boolean
}

async function forceWebgl(page: Page): Promise<boolean> {
  await page.evaluate(() => {
    const state = window.__store?.getState()
    if (!state?.settings) {
      throw new Error('Store unavailable')
    }
    window.__store?.setState({
      settings: {
        ...state.settings,
        terminalGpuAcceleration: 'on'
      }
    })
    const worktreeId = state.activeWorktreeId
    const tabId =
      state.activeTabType === 'terminal'
        ? state.activeTabId
        : worktreeId
          ? (state.activeTabIdByWorktree?.[worktreeId] ?? null)
          : null
    const manager = tabId ? window.__paneManagers?.get(tabId) : null
    manager?.setTerminalGpuAcceleration('on')
  })
  return page
    .waitForFunction(
      () => {
        const state = window.__store?.getState()
        const worktreeId = state?.activeWorktreeId
        const tabId =
          state?.activeTabType === 'terminal'
            ? state.activeTabId
            : worktreeId
              ? (state?.activeTabIdByWorktree?.[worktreeId] ?? null)
              : null
        const diagnostics = tabId
          ? (window.__paneManagers?.get(tabId)?.getRenderingDiagnostics?.() ?? [])
          : []
        return diagnostics.some((diagnostic) => diagnostic.hasWebgl)
      },
      null,
      { timeout: 5_000 }
    )
    .then(() => true)
    .catch(() => false)
}

async function writeDenseTerminalContent(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    const tabId =
      state?.activeTabType === 'terminal'
        ? state.activeTabId
        : worktreeId
          ? (state?.activeTabIdByWorktree?.[worktreeId] ?? null)
          : null
    const manager = tabId ? window.__paneManagers?.get(tabId) : null
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    if (!pane) {
      throw new Error('Active terminal pane is unavailable')
    }
    const rowCount = Math.max(pane.terminal.rows, 24)
    const rows = Array.from({ length: rowCount }, (_, row) =>
      [
        `WORKTREE_SWITCH_FIRST_FRAME row=${String(row).padStart(2, '0')}`,
        'abcdefghijklmnopqrstuvwxyz',
        '0123456789',
        '[]{}<>/\\'
      ].join(' ')
    )
    await new Promise<void>((resolve) =>
      pane.terminal.write(`\x1b[2J\x1b[3J\x1b[H${rows.join('\r\n')}`, resolve)
    )
    pane.terminal.refresh(0, pane.terminal.rows - 1)
  })
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  )
}

async function installManagerProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    const tabId =
      state?.activeTabType === 'terminal'
        ? state.activeTabId
        : worktreeId
          ? (state?.activeTabIdByWorktree?.[worktreeId] ?? null)
          : null
    const manager = tabId ? window.__paneManagers?.get(tabId) : null
    if (!manager) {
      throw new Error('Active terminal manager is unavailable')
    }

    const probeWindow = window as ProbeWindow
    probeWindow.__terminalWorktreeSwitchFirstFrameEvents = []
    probeWindow.__terminalWorktreeSwitchFirstFrameSample = (
      frame: number
    ): TerminalSurfaceSample => {
      const currentState = window.__store?.getState()
      const currentWorktreeId = currentState?.activeWorktreeId ?? null
      const currentTabId =
        currentState?.activeTabType === 'terminal'
          ? currentState.activeTabId
          : currentWorktreeId
            ? (currentState?.activeTabIdByWorktree?.[currentWorktreeId] ?? null)
            : null
      const currentManager = currentTabId ? window.__paneManagers?.get(currentTabId) : null
      const currentPane =
        currentManager?.getActivePane?.() ?? currentManager?.getPanes?.()[0] ?? null
      const screen = currentPane?.container.querySelector('.xterm-screen') ?? null
      const rows = screen?.querySelector('.xterm-rows') ?? null
      const screenRect = screen?.getBoundingClientRect() ?? null
      const rowsRect = rows?.getBoundingClientRect() ?? null
      const canvases = Array.from(screen?.querySelectorAll('canvas') ?? [])
      const largestCanvasRect =
        canvases
          .map((canvas) => canvas.getBoundingClientRect())
          .sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null
      const rowElements = Array.from(rows?.children ?? []).filter(
        (child): child is HTMLElement => child instanceof HTMLElement
      )
      const visibleRowCount =
        screenRect === null
          ? 0
          : rowElements.filter((row) => {
              const rect = row.getBoundingClientRect()
              return rect.height > 0 && rect.bottom > screenRect.top && rect.top < screenRect.bottom
            }).length
      const diagnostics = currentManager?.getRenderingDiagnostics?.() ?? []
      const proposedRows = (() => {
        try {
          return currentPane?.fitAddon.proposeDimensions()?.rows ?? null
        } catch {
          return null
        }
      })()
      const screenHeight = screenRect?.height ?? null

      return {
        frame,
        activeWorktreeId: currentWorktreeId,
        eventNames: ((window as ProbeWindow).__terminalWorktreeSwitchFirstFrameEvents ?? []).map(
          (event) => event.name
        ),
        hasWebgl: diagnostics.some((diagnostic) => diagnostic.hasWebgl),
        largestCanvasBottomGap:
          screenRect && largestCanvasRect
            ? Math.max(0, screenRect.bottom - largestCanvasRect.bottom)
            : null,
        largestCanvasHeightRatio:
          screenRect && largestCanvasRect && screenRect.height > 0
            ? largestCanvasRect.height / screenRect.height
            : null,
        proposedRows,
        rowsBottomGap:
          screenRect && rowsRect ? Math.max(0, screenRect.bottom - rowsRect.bottom) : null,
        rowsHeightRatio:
          screenRect && rowsRect && screenRect.height > 0
            ? rowsRect.height / screenRect.height
            : null,
        screenHeight,
        terminalRows: currentPane?.terminal.rows ?? null,
        visibleRowCount
      }
    }
    const probeManager = manager as unknown as ProbeManager
    if (probeManager.__terminalWorktreeSwitchFirstFramePatched) {
      return
    }

    const methods: ManagerEventName[] = [
      'suspendRendering',
      'resumeRendering',
      'fitAllPanes',
      'resetWebglTextureAtlases'
    ]
    for (const method of methods) {
      const original = probeManager[method].bind(manager)
      probeManager[method] = (...args: unknown[]) => {
        const currentWindow = window as ProbeWindow
        currentWindow.__terminalWorktreeSwitchFirstFrameEvents ??= []
        currentWindow.__terminalWorktreeSwitchFirstFrameEvents.push({
          name: method,
          time: performance.now()
        })
        return original(...args)
      }
    }
    probeManager.__terminalWorktreeSwitchFirstFramePatched = true
  })
}

async function readManagerEventNames(page: Page): Promise<ManagerEventName[]> {
  return page.evaluate(() => {
    const probeWindow = window as ProbeWindow
    return (probeWindow.__terminalWorktreeSwitchFirstFrameEvents ?? []).map((event) => event.name)
  })
}

async function resetManagerEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probeWindow = window as ProbeWindow
    probeWindow.__terminalWorktreeSwitchFirstFrameEvents = []
  })
}

async function readCurrentTerminalSurface(page: Page): Promise<TerminalSurfaceSample> {
  return page.evaluate(() => {
    const sample = (window as ProbeWindow).__terminalWorktreeSwitchFirstFrameSample
    if (!sample) {
      throw new Error('Terminal surface sampler is unavailable')
    }
    return sample(0)
  })
}

async function sampleFramesAfterSwitchBack(
  page: Page,
  worktreeId: string,
  frameCount: number
): Promise<TerminalSurfaceSample[]> {
  return page.evaluate(
    ({ targetWorktreeId, samplesToCollect }) =>
      new Promise<TerminalSurfaceSample[]>((resolve, reject) => {
        try {
          const store = window.__store
          if (!store) {
            throw new Error('Store unavailable')
          }
          const samples: TerminalSurfaceSample[] = []
          let frame = 0
          const captureNextFrame = (): void => {
            frame += 1
            const sample = (window as ProbeWindow).__terminalWorktreeSwitchFirstFrameSample
            if (!sample) {
              throw new Error('Terminal surface sampler is unavailable')
            }
            samples.push(sample(frame))
            if (frame >= samplesToCollect) {
              resolve(samples)
              return
            }
            requestAnimationFrame(captureNextFrame)
          }

          // Why: schedule the sampler before activation so frame 1 observes
          // the pre-paint state of the worktree becoming visible.
          requestAnimationFrame(captureNextFrame)
          store.getState().setActiveWorktree(targetWorktreeId)
        } catch (error) {
          reject(error)
        }
      }),
    { targetWorktreeId: worktreeId, samplesToCollect: frameCount }
  )
}

function isCollapsedSurface(sample: TerminalSurfaceSample): boolean {
  const height = sample.screenHeight ?? 0
  const allowedGap = Math.max(48, height * 0.25)
  const visibleRowsFloor = Math.max(6, Math.floor((sample.terminalRows ?? 0) * 0.5))
  const visibleRowsAreInspectable = sample.visibleRowCount > 0

  return (
    height < 160 ||
    (sample.rowsHeightRatio !== null && sample.rowsHeightRatio < 0.7) ||
    (sample.rowsBottomGap !== null && sample.rowsBottomGap > allowedGap) ||
    (sample.largestCanvasHeightRatio !== null && sample.largestCanvasHeightRatio < 0.7) ||
    (sample.largestCanvasBottomGap !== null && sample.largestCanvasBottomGap > allowedGap) ||
    (visibleRowsAreInspectable && sample.visibleRowCount < visibleRowsFloor)
  )
}

async function attachFrameSamples(
  testInfo: TestInfo,
  samples: TerminalSurfaceSample[],
  name = 'terminal-worktree-switch-first-frame-samples'
): Promise<void> {
  await testInfo.attach(name, {
    body: `${JSON.stringify(samples, null, 2)}\n`,
    contentType: 'application/json'
  })
}

test.describe('terminal worktree switch first frame @headful', () => {
  test('resumes the hidden terminal before the first visible frame after switching back', async ({
    orcaPage
  }, testInfo) => {
    await waitForSessionReady(orcaPage)
    const firstWorktreeId = await waitForActiveWorktree(orcaPage)
    const secondWorktreeId = (await getAllWorktreeIds(orcaPage)).find(
      (id) => id !== firstWorktreeId
    )
    test.skip(!secondWorktreeId, 'first-frame switch repro needs the seeded secondary worktree')
    if (!secondWorktreeId) {
      return
    }

    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage, 30_000)
    const webglActive = await forceWebgl(orcaPage)
    test.skip(!webglActive, 'WebGL was not active in this headful environment')
    await writeDenseTerminalContent(orcaPage)
    await installManagerProbe(orcaPage)

    const baseline = await readCurrentTerminalSurface(orcaPage)
    await attachFrameSamples(testInfo, [baseline], 'terminal-worktree-switch-baseline-sample')
    expect(baseline.hasWebgl, 'baseline terminal should use WebGL').toBe(true)
    expect(isCollapsedSurface(baseline), 'baseline terminal surface should be full height').toBe(
      false
    )

    await switchToWorktree(orcaPage, secondWorktreeId)
    await expect
      .poll(() => getActiveWorktreeId(orcaPage), {
        timeout: 10_000,
        message: 'second worktree did not become active before first-frame repro'
      })
      .toBe(secondWorktreeId)
    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage, 30_000)
    await expect
      .poll(() => readManagerEventNames(orcaPage), {
        timeout: 5_000,
        message: 'original terminal did not suspend after being hidden'
      })
      .toContain('suspendRendering')
    await resetManagerEvents(orcaPage)

    const samples = await sampleFramesAfterSwitchBack(orcaPage, firstWorktreeId, 8)
    await attachFrameSamples(testInfo, samples)

    expect(samples[0]?.activeWorktreeId).toBe(firstWorktreeId)
    expect(samples[0]?.eventNames).toEqual(
      expect.arrayContaining(['resumeRendering', 'fitAllPanes', 'resetWebglTextureAtlases'])
    )
    expect(samples[0]?.hasWebgl, 'WebGL should be reattached before frame 1').toBe(true)
    expect(
      samples.filter(isCollapsedSurface),
      'terminal surface should not collapse during first frames after worktree restore'
    ).toEqual([])
  })
})
