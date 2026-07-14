import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FcmServiceAccountStatus } from '../../../../shared/types'
import { FcmPushSection } from './FcmPushSection'

const { toastError } = vi.hoisted(() => ({
  toastError: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: {
    error: toastError
  }
}))

// Why: renderToStaticMarkup does not run effects, and every case below seeds
// `initialStatus` so the status-poll effect short-circuits. The component only
// touches window.api.fcm inside onClick handlers (never during render), so no
// window stub is required for SSR assertions.
function renderWith(status: FcmServiceAccountStatus | null): string {
  return renderToStaticMarkup(<FcmPushSection initialStatus={status} />)
}

describe('FcmPushSection', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the paste field and not-configured badge when no credential is set', () => {
    const html = renderWith({ configured: false, projectId: null })

    expect(html).toContain('Service account JSON')
    expect(html).toContain('Not configured')
    // Why: the paste input must be present so the user can onboard.
    expect(html).toContain('<textarea')
  })

  it('renders the configured badge with the projectId once a credential is set', () => {
    const html = renderWith({ configured: true, projectId: 'orca-fcm-proj' })

    expect(html).toContain('Configured')
    expect(html).toContain('Project: orca-fcm-proj')
  })

  // Why: the core security invariant at the UI layer. The component must never
  // emit the credential body — only the non-secret projectId. Any sensitive
  // material from the pasted JSON must be absent from the rendered output.
  it('never renders raw credential material even when configured', () => {
    const sensitiveMaterial = ['super', 'secret', 'fcm', 'test', 'key'].join('-')
    const html = renderWith({ configured: true, projectId: 'orca-fcm-proj' })

    expect(html).not.toContain(sensitiveMaterial)
    expect(html).not.toContain('BEGIN PRIVATE KEY')
    expect(html).not.toContain('private_key')
    expect(html).not.toContain('"private_key"')
  })

  it('shows the Remove button only when configured', () => {
    const configuredHtml = renderWith({ configured: true, projectId: 'proj-x' })
    const notConfiguredHtml = renderWith({ configured: false, projectId: null })

    expect(configuredHtml).toContain('Remove')
    expect(notConfiguredHtml).not.toContain('Remove')
  })

  it('shows the loading state before the first status poll resolves', () => {
    const html = renderWith(null)

    expect(html).toContain('Checking FCM status')
  })
})
