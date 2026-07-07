import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PRE_HANDLER_PTY_MAX_PTYS,
  bufferPreHandlerPtyData,
  bufferPreHandlerPtyExit,
  drainPreHandlerPtyData,
  drainPreHandlerPtyExit,
  getPreHandlerPtyStateCountsForTests,
  resetPreHandlerPtyStateForTests
} from './pty-pre-handler-buffer'

afterEach(() => {
  resetPreHandlerPtyStateForTests()
})

describe('pty pre-handler buffer', () => {
  it('bounds exit records while retaining recently updated PTYs', () => {
    bufferPreHandlerPtyExit('keep', 7)
    for (let i = 0; i < PRE_HANDLER_PTY_MAX_PTYS - 1; i += 1) {
      bufferPreHandlerPtyExit(`pty-${i}`, i)
    }

    bufferPreHandlerPtyExit('keep', 8)
    bufferPreHandlerPtyExit('pty-new', 99)

    expect(getPreHandlerPtyStateCountsForTests()).toEqual({
      data: 0,
      exits: PRE_HANDLER_PTY_MAX_PTYS
    })

    const evictedHandler = vi.fn()
    drainPreHandlerPtyExit('pty-0', evictedHandler)
    expect(evictedHandler).not.toHaveBeenCalled()

    const keepHandler = vi.fn()
    drainPreHandlerPtyExit('keep', keepHandler)
    expect(keepHandler).toHaveBeenCalledWith(8)

    const newHandler = vi.fn()
    drainPreHandlerPtyExit('pty-new', newHandler)
    expect(newHandler).toHaveBeenCalledWith(99)
  })

  it('does not let duplicate exit records grow the exit map', () => {
    bufferPreHandlerPtyExit('pty-1', 1)
    bufferPreHandlerPtyExit('pty-1', 2)

    expect(getPreHandlerPtyStateCountsForTests()).toEqual({ data: 0, exits: 1 })

    const handler = vi.fn()
    drainPreHandlerPtyExit('pty-1', handler)

    expect(handler).toHaveBeenCalledWith(2)
  })

  it('keeps the existing data buffer cap separate from exit records', () => {
    for (let i = 0; i < PRE_HANDLER_PTY_MAX_PTYS + 1; i += 1) {
      bufferPreHandlerPtyData(`pty-${i}`, `data-${i}`)
    }
    bufferPreHandlerPtyExit('exit-pty', 0)

    expect(getPreHandlerPtyStateCountsForTests()).toEqual({
      data: PRE_HANDLER_PTY_MAX_PTYS,
      exits: 1
    })

    const evictedDataHandler = vi.fn()
    drainPreHandlerPtyData('pty-0', evictedDataHandler)
    expect(evictedDataHandler).not.toHaveBeenCalled()
  })
})
