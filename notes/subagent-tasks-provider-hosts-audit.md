# Tasks/provider hosts audit

## Summary

The Tasks surface is partway through the project-first host migration, but the data model is still mostly “repo/workspace/site + current runtime focus”. GitHub task lists have the best host-scoping work today: work-item cache keys include an execution host, runtime fetches can fan out through RPC, and issue-source preferences persist to the repo owner host. The main product correctness gap is that task source context is not first-class. Linear/Jira/GitLab and several GitHub drawer mutations still derive the provider account/server from global active runtime settings, selected repo state, or a local path at the moment of action. That can fetch or mutate the wrong account when a durable Project exists on multiple hosts, when runtime focus changes while a drawer is open, or when task source and run host are intentionally different.

## Findings

1. **Task source context is global runtime focus for Linear/Jira, not carried with the task/source.**  
   \`TaskPage\` derives a single \`providerRuntimeContextKey\` from current settings and treats Linear/Jira status as current only if it matches that focus (\`src/renderer/src/components/TaskPage.tsx:2505-2514\`). The runtime clients route every Linear/Jira call via \`getActiveRuntimeTarget(settings)\` (\`src/renderer/src/runtime/runtime-linear-client.ts:65-73\`, \`src/renderer/src/runtime/runtime-linear-client.ts:223-253\`, \`src/renderer/src/runtime/runtime-jira-client.ts:30-35\`, \`src/renderer/src/runtime/runtime-jira-client.ts:139-149\`). This conflates “which host/account owns the task source” with “where the workspace will run”. A user can open a Linear/Jira issue sourced from one runtime/local account, switch runtime focus for running work, then refresh/mutate through a different provider host.

2. **Linear/Jira cache keys omit provider host context and rely on side invalidation.**  
   Linear search/list cache keys are workspace/query/filter only (\`src/renderer/src/store/slices/linear.ts:927-1044\`), and Jira search/list cache keys are site/JQL/filter only (\`src/renderer/src/store/slices/jira.ts:363-447\`). The slices guard in-flight writes with \`getProviderRuntimeContextKey\`, and Linear clears caches when status scope changes (\`src/renderer/src/store/slices/linear.ts:500-541\`), which is good, but the persisted cache identity itself cannot represent two hosts with the same Linear workspaceId or Jira siteId at once. Optimistic patches also scan all caches by issue id/key without host/site/workspace scoping (\`src/renderer/src/store/slices/linear.ts:1888-1925\`, \`src/renderer/src/store/slices/jira.ts:500-521\`).

3. **Open Linear drawer hydration keys are tied to active runtime, not task source identity.**  
   \`LinearIssueWorkspace\` uses \`\${settings?.activeRuntimeEnvironmentId ?? 'local'}:\${issue.workspaceId ?? 'selected'}:\${issue.id}\` as its hydration identity (\`src/renderer/src/components/LinearIssueWorkspace.tsx:561-575\`). This protects against some runtime switches, but it is still global runtime focus, not the issue’s captured provider context. It also has no representation for future non-runtime hosts/cloud VMs or explicit taskSourceHost.

4. **GitLab Tasks are path-only and local-IPC-only.**  
   The GitLab list effect fans out selected repos but calls \`window.api.gl.listIssues/listMRs\` with only \`repoPath\` (\`src/renderer/src/components/TaskPage.tsx:3641-3690\`). GitLab preload APIs are path-only for most reads and mutations (\`src/preload/api-types.ts:1381-1451\`), with only some deeper MR operations accepting \`projectRef\` (\`src/preload/api-types.ts:1452-1484\`). The drawer update path also mutates by \`repoPath\` only (\`src/renderer/src/components/GitLabItemDialog.tsx:520-525\`). This cannot distinguish the same project path on local/SSH/runtime/future cloud hosts, nor can it express a GitLab account/server separate from the workspace run host.

5. **GitHub work-item list routing is host-scoped, but drawer fallback mutations can still bypass runtime routing.**  
   Good: work-item cache keys include \`executionHostId\` (\`src/renderer/src/store/slices/github.ts:575-583\`), in-flight keys include the runtime target (\`src/renderer/src/store/slices/github.ts:585-591\`), and list/count route through runtime RPC when the repo owner is runtime (\`src/renderer/src/store/slices/github.ts:204-244\`). However, \`GitHubItemDialog\` non-project fallback mutations call local IPC directly for issue/PR state updates when no \`projectOrigin\` is present (\`src/renderer/src/components/GitHubItemDialog.tsx:4312-4320\`, \`src/renderer/src/components/GitHubItemDialog.tsx:4400-4408\`). Those paths should use the same repo owner/provider context routing as the list source, or they risk mutating via local credentials after reading from a runtime host.

6. **Task resume/open state captures repoId/workItem snapshots, not provider context/project host setup.**  
   The GitHub drawer key is \`{ id, repoId }\` (\`src/renderer/src/components/TaskPage.tsx:2831-2840\`), and opening a detail page stores \`preselectedRepoId\` plus the work-item snapshot (\`src/renderer/src/components/TaskPage.tsx:2888-2896\`). This is okay for same-session cross-repo disambiguation, but it is not durable enough for the desired model: repoId identifies one setup/repo record, not the task-source host/account or a ProjectHostSetup. Similar global resume state is implied by the task source defaults and selected workspace/site fallback (\`src/renderer/src/components/TaskPage.tsx:2586-2598\`, \`src/renderer/src/components/TaskPage.tsx:2672-2682\`).

## Concrete Recommendations

- Introduce a first-class \`TaskSourceContext\` and pass it through list rows, drawers, mutations, caches, and resume state. It should include provider, provider host/account/server identity, project id, and (when relevant) projectHostSetup/run host separately. Do not infer it from active runtime focus at action time.
- Split “task source host” from “run host” in UI state. Opening/using a task should preserve where the issue was fetched/mutated from, while workspace creation chooses a ProjectHostSetup independently.
- Update Linear/Jira runtime clients to accept an explicit provider context/target instead of only \`settings.activeRuntimeEnvironmentId\`; include that context in cache keys and optimistic patch keys.
- Extend GitLab APIs from \`repoPath\`-only to explicit project/provider context. At minimum carry \`repoId\`/executionHostId/projectRef through reads and mutations; ideally carry the same \`TaskSourceContext\` used by GitHub/Linear/Jira.
- Route all GitHub drawer fallback mutations through repo-owner/provider routing, not direct local IPC, unless the captured task source is explicitly local.
- Store task resume/open-drawer state with provider context and projectHostSetup identity, not just \`repoId\`, \`workspaceId\`, or selected site/workspace fallback.

## Already okay

- GitHub work-item cache and in-flight identity are host-aware (\`src/renderer/src/store/slices/github.ts:575-591\`).
- GitHub work-item list/count can route through runtime RPC for runtime-owned repos (\`src/renderer/src/store/slices/github.ts:204-244\`).
- GitHub issue-source preference persistence uses the repo owner runtime rather than focused runtime (\`src/renderer/src/store/slices/github.ts:3391-3418\`).
- GitLab cross-repo list merging tags each returned item with the selected repoId, avoiding same-IID collisions in the visible list (\`src/renderer/src/components/TaskPage.tsx:3692-3706\`).
- Linear/Jira slices do guard stale in-flight writes against runtime-context changes, which reduces race bugs even though cache identity is not yet provider-context-native (\`src/renderer/src/store/slices/linear.ts:500-541\`, \`src/renderer/src/store/slices/jira.ts:363-447\`).

## Unknowns

- I did not verify the main-process GitHub/GitLab/Linear/Jira handlers; this report focuses on renderer/preload routing visible from the Tasks surface.
- It is unclear whether current \`repoId\` values are already intended to be ProjectHostSetup-scoped. Even if they are, provider account context is still absent from Linear/Jira/GitLab task identities.
- I did not audit workspace creation end-to-end; the key ambiguity remains that “Use task” needs an explicit mapping from captured task source to chosen ProjectHostSetup/run host.
