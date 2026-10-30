# FilsPay — Gemini Instructions

Shared authority: **[AGENTS.md](AGENTS.md)**. Read it first and follow it fully (architecture, commands, safety rules, severity, Definition of Done). This file only adds Gemini behavior; if the two ever differ, `AGENTS.md` wins.

## 1. Research & Exploration

- **Follow Persistent Context Protocol:** Read `context/README.md` first. Select only the context files relevant to your task from the router table. Do not perform repository-wide sweeps or broad file listings when context is available.
- Inspect only the specific source files necessary for the task.
- Treat historical bug reports in `Evidence/bugs/` as leads, not verified truth. Verify defects against current code.
- **Strict Boundary:** Do not read `Evidence/old-agints-instration/` (explicit project owner directive).
- Always run `git status` first. Files with uncommitted changes represent active in-progress work by other agents. Never revert, overwrite, or reformat them.

## 2. Implementation & Code Modification

- Maintain minimal, targeted diffs. No unrelated refactoring or dependency additions.
- Add a co-located regression test (`*.test.ts`) for every defect fixed.
- **Strict Stop-and-Ask Boundaries:**
  - `packages/money/` is strictly protected and frozen. Never edit without explicit human authorization.
  - `apps/api/src/v1/` partner contract is frozen.
  - Never edit existing migration files in `db/migrations/*.sql`.
  - Never run `npm run seed` or destructive database commands without `ALLOW_DESTRUCTIVE_SEED=1` against an isolated local database.
  - Never commit, push, or switch branches unless explicitly requested.

## 3. Persistent Context Protocol

Follow `AGENTS.md` §12:
- **Before task:** Read `context/README.md`, identify required context documents, and review documented business rules and invariants.
- **During task:** Respect documented architectural invariants in `context/DEVELOPMENT_RULES.md` and dependencies in `context/DEPENDENCY_MAP.md`.
- **After task:** Context maintenance is mandatory. Review and update affected context documents in `context/`, update `context/KNOWN_ISSUES.md` if bugs were addressed or discovered, and append an entry to `context/CHANGELOG.md`.

## 4. Verification & Testing

- Run narrow unit tests, then `npm run typecheck`.
- If PostgreSQL or Docker is unavailable, report integration tests as **BLOCKED / NOT RUN**. Never claim unverified tests passed.
- On Windows PowerShell, use `npm.cmd` and `npx.cmd` if `.ps1` execution is blocked.

## 5. Reporting

- Deliver completion summaries stating: files changed, commands run with real outcomes, bug status before/after, and unverified aspects. No assumptions without evidence.
