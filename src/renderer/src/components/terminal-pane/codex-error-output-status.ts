type CodexErrorOutputStatusDetector = {
  observe: (data: string) => boolean
}

const ESC = String.fromCharCode(0x1b)
const BEL = String.fromCharCode(0x07)
const ANSI_ESCAPE_RE = new RegExp(
  `${ESC}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}]*(?:${BEL}|${ESC}\\\\))`,
  'g'
)
const INCOMPLETE_ANSI_ESCAPE_RE = new RegExp(
  `${ESC}(?:\\[[0-?]*[ -/]*|\\][^${BEL}${ESC}]*|\\S?)?$`,
  'g'
)
const RECENT_RAW_TEXT_LIMIT = 300
const STATUS_SCAN_TEXT_LIMIT = 4096
const CODEX_STREAM_DISCONNECTED_MARKER = 'stream disconnected before completion:'
const CODEX_STREAM_DISCONNECTED_RE = /\bstream disconnected before completion:[^\r\n]*/

function terminalControlMayAffectText(data: string): boolean {
  for (let index = 0; index < data.length; index += 1) {
    const code = data.charCodeAt(index)
    if (
      code === 0x0d ||
      code === 0x1b ||
      (code <= 0x1f && code !== 0x0a) ||
      (code >= 0x7f && code <= 0x9f)
    ) {
      return true
    }
  }
  return false
}

function stripTerminalControl(data: string): string {
  if (!terminalControlMayAffectText(data)) {
    return data
  }
  const withoutAnsi = data.replace(ANSI_ESCAPE_RE, '').replace(INCOMPLETE_ANSI_ESCAPE_RE, '')
  let output = ''
  for (let index = 0; index < withoutAnsi.length; index += 1) {
    const code = withoutAnsi.charCodeAt(index)
    if ((code <= 0x1f && code !== 0x0a && code !== 0x0d) || (code >= 0x7f && code <= 0x9f)) {
      continue
    }
    output += withoutAnsi[index]
  }
  return output
}

function appendRecentRawText(previousRawText: string, data: string): string {
  if (data.length >= RECENT_RAW_TEXT_LIMIT) {
    return data.slice(-RECENT_RAW_TEXT_LIMIT)
  }
  return (previousRawText + data).slice(-RECENT_RAW_TEXT_LIMIT)
}

function buildStatusScanRawText(prefix: string, data: string): string {
  const boundedPrefix =
    prefix.length > RECENT_RAW_TEXT_LIMIT + 1 ? prefix.slice(-(RECENT_RAW_TEXT_LIMIT + 1)) : prefix
  const dataBudget = STATUS_SCAN_TEXT_LIMIT - boundedPrefix.length

  if (dataBudget <= 0) {
    return boundedPrefix.slice(-STATUS_SCAN_TEXT_LIMIT)
  }
  if (data.length <= dataBudget) {
    return boundedPrefix + data
  }

  const headBudget = Math.max(0, Math.floor((dataBudget - 1) / 2))
  const tailBudget = Math.max(0, dataBudget - headBudget - 1)
  const head = headBudget > 0 ? data.slice(0, headBudget) : ''
  const tail = tailBudget > 0 ? data.slice(-tailBudget) : ''
  // Why: PTY chunks can be large pastes or hidden-output restores; stream-error
  // detection only needs chunk-boundary context plus the current edge windows.
  return `${boundedPrefix}${head}\n${tail}`
}

function rawTextMayContainCodexStreamError(rawText: string): boolean {
  // Why: Codex emits this error in lowercase; avoid allocating a lowercased
  // copy for every ordinary PTY chunk on the no-match hot path.
  return rawText.includes(CODEX_STREAM_DISCONNECTED_MARKER)
}

function findOverlappingCodexStreamError(
  scanText: string,
  previousTextLength: number
): RegExpMatchArray | null {
  const re = new RegExp(CODEX_STREAM_DISCONNECTED_RE.source, 'g')
  for (const match of scanText.matchAll(re)) {
    const start = match.index ?? 0
    if (start + match[0].length > previousTextLength) {
      return match
    }
  }
  return null
}

function extractCodexStreamErrorMessage(scanText: string, match: RegExpMatchArray): string {
  const start = match.index ?? 0
  const lineEndCandidates = [scanText.indexOf('\r', start), scanText.indexOf('\n', start)].filter(
    (index) => index >= 0
  )
  const lineEnd = lineEndCandidates.length > 0 ? Math.min(...lineEndCandidates) : scanText.length
  return scanText.slice(start, lineEnd).replace(/\s+/g, ' ').trim()
}

export function createCodexErrorOutputStatusDetector(args: {
  onStreamError: (message: string) => void
}): CodexErrorOutputStatusDetector {
  let recentRawText = ''

  return {
    observe(data: string): boolean {
      const previousRawText = recentRawText
      recentRawText = appendRecentRawText(previousRawText, data)
      const scanRawText = buildStatusScanRawText(previousRawText, data)

      if (!rawTextMayContainCodexStreamError(scanRawText)) {
        return false
      }

      const scanText = stripTerminalControl(scanRawText)
      const previousTextLength = previousRawText ? stripTerminalControl(previousRawText).length : 0
      const match = findOverlappingCodexStreamError(scanText, previousTextLength)
      if (!match) {
        return false
      }

      const message = extractCodexStreamErrorMessage(scanText, match)
      if (!message) {
        return false
      }
      args.onStreamError(message)
      return true
    }
  }
}
