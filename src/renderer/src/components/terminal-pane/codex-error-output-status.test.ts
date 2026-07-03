import { describe, expect, it, vi } from 'vitest'
import { createCodexErrorOutputStatusDetector } from './codex-error-output-status'

describe('Codex error output status detector', () => {
  it('detects stream-disconnect errors from Codex output', () => {
    const onStreamError = vi.fn()
    const detector = createCodexErrorOutputStatusDetector({ onStreamError })

    const observed = detector.observe(
      '■ stream disconnected before completion: error sending request for url (http://openclaw:2455/backend-api/codex/responses)\r\n'
    )

    expect(observed).toBe(true)
    expect(onStreamError).toHaveBeenCalledWith(
      'stream disconnected before completion: error sending request for url (http://openclaw:2455/backend-api/codex/responses)'
    )
  })

  it('detects a stream-disconnect error split across chunks', () => {
    const onStreamError = vi.fn()
    const detector = createCodexErrorOutputStatusDetector({ onStreamError })

    expect(detector.observe('■ stream discon')).toBe(false)
    expect(
      detector.observe(
        'nected before completion: error sending request for url (http://openclaw:2455/backend-api/codex/responses)\r\n'
      )
    ).toBe(true)

    expect(onStreamError).toHaveBeenCalledWith(
      'stream disconnected before completion: error sending request for url (http://openclaw:2455/backend-api/codex/responses)'
    )
  })

  it('strips terminal control sequences before reporting the error message', () => {
    const onStreamError = vi.fn()
    const detector = createCodexErrorOutputStatusDetector({ onStreamError })

    detector.observe(
      '\x1b[31mstream disconnected before completion: error sending request for url (http://openclaw:2455/backend-api/codex/responses)\x1b[0m\r\n'
    )

    expect(onStreamError).toHaveBeenCalledWith(
      'stream disconnected before completion: error sending request for url (http://openclaw:2455/backend-api/codex/responses)'
    )
  })
})
