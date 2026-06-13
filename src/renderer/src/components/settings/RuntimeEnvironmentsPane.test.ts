import { describe, expect, it } from 'vitest'
import {
  MIN_COMPATIBLE_RUNTIME_SERVER_VERSION,
  RUNTIME_PROTOCOL_VERSION
} from '../../../../shared/protocol-version'
import {
  evaluateHostDetails,
  getHostDetailsDescription,
  getHostDetailsSummary,
  getRuntimeCapabilitiesSummary,
  type RuntimeHostDetails
} from './RuntimeEnvironmentsPane'

function details(overrides: Partial<RuntimeHostDetails>): RuntimeHostDetails {
  return {
    status: 'ready',
    runtimeStatus: null,
    compatibility: null,
    error: null,
    ...overrides
  }
}

describe('RuntimeEnvironmentsPane host details', () => {
  it('summarizes loading, error, compatible, and blocked hosts', () => {
    expect(getHostDetailsSummary(undefined)).toBe('Checking…')
    expect(getHostDetailsSummary(details({ status: 'error', error: 'offline' }))).toBe(
      'Status unavailable'
    )
    expect(
      getHostDetailsSummary(
        details({
          compatibility: {
            kind: 'ok',
            clientProtocolVersion: RUNTIME_PROTOCOL_VERSION,
            serverProtocolVersion: RUNTIME_PROTOCOL_VERSION
          }
        })
      )
    ).toBe('Compatible')
    expect(
      getHostDetailsSummary(
        details({
          compatibility: {
            kind: 'blocked',
            reason: 'server-too-old',
            clientProtocolVersion: RUNTIME_PROTOCOL_VERSION,
            serverProtocolVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION - 1,
            requiredServerProtocolVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION
          }
        })
      )
    ).toBe('Update server')
    expect(
      getHostDetailsSummary(
        details({
          compatibility: {
            kind: 'blocked',
            reason: 'client-too-old',
            clientProtocolVersion: RUNTIME_PROTOCOL_VERSION,
            serverProtocolVersion: RUNTIME_PROTOCOL_VERSION,
            requiredClientProtocolVersion: RUNTIME_PROTOCOL_VERSION + 1
          }
        })
      )
    ).toBe('Update client')
  })

  it('evaluates runtime protocol compatibility from status aliases', () => {
    expect(
      evaluateHostDetails({
        runtimeId: 'runtime-old',
        rendererGraphEpoch: 1,
        graphStatus: 'ready',
        authoritativeWindowId: 1,
        liveTabCount: 0,
        liveLeafCount: 0,
        protocolVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION - 1,
        minCompatibleMobileVersion: 0
      })
    ).toMatchObject({ kind: 'blocked', reason: 'server-too-old' })
  })

  it('explains blocked runtime compatibility with required protocol versions', () => {
    expect(
      getHostDetailsDescription(
        details({
          compatibility: {
            kind: 'blocked',
            reason: 'server-too-old',
            clientProtocolVersion: RUNTIME_PROTOCOL_VERSION,
            serverProtocolVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION - 1,
            requiredServerProtocolVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION
          }
        })
      )
    ).toContain('client requires server protocol')
  })

  it('summarizes runtime capabilities by name with overflow count', () => {
    expect(
      getRuntimeCapabilitiesSummary({
        runtimeId: 'runtime',
        rendererGraphEpoch: 1,
        graphStatus: 'ready',
        authoritativeWindowId: 1,
        liveTabCount: 0,
        liveLeafCount: 0,
        capabilities: ['runtime.environments.v1', 'terminal.multiplex.v1']
      })
    ).toBe('runtime.environments.v1, terminal.multiplex.v1')

    expect(
      getRuntimeCapabilitiesSummary({
        runtimeId: 'runtime',
        rendererGraphEpoch: 1,
        graphStatus: 'ready',
        authoritativeWindowId: 1,
        liveTabCount: 0,
        liveLeafCount: 0,
        capabilities: [
          'runtime.environments.v1',
          'browser.screencast.v1',
          'terminal.multiplex.v1',
          'project-host-setup.v1'
        ]
      })
    ).toBe('runtime.environments.v1, browser.screencast.v1, terminal.multiplex.v1 +1')
  })
})
