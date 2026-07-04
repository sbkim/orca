// Why this module exists: @xterm/addon-serialize restores the cursor with
// RELATIVE moves (CUD/CUB) computed from where it assumes replay leaves the
// cursor. When the final content row is filled exactly to the right margin,
// replay leaves the fresh terminal wrap-pending (internal x == cols), so the
// relative math lands one column short of the real cursor. Every Orca buffer
// snapshot that will be replayed into another terminal must therefore end
// with an absolute CUP derived from the SOURCE terminal's authoritative
// cursor position.

type SerializeCursorTerminal = {
  cols: number
  rows: number
  buffer: { active: { cursorX: number; cursorY: number } }
}

type BufferSerializer<TOpts> = {
  serialize: (opts?: TOpts) => string
}

export function serializeWithAbsoluteCursor<TOpts>(
  serializer: BufferSerializer<TOpts>,
  terminal: SerializeCursorTerminal,
  opts?: TOpts
): string {
  const serialized = serializer.serialize(opts)
  // Why skip empty snapshots: several callers treat '' as "nothing to
  // restore" (e.g. shutdown layout capture drops empty buffers); a bare CUP
  // would turn every idle pane into a persisted snapshot.
  if (serialized.length === 0) {
    return serialized
  }
  const { cursorX, cursorY } = terminal.buffer.active
  // Why skip wrap-pending sources (cursorX == cols): plain replay already
  // reproduces that state exactly, while CUP would clamp to the last column
  // and clear the pending-wrap flag, changing how the next byte renders.
  // The remaining bounds checks are defensive: never emit a clamping CUP.
  if (cursorX < 0 || cursorX >= terminal.cols || cursorY < 0 || cursorY >= terminal.rows) {
    return serialized
  }
  // cursorY is viewport-relative (0 at the buffer's base row), which is the
  // same coordinate space CUP addresses after replay; scrollback length
  // differences between source and destination do not shift it.
  return `${serialized}\x1b[${cursorY + 1};${cursorX + 1}H`
}
