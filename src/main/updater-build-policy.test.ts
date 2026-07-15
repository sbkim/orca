import { afterEach, describe, expect, it } from 'vitest'
import { autoUpdatesDisabledForBuild } from './updater-build-policy'

const buildGlobals = globalThis as { ORCA_DISABLE_AUTO_UPDATE?: boolean }

describe('updater build policy', () => {
  afterEach(() => {
    delete buildGlobals.ORCA_DISABLE_AUTO_UPDATE
  })

  it('keeps updates enabled for ordinary contributor and official builds', () => {
    expect(autoUpdatesDisabledForBuild()).toBe(false)
  })

  it('disables updates when a fork dev package bakes in the flag', () => {
    buildGlobals.ORCA_DISABLE_AUTO_UPDATE = true

    expect(autoUpdatesDisabledForBuild()).toBe(true)
  })
})
