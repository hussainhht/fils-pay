# FilsPay — Claude Code Instructions

Shared authority: **[AGENTS.md](AGENTS.md)**. Read it first and follow it fully (architecture, commands, safety rules, severity, Definition of Done). This file only adds Claude Code behavior; if the two ever differ, AGENTS.md wins.

## Research

- Explore narrowly: use Grep/Glob and read only the files on the path of the task. Prefer the code over docs; docs and ADRs may be stale.
- Before implementing a fix, read the relevant `Evidence/bugs/bug-*.md` and any `Evidence/agent-*` / `Evidence/implementation/` report for that area, then confirm the defect in current code. Treat all of it as leads, not proof.
- Do not read `Evidence/old-agints-instration/` (owner directive). Do not trust bug status lines without checking.
- Run `git status` and `git branch --show-current` before editing. Files already modified are other people's in-progress work: do not touch them unless the task requires it, and then edit minimally around the existing changes.

## Implementation

- One workstream at a time. Do not run parallel editing subagents or workflows on overlapping files; subagents are for read-only investigation unless each has its own worktree and a disjoint file set.
- Make targeted edits with Edit; no sweeping rewrites or formatting churn. Add a regression test with every fix.
- Stop and ask before: touching `packages/money/`, migrations/schema, the `apps/api/src/v1/` contract, destructive DB or git commands, new dependencies, or resolving the ADR conflicts listed in AGENTS.md §2.
- Never commit, push, merge, or switch branches unless asked.

## Verification

- Run the narrowest relevant tests, then `npm run typecheck`. Report unrunnable tests (no Postgres/Docker) as not run.
- Follow the AGENTS.md §4 sequence for runtime claims. Use `npm.cmd` if PowerShell blocks `npm.ps1`.

## Long-running tasks

- Start servers and watchers with `run_in_background`; don't poll with sleep loops. Record the ports you started and stop only processes you started. Never kill an unfamiliar process that already holds 3000/5173/5174.
- Keep the Evidence report incrementally updated so work survives context compaction.

## Persistent Context Protocol

Follow `AGENTS.md` §12:
- **Before task:** Read `context/README.md` and consult only the task-relevant context files. Inspect only necessary source files. Do not initiate repository-wide file scans.
- **During task:** Respect documented architectural invariants in `context/DEVELOPMENT_RULES.md` and dependencies in `context/DEPENDENCY_MAP.md`.
- **After task:** Update affected documents in `context/`, update `context/KNOWN_ISSUES.md` if bugs were touched, and append an entry to `context/CHANGELOG.md`. Tasks are incomplete until context maintenance is done.

## Reporting

- Progress: one or two sentences per milestone, stating what was found or changed.
- Completion summary: files changed, commands run with real results, bug status before/after, what was not verified. No claims without evidence.

