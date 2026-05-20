# Continuing activation re-entry

Date: 2026-05-20

## Problem

Fresh and shallow Orca users often add a project or start an agent, then leave before forming a habit. The retention bet is not generic session memory. It is a small in-app nudge toward the next concrete activation action when Orca already has reliable state for that action.

## V1 scope

V1 ranks and surfaces one next action in the existing sidebar. It does not interrupt the user and does not add new OS notifications.

Included candidates:

- `agent_needs_input`: an agent is waiting for input or permission. Backed by live explicit agent status when available, with terminal-title permission status as a fallback.
- `agent_ready_for_review`: an agent reached an idle/done state and the user has not reviewed it. Backed by explicit done status when available and by a local-only cue recorded from Orca's existing working-to-idle agent transition.

The local cue stores only `kind`, `tabId`, and timestamps in the existing workspace session. It does not store prompt text, command output, paths, repo names, branch names, file names, worktree ids, or terminal titles. Telemetry never includes target ids.

## Deferred candidates

- Blocked setup or integration retry: current setup-script recovery state is not reliable enough to distinguish failed setup from generic terminal output.
- Selected issue/PR/task not started: task caches are not user intent, and composer modal state is not a durable activation signal.
- Configured but unused onboarding feature: no trustworthy persisted feature-used state was found in this branch.
- First workspace after repo add: residual project setup is already in progress and should not be re-scoped here.
- Competitor setup import: already in progress and maps to `orca.yaml`, not Add Project setup actions.

## Surface

The sidebar gets a compact “Next action” row between the global nav and workspace list. The row shows one high-confidence candidate and offers:

- Open: activates the target workspace and tab through the existing activation helper.
- Dismiss: hides the cue for the current session or persisted cue.

The surface is intentionally small and only appears when the target is not already the active visible terminal tab.

## Ranking

Highest priority wins:

1. Agent needs input or permission.
2. Agent output is ready for review.

Within a priority bucket, newer state wins. Candidate generation validates that the worktree and tab still exist before surfacing a cue.

## Telemetry gate

Question: Do continuing-activation candidates create meaningful second-session action, or are they ignored/dismissed?

Decision owner/use: Product uses this to decide whether to expand next-action re-entry beyond agent attention into setup recovery or task-start candidates.

Dashboard: Orca retention dashboard, proposed “Continuing activation candidate funnel” tile.

Action: If shown-to-click or clicked-to-landed is weak, keep the surface narrow or remove it. If it is strong, add the next reliable candidate class.

Telemetry volume estimate:

- Trigger: candidate shown, clicked, dismissed, landed.
- Expected events/user/day: 0-4 for most users with active agents.
- Max events/user/day: bounded by visible top-candidate changes and explicit user actions; power users can create more, but this is not timer-based.
- At 1,000 DAU: expected under 4,000 events/day.
- Monthly at 1,000 DAU: expected under 120,000 events/month.
- Approval note: events are low-cardinality enums only and answer whether this retention surface should expand.

Payload contains only candidate kind and surface enum. It never includes prompts, repo/workspace names, paths, branch names, file names, URLs, commands, hostnames, or ids.

Candidate IDs and runtime dismissal keys are also privacy-neutral. They use candidate kind, source, tab id, pane id, cue id, and timestamps only; they do not include terminal titles, prompts, repo/workspace names, branches, paths, or file names.

## SSH and platform notes

Candidate actions use `activateAndRevealWorktree`, which already handles SSH-backed worktrees through the standard renderer state and terminal activation path. No path parsing is added. Keyboard labels are not introduced.
