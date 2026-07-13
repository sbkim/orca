import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { FcmServiceAccountStatus } from '../../../../shared/types'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Check, CloudUpload, Loader2, Send, TriangleAlert } from 'lucide-react'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'

// Why: FCM onboarding (SPEC-FCM-001 §E #1). The renderer only ever holds the
// raw credential during the paste — after Save the IPC layer persists it
// (safeStorage-encrypted at rest via persistence.ts) and this component polls
// the status channel, which returns just { configured, projectId } and never
// the JSON. `initialStatus` lets tests drive the configured/not-configured
// branches deterministically under renderToStaticMarkup (effects do not run in
// SSR); production leaves it null so the effect polls the real status.
export function FcmPushSection({
  initialStatus = null
}: {
  initialStatus?: FcmServiceAccountStatus | null
}): React.JSX.Element {
  const mountedRef = useMountedRef()
  const [status, setStatus] = useState<FcmServiceAccountStatus | null>(initialStatus)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // Why: skip the poll when the parent seeded an initial status (tests), so
    // the SSR-asserted state is not immediately overwritten by an async fetch.
    if (initialStatus !== null) {
      return
    }
    let cancelled = false
    void window.api.fcm.getServiceAccountStatus().then((next) => {
      if (!cancelled && mountedRef.current) {
        setStatus(next)
      }
    })
    return () => {
      cancelled = true
    }
  }, [initialStatus, mountedRef])

  const handleSave = async (): Promise<void> => {
    const trimmed = draft.trim()
    if (trimmed.length === 0 || saving) {
      return
    }
    setSaving(true)
    try {
      const result = await window.api.fcm.setServiceAccount(trimmed)
      if (!mountedRef.current) {
        return
      }
      if (result.ok) {
        setStatus({ configured: true, projectId: result.projectId })
        setDraft('')
      } else {
        // Why: the IPC error is a fixed, generic validation reason that never
        // includes the credential body — safe to surface verbatim.
        toast.error(
          translate(
            'auto.components.settings.FcmPushSection.62c22c69db',
            'Failed to save the service account JSON.'
          )
        )
      }
    } finally {
      if (mountedRef.current) {
        setSaving(false)
      }
    }
  }

  const handleClear = async (): Promise<void> => {
    await window.api.fcm.clearServiceAccount()
    if (!mountedRef.current) {
      return
    }
    setStatus({ configured: false, projectId: null })
    setDraft('')
  }

  const configured = status?.configured === true
  const projectId = configured ? (status?.projectId ?? null) : null

  return (
    <div className="space-y-2 py-2">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <CloudUpload className="size-4" />
          <Label>
            {translate('auto.components.settings.FcmPushSection.e64e26b483', 'FCM Push (Mobile)')}
          </Label>
        </div>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.FcmPushSection.5f1c074e17',
            'Send push notifications to paired mobile devices over Firebase Cloud Messaging.'
          )}
        </p>
      </div>

      <FcmPushStatusBadge configured={configured} projectId={projectId} loading={status === null} />

      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">
          {translate('auto.components.settings.FcmPushSection.9022fd6485', 'Service account JSON')}
        </Label>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
          rows={6}
          aria-label={translate(
            'auto.components.settings.FcmPushSection.904130bfff',
            'Paste the Google service account JSON from your Firebase project.'
          )}
          placeholder={translate(
            'auto.components.settings.FcmPushSection.904130bfff',
            'Paste the Google service account JSON from your Firebase project.'
          )}
          className="w-full min-w-0 resize-y rounded-md border border-input bg-transparent px-3 py-1.5 font-mono text-xs shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          disabled={draft.trim().length === 0 || saving}
          onClick={() => void handleSave()}
          className="gap-2"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          {saving
            ? translate('auto.components.settings.FcmPushSection.4db57a2a1a', 'Saving…')
            : translate('auto.components.settings.FcmPushSection.1f227db331', 'Save')}
        </Button>
        {configured ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => void handleClear()}
            className="gap-2"
          >
            {translate('auto.components.settings.FcmPushSection.aba77142c0', 'Remove')}
          </Button>
        ) : null}
      </div>

      {configured ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={async () => {
              try {
                await window.api.fcm.testDispatch()
                toast.success('FCM test push dispatched')
              } catch {
                toast.error('FCM test push failed')
              }
            }}
          >
            <Send className="size-3.5" />
            {translate(
              'auto.components.settings.FcmPushSection.tmp-test-push',
              'Send test push (device E2E — TEMP)'
            )}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

// Why: the badge is the at-a-glance configured/not-configured indicator. It
// renders only the non-secret projectId, never the raw JSON or private key —
// the status channel contract guarantees neither is present in `status`.
function FcmPushStatusBadge({
  configured,
  projectId,
  loading
}: {
  configured: boolean
  projectId: string | null
  loading: boolean
}): React.JSX.Element {
  if (loading) {
    return (
      <p className="text-xs text-muted-foreground">
        {translate('auto.components.settings.FcmPushSection.14837831c9', 'Checking FCM status…')}
      </p>
    )
  }
  if (configured) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/[0.07] px-3 py-2 text-xs">
        <Check
          className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
          strokeWidth={3}
        />
        <span className="font-medium text-foreground">
          {translate('auto.components.settings.FcmPushSection.6865309d2a', 'Configured')}
        </span>
        {projectId ? (
          <span className="truncate font-mono text-muted-foreground">
            {translate(
              'auto.components.settings.FcmPushSection.58aae52577',
              'Project: {{projectId}}',
              {
                projectId
              }
            )}
          </span>
        ) : null}
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
      <TriangleAlert className="size-3.5 shrink-0" />
      <span className="font-medium">
        {translate('auto.components.settings.FcmPushSection.fe942f1afa', 'Not configured')}
      </span>
    </div>
  )
}
