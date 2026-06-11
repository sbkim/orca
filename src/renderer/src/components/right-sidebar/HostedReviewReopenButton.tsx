import { CircleDot, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

type HostedReviewReopenButtonProps = {
  label: string
  reopening: boolean
  disabled: boolean
  onReopen: () => void
}

export function HostedReviewReopenButton({
  label,
  reopening,
  disabled,
  onReopen
}: HostedReviewReopenButtonProps): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      className="w-full cursor-pointer text-[11px] hover:cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      onClick={onReopen}
      disabled={disabled}
    >
      {reopening ? (
        <LoaderCircle className="size-3.5 animate-spin" />
      ) : (
        <CircleDot className="size-3.5" />
      )}
      {reopening
        ? translate('auto.components.right.sidebar.HostedReviewActions.6645ac7dd1', 'Reopening...')
        : translate(
            'auto.components.right.sidebar.HostedReviewActions.3ce211ece6',
            'Reopen {{value0}}',
            { value0: label }
          )}
    </Button>
  )
}
