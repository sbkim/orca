# SSH Repo Host Reconciliation Design

Date: 2026-07-10

## Problem

The proven flow is **Settings → SSH → remove host → re-add the same host**. Main matches the
removal tombstone and `Store.reassignSshTargetId` moves the persisted repo from the old target ID to
the new target ID without changing `Repo.id`. A renderer catalog merge can then retain the cached
old-target row alongside the fetched new-target row because repo rows are keyed by execution host
and repo ID.

PR #7997 made worktree deletion host-scoped and fail closed. This follow-up only
removes the superseded renderer row; it does not replace that safety boundary.

## Verified Gap

`pruneSupersededSshRepoRows` already removes an unknown direct-SSH row when another host has the
same repo ID, while preserving a lone ghost for the forget flow. `fetchRepos` invokes it after its
merge. These two ingress paths do not:

- `fetchRuntimeEnvironmentRepos`
- the per-catalog `applyCatalog` transaction in `fetchReposForAllHosts`

Both preserve rows owned by other execution hosts, so either can retain an old-target row already
present in renderer state. The all-host local catalog is the direct reproduction: it can fetch the
re-adopted new-target row while retaining the cached old-target row.

## Non-Goals

- Do not re-key repo or worktree UUIDs or introduce compound serialized IDs.
- Do not change main-process re-adoption, persistence, IPC/RPC schemas, or provider behavior.
- Do not add a new re-adoption event without a reproduced need.
- Do not remove PR #7997's host context from destructive operations.

## Edge Cases And Safety Constraints

Pruning must use positive, correctly scoped evidence:

- An absent local target ID is removal evidence only after `sshTargetsHydrated` is true. The flag
  exists specifically because paired clients and clients without the SSH RPC can have an empty,
  unhydrated `sshTargetLabels` map.
- Only a direct `ssh:<targetId>` execution row owned by this desktop may be classified from the
  local target map. A repo fetched from `runtime:<environmentId>` may retain an ordinary SSH
  `connectionId` owned by that remote Orca server; local labels say nothing about it.
- `runtime-ssh-*` targets remain excluded as today.
- Absence of a catalog response, an offline target, or an unreachable runtime is not removal
  evidence.
- A dead row is removed only when a different, non-dead row with the same `Repo.id` exists. A lone
  ghost remains visible and forgettable; two live hosts remain distinct.

The existing unconditional `fetchRepos` call must obey the same hydration and execution-owner
rules. Otherwise extending the call to more catalog paths would spread an unsafe classifier.

## Design

1. Harden the existing reconciliation boundary rather than adding an event or changing IDs.
   `pruneSupersededSshRepoRows` (or a narrowly named wrapper around it) must receive enough state to
   distinguish an authoritative local target list from an unhydrated one and must ignore
   runtime-environment-owned rows.
2. In `fetchRepos`, `fetchRuntimeEnvironmentRepos`, and each `fetchReposForAllHosts` catalog
   transaction, reconcile the merged rows against the transaction's current SSH metadata. Do not
   compute the final rows from `get()` before the updater; parallel all-host responses must each
   merge and reconcile against the latest state.
3. Use the finalized rows for `repos`, valid-repo-ID filtering, and the `repos` input to project
   compatibility merging. Keep unrelated all-host failure behavior, deferred UI validation,
   refreshed-host return behavior, and safe-auto fork scheduling unchanged.
4. Do not add a second stale-row algorithm, persisted migration, re-adoption event, UUID re-key, IPC
   change, or provider-specific behavior.

```text
main: remove target → tombstone
main: re-add matching identity → reassign old target ID to new target ID
renderer: fetch catalog → merge by (execution host, repo ID)
renderer transaction: if local SSH targets are authoritative,
  remove old direct-SSH row only when a non-dead same-ID sibling exists
renderer: derive catalog consumers from the finalized rows
```

## Test Plan

Test at the store transactions that omit reconciliation today, with the pure classifier suite
covering the ownership rule.

- In `repos-all-hosts.test.ts`, seed a cached `ssh:old` row, mark local SSH metadata hydrated with
  only `new`, return the same repo ID on `ssh:new` from local `repo.list`, and run
  `fetchReposForAllHosts({ remoteHosts: 'skip' })`. Assert only `ssh:new` remains. This isolates the
  all-host catalog applicator without unrelated runtime RPCs.
- In the existing repo runtime/store test seam, seed old and live same-ID rows, perform
  `fetchRuntimeEnvironmentRepos`, and assert the completed transaction does not retain the old row.
  Keep the assertion on store state; the method's return contains only the refreshed runtime host
  and does not expose the pruned desktop row.
- Add store coverage proving an unhydrated empty local target map preserves a dead/live duplicate,
  while an authoritative hydrated map prunes the dead row. A lone ghost must survive either state.
- Extend `superseded-ssh-repo-rows.test.ts` with a `runtime:<environmentId>`-owned repo carrying an
  ordinary, non-`runtime-ssh-*` connection ID. It must not be classified by local SSH labels.
- Retain the existing cases for a live SSH sibling, local sibling, lone ghost, and
  `runtime-ssh-*` target. Assert two live SSH hosts remain separate.

The regression tests should fail when the new ingress calls are removed, not reproduce main's
already-covered tombstone and persistence flow. Main coverage already exercises strict alias or
host/user/port matching and `reassignSshTargetId` carrier migration.

Run the focused classifier, all-host, and project-runtime/store suites, then typecheck, lint,
`pnpm check:max-lines-ratchet`, and the production build required by the repository.

## Electron Validation

Use an isolated profile and a throwaway Linux SSH target:

1. Add a repo through the throwaway SSH target and configure/select a runtime environment so local
   `repos:changed` handling takes the all-host refresh path.
2. Remove the SSH target and re-add the same target identity without restarting the renderer;
   confirm exactly one row remains and its worktree opens.
3. Repeat the remove/re-add cycle and confirm the stale row does not return and an adjacent local
   project is unchanged.

The targeted-runtime ingress is best validated by its deterministic store test; this SSH settings
flow does not naturally force a runtime-environment catalog refresh. Capture the three full-window
screenshots listed below and pair them with the store test results. There is no new UI or copy to
review.

Windows and POSIX paths do not participate in reconciliation, so no platform branch is required.
The paired-web risk is covered by the hydration and execution-owner tests: a client without an
authoritative local SSH target list must preserve rows rather than infer deletion. Git provider
identity is not used.

## Performance and Scope

The classifier remains linear in the number of merged repo rows and runs once per completed catalog
application. All-host loading therefore adds one bounded pass per host response, with no polling,
listener, persistence, subprocess, or IPC changes.

Land one renderer-only PR containing the focused tests and reconciliation calls. Do not include
event-protocol, UUID, persistence, or main-process re-adoption work.

## UI Quality Bar

No controls or copy change. Electron must show one stable re-adopted SSH project row, no dead-host
badge or reconnect error, no selection jump, and no regression to adjacent local projects. Existing
STYLEGUIDE.md layout, density, tokens, and interactions remain unchanged.

## Review Screenshots

1. Full app window after the first remove/re-add cycle, with one re-adopted SSH project row.
2. Full app window after the repeated cycle, with the row still stable.
3. Full app window containing the re-adopted SSH project and an unaffected adjacent local project.

Pair the screenshots with store assertions because the removed stale row is partly non-visual.

## Rollout

1. Add red tests for the all-host and targeted-runtime ingress gaps plus classifier safety gates.
2. Harden the classifier and wire it into all three catalog transactions.
3. Run focused tests, typecheck, lint, max-lines, and the production build.
4. Validate the warm remove/re-add flow in isolated Electron with a throwaway SSH target.
5. Open one renderer-only PR without merging it.

## Lightweight Eng Review

- Scope: two missing renderer ingress transactions plus safety hardening in the existing classifier.
- Architecture/data flow: classify only direct desktop SSH rows after authoritative SSH hydration,
  inside each state transaction before derived state.
- Failure modes covered: unhydrated labels, runtime-owned SSH, lone ghosts, two live hosts,
  parallel catalog responses, repeated refresh, and stale derived state.
- Test coverage required: red/green store tests at both ingress seams, pure classifier tests, and
  isolated Electron SSH remove/re-add validation.
- Performance/blast radius: one O(number of repos) pass per completed catalog merge; no new polling,
  listeners, persistence, subprocess, IPC, or RPC work.
- UI quality bar: no redesign; one stable row with no duplicate, dead-host state, or adjacent
  regression.
- Required review screenshots: first cycle, repeated cycle, and adjacent local/SSH rows.
- Residual risks: Windows/WSL may remain code-reviewed rather than live-tested; matching is
  path-independent.
