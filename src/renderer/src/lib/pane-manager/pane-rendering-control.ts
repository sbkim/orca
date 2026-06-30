import type { ManagedPaneInternal } from './pane-manager-types'
import { safeFit } from './pane-tree-ops'
import {
  attachWebgl,
  disposeWebgl,
  markComplexScriptOutput,
  resetWebglTextureAtlas,
  shouldUseTerminalWebgl
} from './pane-webgl-renderer'
import { reattachWebglIfNeeded } from './pane-webgl-reattach'
import {
  installTransparentWebglClear,
  uninstallTransparentWebglClear
} from './pane-webgl-transparent-clear'

export function setPaneGpuRenderingState(
  panes: Map<number, ManagedPaneInternal>,
  paneId: number,
  enabled: boolean
): void {
  const pane = panes.get(paneId)
  if (!pane) {
    return
  }
  pane.gpuRenderingEnabled = enabled
  if (!enabled) {
    disposeWebgl(pane, { refreshDimensions: true })
    return
  }
  if (pane.webglAttachmentDeferred || pane.webglDisabledAfterContextLoss) {
    return
  }
  if (!pane.webglAddon) {
    attachWebgl(pane)
    safeFit(pane)
  }
}

export function setPaneTerminalTransparency(
  panes: Map<number, ManagedPaneInternal>,
  paneId: number,
  enabled: boolean
): void {
  const pane = panes.get(paneId)
  if (!pane || pane.terminalTransparencyEnabled === enabled) {
    return
  }
  pane.terminalTransparencyEnabled = enabled
  if (!shouldUseTerminalWebgl(pane)) {
    disposeWebgl(pane, { refreshDimensions: true })
    return
  }
  if (pane.webglAddon) {
    // Why: transparent WebGL is correct only when xterm's private renderer can
    // clear the alpha canvas before redraw; otherwise fall back to DOM.
    if (enabled && !installTransparentWebglClear(pane.webglAddon)) {
      disposeWebgl(pane, { refreshDimensions: true })
      return
    }
    if (!enabled) {
      uninstallTransparentWebglClear(pane.webglAddon)
    }
    try {
      pane.terminal.refresh(0, pane.terminal.rows - 1)
    } catch {
      /* ignore - pane may have been disposed in the meantime */
    }
    return
  }
  if (
    pane.gpuRenderingEnabled &&
    !pane.webglAddon &&
    !pane.webglAttachmentDeferred &&
    !pane.webglDisabledAfterContextLoss
  ) {
    attachWebgl(pane)
    safeFit(pane)
  }
}

export function markPaneComplexScriptOutput(
  panes: Map<number, ManagedPaneInternal>,
  paneId: number
): void {
  const pane = panes.get(paneId)
  if (pane) {
    markComplexScriptOutput(pane)
  }
}

export function suspendPaneRendering(panes: Iterable<ManagedPaneInternal>): void {
  for (const pane of panes) {
    pane.webglAttachmentDeferred = true
    disposeWebgl(pane)
  }
}

export function resumePaneRendering(panes: Iterable<ManagedPaneInternal>): void {
  for (const pane of panes) {
    pane.webglAttachmentDeferred = false
    reattachWebglIfNeeded(pane)
  }
}

export function resetPaneWebglTextureAtlases(panes: Iterable<ManagedPaneInternal>): void {
  for (const pane of panes) {
    resetWebglTextureAtlas(pane)
  }
}
