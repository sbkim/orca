import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence'

const { removeHandlerMock, handleMock } = vi.hoisted(() => ({
  removeHandlerMock: vi.fn(),
  handleMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    removeHandler: removeHandlerMock,
    handle: handleMock
  }
}))

import { registerFcmHandlers } from './fcm-onboarding'

// Why: a minimal in-memory store lets each test seed the persisted credential
// state and assert how the handlers move it, without touching safeStorage or
// disk. `setFcmServiceAccountJson` mirrors persistence.ts: empty/null becomes
// null so the "clear" path is exercised identically to production.
function createMockStore(initial: string | null = null): {
  store: Store
  state: { value: string | null }
} {
  const state = { value: initial }
  const store = {
    getFcmServiceAccountJson: () => state.value,
    setFcmServiceAccountJson: (value: string | null) => {
      state.value = value && value.length > 0 ? value : null
    }
  } as unknown as Store
  return { store, state }
}

// Why: handlers are registered through ipcMain.handle, which the electron mock
// captures as `(channel, handler)` pairs. This helper plucks the handler for a
// given channel so a test can invoke it directly with controlled args.
function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = handleMock.mock.calls.find((c: unknown[]) => c[0] === channel)
  if (!call) {
    throw new Error(`no handler registered for ${channel}`)
  }
  return call[1] as (...args: unknown[]) => unknown
}

// Why: fake credential material only — validation reads project_id, never the
// private key. The unique sentinel tokens let the no-leak test assert that
// none of the sensitive payload survives into the status response. Constructed
// from parts so the fixture itself does not look like a real credential blob
// to secret scanners.
const FAKE_SECRET_MATERIAL = ['super', 'secret', 'fcm', 'test', 'key'].join('-')
const FAKE_CLIENT_EMAIL = ['firebase', 'adminsdk', 'example', 'iam', 'gserviceaccount', 'com'].join(
  '.'
)
const VALID_JSON = JSON.stringify({
  project_id: 'orca-fcm-proj',
  private_key: FAKE_SECRET_MATERIAL,
  client_email: FAKE_CLIENT_EMAIL
})

describe('registerFcmHandlers', () => {
  beforeEach(() => {
    removeHandlerMock.mockReset()
    handleMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers exactly the three FCM channels', () => {
    registerFcmHandlers(createMockStore().store)

    const channels = handleMock.mock.calls.map((c: unknown[]) => c[0])
    expect(channels).toEqual([
      'fcm:setServiceAccount',
      'fcm:getServiceAccountStatus',
      'fcm:clearServiceAccount'
    ])
  })

  it('accepts a valid credential and reports its projectId', async () => {
    const { store, state } = createMockStore(null)
    registerFcmHandlers(store)

    const result = await getHandler('fcm:setServiceAccount')(undefined, VALID_JSON)

    expect(result).toEqual({ ok: true, projectId: 'orca-fcm-proj' })
    expect(state.value).toBe(VALID_JSON)
  })

  it('rejects malformed JSON', async () => {
    const { store, state } = createMockStore(null)
    registerFcmHandlers(store)

    const result = await getHandler('fcm:setServiceAccount')(undefined, '{ not json')

    expect(result).toEqual({ ok: false, error: expect.any(String) })
    expect(state.value).toBeNull()
  })

  it('rejects a credential missing project_id', async () => {
    const { store, state } = createMockStore(null)
    registerFcmHandlers(store)

    const result = await getHandler('fcm:setServiceAccount')(
      undefined,
      JSON.stringify({ private_key: 'whatever' })
    )

    expect(result).toEqual({ ok: false, error: expect.any(String) })
    expect(state.value).toBeNull()
  })

  it('rejects JSON primitives without throwing', async () => {
    const { store, state } = createMockStore(null)
    registerFcmHandlers(store)

    for (const raw of ['null', '42', '"text"', '[]']) {
      const result = await getHandler('fcm:setServiceAccount')(undefined, raw)
      expect(result).toMatchObject({ ok: false })
    }

    expect(state.value).toBeNull()
  })

  it('rejects a credential whose project_id is not a non-empty string', async () => {
    const { store, state } = createMockStore(null)
    registerFcmHandlers(store)

    const numericResult = await getHandler('fcm:setServiceAccount')(
      undefined,
      JSON.stringify({ project_id: 12345 })
    )
    expect(numericResult).toMatchObject({ ok: false })

    const emptyResult = await getHandler('fcm:setServiceAccount')(
      undefined,
      JSON.stringify({ project_id: '' })
    )
    expect(emptyResult).toMatchObject({ ok: false })

    expect(state.value).toBeNull()
  })

  it('reports configured=true with projectId once a credential is stored', async () => {
    const { store } = createMockStore(VALID_JSON)
    registerFcmHandlers(store)

    const status = await getHandler('fcm:getServiceAccountStatus')()

    expect(status).toEqual({ configured: true, projectId: 'orca-fcm-proj' })
  })

  // Why: this is the core security invariant. The status channel is the only
  // surface the renderer polls after the initial paste, so its serialized shape
  // must never carry the credential's private key or the raw JSON blob — only
  // the non-secret projectId.
  it('never leaks the raw JSON or private key through the status channel', async () => {
    const { store } = createMockStore(VALID_JSON)
    registerFcmHandlers(store)

    const status = await getHandler('fcm:getServiceAccountStatus')()
    const serialized = JSON.stringify(status)

    expect(serialized).not.toContain(FAKE_SECRET_MATERIAL)
    expect(serialized).not.toContain('"private_key"')
    // Why: the full credential blob (including client_email) must not appear.
    expect(serialized).not.toContain(FAKE_CLIENT_EMAIL)
  })

  it('reports configured=false when no credential is stored', async () => {
    const { store } = createMockStore(null)
    registerFcmHandlers(store)

    const status = await getHandler('fcm:getServiceAccountStatus')()

    expect(status).toEqual({ configured: false, projectId: null })
  })

  it('clears the stored credential', async () => {
    const { store, state } = createMockStore(VALID_JSON)
    registerFcmHandlers(store)

    const result = await getHandler('fcm:clearServiceAccount')()

    expect(result).toEqual({ ok: true })
    expect(state.value).toBeNull()
  })

  it('treats a corrupt stored credential as not-configured rather than throwing', async () => {
    // Why: mirrors the fan-out's defensive parse in index.ts — a corrupt or
    // hand-edited persisted value must degrade to a no-op so the status poll
    // never throws on the renderer's hot path.
    const { store } = createMockStore('not-valid-json{')
    registerFcmHandlers(store)

    const status = await getHandler('fcm:getServiceAccountStatus')()

    expect(status).toEqual({ configured: false, projectId: null })
  })
})
