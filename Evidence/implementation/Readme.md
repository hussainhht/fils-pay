# Implementation evidence

Phase 0 verification reports and subsequent implementation/validation artifacts are consolidated here. The audit reports describe the baseline at their recorded HEAD, not current remediation status. Current status is in the [bug registry](../bugs/Readme.md) and the per-bug fix notes; work order is in the [plan](../bugfix_plan.md).

| Work | Evidence |
|---|---|
| Phase 0 infrastructure | [Agent 1](agent-1-infrastructure.md) |
| Phase 0 authentication/admin | [Agent 2](agent-2-auth-admin.md) |
| Phase 0 payments/refunds | [Agent 3](agent-3-payments-refunds.md) |
| Phase 0 settlement | [Agent 4](agent-4-settlement.md) |
| Phase 0 webhooks | [Agent 5](agent-5-webhooks.md) |
| Phase 0 reporting | [Agent 6](agent-6-reporting.md) |
| Wave 1 boot/auth | [Validation and limits](wave1-validation.md), [migration SQL checks](migrations-validation.sql), [HTTP smoke](wave1-smoke.mjs) |

Legacy `Evidence/phase0` paths in the historical reports record where those reports were originally created. They now live in this directory. Historical runtime-artifact citations are provenance references; deleting those artifacts does not supply new runtime proof.

Regenerate current registry status from the explicit per-report fix notes with:

```sh
node Evidence/implementation/update-bug-status.mjs
```

The script preserves historical verification and investigation counts, and adds current Status cells to both the master index and category tables.
