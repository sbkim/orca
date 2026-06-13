# Settings/cache/CLI host-scope audit

## Summary

The branch has several solid host-scope foundations already: execution hosts are explicit (\`local\`, \`ssh:*\`, \`runtime:*\`), workspace session state is partitioned by host, GitHub repo cache keys include host scope, and Source Control AI model choices have host-keyed selection/discovery maps. The remaining risk is concentrated in older provider/account surfaces that still use client-global settings or repo-path-only selectors, plus a few user-facing settings labels that do not yet communicate whether the value applies globally, to a host, to a project, or to a project-host setup.

Must-fix gaps below focus on places where user-visible behavior can mix accounts/hosts or where a setting’s ownership model is unclear.

## Findings

### 1. GitLab IPC selectors are repo-path-only, unlike GitHub's newer repo-id-aware guard

- \`src/main/ipc/gitlab.ts:56-63\` validates requests by resolving \`repoPath\` and finding the first registered repo with the same path.
- All preload GitLab calls use \`{ repoPath }\` selectors without \`repoId\` or \`executionHostId\`; examples:
  - \`src/preload/gitlab.ts:13-20\`
  - \`src/preload/gitlab.ts:25-37\`
  - \`src/preload/gitlab.ts:67-80\`
  - \`src/preload/gitlab.ts:101-144\`
- GitHub already accepts \`repoId\` on many IPC selectors and rejects mismatched path/id pairs:
  - \`src/main/ipc/github.ts:131-149\`
  - \`src/preload/api-types.ts:1240-1301\`

Impact: in a project-first model, a local setup, SSH setup, and runtime setup can legitimately share display name or path-like identity. GitLab operations can still be routed by path alone, which is weaker than project-host identity and can mix user intent if duplicate paths or migrated project-host setups exist. This is especially risky for mutating calls such as update/comment/merge/retry at \`src/main/ipc/gitlab.ts:193-217\`, \`src/main/ipc/gitlab.ts:274-312\`, and \`src/main/ipc/gitlab.ts:338-418\`.

### 2. GitHub/GitLab user-scoped account diagnostics and rate limits are still client-global or repo-ambient

- GitHub rate limit and auth diagnosis take no host or repo selector:
  - \`src/preload/index.ts:1182-1188\`
  - \`src/preload/api-types.ts:1317-1325\`
- GitLab has a host string for rate limit, but viewer/auth diagnosis remain global:
  - \`src/preload/gitlab.ts:8-11\`
  - \`src/main/ipc/gitlab.ts:70-79\`
- GitLab todos are explicitly user-scoped and use \`repoPath\` only as a registered-repo guard:
  - \`src/main/ipc/gitlab.ts:421-427\`
  - \`src/preload/api-types.ts:1426-1427\`

Impact: Settings/Integrations can show “connected”, “viewer”, “rate limit”, or “todos” for whichever client/global CLI account is visible from the Electron process, not necessarily the account on the selected Local/SSH/runtime host. That becomes misleading when the user’s local \`gh\`/\`glab\` auth differs from a remote host’s CLI auth.

### 3. Source Control AI has host-scoped model choices, but command/agent defaults remain client-global and are sent to remote/runtime generation

- Host-keyed model selection/discovery exists:
  - \`src/shared/source-control-ai-types.ts:11-15\`
  - \`src/shared/source-control-ai-types.ts:24-37\`
  - \`src/shared/source-control-ai.ts:749-786\`
  - \`src/shared/source-control-ai.ts:874-918\`
- Resolution defaults to local if no discovery host key is provided:
  - \`src/shared/source-control-ai.ts:1240-1249\`
- Runtime generation forwards global \`sourceControlAi\`, \`agentCmdOverrides\`, and discovery host key to runtime RPC:
  - \`src/renderer/src/runtime/runtime-git-client.ts:70-99\`
  - \`src/renderer/src/runtime/runtime-git-client.ts:523-534\`
  - \`src/renderer/src/runtime/runtime-git-client.ts:603-614\`
- Global agent command/default args/env are client-global settings:
  - \`src/shared/types.ts:2470-2475\`
- Resume also uses global launch overrides/default args/env:
  - \`src/renderer/src/lib/resume-sleeping-agent-session.ts:45-51\`

Impact: model choice is host-aware, but the command used to invoke the provider and extra launch args/env are not. A remote Linux host, runtime server, and local macOS client may need different binary names, paths, auth env, or wrapper commands. Today a client-global override can silently apply to the wrong host.

### 4. \`hostSettingOverrides\` is intentionally narrow, but adjacent host-varying settings are still global

- Current host overrides only cover \`displayLabel\` and \`defaultWorktreeLocation\`:
  - \`src/shared/types.ts:2190-2200\`
  - \`src/shared/types.ts:2202-2206\`
  - \`src/shared/host-setting-overrides.ts:17-34\`
- Many settings that can vary by host remain global, including workspace directory fallback and agent launch command/args/env:
  - \`src/shared/types.ts:2202-2208\`
  - \`src/shared/types.ts:2470-2475\`

Impact: the code documents the intended narrowness well, but the desired model says provider/account settings need explicit scope. There is no adjacent typed home yet for host-scoped agent launch configuration or host-scoped provider/account diagnostics, so Settings copy can imply a value is universal when it is actually host-sensitive.

### 5. Sleeping agent resume records do not persist full execution host identity

- Resume records store \`connectionId?: string | null\` but not \`executionHostId\` or runtime environment id:
  - \`src/shared/agent-session-resume.ts:24-37\`
- The record creator does not include \`connectionId\` despite the record type allowing it:
  - \`src/renderer/src/store/slices/agent-status.ts:186-217\`
- Resume launch platform infers remote only from the worktree’s current repo/path state:
  - \`src/renderer/src/lib/resume-sleeping-agent-session.ts:15-23\`

Impact: provider session IDs belong to the host where the CLI ran. If a worktree is moved, rehydrated under a project-host setup, or associated with a runtime host, resume can lack durable proof of which host owns the provider session. This is likely fine for current local/SSH happy paths, but it is fragile for runtime/remote server and future cloud VM hosts.

### 6. Some renderer caches are host-scoped, but not consistently across adjacent selectors

Good:
- GitHub PR/repo cache keys include runtime/SSH host scope:
  - \`src/renderer/src/store/slices/github-cache-key.ts:10-25\`
  - \`src/renderer/src/store/slices/github-cache-key.ts:28-43\`
- GitHub metadata hooks include runtime in cache key:
  - \`src/renderer/src/hooks/useIssueMetadata.ts:56-63\`
  - \`src/renderer/src/hooks/useIssueMetadata.ts:130-136\`

Risk:
- GitHub metadata options support runtime only, not SSH \`connectionId\`/\`executionHostId\`:
  - \`src/renderer/src/hooks/useIssueMetadata.ts:31-33\`
  - \`src/renderer/src/hooks/useIssueMetadata.ts:80-90\`
  - \`src/renderer/src/hooks/useIssueMetadata.ts:154-164\`
- Smart GitHub submit cache keys by \`repoId:repoPath\` and link/number, but not host id:
  - \`src/renderer/src/lib/smart-github-submit.ts:109-124\`
  - \`src/renderer/src/lib/smart-github-submit.ts:127-160\`

Impact: repo id often saves this, but the API shape still makes “host ownership” implicit. Any future project-host setup that shares repo id/path semantics or does URL lookup against a non-local host can reuse stale/wrong metadata unless host id is part of every cache/request selector.

### 7. Telemetry appears mostly low-risk, but host/project scope is not represented in relevant events

- Settings telemetry only emits whitelisted key names, no raw value:
  - \`src/main/ipc/settings.ts:125-150\`
- Agent resume launch telemetry records agent kind/source/request kind, not host kind:
  - \`src/renderer/src/lib/resume-sleeping-agent-session.ts:66-72\`

Impact: privacy posture is good, but diagnostics/product analysis will not be able to distinguish local vs SSH vs runtime behavior for settings-driven host features unless a bounded, non-identifying \`host_kind\`/\`execution_surface\` enum is added where needed. Do not add hostnames, paths, repo names, branch names, account names, or tokens.

## Concrete Recommendations

1. Add a common project-host selector type for provider IPC/preload calls: at minimum \`{ repoId, repoPath, executionHostId? }\`, with main-process validation mirroring GitHub’s path/id mismatch guard. Apply first to GitLab mutating and metadata calls.

2. Split provider/account Settings surfaces by scope in UI copy and data model:
   - client-global: telemetry consent, app appearance, local Electron proxy, local-only integrations
   - host-scoped: CLI auth diagnostics, provider viewer/rate limit, agent command overrides, discovered CLI models
   - project-scoped: repo/project review defaults and source-control prompts
   - project-host setup: checkout path, worktree root, hook settings, git username

3. Promote agent launch config from client-global-only to \`hostSettingOverrides\` or a dedicated host-scoped launch settings map. Keep client-global fallback, but make effective resolution explicit: \`host override ?? client default ?? catalog default\`.

4. Preserve full host identity in sleeping agent resume records: add \`executionHostId\` and/or \`runtimeEnvironmentId\`, populate it when capturing, and use it when launching the resume command. The provider session id should never be treated as portable across hosts.

5. Make cache keys and request selectors consistently host-owned. Use execution host id rather than ad hoc runtime-only options for:
   - GitHub metadata hooks
   - smart GitHub submit lookup cache
   - GitLab labels/assignees/details caches if/when added
   - cross-window mutation invalidation payloads

6. Add bounded diagnostics telemetry only if it answers a concrete support/product question. Prefer enums like \`host_kind: local|ssh|runtime|cloud\` and avoid hostnames, paths, repo names, branch names, account names, or tokens.

## Unknowns

- I stopped before auditing all Settings components and search metadata. Some UI copy may already clarify scope, but the type/API layer still has ambiguous ownership.
- I did not trace every call site into GitHub/GitLab work item drawers and task lists, so some renderer callers may already pass repo ids where available.
- I did not verify runtime server API contracts for provider auth/model discovery; the local preload/API shapes suggest the client still owns some values that may need to be host-owned.
- I did not inspect persistence migrations for \`ProjectHostSetup\` and host override defaults, so migration-specific risks may remain.
