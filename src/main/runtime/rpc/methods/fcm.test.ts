import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcRequest, RpcResponse } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { FCM_METHODS } from './fcm'

const PRIVATE_KEY_SENTINEL = 'private-key-must-not-leak'
const SERVICE_ACCOUNT_JSON = JSON.stringify({
  project_id: 'orca-headless-test',
  private_key: PRIVATE_KEY_SENTINEL
})

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-fcm', authToken: 'token', method, params }
}

function createRuntime(): OrcaRuntimeService {
  return {
    getRuntimeId: () => 'runtime-test',
    setFcmServiceAccount: vi.fn(() => ({ ok: true, projectId: 'orca-headless-test' })),
    getFcmServiceAccountStatus: vi.fn(() => ({
      configured: true,
      projectId: 'orca-headless-test'
    })),
    clearFcmServiceAccount: vi.fn(() => ({ ok: true }))
  } as unknown as OrcaRuntimeService
}

async function dispatchWebSocket(
  dispatcher: RpcDispatcher,
  request: RpcRequest,
  clientKind: 'mobile' | 'runtime'
): Promise<RpcResponse> {
  const replies: string[] = []
  await dispatcher.dispatchStreaming(request, (reply) => replies.push(reply), { clientKind })
  return JSON.parse(replies[0]) as RpcResponse
}

describe('FCM RPC methods', () => {
  it('configures a credential through the local socket without returning secret material', async () => {
    const runtime = createRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: FCM_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest('fcm.setServiceAccount', { serviceAccountJson: SERVICE_ACCOUNT_JSON })
    )

    expect(runtime.setFcmServiceAccount).toHaveBeenCalledWith(SERVICE_ACCOUNT_JSON)
    expect(response).toMatchObject({
      ok: true,
      result: { ok: true, projectId: 'orca-headless-test' }
    })
    expect(JSON.stringify(response)).not.toContain(PRIVATE_KEY_SENTINEL)
    expect(JSON.stringify(response)).not.toContain('private_key')
  })

  it('supports status and clear through the local socket', async () => {
    const runtime = createRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: FCM_METHODS })

    const status = await dispatcher.dispatch(makeRequest('fcm.getServiceAccountStatus'))
    const cleared = await dispatcher.dispatch(makeRequest('fcm.clearServiceAccount'))

    expect(status).toMatchObject({
      ok: true,
      result: { configured: true, projectId: 'orca-headless-test' }
    })
    expect(cleared).toMatchObject({ ok: true, result: { ok: true } })
  })

  it.each(['mobile', 'runtime'] as const)(
    'rejects credential management from a %s WebSocket client',
    async (clientKind) => {
      const runtime = createRuntime()
      const dispatcher = new RpcDispatcher({ runtime, methods: FCM_METHODS })

      const response = await dispatchWebSocket(
        dispatcher,
        makeRequest('fcm.setServiceAccount', { serviceAccountJson: SERVICE_ACCOUNT_JSON }),
        clientKind
      )

      expect(response).toMatchObject({ ok: false, error: { code: 'forbidden' } })
      expect(runtime.setFcmServiceAccount).not.toHaveBeenCalled()
      expect(JSON.stringify(response)).not.toContain(PRIVATE_KEY_SENTINEL)
    }
  )

  it('rejects an oversized credential before it reaches the runtime', async () => {
    const runtime = createRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: FCM_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest('fcm.setServiceAccount', { serviceAccountJson: 'x'.repeat(128 * 1024 + 1) })
    )

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument', message: 'Service-account JSON is too large.' }
    })
    expect(runtime.setFcmServiceAccount).not.toHaveBeenCalled()
  })
})
