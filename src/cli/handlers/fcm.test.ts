import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { callMock, constructorMock } = vi.hoisted(() => ({
  callMock: vi.fn(),
  constructorMock: vi.fn()
}))

vi.mock('../runtime-client', () => {
  class RuntimeClient {
    call = callMock

    constructor(...args: unknown[]) {
      constructorMock(...args)
    }
  }

  class RuntimeClientError extends Error {
    readonly code: string

    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  }

  class RuntimeRpcFailureError extends RuntimeClientError {
    readonly response: unknown

    constructor(response: unknown) {
      super('runtime_error', 'runtime_error')
      this.response = response
    }
  }

  return { RuntimeClient, RuntimeClientError, RuntimeRpcFailureError }
})

import { main } from '../index'
import { okFixture } from '../test-fixtures'

const PRIVATE_KEY_SENTINEL = 'headless-cli-private-key'
const SERVICE_ACCOUNT_JSON = JSON.stringify({
  project_id: 'orca-headless-test',
  private_key: PRIVATE_KEY_SENTINEL
})

describe('orca fcm CLI handlers', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orca-fcm-cli-'))
    callMock.mockReset()
    constructorMock.mockReset()
    process.exitCode = undefined
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(directory, { recursive: true, force: true })
    process.exitCode = undefined
  })

  it('reads a host-local JSON file and configures the running runtime', async () => {
    await writeFile(join(directory, 'service-account.json'), SERVICE_ACCOUNT_JSON)
    callMock.mockResolvedValue(okFixture('req-fcm', { ok: true, projectId: 'orca-headless-test' }))

    await main(['fcm', 'set', '--file', 'service-account.json'], directory)

    expect(callMock).toHaveBeenCalledWith('fcm.setServiceAccount', {
      serviceAccountJson: SERVICE_ACCOUNT_JSON
    })
    const output = String(vi.mocked(console.log).mock.calls[0][0])
    expect(output).toBe('Configured FCM push for project "orca-headless-test".')
    expect(output).not.toContain(PRIVATE_KEY_SENTINEL)
  })

  it('rejects malformed JSON locally without sending credential material', async () => {
    await writeFile(join(directory, 'invalid.json'), `{ "private_key": "${PRIVATE_KEY_SENTINEL}"`)

    await main(['fcm', 'set', '--file', 'invalid.json'], directory)

    expect(callMock).not.toHaveBeenCalled()
    const output = String(vi.mocked(console.error).mock.calls[0][0])
    expect(output).toContain('Service-account JSON could not be parsed.')
    expect(output).not.toContain(PRIVATE_KEY_SENTINEL)
    expect(process.exitCode).toBe(1)
  })

  it('shows status and clears the stored credential', async () => {
    callMock
      .mockResolvedValueOnce(
        okFixture('req-status', { configured: true, projectId: 'orca-headless-test' })
      )
      .mockResolvedValueOnce(okFixture('req-clear', { ok: true }))

    await main(['fcm', 'status'], directory)
    await main(['fcm', 'clear'], directory)

    expect(callMock).toHaveBeenNthCalledWith(1, 'fcm.getServiceAccountStatus')
    expect(callMock).toHaveBeenNthCalledWith(2, 'fcm.clearServiceAccount')
    expect(vi.mocked(console.log).mock.calls.map((call) => call[0])).toEqual([
      'FCM push is configured for project "orca-headless-test".',
      'Cleared the FCM service-account credential.'
    ])
  })

  it('ignores remote selectors so credentials can only target the local host', async () => {
    callMock.mockResolvedValue(okFixture('req-status', { configured: false, projectId: null }))

    await main(['fcm', 'status', '--environment', 'remote-server'], directory)

    expect(constructorMock).toHaveBeenCalledWith(undefined, undefined, null, null)
    expect(callMock).toHaveBeenCalledWith('fcm.getServiceAccountStatus')
  })
})
