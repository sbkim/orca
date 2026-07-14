import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { resolveFcmPushLogPath } from './fcm-push-logger'

describe('resolveFcmPushLogPath', () => {
  it('uses the active Orca userData path so dev and production logs stay isolated', () => {
    expect(
      resolveFcmPushLogPath({
        env: { ORCA_USER_DATA_PATH: '/tmp/orca-dev' },
        platform: 'darwin',
        homeDir: '/Users/test'
      })
    ).toBe(join('/tmp/orca-dev', 'logs', 'fcm-push.log'))
  })

  it('falls back to the platform app-data directory when no runtime path is seeded', () => {
    expect(resolveFcmPushLogPath({ env: {}, platform: 'linux', homeDir: '/home/test' })).toBe(
      join('/home/test', '.config', 'orca', 'logs', 'fcm-push.log')
    )
  })

  it('does not write synthetic test sends unless a test log path is explicit', () => {
    expect(resolveFcmPushLogPath({ env: { VITEST: 'true' } })).toBeNull()
    expect(
      resolveFcmPushLogPath({
        env: { VITEST: 'true', ORCA_FCM_PUSH_LOG_PATH: '/tmp/fcm-test.log' }
      })
    ).toBe('/tmp/fcm-test.log')
  })
})
