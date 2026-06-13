# Automations Host Model Audit

## Summary

Automations are still mostly repo/worktree anchored. The UI labels the target as "Project", but the persisted and dispatching model treats `automation.projectId` as a repo id, derives the run host from that repo, and creates/reuses worktrees through repo-scoped APIs. This is the main mismatch with the desired project-first model: an automation cannot explicitly say "logical Project X, run on ProjectHostSetup Y / host Z", nor can a run record snapshot enough host/provider context to remain correct after project setup migration, SSH reconnection state changes, or remote runtime capability changes.

## Findings

1. Must fix: `Automation.projectId` is used as a repo id, not a durable logical Project id.
   - Shared type only stores `projectId`, `executionTargetType`, `executionTargetId`, `workspaceMode`, `workspaceId`, and `baseBranch`; it has no `hostId`, `projectHostSetupId`, or provider/source context fields. See `src/shared/automations-types.ts:77-101` and create/update inputs at `src/shared/automations-types.ts:126-160`.
   - Store creation resolves `input.projectId` against `state.repos`, then persists it unchanged. See `src/main/persistence.ts:3630-3643`.
   - Store update repeats the same repo lookup using `repoId = updates.projectId ?? current.projectId`. See `src/main/persistence.ts:3664-3688`.
   - Renderer dispatch finds `state.repos.find((entry) => entry.id === automation.projectId)`. See `src/renderer/src/hooks/useAutomationDispatchEvents.ts:60-81`.

2. Must fix: run host selection is implicit and stale-prone.
   - `executionTargetType`, `executionTargetId`, and `schedulerOwner` are derived once from the repo'\''s `connectionId` at create/update time. See `src/main/persistence.ts:3631-3643` and `src/main/persistence.ts:3670-3688`.
   - Dispatch ignores these persisted execution fields for SSH setup and instead re-derives from the current repo record. See `src/renderer/src/hooks/useAutomationDispatchEvents.ts:60-118`.
   - This means if a logical project later has multiple host setups, or a repo-backed compatibility record changes, the automation has no explicit run host contract to preserve intent.

3. Must fix: `workspaceMode` remains repo/workspace anchored.
   - The only modes are `existing` and `new_per_run`. See `src/shared/automations-types.ts:3`.
   - Existing mode stores only `workspaceId`; new-per-run stores only `baseBranch`. See `src/shared/automations-types.ts:87-90`.
   - New-per-run dispatch calls `createWorktree(automation.projectId, ...)`, so it creates from a repo id rather than a `ProjectHostSetup` or host-scoped project setup. See `src/renderer/src/hooks/useAutomationDispatchEvents.ts:152-171`.
   - Precheck cwd uses existing `workspaceId` or `store.getRepo(automation.projectId)?.path`, again binding new-per-run prechecks to the repo compatibility path. See `src/main/automations/service.ts:233-241`.

4. Must fix: provider/source context is absent for task/provider-driven automations.
   - Automation types carry `agentId` but no source provider identity, task provider, issue source preference, GitHub/GitLab project reference, owner/repo snapshot, remote name, or provider source context. See `src/shared/automations-types.ts:77-101`.
   - The logical `Project` type has `providerIdentity`, but currently only supports GitHub and is not referenced by automations. See `src/shared/types.ts:91-107`.
   - CLI/API fields are still named `repo` and `workspace`, not project/setup/host. See `src/main/runtime/rpc/methods/automations.ts:54-69`, `src/main/runtime/rpc/methods/automations.ts:71-87`, and `src/cli/specs/automations.ts:4-12`.

5. Must fix: run records do not snapshot host/setup/source identity.
   - `AutomationRun` stores `automationId`, `workspaceId`, display name, terminal session id, output, precheck, usage, and timestamps, but no `projectId`, `hostId`, `projectHostSetupId`, execution target, provider source, runtime id, or capability/version snapshot. See `src/shared/automations-types.ts:103-124`.
   - Runs are created with `workspaceId: automation.workspaceId` and no host metadata. See `src/main/persistence.ts:3726-3760`.
   - Dispatch result can update only workspace/session/output/precheck/usage/error, not host/setup/source fields. See `src/shared/automations-types.ts:168-178` and `src/main/persistence.ts:3769-3808`.

6. Must fix: disconnected/auth-needed SSH is handled only as a repo.connectionId dispatch concern.
   - Dispatch checks passphrase and connection state using `repo.connectionId`. See `src/renderer/src/hooks/useAutomationDispatchEvents.ts:83-118`.
   - Detail copy warns about SSH skip behavior, but it is keyed only from `automation.executionTargetType === '\''ssh'\''`. See `src/renderer/src/components/automations/AutomationDetail.tsx:178-185`.
   - Precheck SSH execution requires an already connected SSH manager connection and reports "SSH target is not connected." See `src/main/automations/precheck-runner.ts:238-247`.
   - There is no stored distinction between "host setup exists but disconnected", "interactive auth required", "remote runtime too old", or "host setup unsupported"; statuses are coarse `skipped_unavailable` / `skipped_needs_interactive_auth`. See statuses at `src/shared/automations-types.ts:7-17`.

7. Should fix: runtime version/capability gating is missing from automations.
   - Project host setup flows already have runtime capability checks and user-facing unsupported-server copy elsewhere, but automation create/update/run paths do not reference these capabilities. Evidence of capability handling exists in repo slice search results around `src/renderer/src/store/slices/repos.ts:239-268`.
   - Automation RPC schemas expose `repo`, `workspace`, and `workspaceMode` only. See `src/main/runtime/rpc/methods/automations.ts:54-87`.
   - Session reuse can subscribe to remote runtime terminals, but it chooses runtime target from the PTY environment or active settings, not from an automation run host field. See `src/renderer/src/lib/automation-session-observer.ts:32-57`.

8. Should fix: session reuse is tied to workspace id and terminal tab id, not host/setup/session identity.
   - Reuse candidates require same `automationId`, same `workspaceId`, completed status, and a live terminal tab id. See `src/renderer/src/lib/automation-session-reuse.ts:13-57`.
   - It does not verify host id, project host setup id, execution target, runtime environment, or provider conversation/session identity. See `src/renderer/src/lib/automation-session-reuse.ts:29-55`.

9. Should fix: CLI automations are still repo-first and cannot target a host setup.
   - CLI accepts `--repo`, `--workspace`, `--workspace-mode`, and `--base-branch`. See `src/cli/specs/automations.ts:4-12` and usage at `src/cli/specs/automations.ts:32-57`.
   - Handler default target resolution falls back to current worktree and omits a target for remote clients; there is no `--project`, `--host`, or `--project-host-setup`. See `src/cli/handlers/automations.ts:292-313`.
   - Runtime target resolver returns only `projectId`, `workspaceMode`, and `workspaceId`, with error messages referring to repo. See `src/main/runtime/orca-runtime.ts:1941-1990`.

10. Migration gap: old automations have no explicit compatibility projection to the project-first model.
   - Existing normalization only normalizes precheck and session reuse; it does not backfill host/setup fields. See `src/main/persistence.ts:607-612`.
   - Existing persisted automations are listed directly after this normalization. See `src/main/persistence.ts:3614-3618`.
   - ProjectHostSetup compatibility records exist for repos, but automations are not currently projected through them during load/list/create/update based on inspected code.

## Concrete Recommendations

1. Change the automation target model to store durable logical target plus run host:
   - `projectId`: logical Project id.
   - `projectHostSetupId`: selected setup for execution.
   - `hostId`: denormalized host id snapshot for filtering/display/recovery.
   - Keep a migration-only `legacyRepoId` or compatibility resolver rather than overloading `projectId`.

2. Replace `workspaceMode` semantics with explicit host-scoped run target data:
   - Existing workspace: `{ mode: '\''existing_workspace'\'', workspaceId, projectHostSetupId, hostId }`.
   - Fresh run: `{ mode: '\''new_workspace_per_run'\'', projectHostSetupId, hostId, baseRef }`.
   - Validate that `workspaceId` belongs to the same `projectId/projectHostSetupId/hostId` before save and before dispatch.

3. Snapshot run context when creating an `AutomationRun`:
   - `projectId`, `projectHostSetupId`, `hostId`, `executionTargetType`, `executionTargetId`, `runtimeId/version/capabilities` where relevant, `sourceProviderContext`, and `baseRef`.
   - This makes run history intelligible after workspace deletion, project setup migration, or provider-source changes.

4. Add a provider/source context object for task/provider-driven automations:
   - Include task provider, hosted review provider, issue source preference/effective source, provider project/repo identity, and provider-specific source selector.
   - Keep GitHub/GitLab-specific details behind provider discriminants.

5. Move dispatch/precheck off `repo.connectionId` and `store.getRepo(projectId)`.
   - Resolve `projectHostSetupId` to a run host and path.
   - Use setup state to classify skipped runs as disconnected, auth-needed, unsupported runtime, missing setup, or unavailable host.

6. Add capability/version checks before saving and before running.
   - For remote/runtime-backed setups, require the automation target schema, project host setup APIs, terminal launch, precheck, and session reuse capabilities to be present.
   - Persist a clear `skipped_unsupported_runtime` or equivalent status when a scheduled run cannot execute due to old host/runtime code.

7. Update CLI/RPC surface to be project-first while preserving compatibility.
   - Add `--project`, `--host`, and/or `--project-host-setup`.
   - Keep `--repo` as a deprecated compatibility selector that resolves to a project host setup.
   - Rename runtime input fields away from `repo` in new methods, or add v2 methods to avoid breaking old CLIs.

8. Implement migration/backfill.
   - For each old automation where `projectId` is a repo id, use the repo-backed `ProjectHostSetup` compatibility projection to fill `projectId`, `projectHostSetupId`, `hostId`, execution target, and any available provider identity.
   - Leave old run history readable by adding best-effort host/setup snapshots on load or by preserving legacy fields.

## Unknowns

- I stopped before auditing all project-host setup helper APIs, so I did not verify the exact best resolver to map legacy repo ids to `ProjectHostSetup` records.
- I did not inspect the complete runtime capability graph or remote automation support, so the specific capability names/version gates are unknown.
- I did not audit external Hermes/OpenClaw automation creation deeply beyond the renderer save path; external automation host modeling may need a separate pass.
- I did not run tests or inspect persisted data migrations outside the lines cited above.

