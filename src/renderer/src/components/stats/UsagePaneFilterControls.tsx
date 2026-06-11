import { RefreshCw, SlidersHorizontal } from 'lucide-react'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'

type UsagePaneFilterControlsProps<Scope extends string, Range extends string> = {
  scope: Scope
  range: Range
  scopeOptions: { value: Scope; label: string }[]
  rangeOptions: Range[]
  rangeLabels: Record<Range, string>
  isScanning: boolean
  optionsLabel: string
  filtersLabel: string
  scopeLabel: string
  rangeLabel: string
  refreshLabel: string
  enableLabel: string
  onScopeChange: (value: Scope) => void
  onRangeChange: (value: Range) => void
  onRefresh: () => void
  onDisable: () => void
}

export function UsagePaneFilterControls<Scope extends string, Range extends string>({
  scope,
  range,
  scopeOptions,
  rangeOptions,
  rangeLabels,
  isScanning,
  optionsLabel,
  filtersLabel,
  scopeLabel,
  rangeLabel,
  refreshLabel,
  enableLabel,
  onScopeChange,
  onRangeChange,
  onRefresh,
  onDisable
}: UsagePaneFilterControlsProps<Scope, Range>): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-2 self-start">
      <DropdownMenu>
        <TooltipProvider delayDuration={250}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label={optionsLabel}>
                  <SlidersHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {filtersLabel}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>{scopeLabel}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={scope}
            onValueChange={(value) => onScopeChange(value as Scope)}
          >
            {scopeOptions.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{rangeLabel}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={range}
            onValueChange={(value) => onRangeChange(value as Range)}
          >
            {rangeOptions.map((option) => (
              <DropdownMenuRadioItem key={option} value={option}>
                {rangeLabels[option]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipProvider delayDuration={250}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onRefresh}
              disabled={isScanning}
              aria-label={refreshLabel}
            >
              <RefreshCw className={`size-3.5 ${isScanning ? 'animate-spin' : ''}`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {refreshLabel}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <button
        type="button"
        role="switch"
        aria-checked={true}
        aria-label={enableLabel}
        onClick={onDisable}
        className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-foreground transition-colors"
      >
        <span className="pointer-events-none block size-3.5 translate-x-4 rounded-full bg-background shadow-sm transition-transform" />
      </button>
    </div>
  )
}
