// Why: Phase 3 slice 1 of terminal-side-effect-authority.md runs a per-PTY
// title tracker in main alongside the renderer transport's byte parser. Both
// must derive IDENTICAL ordered title/status facts from the same bytes, or
// main-side consumers (tui-idle waiters, worktree ps, mobile titles) drift
// from what the renderer shows. This harness feeds identical byte fixtures
// through the renderer `createPtyOutputProcessor` and through main's
// consumption shape (OSC 9999 strip → shared title tracker) and asserts the
// event sequences match.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentStatusOscProcessor } from '../../../../shared/agent-status-osc'
import { createTerminalTitleTracker } from '../../../../shared/terminal-output-side-effects'
import { createPtyOutputProcessor } from './pty-transport'

const ESC = '\x1b'
const BEL = '\x07'
const ST = `${ESC}\\`

type TitleFactEvent =
  | { kind: 'title'; normalized: string; raw: string }
  | { kind: 'became-working' }
  | { kind: 'became-idle'; title: string }
  | { kind: 'agent-exited' }

type TitleFactPath = {
  events: TitleFactEvent[]
  feed: (chunk: string) => void
}

function createRendererPath(): TitleFactPath {
  const events: TitleFactEvent[] = []
  const processor = createPtyOutputProcessor({
    onTitleChange: (normalized, raw) => events.push({ kind: 'title', normalized, raw }),
    onAgentBecameWorking: () => events.push({ kind: 'became-working' }),
    onAgentBecameIdle: (title) => events.push({ kind: 'became-idle', title }),
    onAgentExited: () => events.push({ kind: 'agent-exited' })
  })
  const callbacks = { onData: () => {} }
  return {
    events,
    feed(chunk: string): void {
      processor.processData(chunk, callbacks)
      // Why: the renderer defers side effects behind a setTimeout(0) drain to
      // protect xterm paint. Flush synchronously so both paths observe each
      // chunk at the same fake-timer instant.
      processor.flushPendingSideEffects()
    }
  }
}

function createMainPath(): TitleFactPath {
  const events: TitleFactEvent[] = []
  // Why: mirrors OrcaRuntimeService.onPtyData — the per-PTY OSC 9999
  // processor strips status payloads before the title tracker sees the chunk.
  const processAgentStatusChunk = createAgentStatusOscProcessor()
  const tracker = createTerminalTitleTracker({
    onTitle: (normalized, raw) => events.push({ kind: 'title', normalized, raw }),
    onAgentBecameWorking: () => events.push({ kind: 'became-working' }),
    onAgentBecameIdle: (title) => events.push({ kind: 'became-idle', title }),
    onAgentExited: () => events.push({ kind: 'agent-exited' })
  })
  return {
    events,
    feed(chunk: string): void {
      tracker.handleChunk(processAgentStatusChunk(chunk).cleanData)
    }
  }
}

function feedBoth(paths: { renderer: TitleFactPath; main: TitleFactPath }, chunk: string): void {
  paths.renderer.feed(chunk)
  paths.main.feed(chunk)
}

describe('main title tracker parity with the renderer transport processor', () => {
  let paths: { renderer: TitleFactPath; main: TitleFactPath }

  beforeEach(() => {
    vi.useFakeTimers()
    paths = { renderer: createRendererPath(), main: createMainPath() }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('derives identical facts from a coalesced spinner+idle chunk (issue #1083)', () => {
    // One realistic node-pty batch: Pi's 80ms spinner frames plus agent_end's
    // trailing idle title. A last-title reader sees only the idle title and
    // never observes the working state.
    const chunk =
      `${ESC}]0;⠋ π - cwd${BEL}response text\r\n` +
      `${ESC}]0;⠙ π - cwd${BEL}more text\r\n` +
      `${ESC}]0;π - cwd${BEL}`
    feedBoth(paths, chunk)

    expect(paths.main.events).toEqual(paths.renderer.events)
    const kinds = paths.main.events.map((event) => event.kind)
    expect(kinds).toContain('became-working')
    expect(kinds.indexOf('became-working')).toBeLessThan(kinds.indexOf('became-idle'))
  })

  it('derives identical facts from BEL- and ST-terminated titles', () => {
    feedBoth(paths, `${ESC}]2;Codex working${ST}body bytes`)
    feedBoth(paths, `${ESC}]0;Codex done${BEL}`)

    expect(paths.main.events).toEqual(paths.renderer.events)
    expect(paths.main.events).toContainEqual({ kind: 'became-idle', title: 'Codex done' })
  })

  it('drops the bare cursor-agent native title in both paths', () => {
    feedBoth(paths, `${ESC}]0;⠋ Cursor Agent${BEL}`)
    feedBoth(paths, `${ESC}]0;Cursor Agent${BEL}`)

    expect(paths.main.events).toEqual(paths.renderer.events)
    const titles = paths.main.events.filter((event) => event.kind === 'title')
    expect(titles).toEqual([{ kind: 'title', normalized: '⠋ Cursor Agent', raw: '⠋ Cursor Agent' }])
  })

  it('clears a stale working title after the 3s timeout in both paths', () => {
    feedBoth(paths, `${ESC}]0;. Claude working${BEL}`)
    feedBoth(paths, 'output with no title\r\n')

    vi.advanceTimersByTime(3_000)

    expect(paths.main.events).toEqual(paths.renderer.events)
    expect(paths.main.events.at(-1)).toEqual({ kind: 'became-idle', title: 'Claude' })
  })

  it('keeps the stale-title timer unperturbed by pure OSC 9999 status chunks', () => {
    feedBoth(paths, `${ESC}]0;Codex working${BEL}`)
    feedBoth(paths, 'plain output arms the timer\r\n')

    vi.advanceTimersByTime(2_000)
    // Why: a chunk that is ONLY an Orca status payload strips to empty
    // cleanData; neither path may restart (or newly arm) the stale probe.
    feedBoth(paths, `${ESC}]9999;{"state":"working","agentType":"codex"}${BEL}`)
    vi.advanceTimersByTime(1_000)

    expect(paths.main.events).toEqual(paths.renderer.events)
    expect(paths.main.events.at(-1)).toEqual({ kind: 'became-idle', title: 'Codex' })
  })

  it('ignores a title split across chunk boundaries in both paths', () => {
    feedBoth(paths, `${ESC}]0;split-ti`)
    feedBoth(paths, `tle${BEL}`)

    expect(paths.main.events).toEqual(paths.renderer.events)
    expect(paths.main.events).toEqual([])
  })
})
