export function buildTerminalTitlePaneCandidateId({
  tabId,
  paneId
}: {
  tabId: string
  paneId: string | number
}): string {
  return `agent_needs_input:terminal_title:${tabId}:${paneId}`
}

export function buildTerminalTitleTabCandidateId({ tabId }: { tabId: string }): string {
  return `agent_needs_input:terminal_title:${tabId}:tab`
}
