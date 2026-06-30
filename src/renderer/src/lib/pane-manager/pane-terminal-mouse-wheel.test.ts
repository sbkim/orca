// @vitest-environment happy-dom
import type { Terminal } from '@xterm/xterm'
import { describe, expect, it, vi } from 'vitest'
import {
  TERMINAL_TUI_MOUSE_WHEEL_MULTIPLIER,
  attachTerminalMouseWheelMultiplier,
  normalizeTerminalTuiMouseWheelMultiplier,
  shouldMultiplyTerminalMouseWheel
} from './pane-terminal-mouse-wheel'

const DOM_DELTA_PIXEL = 0
const DOM_DELTA_LINE = 1
const REPLAYED_WHEEL_EVENT_PROPERTY = '__orcaReplayedTerminalWheelEvent'

function terminalElement(mouseReporting = true): HTMLElement {
  return {
    classList: {
      contains: (className: string) => mouseReporting && className === 'enable-mouse-events'
    }
  } as HTMLElement
}

function wheelEvent(init: Partial<WheelEventInit> = {}): WheelEvent {
  return {
    deltaY: 100,
    deltaMode: DOM_DELTA_PIXEL,
    ...init
  } as WheelEvent
}

type WheelHandler = (event: WheelEvent) => boolean

/**
 * Records the handler xterm would invoke and a spied dispatch target so the
 * synchronous replay behavior of attachTerminalMouseWheelMultiplier can be
 * asserted without a real xterm/DOM.
 */
function fakeTerminal(element: HTMLElement | null): {
  terminal: Pick<Terminal, 'attachCustomWheelEventHandler' | 'element'>
  getHandler: () => WheelHandler
  target: EventTarget
  dispatch: ReturnType<typeof vi.fn>
} {
  let handler: WheelHandler | undefined
  // Real EventTarget instance so the handler's `currentTarget instanceof
  // EventTarget` guard passes, but with dispatchEvent stubbed so we count the
  // synchronous replay dispatches directly instead of recursing into the DOM.
  const target = new EventTarget()
  const dispatch = vi.fn<(event: Event) => boolean>(() => true)
  target.dispatchEvent = dispatch
  const terminal = {
    element,
    attachCustomWheelEventHandler: (next: WheelHandler) => {
      handler = next
    }
  } as unknown as Pick<Terminal, 'attachCustomWheelEventHandler' | 'element'>
  return {
    terminal,
    getHandler: () => {
      if (!handler) {
        throw new Error('handler was not attached')
      }
      return handler
    },
    target,
    dispatch
  }
}

function discreteWheelEventOn(target: EventTarget): WheelEvent {
  return {
    type: 'wheel',
    deltaY: 1,
    deltaMode: DOM_DELTA_LINE,
    currentTarget: target
  } as unknown as WheelEvent
}

describe('terminal mouse wheel multiplier', () => {
  it('uses a three-report multiplier for TUI mouse wheel scrolling', () => {
    expect(TERMINAL_TUI_MOUSE_WHEEL_MULTIPLIER).toBe(3)
  })

  it('normalizes TUI wheel multipliers to the supported report range', () => {
    expect(normalizeTerminalTuiMouseWheelMultiplier(undefined)).toBe(3)
    expect(normalizeTerminalTuiMouseWheelMultiplier(0)).toBe(1)
    expect(normalizeTerminalTuiMouseWheelMultiplier(4.4)).toBe(4)
    expect(normalizeTerminalTuiMouseWheelMultiplier(20)).toBe(10)
  })

  it('multiplies discrete wheel events when mouse reporting is active', () => {
    expect(shouldMultiplyTerminalMouseWheel(wheelEvent(), terminalElement())).toBe(true)
  })

  it('leaves normal terminal scrollback alone', () => {
    expect(shouldMultiplyTerminalMouseWheel(wheelEvent(), terminalElement(false))).toBe(false)
  })

  it('leaves trackpad-like pixel scrolling one-to-one', () => {
    expect(
      shouldMultiplyTerminalMouseWheel(
        wheelEvent({
          deltaY: 12,
          deltaMode: DOM_DELTA_PIXEL
        }),
        terminalElement()
      )
    ).toBe(false)
  })

  it('multiplies non-pixel wheel deltas as discrete input', () => {
    expect(
      shouldMultiplyTerminalMouseWheel(
        wheelEvent({
          deltaY: 1,
          deltaMode: DOM_DELTA_LINE
        }),
        terminalElement()
      )
    ).toBe(true)
  })

  it('ignores horizontal shift-wheel events', () => {
    expect(
      shouldMultiplyTerminalMouseWheel(
        wheelEvent({
          shiftKey: true
        }),
        terminalElement()
      )
    ).toBe(false)
  })

  it('dispatches the extra reports synchronously to stay frame-aligned', () => {
    const { terminal, getHandler, target, dispatch } = fakeTerminal(terminalElement())
    attachTerminalMouseWheelMultiplier(terminal, {
      getTuiMouseWheelMultiplier: () => 3
    })

    const result = getHandler()(discreteWheelEventOn(target))

    // Assert immediately after the handler returns (no microtask flush): the
    // multiplier - 1 clones must already be present, proving the dispatch is
    // synchronous and no longer deferred into a queueMicrotask.
    expect(result).toBe(true)
    expect(dispatch).toHaveBeenCalledTimes(2)
  })

  it('reads the current TUI multiplier for each wheel event', () => {
    const { terminal, getHandler, target, dispatch } = fakeTerminal(terminalElement())
    let multiplier = 1
    attachTerminalMouseWheelMultiplier(terminal, {
      getTuiMouseWheelMultiplier: () => multiplier
    })
    const handler = getHandler()

    expect(handler(discreteWheelEventOn(target))).toBe(true)
    expect(dispatch).not.toHaveBeenCalled()

    multiplier = 4
    expect(handler(discreteWheelEventOn(target))).toBe(true)
    expect(dispatch).toHaveBeenCalledTimes(3)
  })

  it('marks replayed clones so they do not re-trigger multiplication', () => {
    const { terminal, getHandler, target, dispatch } = fakeTerminal(terminalElement())
    attachTerminalMouseWheelMultiplier(terminal, {
      getTuiMouseWheelMultiplier: () => 3
    })

    getHandler()(discreteWheelEventOn(target))

    for (const [clone] of dispatch.mock.calls as [WheelEvent][]) {
      expect(
        (clone as WheelEvent & { [REPLAYED_WHEEL_EVENT_PROPERTY]?: boolean })[
          REPLAYED_WHEEL_EVENT_PROPERTY
        ]
      ).toBe(true)
      expect(shouldMultiplyTerminalMouseWheel(clone, terminalElement())).toBe(false)
    }
  })

  it('does not multiply when mouse reporting is inactive', () => {
    const { terminal, getHandler, target, dispatch } = fakeTerminal(terminalElement(false))
    attachTerminalMouseWheelMultiplier(terminal, {
      getTuiMouseWheelMultiplier: () => 3
    })

    expect(getHandler()(discreteWheelEventOn(target))).toBe(true)
    expect(dispatch).not.toHaveBeenCalled()
  })
})
