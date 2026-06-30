import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import { EphemeralVmsPane } from './EphemeralVmsPane'
import { getExperimentalSearchEntry } from './experimental-search'
import { SearchableSetting } from './SearchableSetting'

export function EphemeralVmsExperimentalSetting(): React.JSX.Element {
  const entry = getExperimentalSearchEntry().ephemeralVms

  return (
    <SearchableSetting
      title={entry.title}
      description={entry.description}
      keywords={entry.keywords}
      className="max-w-none space-y-4 py-2"
      id="ephemeral-vms"
    >
      <div className="space-y-1.5">
        <Label>
          {translate(
            'auto.components.settings.ephemeralVms.search.title',
            'Per-Workspace Environments'
          )}
        </Label>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.ephemeralVms.search.description',
            'Learn how repo-owned recipes give each workspace its own on-demand, disposable environment.'
          )}
        </p>
      </div>
      <EphemeralVmsPane />
    </SearchableSetting>
  )
}
