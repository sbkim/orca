import { describe, expect, it, vi, type Mock } from 'vitest'
import type { WebglAddon } from '@xterm/addon-webgl'
import {
  installTransparentWebglClear,
  uninstallTransparentWebglClear
} from './pane-webgl-transparent-clear'

function createAddon(): {
  addon: WebglAddon
  gl: {
    COLOR_BUFFER_BIT: number
    clear: Mock<(mask: number) => void>
    clearColor: Mock<(red: number, green: number, blue: number, alpha: number) => void>
  }
  originalRenderRows: Mock<(start: number, end: number) => void>
  renderer: { renderRows: (start: number, end: number) => void }
} {
  const gl = {
    COLOR_BUFFER_BIT: 0x4000,
    clear: vi.fn<(mask: number) => void>(),
    clearColor: vi.fn<(red: number, green: number, blue: number, alpha: number) => void>()
  }
  const originalRenderRows = vi.fn<(start: number, end: number) => void>()
  const renderer = {
    _gl: gl,
    renderRows: originalRenderRows
  }
  return {
    addon: { _renderer: renderer } as unknown as WebglAddon,
    gl,
    originalRenderRows,
    renderer
  }
}

describe('transparent WebGL clear patch', () => {
  it('clears the transparent canvas before delegating renderRows', () => {
    const { addon, gl, originalRenderRows, renderer } = createAddon()

    expect(installTransparentWebglClear(addon)).toBe(true)
    renderer.renderRows(2, 4)

    expect(gl.clearColor).toHaveBeenCalledWith(0, 0, 0, 0)
    expect(gl.clear).toHaveBeenCalledWith(gl.COLOR_BUFFER_BIT)
    expect(originalRenderRows).toHaveBeenCalledWith(2, 4)
    expect(gl.clear.mock.invocationCallOrder[0]).toBeLessThan(
      originalRenderRows.mock.invocationCallOrder[0]
    )
  })

  it('is idempotent and restores the original renderRows on uninstall', () => {
    const { addon, originalRenderRows, renderer } = createAddon()

    expect(installTransparentWebglClear(addon)).toBe(true)
    const patchedRenderRows = renderer.renderRows
    expect(installTransparentWebglClear(addon)).toBe(true)

    expect(renderer.renderRows).toBe(patchedRenderRows)

    uninstallTransparentWebglClear(addon)

    expect(renderer.renderRows).toBe(originalRenderRows)
  })

  it('declines addons without the expected xterm WebGL internals', () => {
    expect(installTransparentWebglClear({} as WebglAddon)).toBe(false)
  })
})
