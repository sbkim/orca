import { LoaderCircle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

type HostedReviewDeleteWorkspaceButtonProps = {
  deleting: boolean
  onDelete: () => void
}

export function HostedReviewDeleteWorkspaceButton({
  deleting,
  onDelete
}: HostedReviewDeleteWorkspaceButtonProps): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="secondary"
      size="xs"
      className="w-full cursor-pointer text-[11px] hover:cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      onClick={onDelete}
      disabled={deleting}
    >
      {deleting ? (
        <LoaderCircle className="size-3.5 animate-spin" />
      ) : (
        <Trash2 className="size-3.5" />
      )}
      {deleting
        ? translate('auto.components.right.sidebar.HostedReviewActions.eefd50457e', 'Deleting...')
        : translate(
            'auto.components.right.sidebar.HostedReviewActions.e4aca40024',
            'Delete Workspace'
          )}
    </Button>
  )
}
