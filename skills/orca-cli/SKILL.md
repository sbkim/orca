---
name: orca-cli
description: >-
  Use the public `orca` CLI to operate Orca editor state: workspaces/worktrees,
  terminals, repos, scheduled automations, worktree comments, and Orca's
  built-in browser. Use when the user says "$orca-cli", "use orca cli",
  "create/spawn workspace", "child workspace", "worktree", "setup hooks",
  "spawn codex/claude in a workspace", "read/wait terminal", "Orca browser",
  or "browser use with orca cli". Prefer this over raw `git worktree`, ad hoc
  PTYs, Playwright, or Computer Use when the task touches Orca-managed state.
  For terminal input to another AI agent, use `orchestration`; reading/waiting
  on agent terminals stays here.
---

# Orca CLI

Use this skill when work should go through Orca's control plane rather than direct `git`, shell PTYs, local files, ad hoc browser automation, or desktop Computer Use.

## Platform Note

On Linux, the CLI command is `orca-ide` instead of `orca` to avoid conflicting with GNOME Orca. Everywhere this document says `orca <subcommand>`, Linux users should substitute `orca-ide <subcommand>`.

## When To Use

Use `orca` for:

- worktree orchestration inside a running Orca app
- updating the current worktree comment at meaningful checkpoints
- reading, creating, waiting on, stopping, or splitting Orca-managed terminals
- sending input to non-agent terminals
- creating and managing scheduled Orca automations
- accessing repos known to Orca
- driving Orca's built-in browser

Do not use it when plain shell tools are simpler and Orca state does not matter.

When the user asks for browser work "with Orca CLI", "with the Orca browser", or similar, use this skill's browser commands. Do not also use Computer Use unless the user explicitly asks to inspect or manipulate a desktop app/window outside Orca's browser automation surface.

## Preconditions

- Prefer the public `orca` command first.
- Orca editor/runtime should already be running, or the agent should start it with `orca open`.
- Do not inspect Orca source files just to decide how to invoke the CLI.
- Do not use generic environment variables as proof that the shell is inside Orca.
- Do not move on until the public CLI exists and runtime reachability is known. If this turn already checked `status`, reuse that result.

```bash
command -v orca
orca status --json
```

If Orca is not running:

```bash
orca open --json
orca status --json
```

If `orca` is not on PATH, say so explicitly and stop or ask the user to install/register the CLI before continuing. On Linux, retry with `orca-ide` first as noted above.

## Core Workflow

```bash
orca status --json
orca worktree ps --json
orca terminal list --json
```

Resolve the target worktree or terminal handle, then act through Orca:

- `worktree create/set/rm`
- `automations list/show/create/edit/remove/run/runs`
- `terminal create/read/send/wait/stop/split`
- browser commands such as `goto`, `snapshot`, `click`, `fill`

When reaching a significant checkpoint, update the current worktree comment:

```bash
orca worktree set --worktree active --comment "reproduced bug; testing fix" --json
```

Why: the worktree comment is Orca's lightweight, agent-writable status field. Keep it current enough that the user can scan progress without reading the terminal.

## Repo Commands

```bash
orca repo list --json
orca repo show --repo id:<repoId> --json
orca repo add --path /abs/repo --json
orca repo set-base-ref --repo id:<repoId> --ref origin/main --json
orca repo search-refs --repo id:<repoId> --query main --limit 10 --json
```

## Worktree Commands

```bash
orca worktree list --repo id:<repoId> --json
orca worktree ps --json
orca worktree current --json
orca worktree show --worktree id:<worktreeId> --json
orca worktree create --name agent-task --agent codex --prompt "hi" --json
orca worktree create --repo id:<repoId> --name my-task --issue 123 --comment "seed" --json
orca worktree create --name setup-task --setup run --json
orca worktree create --name related-task --parent-worktree active --json
orca worktree create --name independent-task --no-parent --json
orca worktree set --worktree active --comment "waiting on review" --json
orca worktree rm --worktree id:<worktreeId> --force --json
```

Selectors:

- `id:<worktree-id>`
- `path:<absolute-path>`
- `branch:<branch-name>`
- `issue:<number>`
- `active` / `current` for the enclosing Orca-managed worktree

### Worktree Lineage

When creating a worktree from inside an Orca-managed worktree, decide whether the new work is related to the current workspace or independent.

For related work, rely on Orca's inferred parent or pass `--parent-worktree active` when the relationship should be explicit:

```bash
orca worktree create --name related-task --json
orca worktree create --name related-task --parent-worktree active --json
```

For independent work, pass `--no-parent`:

```bash
orca worktree create --name independent-task --no-parent --json
```

A different branch, issue, or name is not enough by itself to make work independent. Treat lineage as a record of why the workspace exists, not as a property of the branch name.

### Worktree Startup

When creating a new workspace that should immediately run a known TUI agent, pass `--agent <id>` on `worktree create` instead of creating a blank worktree and then creating a separate agent terminal.

```bash
orca worktree create --name agent-task --agent codex --prompt "hi" --json
orca worktree create --name agent-task --agent claude --json
```

Why: create-time agent startup lets Orca launch the agent in the first terminal, send the initial prompt, validate disabled-agent settings, apply command overrides, quote correctly for local vs SSH workspaces, and avoid leaving an unused first terminal behind.

If creating from outside an Orca-managed worktree or targeting a different repo, pass `--repo <selector>`.

Use `--setup run|skip|inherit` to choose the repo setup policy. Default is `inherit`.

- `run`: force repo setup for this create.
- `skip`: skip repo setup for this create.
- `inherit`: follow the repo/user default.

`--run-hooks` is a no-value legacy alias for setup run and reveals the new worktree in the app. Prefer `--setup run` for new scripts unless you specifically need the legacy reveal behavior.

Backward compatibility: if an older CLI rejects `--agent`, create the worktree normally, then launch the agent with `orca terminal create --worktree <selector> --command "codex"` and wait for `tui-idle` before sending work. If it rejects `--setup`, use `--run-hooks` when forcing setup is required.

## Automations

```bash
orca automations list --json
orca automations show <automationId> --json
orca automations create --name "Daily review" --trigger daily --time 09:00 --prompt "Review open changes" --provider codex --repo id:<repoId> --json
orca automations create --name "Inbox digest" --trigger hourly --prompt "Summarize unread mail" --provider codex --workspace active --reuse-session --json
orca automations edit <automationId> --name "Weekday review" --trigger weekdays --time 09:30 --fresh-session --json
orca automations run <automationId> --json
orca automations runs --id <automationId> --json
orca automations remove <automationId> --json
```

Use `--repo <selector>` for a new worktree per run, or `--workspace <selector>` / `--workspace-mode existing` when the automation should run in an existing Orca worktree. Use `--disabled` when creating automations during tests or setup so they cannot run before review.

## Terminal Commands

```bash
orca terminal list --worktree id:<worktreeId> --json
orca terminal show --terminal <handle> --json
orca terminal read --terminal <handle> --json
orca terminal read --terminal <handle> --cursor <oldestCursor> --limit 1000 --json
orca terminal send --terminal <handle> --text "npm test" --enter --json
orca terminal wait --terminal <handle> --for exit --timeout-ms 5000 --json
orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 30000 --json
orca terminal create --worktree active --title "Tests" --command "npm test" --json
orca terminal split --terminal <handle> --direction horizontal --command "npm run dev" --json
orca terminal switch --terminal <handle> --json
orca terminal close --terminal <handle> --json
```

Terminal guidance:

- `--terminal` is optional for most commands; when omitted, Orca auto-resolves to the active terminal in the current worktree. Use explicit handles when operating on a specific pane.
- Use `terminal create --command` to add a terminal to an existing workspace. For new workspace plus agent, prefer `worktree create --agent`.
- Interactive local agent commands such as bare `codex` or bare `claude` use Orca's visible terminal path automatically.
- Use `terminal wait --for tui-idle` for recognized agent CLIs. Always pass `--timeout-ms`; real coding tasks can take 15-60 minutes.
- For long transcripts, start with `terminal read --json`; if output is limited, read retained transcript pages from `oldestCursor` / `nextCursor` with `--cursor` and `--limit`.
- Terminal handles are runtime-scoped. If Orca returns `terminal_handle_stale`, reacquire with `terminal list`.
- `--direction horizontal` splits left/right with the new pane to the right. `--direction vertical` splits top/bottom with the new pane below. This follows VS Code convention.

## Agent Guidance

- If the user says to create/manage an Orca worktree, use `orca worktree ...`, not raw `git worktree ...`.
- If the user says to create/manage a scheduled Orca automation, use `orca automations ...`, not persistence edits.
- Prefer `--json` for machine-driven use.
- Use `worktree ps` as the first summary view when many worktrees may exist.
- Use `worktree current` or `--worktree active` when the agent needs the current worktree identity.
- When creating a worktree from an existing workspace, keep inferred parent context for related work and use `--no-parent` for independent work.
- When creating a new worktree and launching an agent, prefer `orca worktree create --agent <agent> --prompt <text>`.
- Update the worktree comment at significant checkpoints, not every trivial command.
- Prefer optimistic checkpoint updates. If comment update fails because Orca is unavailable or the shell is outside an Orca worktree, continue the main task unless Orca state is the task.
- Use `terminal read` before `terminal send` unless the next input is obvious.
- For agent-to-agent messages or handoffs, use the `orchestration` skill. Do not type prompts into another agent terminal with `terminal send`.
- Prefer Orca selectors over hardcoded paths when Orca identity already exists.
- If the user asks for CLI UX feedback, test the public `orca` command first. Inspect `src/cli` only if the public command is missing or implementation internals are the task.

## Browser Automation

Use the built-in browser with a snapshot-interact-re-snapshot loop:

```bash
orca goto --url https://example.com --json
orca snapshot --json
orca click --element @e3 --json
orca snapshot --json
```

Common commands:

```bash
orca goto --url <url> --json
orca snapshot --json
orca click --element <ref> --json
orca fill --element <ref> --value <text> --json
orca type --input <text> --json
orca wait --text <text> --json
orca wait --url <substring> --json
orca wait --selector <css> --json
orca screenshot --json
orca tab list --json
orca tab create --url <url> --json
orca tab switch --index <n> --json
orca tab close --index <n> --json
orca eval --expression <js> --json
orca exec --command "help" --json
```

Browser guidance:

- Browser commands are scoped to the current worktree by default. Use `--worktree all` only when cross-worktree access is intentional.
- Prefer these browser commands over Computer Use for web-page navigation, clicking, filling, screenshots, tabs, and waits when the user asked for Orca CLI/browser automation.
- Re-snapshot after navigation, tab switches, clicks that change the page, and any `browser_stale_ref` error.
- Use `orca wait --text`, `--url`, `--selector`, or `--load` after async page changes. Avoid bare sleep-style waits except while debugging.
- For concurrent browser workflows, run `orca tab list --json`, read `tabs[].browserPageId`, and pass `--page <browserPageId>` on later commands.
- If `fill` or `type` fails on a custom input, try `orca focus --element @e1 --json` then `orca exec --command "keyboard inserttext \"text\"" --json`.
- Use typed tab commands (`orca tab list/create/close/switch`), not `orca exec --command "tab ..."`, so Orca keeps UI state synchronized.
- Common recoveries: `browser_no_tab` means open a tab; `browser_tab_not_found` means list tabs first.

## Important Constraints

- Orca CLI only talks to a running Orca editor.
- Orca is the source of truth for worktree, terminal, automation, and browser state.
- The public `orca` command is the interface users experience. Agents should validate and use that surface, not repo-local implementation entrypoints.

## References

See these docs in this repo when behavior is unclear:

- `docs/orca-cli-focused-v1-status.md`
- `docs/orca-cli-v1-spec.md`
- `docs/orca-runtime-layer-design.md`

## Next Action

Resolve `$ORCA` if needed, confirm status unless already checked this turn, then choose the narrowest command for the task: `worktree ps/current/create`, `terminal list/read/wait`, `automations list`, or browser `snapshot`.
