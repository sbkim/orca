import type { WebglAddon } from '@xterm/addon-webgl'

type WebglRenderRows = (start: number, end: number) => void

type TransparentClearGl = Pick<WebGL2RenderingContext, 'COLOR_BUFFER_BIT' | 'clear' | 'clearColor'>

type ClearableWebglRenderer = {
  _gl: TransparentClearGl
  renderRows: WebglRenderRows
}

type WebglAddonWithRenderer = WebglAddon & {
  _renderer?: unknown
}

type TransparentClearPatch = {
  originalRenderRows: WebglRenderRows
  patchedRenderRows: WebglRenderRows
}

const transparentClearPatches = new WeakMap<object, TransparentClearPatch>()

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null
}

function getClearableRenderer(addon: WebglAddon): ClearableWebglRenderer | null {
  const renderer = (addon as WebglAddonWithRenderer)._renderer
  if (!isObject(renderer) || typeof renderer.renderRows !== 'function') {
    return null
  }
  const gl = renderer._gl
  if (
    !isObject(gl) ||
    typeof gl.clearColor !== 'function' ||
    typeof gl.clear !== 'function' ||
    typeof gl.COLOR_BUFFER_BIT !== 'number'
  ) {
    return null
  }
  return renderer as ClearableWebglRenderer
}

export function installTransparentWebglClear(addon: WebglAddon): boolean {
  const renderer = getClearableRenderer(addon)
  if (!renderer) {
    return false
  }
  if (transparentClearPatches.has(renderer)) {
    return true
  }
  const originalRenderRows = renderer.renderRows
  // Why: @xterm/addon-webgl has no public transparent-frame clear hook. Clearing
  // the alpha canvas before xterm redraws prevents rgba backgrounds from being
  // blended over the previous frame on partial redraws (#6491).
  const patchedRenderRows: WebglRenderRows = function patchedTransparentRenderRows(start, end) {
    renderer._gl.clearColor(0, 0, 0, 0)
    renderer._gl.clear(renderer._gl.COLOR_BUFFER_BIT)
    originalRenderRows.call(renderer, start, end)
  }
  renderer.renderRows = patchedRenderRows
  transparentClearPatches.set(renderer, { originalRenderRows, patchedRenderRows })
  return true
}

export function uninstallTransparentWebglClear(addon: WebglAddon): void {
  const renderer = getClearableRenderer(addon)
  if (!renderer) {
    return
  }
  const patch = transparentClearPatches.get(renderer)
  if (!patch) {
    return
  }
  if (renderer.renderRows === patch.patchedRenderRows) {
    renderer.renderRows = patch.originalRenderRows
  }
  transparentClearPatches.delete(renderer)
}
