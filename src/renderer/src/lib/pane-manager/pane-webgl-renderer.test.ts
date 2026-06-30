import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagedPaneInternal } from './pane-manager-types'
import { resetTerminalWebglSuggestion, shouldUseTerminalWebgl } from './pane-webgl-renderer'

function createPane(
  overrides: Partial<
    Pick<ManagedPaneInternal, 'terminalGpuAcceleration' | 'terminalTransparencyEnabled'>
  > = {}
): ManagedPaneInternal {
  const leafId = '11111111-1111-4111-8111-111111111111' as never
  return {
    id: 1,
    leafId,
    stablePaneId: leafId,
    terminal: { cols: 80, rows: 24 } as never,
    container: {} as never,
    xtermContainer: {} as never,
    linkTooltip: {} as never,
    terminalGpuAcceleration: overrides.terminalGpuAcceleration ?? 'auto',
    gpuRenderingEnabled: true,
    terminalTransparencyEnabled: overrides.terminalTransparencyEnabled ?? false,
    webglAttachmentDeferred: false,
    webglDisabledAfterContextLoss: false,
    hasComplexScriptOutput: false,
    webglAddon: null,
    ligaturesAddon: null,
    fitResizeObserver: null,
    pendingObservedFitRafId: null,
    fitAddon: {} as never,
    searchAddon: {} as never,
    serializeAddon: {} as never,
    unicode11Addon: {} as never,
    webLinksAddon: {} as never,
    compositionHandler: null,
    pendingSplitScrollState: null,
    debugLabel: null
  }
}

describe('shouldUseTerminalWebgl', () => {
  beforeEach(() => {
    resetTerminalWebglSuggestion()
    // Why: pin a non-Linux host so the "auto" path resolves deterministically
    // to allowWebgl=true, isolating the policy checks under test.
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)'
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetTerminalWebglSuggestion()
  })

  it('allows WebGL under transparency when GPU acceleration is forced on', () => {
    const pane = createPane({ terminalGpuAcceleration: 'on', terminalTransparencyEnabled: true })
    expect(shouldUseTerminalWebgl(pane)).toBe(true)
  })

  it('allows WebGL under transparency on the auto policy', () => {
    const pane = createPane({ terminalGpuAcceleration: 'auto', terminalTransparencyEnabled: true })
    expect(shouldUseTerminalWebgl(pane)).toBe(true)
  })

  it('allows WebGL when transparency is off and GPU is forced on', () => {
    const pane = createPane({ terminalGpuAcceleration: 'on', terminalTransparencyEnabled: false })
    expect(shouldUseTerminalWebgl(pane)).toBe(true)
  })

  it('allows WebGL when transparency is off and auto policy permits it', () => {
    const pane = createPane({ terminalGpuAcceleration: 'auto', terminalTransparencyEnabled: false })
    expect(shouldUseTerminalWebgl(pane)).toBe(true)
  })
})
