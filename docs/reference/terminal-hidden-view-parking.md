# Terminal Hidden View Parking

Status: Phase 1 of the terminal model/view architecture. See
[`terminal-model-view-contract.md`](./terminal-model-view-contract.md) for the
invariants this design extends.

## Problem

Hidden terminal panes keep a full renderer xterm instance alive (buffer,
scrollback, DOM, addons). At many-worktree scale this is the dominant renderer
memory cost, and it forces every hidden byte through renderer-side write/skip
decisions. The main-process model (daemon + runtime headless emulators) already
ingests every byte and can serve restorable snapshots, so the renderer view for
a long-hidden pane is redundant state.

A previous attempt shipped and was reverted the same day. The post-mortem
finding: parking unmounted the pane component, which also tore down the
renderer's PTY byte parsers — and those parsers are the only source of bell
notifications, title-transition agent-complete notifications, and tab titles.
A parked worktree whose agent finished would never notify. This design keeps
those side effects alive while parked.

## Design

### Park policy (renderer)

A pure policy module decides which hidden terminal tabs may park:

- Cold-park hysteresis: a tab must be hidden for 30s before parking.
- Hot-retain working set: recently visible worktrees/tabs are retained
  (5 minutes, bounded count) so quick tab switches never pay a re-hydrate.
- Eligibility excludes: visible panes, hidden-measuring startup probes,
  activity-portal panes, tabs with pending startup commands or pending
  activation spawns, floating-panel tabs, and any tab whose PTY is not
  snapshot-backed (remote-runtime `remote:` PTYs and SSH PTYs are excluded in
  this phase).
- Kill switch: `settings.terminalHiddenViewParking === false` disables parking
  entirely.

### Park mechanics

Parking a tab unmounts its `TerminalPane` React subtree (the overlay layer
renders null for parked tabs). This is the same teardown that tab-group moves
already exercise: transports detach but the PTY session, daemon model, and tab
state all survive. The xterm instance, its buffers, DOM, and WebGL/addon
resources are released.

### Parked byte watcher (the piece the reverted attempt lacked)

While a tab is parked, a pane-less watcher subscribes to its PTYs through the
dispatcher sidecar mechanism (the same mechanism background agent launches
use). The watcher runs the transport-level byte parsers with no xterm:

- OSC 0/1/2 titles → tab/pane title store updates (all-titles ordering, same
  normalization as the live transport path).
- Title-transition agent tracker → agent-became-idle completion notification
  and prompt-cache timer, agent-became-working cancellation.
- BEL detection (OSC-aware stateful detector) → worktree/tab unread plus the
  delayed terminal-bell OS notification.
- DECSET 2031 subscribe scan → out-of-band color-scheme reply via
  `transport.sendInput`, so TUIs that subscribe while parked still learn the
  theme.
- GitHub PR link scan → worktree linked-PR detection keeps working for agents
  that print PR URLs while parked.

Main's synthetic agent-title/permission frames ride the same `pty:data`
channel, so they flow through the watcher unchanged.

Out of scope while parked (documented behavior, unchanged from the hidden
skip-latch status quo): terminal query auto-replies other than mode 2031,
OSC 52 clipboard writes, Command Code output scraping.

### Reveal

Revealing a parked tab remounts the pane subtree and rides the existing
reattach path: fresh xterm via `openTerminal` (unicode provider activation
before any write), daemon model snapshot > relay replay > cold restore
precedence, replay-guarded so snapshot-embedded queries never answer, then
`POST_REPLAY_REATTACH_RESET` hygiene, fit, and PTY resize. The watcher is
disposed before the pane handlers re-register.

## Invariants

1. PTY reads never stop; parking only changes renderer-side view lifetime.
2. Bell, agent-completion, title, and PR-link side effects keep working while
   parked (watcher parity tests).
3. Reveal shows model-correct output (visual gates: hidden TUI restore, long
   table, rendering golden) and accepts input immediately.
4. Sleep/wake, pane close, and PTY restart while parked must not leak watchers
   or strand parked state.
5. Memory: parked tabs hold no xterm buffers; renderer memory scales with
   visible panes.

## Cut-offs

This phase is independently mergeable. Later phases (side-effect authority to
main, gating hidden delivery in main, model query authority) replace the
watcher's byte parsing for local/SSH PTYs and stop hidden delivery entirely;
the watcher remains the parser for remote-runtime PTYs, which never transit
local main.
