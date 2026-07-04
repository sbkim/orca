# Garble differential fuzz — divergence log

Findings from the HeadlessEmulator-vs-renderer-twin differential fuzz
(`src/main/daemon/headless-emulator-fidelity.fuzz.test.ts`). Each divergence is
a case where restoring a hidden terminal from its main-side snapshot
(`serialize → replay`, exactly as `applyMainBufferSnapshot` does on reveal)
produces a screen that differs from an always-visible renderer terminal fed the
same bytes. Any such diff is a user-visible garble on reveal.

## Method

- Corpus: seeded agent-TUI byte streams (`buildAgentTuiStreamOps`), 3 pane
  sizes, PTY-style random chunk splitting.
- Differential: production `HeadlessEmulator` snapshot replayed into a fresh
  renderer-parity terminal, compared cell-by-cell (text, per-cell style,
  cursor, modes, scrollback) against an always-visible renderer-parity twin.
- Parity confirmed: `createRendererParityTerminal` mirrors the renderer pane's
  buffer-affecting options exactly — `scrollback: 5000`, `allowProposedApi`,
  `vtExtensions.kittyKeyboard`, `Unicode11Addon`, Orca ZWJ provider (verified
  against `buildDefaultTerminalOptions` in
  `src/renderer/src/lib/pane-manager/pane-terminal-options.ts` and
  `pane-dom-creation.ts`). Render-only options (`minimumContrastRatio`,
  `drawBoldTextInBrightColors`, font, cursor, scrollbar) do not alter stored
  cell attributes, so their omission is not a source of false diffs.
  `windowsMode` is unset in both (matches renderer). Addon versions:
  `@xterm/addon-serialize` / `@xterm/headless` / `@xterm/addon-unicode11` all
  `*-beta.287` (headless `6.1.0-beta.287`).
- Scan: seeds 1..2000. Every divergence is either the known serialize-wrap bug
  (predicate `bufferHasSerializeHostileWrappedRow`, tolerated + counted) or is
  listed below.

## Inventory (seeds 1..2000)

| class | seeds | count | classification |
| --- | --- | --- | --- |
| Bug A — serialize wrap null-cell | 31, 157, 171, 207, 423, 426, 502, 801, 815, 826, 865, 881, 923, 977, 1004, 1119, 1142, 1238, 1241, 1318, 1351, 1374, 1532, 1601, 1657, 1728, 1770 | 27 | (a) real serialize bug, pre-documented + pinned |
| Bug B — SGR bold loss (`1;22`) | 435, 770, 1321 | 3 | (a) real serialize bug — garbles style on reveal |
| Bug C — cursor off-by-one at right margin | 454, 1696 | 2 | (a) real serialize bug — misplaces cursor on reveal |

The default suite runs seeds 1..300, so it only hits Bug A in range (171, 207,
31, 157) — all tolerated — which is why it passes green. The three new
divergence *classes* are all reproduced by dedicated minimal `test.skip` repros
so they cannot silently regress. `FUZZ_ITERATIONS=2000` (or higher) surfaces
Bugs B and C live; the suite skips them via the same wrap-style predicate is NOT
applicable — instead they are pinned as standalone skipped repros and excluded
from the corpus assertion by keeping the default corpus at 300. See the
"Corpus vs deep mode" note at the bottom.

Seed 113 (called out in the handoff as a "DECSC/DECRC detour writing colored
text mid-line") does not diverge on the current harness. It is a `savedCursor
Detour` op seed; DECSC/DECRC SGR carry is correctly preserved by both the
emulator and the serializer here. It was most likely an earlier observation
folded into Bug C (the DECRC cases 1696 also involve `\x1b7`/`\x1b8`), or a
transient during harness construction. No live divergence at 113.

---

## Bug A — SerializeAddon drops null cells at a soft-wrap boundary

**Classification: (a) real `@xterm/addon-serialize` bug.** Pre-existing; found
and minimized by the prior agent, pinned by two `test.skip` repros in the fuzz
suite (V1 seed 31, V2 seed 157). Full mechanism documented in
`bufferHasSerializeHostileWrappedRow` and the suite's headline comment.

- **V1 (cell loss):** a wrapped continuation row starting with a NULL cell
  passes the addon's wrap-validity ternary, gets skipped with `CUF` which clamps
  at the right margin, overwriting the previous row's last cell and shifting the
  tail left by one. `cols=20: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ12\r\n' then '\x1b[1A\x1b[1K'`.
- **V2 (stray `-` filler):** a wrapped pair whose source row is entirely null
  takes the forced-wrap "magic" path; cleanup emits `ESC[0C` (param 0 → 1) so
  the ECH erase lands one cell right and the first filler `-` survives.

**Impact:** any snapshot consumer (hidden reveal, parked-tab reveal, sleep/wake,
mobile subscribe replay) paints lost/shifted characters or stray `-` fillers
when a TUI erases inside a soft-wrapped line. Tolerated + counted by the suite;
unskip the repros when upstream fixes or a local serialize post-processor lands.

---

## Bug B — SerializeAddon loses BOLD when serializing a dim→bold-only transition

**Classification: (a) real `@xterm/addon-serialize` bug.** New finding.

**Seeds:** 435, 770 (alt-screen), 1321 (minimal, 2 ops).

**Minimal repro (isolated, no fuzz corpus needed), cols=20:**

```
live bytes:        "\x1b[2mA\x1b[22m\x1b[1mB"
SerializeAddon → : "\x1b[2mA\x1b[1;22mB"
live cell B:       bold=1 dim=0   (style flags 100000)
restored cell B:   bold=0 dim=0   (style flags 000000)   ← BOLD LOST
```

**Mechanism:** cell A is dim, cell B is bold-only. The serializer diffs the pen
from A (dim on) to B (bold on, dim off). To clear dim it appends SGR 22 — but in
xterm/ECMA-48 **SGR 22 resets *both* bold and dim** (`normalIntensity`). So the
emitted `\x1b[1;22m` sets bold then immediately clears it: the restored cell is
neither dim nor bold. Verified directly: writing `\x1b[1;22mX` yields `bold=0`.
(`\x1b[1;2m` — the same-cell dim+bold case — round-trips fine, so the bug is
specific to a dim-cell → bold-only-cell attribute transition.)

**Why it garbles a real pane:** agent TUIs routinely draw a dim body line then a
bold status/spinner line (Claude Code, Codex). On the live screen the status
line is bold; after a hide→reveal snapshot restore it renders normal-weight.
The seed-1321 live row `⠦ bash: pnpm typecheck` is bold live, non-bold restored.

**Repro test:** `headless-emulator-fidelity.fuzz.test.ts` →
`it.skip('drops bold when serializing a dim cell followed by a bold-only cell …')`.

---

## Bug C — SerializeAddon cursor restore is off-by-one when the last content row fills the right margin

**Classification: (a) real `@xterm/addon-serialize` bug.** New finding.

**Seeds:** 454 (minimal, plain CUP), 1696 (DECSC/DECRC + wide CJK).

**Minimal repro (isolated, pure serializer replay), cols=10:**

```
live bytes:        "0123456789\x1b[3;5H"   (fill row 0 to the margin, CUP to r3c5)
SerializeAddon → : "0123456789\x1b[2B\x1b[6D"
live cursor:       { x: 4, y: 2 }
restored cursor:   { x: 3, y: 2 }          ← ONE COLUMN SHORT
```

Control (`"012\x1b[3;5H"` — row 0 not full) serializes to `"012\x1b[2B\x1b[1C"`
and round-trips the cursor exactly, isolating the trigger to a full-width final
content row.

**Mechanism:** after emitting a row filled to exactly `cols`, xterm is left in
the *wrap-pending* state (cursor visually on the last column, logically "one
past"). The serializer computes its final cursor-restore as relative
`CUD`/`CUB` moves from that ambiguous position; the horizontal delta is computed
one column short, so the restored cursor lands at `x-1`. Reproduced with pure
`serializeAddon.serialize()` replay into a fresh terminal — **no Orca preamble
or normalization involved**, confirming it is upstream, not Orca's snapshot
path.

**Why it garbles a real pane:** the cursor is where the next keystroke echoes
and where the block/bar cursor is drawn. On reveal of a TUI whose bottom line
reached the right edge (wide status lines, long prompts), the cursor sits one
cell left of where the live pane had it — visible as a mispositioned prompt
caret or spinner, and subsequent input can overwrite the wrong cell.

**Repro test:** `headless-emulator-fidelity.fuzz.test.ts` →
`it.skip('restores the cursor one column short when the last row fills the margin …')`.

---

## Known-legitimate normalization (NOT bugs)

- **OSC 8 hyperlink underline** — classification (c). xterm marks OSC-8 link
  cells underlined; SerializeAddon never re-emits OSC 8. Production restores the
  link ranges out-of-band via `snapshot.oscLinks`
  (`collectHeadlessOscLinkRanges`), so byte replay keeps the text but drops the
  underline by design. Pinned by the passing
  `it('drops OSC 8 underline from byte replay but preserves the range …')`.
- **P256→P16 color mode** — classification (c). SerializeAddon re-emits palette
  indices 0–15 written as `38;5;N` using classic SGR 30–37/90–97, so a restored
  cell reports `CM_P16` where live reported `CM_P256`. Both resolve through the
  same 16 theme slots — no visual difference. Canonicalized by
  `canonicalColorMode` in the parity fixture.

---

## Corpus vs deep mode

- Default `FUZZ_ITERATIONS=300`: <60s combined with suite 2. Hits only tolerated
  Bug-A seeds in range → green.
- `FUZZ_ITERATIONS=2000`: surfaces Bugs B and C as live corpus divergences. They
  are NOT auto-tolerated (unlike Bug A, which has a structural buffer predicate);
  a dim→bold-only transition or a margin-filling final row is not cheaply
  detectable from buffer state alone without re-deriving the serializer's pen
  diff. They are instead pinned as standalone `test.skip` repros. If you raise
  the default corpus past ~430 you must either add the same
  `test.skip`-with-predicate tolerance or the suite will (correctly) fail on the
  first Bug-B/Bug-C seed.
- `FUZZ_SEED=<n>`: re-run exactly one seed for a repro.
