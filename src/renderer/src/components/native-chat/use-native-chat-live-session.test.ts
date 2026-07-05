// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { useAppStore } from '@/store'
import { mergeNativeChatLiveSession } from './native-chat-live-status'

// Mock the session transport so the hook's IO is observable and controllable
// per owner id. Each distinct owner gets its own read/subscribe/unsubscribe mocks.
const { transportFactory, getMockTransport, resetMockTransports } = vi.hoisted(() => {
  type MockTransport = {
    readSession: ReturnType<typeof vi.fn>
    subscribe: ReturnType<typeof vi.fn>
    unsubscribe: ReturnType<typeof vi.fn>
  }
  const transports = new Map<string | null, MockTransport>()
  const getMockTransport = (ownerId: string | null): MockTransport => {
    let transport = transports.get(ownerId)
    if (!transport) {
      const unsubscribe = vi.fn()
      transport = {
        unsubscribe,
        readSession: vi.fn().mockResolvedValue({ messages: [] }),
        subscribe: vi.fn(() => unsubscribe)
      }
      transports.set(ownerId, transport)
    }
    return transport
  }
  return {
    getMockTransport,
    resetMockTransports: () => transports.clear(),
    transportFactory: vi.fn((ownerId: string | null) => getMockTransport(ownerId))
  }
})

vi.mock('./native-chat-session-transport', () => ({
  getNativeChatSessionTransport: transportFactory
}))

// Imported after vi.mock is hoisted, so it binds to the mocked transport.
import {
  useNativeChatLiveSession,
  type NativeChatLiveSession,
  type UseNativeChatLiveSessionArgs
} from './use-native-chat-live-session'

function assistant(id: string, text: string): NativeChatMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', text }], timestamp: 2, source: 'transcript' }
}

function user(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: 1, source: 'transcript' }
}

describe('mergeNativeChatLiveSession', () => {
  it("surfaces live 'working' before the assistant turn lands in the transcript", () => {
    const session = mergeNativeChatLiveSession({
      sources: { transcript: [user('u-1', 'do a thing')] },
      sessionId: 'sess',
      agent: 'claude',
      hookState: 'working'
    })
    expect(session.status).toBe('working')
    expect(session.messages).toHaveLength(1)
  })

  it("clears 'working' once the assistant message flushes to the transcript", () => {
    const session = mergeNativeChatLiveSession({
      sources: { transcript: [user('u-1', 'do a thing'), assistant('a-1', 'done')] },
      sessionId: 'sess',
      agent: 'claude',
      hookState: 'working'
    })
    expect(session.status).toBe('ready')
  })

  it('leaves completed states (done/waiting/blocked) on the derived status', () => {
    const session = mergeNativeChatLiveSession({
      sources: { transcript: [user('u-1', 'hi')] },
      sessionId: 'sess',
      agent: 'claude',
      hookState: 'done'
    })
    expect(session.status).toBe('ready')
  })

  it('honors loading and error overrides outright', () => {
    expect(
      mergeNativeChatLiveSession({
        sources: { transcript: [] },
        sessionId: null,
        agent: 'claude',
        hookState: 'working',
        loading: true
      }).status
    ).toBe('loading')

    const errored = mergeNativeChatLiveSession({
      sources: { transcript: [] },
      sessionId: 'sess',
      agent: 'claude',
      hookState: null,
      error: 'unreadable'
    })
    expect(errored.status).toBe('error')
    expect(errored.error).toBe('unreadable')
  })

  it('assembles an empty transcript with no live work as empty', () => {
    const session = mergeNativeChatLiveSession({
      sources: { transcript: [] },
      sessionId: 'sess',
      agent: 'claude',
      hookState: null
    })
    expect(session.status).toBe('empty')
  })
})

describe('useNativeChatLiveSession — transport routing', () => {
  const AGENT = 'claude' as const
  const SESSION = 'sess-1'
  const PANE = 'pane-1'
  const roots: Root[] = []
  let latest: NativeChatLiveSession | null = null

  function Probe(props: UseNativeChatLiveSessionArgs): null {
    latest = useNativeChatLiveSession(props)
    return null
  }

  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  async function render(props: UseNativeChatLiveSessionArgs): Promise<Root> {
    const container = document.createElement('div')
    const root = createRoot(container)
    roots.push(root)
    await act(async () => {
      root.render(createElement(Probe, props))
    })
    await flush()
    return root
  }

  async function rerender(root: Root, props: UseNativeChatLiveSessionArgs): Promise<void> {
    await act(async () => {
      root.render(createElement(Probe, props))
    })
    await flush()
  }

  beforeEach(() => {
    useAppStore.setState({ agentStatusByPaneKey: {} })
  })

  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => root.unmount())
    }
    latest = null
    vi.clearAllMocks()
    resetMockTransports()
  })

  it('routes the initial read and subscribe through the runtime transport', async () => {
    await render({ paneKey: PANE, agent: AGENT, sessionId: SESSION, runtimeEnvironmentId: 'env-1' })

    expect(transportFactory).toHaveBeenCalledWith('env-1')
    const transport = getMockTransport('env-1')
    expect(transport.readSession).toHaveBeenCalledWith(AGENT, SESSION, expect.any(Number), undefined)
    expect(transport.subscribe).toHaveBeenCalledOnce()
  })

  it('re-subscribes against the new owner on an owner flip (R5)', async () => {
    const root = await render({
      paneKey: PANE,
      agent: AGENT,
      sessionId: SESSION,
      runtimeEnvironmentId: 'env-1'
    })
    const first = getMockTransport('env-1')

    await rerender(root, {
      paneKey: PANE,
      agent: AGENT,
      sessionId: SESSION,
      runtimeEnvironmentId: 'env-2'
    })
    const second = getMockTransport('env-2')

    expect(first.unsubscribe).toHaveBeenCalledOnce()
    expect(second.subscribe).toHaveBeenCalledOnce()
  })

  it('tears down the subscription on unmount (no watcher leak)', async () => {
    const root = await render({
      paneKey: PANE,
      agent: AGENT,
      sessionId: SESSION,
      runtimeEnvironmentId: 'env-1'
    })
    const transport = getMockTransport('env-1')

    await act(async () => {
      root.unmount()
    })

    expect(transport.unsubscribe).toHaveBeenCalledOnce()
  })

  it('surfaces a runtime read error in the error phase (R4 end-to-end)', async () => {
    getMockTransport('env-1').readSession.mockResolvedValueOnce({ error: 'runtime too old' })

    await render({ paneKey: PANE, agent: AGENT, sessionId: SESSION, runtimeEnvironmentId: 'env-1' })
    await flush()

    expect(latest?.status).toBe('error')
    expect(latest?.error).toBe('runtime too old')
  })

  it('never calls the transport when there is no session id', async () => {
    await render({ paneKey: PANE, agent: AGENT, sessionId: null, runtimeEnvironmentId: 'env-1' })

    const transport = getMockTransport('env-1')
    expect(transport.readSession).not.toHaveBeenCalled()
    expect(transport.subscribe).not.toHaveBeenCalled()
  })

  it('uses the local transport when the owner is null (unchanged behavior, R6)', async () => {
    await render({ paneKey: PANE, agent: AGENT, sessionId: SESSION })

    expect(transportFactory).toHaveBeenCalledWith(null)
    const transport = getMockTransport(null)
    expect(transport.readSession).toHaveBeenCalledOnce()
    expect(transport.subscribe).toHaveBeenCalledOnce()
  })
})
