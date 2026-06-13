# Composer PR Launch Hosts Audit

## Summary

The Composer flow is partially adapted to the project-first host model: project/host setup selection resolves to a concrete `repoId`, and many repo operations route through repo-owner settings instead of the focused runtime. The biggest remaining gap is that several UX surfaces still treat the selected run repo as both the workspace creation target and the task/review source. In the desired model, a linked work item may come from one host/account while the workspace is created on another host for the same logical Project; today the metadata and launch APIs mostly carry only `repoId`, `repoPath`, `connectionId`, or active runtime.

## Findings

1. **Linked work items lose source-host identity once they enter Composer.**  
   - `src/renderer/src/hooks/useComposerState.ts:1848-1859` resolves PR base using `item.repoId` when present, then falls back to the currently selected repo. This works only when the task source repo is the same repo/setup as the run target.  
   - `src/renderer/src/hooks/useComposerState.ts:2200-2259` and `src/renderer/src/hooks/useComposerState.ts:2550-2588` create worktrees with linked issue/PR/MR numbers, but not the source host/account/repo context that produced those numbers.  
   - `src/renderer/src/lib/pending-worktree-creation.ts:26-57` persists a retryable creation request with `repoId` and linked numbers only. A failed/retried background create cannot preserve “source repo/host differs from run repo/host.”

2. **Task page “Use” opens Composer against the work item repo, not the logical Project/run host.**  
   - `src/renderer/src/components/TaskPage.tsx:5325-5338` opens the Composer with `initialRepoId: item.repoId` for GitHub.  
   - `src/renderer/src/components/TaskPage.tsx:5391-5404` does the same for GitLab.  
   In a project-first model, this should probably preselect the logical Project and carry the task source context separately, then let the user choose/run on any project host setup.

3. **Smart linked-work-item picker is still repo/path scoped and sometimes local-only.**  
   - GitHub lookups in `src/renderer/src/components/new-workspace/SmartWorkspaceNameField.tsx:415-428`, `466-473`, and `868-880` pass `repoPath`/`repoId` only. Cross-repo URL acceptance calls `onRepoChange(targetRepo.id)`, which changes the run repo instead of attaching a source item to the current Project/run host.  
   - GitLab picker paths in `src/renderer/src/components/new-workspace/SmartWorkspaceNameField.tsx:635-692` and `699-745` skip SSH repos with `selectedRepo.connectionId` and use local `window.api.gl` calls. That blocks or misroutes GitLab task selection for remote/project-host setups.  
   - Main GitLab IPC identifies repos by path only: `src/main/ipc/gitlab.ts:56-62` and `src/main/ipc/gitlab.ts:235-254`. This is risky when the same logical project/path shape exists across hosts.

4. **Direct launch/fix-check style creation is still run-repo centric.**  
   - `src/renderer/src/lib/launch-work-item-direct-types.ts:5-16` allows `LaunchableWorkItem.repoId?`, but `LaunchWorkItemDirectArgs` has only one required `repoId` at `18-29`.  
   - `src/renderer/src/lib/launch-work-item-direct.ts:75-123` derives repo owner settings, setup, hooks, PR base, workspace name, and create target from that one `repoId`.  
   - `src/renderer/src/lib/launch-work-item-direct-preflight.ts:11-42` resolves PR start point for the same `repoId` used by the launch. This cannot represent “resolve PR on source host, create workspace on run host.”

5. **Hosted review lookup/creation mostly routes by repo owner, but repo lookup remains path-biased in important places.**  
   - `src/renderer/src/store/slices/hosted-review.ts:194-216` finds the repo for eligibility by `candidate.path === args.repoPath`, then uses that owner settings. With duplicate project folders across hosts, path equality is not enough; callers need to pass `repoId`/projectHostSetup/run host explicitly.  
   - `src/main/ipc/hosted-review.ts:19-33` supports `repoId` for `forBranch`, but `getCreationEligibility` and `create` call `assertRegisteredRepo(args.repoPath, store)` without repoId at `98-126`.  
   - Cache identity is stronger than older code: `src/renderer/src/store/slices/hosted-review-cache-identity.ts:17-27` includes host scope and repoId when supplied. The problem is ensuring all callers supply the correct run-host repo identity.

6. **Issue command/hooks are tied to the run repo, not the linked task source.**  
   - `src/renderer/src/hooks/useComposerState.ts:681-694` and `1020-1052` load hooks and issue command templates for the selected repo/run host.  
   - `src/renderer/src/hooks/useComposerState.ts:2155-2175` runs issue automation when there is a linked issue number, but trust/command source is still the selected repo. If task source differs from run project, the UX needs an explicit rule: run project hooks only, task-source hooks only, or both. Today it is implicit.

## Concrete Recommendations

1. Introduce a first-class linked task source context and thread it separately from the workspace creation target. It should include provider, source repo/project identity, source host/account/connection/runtime, number/type/url, and any provider-specific base/head metadata.

2. Update Composer open/prefill APIs so TaskPage and smart-picker selections set `selectedProjectId` / run `projectHostSetupId` independently from linked task source. Avoid changing the run repo just because a pasted PR URL belongs to another setup of the same logical Project.

3. Split PR/MR start-point resolution into source resolution and run-host creation planning. For cross-host project launches, resolve the source PR/MR on its source host, then map the resulting branch/ref/push target onto the selected projectHostSetup or explicitly fall back with a clear UX message.

4. Extend `WorktreeCreationRequest`, `createWorktree`, and worktree metadata to persist source context, not just linked numbers. This is required for retries, review lookup, terminal-link reconciliation, and future task-source account correctness.

5. Make hosted review creation/eligibility require repo identity for ambiguous paths. Renderer and IPC should pass `repoId`/projectHostSetup/run host through eligibility and create, mirroring the stronger cache-key design.

6. Define the product rule for issueCommand/hooks in cross-host task launches. My recommendation: run hooks from the selected run projectHostSetup, but render task context from the source item, and label that distinction in trust UI.

## Unknowns

- I did not finish tracing all fix-checks launch call sites; I only confirmed the direct launch helper shape is single-`repoId`.  
- I did not finish reviewing PR/MR base resolution in every main-process provider helper.  
- I did not verify whether projectHostSetup metadata is already persisted on worktrees by main/runtime create; renderer call sites still do not pass source context.  
- I did not run tests or execute UI flows because this was a read-only audit and investigation was stopped early.
