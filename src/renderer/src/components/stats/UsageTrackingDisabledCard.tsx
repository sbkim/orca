type UsageTrackingDisabledCardProps = {
  title: string
  description: string
  enableLabel: string
  onEnable: () => void
}

export function UsageTrackingDisabledCard({
  title,
  description,
  enableLabel,
  onEnable
}: UsageTrackingDisabledCardProps): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={false}
          aria-label={enableLabel}
          onClick={onEnable}
          className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-muted-foreground/30 transition-colors"
        >
          <span className="pointer-events-none block size-3.5 translate-x-0.5 rounded-full bg-background shadow-sm transition-transform" />
        </button>
      </div>
    </div>
  )
}
