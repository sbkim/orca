import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { subscribeMock, writeFileSyncMock } = vi.hoisted(() => ({
  subscribeMock: vi.fn(),
  writeFileSyncMock: vi.fn()
}))

vi.mock('node:fs', () => ({
  mkdtempSync: vi.fn(() => '/tmp/orca-watcher-canary-test'),
  rmSync: vi.fn(),
  writeFileSync: writeFileSyncMock
}))
vi.mock('@parcel/watcher', () => ({ subscribe: subscribeMock }))

describe('parcel watcher process canary', () => {
  let originalMessageListeners: ReturnType<typeof process.listeners>
  let originalExitListeners: ReturnType<typeof process.listeners>
  let originalDisconnectListeners: ReturnType<typeof process.listeners>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    subscribeMock.mockReset()
    writeFileSyncMock.mockReset()
    originalMessageListeners = process.listeners('message')
    originalExitListeners = process.listeners('exit')
    originalDisconnectListeners = process.listeners('disconnect')
  })

  afterEach(() => {
    for (const listener of process.listeners('message')) {
      if (!originalMessageListeners.includes(listener)) {
        process.off('message', listener)
      }
    }
    for (const listener of process.listeners('exit')) {
      if (!originalExitListeners.includes(listener)) {
        process.off('exit', listener)
      }
    }
    for (const listener of process.listeners('disconnect')) {
      if (!originalDisconnectListeners.includes(listener)) {
        process.off('disconnect', listener)
      }
    }
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not restart while a native subscription is still crawling', async () => {
    subscribeMock
      .mockResolvedValueOnce({ unsubscribe: vi.fn() })
      .mockReturnValueOnce(new Promise(() => undefined))
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    await import('./parcel-watcher-process-entry')
    await vi.advanceTimersByTimeAsync(0)
    process.emit('message', { op: 'subscribe', id: 1, dir: '/large-repo', opts: {} })

    await vi.advanceTimersByTimeAsync(30_000)

    expect(writeFileSyncMock).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('invalidates an outstanding probe when another subscription starts crawling', async () => {
    subscribeMock
      .mockResolvedValueOnce({ unsubscribe: vi.fn() })
      .mockResolvedValueOnce({ unsubscribe: vi.fn() })
      .mockReturnValueOnce(new Promise(() => undefined))
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    await import('./parcel-watcher-process-entry')
    await vi.advanceTimersByTimeAsync(0)
    process.emit('message', { op: 'subscribe', id: 1, dir: '/repo', opts: {} })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1)

    process.emit('message', { op: 'subscribe', id: 2, dir: '/large-repo', opts: {} })
    await vi.advanceTimersByTimeAsync(20_000)

    expect(writeFileSyncMock).toHaveBeenCalledTimes(1)
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('still restarts after consecutive missed events once every subscription is live', async () => {
    subscribeMock.mockResolvedValue({ unsubscribe: vi.fn() })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    await import('./parcel-watcher-process-entry')
    await vi.advanceTimersByTimeAsync(0)
    process.emit('message', { op: 'subscribe', id: 1, dir: '/repo', opts: {} })
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(30_000)

    expect(writeFileSyncMock).toHaveBeenCalledTimes(3)
    expect(exitSpy).toHaveBeenCalledWith(2)
  })
})
