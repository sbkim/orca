import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Columns2,
  PanelBottomClose,
  PanelRightClose
} from 'lucide-react'
import type { TabSplitDirection } from '../../store/slices/tabs'
import { translate } from '@/i18n/i18n'
import { canMoveTabToNewPaneColumn, moveTabToNewPaneColumn } from './tab-move-to-pane-column'
import { requestActiveTerminalPaneSplit } from './request-active-terminal-pane-split'

const PANE_COLUMN_DIRECTIONS: TabSplitDirection[] = ['right', 'left', 'down', 'up']

function moveTabDirectionIcon(direction: TabSplitDirection): React.JSX.Element {
  switch (direction) {
    case 'right':
      return <ArrowRight className="size-3.5 shrink-0" />
    case 'left':
      return <ArrowLeft className="size-3.5 shrink-0" />
    case 'down':
      return <ArrowDown className="size-3.5 shrink-0" />
    case 'up':
      return <ArrowUp className="size-3.5 shrink-0" />
  }
}

function moveTabDirectionLabel(direction: TabSplitDirection): string {
  switch (direction) {
    case 'right':
      return translate(
        'auto.components.tab.bar.TerminalTabSplitMenuSection.moveTabRight',
        'Move tab right'
      )
    case 'left':
      return translate(
        'auto.components.tab.bar.TerminalTabSplitMenuSection.moveTabLeft',
        'Move tab left'
      )
    case 'down':
      return translate(
        'auto.components.tab.bar.TerminalTabSplitMenuSection.moveTabDown',
        'Move tab down'
      )
    case 'up':
      return translate(
        'auto.components.tab.bar.TerminalTabSplitMenuSection.moveTabUp',
        'Move tab up'
      )
  }
}

export function TerminalTabSplitMenuSection({
  unifiedTabId,
  groupId,
  tabId,
  isActive,
  onActivate,
  splitRightShortcut,
  splitDownShortcut,
  trailingSeparator = false
}: {
  unifiedTabId: string
  groupId: string
  tabId: string
  isActive: boolean
  onActivate: (tabId: string) => void
  splitRightShortcut: string
  splitDownShortcut: string
  trailingSeparator?: boolean
}): React.JSX.Element {
  const canMoveTab = canMoveTabToNewPaneColumn(unifiedTabId, groupId)

  const splitActiveTerminalPane = (direction: 'vertical' | 'horizontal'): void => {
    if (!isActive) {
      onActivate(tabId)
    }
    requestActiveTerminalPaneSplit({ tabId, direction })
  }

  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="[&>svg:last-child]:size-3.5">
          <Columns2 className="size-3.5 shrink-0" />
          {translate('auto.components.tab.bar.TerminalTabSplitMenuSection.split', 'Split')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-[12rem]">
          {canMoveTab
            ? PANE_COLUMN_DIRECTIONS.map((direction) => (
                <DropdownMenuItem
                  key={direction}
                  onSelect={() => {
                    moveTabToNewPaneColumn({ unifiedTabId, groupId, direction })
                  }}
                >
                  {moveTabDirectionIcon(direction)}
                  {moveTabDirectionLabel(direction)}
                </DropdownMenuItem>
              ))
            : null}
          {canMoveTab ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onSelect={() => splitActiveTerminalPane('vertical')}>
            <PanelRightClose className="size-3.5 shrink-0" />
            {translate(
              'auto.components.tab.bar.SortableTabContextMenu.splitTerminalRight',
              'Split terminal right'
            )}
            <DropdownMenuShortcut>{splitRightShortcut}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => splitActiveTerminalPane('horizontal')}>
            <PanelBottomClose className="size-3.5 shrink-0" />
            {translate(
              'auto.components.tab.bar.SortableTabContextMenu.splitTerminalDown',
              'Split terminal down'
            )}
            <DropdownMenuShortcut>{splitDownShortcut}</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {trailingSeparator ? <DropdownMenuSeparator /> : null}
    </>
  )
}
