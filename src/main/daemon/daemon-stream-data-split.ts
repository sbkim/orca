/**
 * Surrogate-safe splitting for daemon stream data events: NDJSON line-size
 * chunking (the receiver's parser rejects oversized lines) and the safe-index
 * clamp shared by the batcher's bulk write slicing and keep-tail dropping.
 */
import { encodeNdjson } from './ndjson'

export function encodeStreamDataEvent(sessionId: string, data: string): string {
  return encodeNdjson({
    type: 'event',
    event: 'data',
    sessionId,
    payload: { data }
  })
}

function streamDataEventLineBytes(sessionId: string, data: string): number {
  return Buffer.byteLength(encodeStreamDataEvent(sessionId, data), 'utf8')
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff
}

function isLowSurrogate(value: number): boolean {
  return value >= 0xdc00 && value <= 0xdfff
}

export function clampToSafeSplitIndex(value: string, start: number, end: number): number {
  if (end <= start || end >= value.length) {
    return end
  }
  const prev = value.charCodeAt(end - 1)
  const next = value.charCodeAt(end)
  return isHighSurrogate(prev) && isLowSurrogate(next) ? end - 1 : end
}

function nextSafeSplitIndex(value: string, start: number): number {
  const next = Math.min(value.length, start + 1)
  if (
    next < value.length &&
    isHighSurrogate(value.charCodeAt(start)) &&
    isLowSurrogate(value.charCodeAt(next))
  ) {
    return next + 1
  }
  return next
}

export function splitStreamDataForNdjson(
  sessionId: string,
  data: string,
  maxLineBytes: number
): string[] {
  if (streamDataEventLineBytes(sessionId, data) <= maxLineBytes) {
    return [data]
  }

  const chunks: string[] = []
  let start = 0
  while (start < data.length) {
    let low = start + 1
    let high = data.length
    let best = start

    while (low <= high) {
      const rawMid = Math.floor((low + high) / 2)
      const mid = clampToSafeSplitIndex(data, start, rawMid)
      if (mid <= start) {
        low = rawMid + 1
        continue
      }

      if (streamDataEventLineBytes(sessionId, data.slice(start, mid)) <= maxLineBytes) {
        best = mid
        low = rawMid + 1
      } else {
        high = rawMid - 1
      }
    }

    const end = best > start ? best : nextSafeSplitIndex(data, start)
    chunks.push(data.slice(start, end))
    start = end
  }

  return chunks
}
