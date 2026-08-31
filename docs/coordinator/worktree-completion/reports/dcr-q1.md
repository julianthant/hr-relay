# dcr-q1 — evidence map

Role: `sup_scout` / high / 120k-105k. Task: `sup_scout_dcr_q1_evidence_mapping`.
Agent: `01a052ee-f768-7f31-98b2-fd181782654d`. Read-only; supervisor persists this return.
Target: `13175b13..6d1e3ca8`. No tests, secret reads, or live-authority access.

| Claim | Classification | Evidence |
|---|---|---|
| Assigned tip descends from common integration base | proved | First-parent receive `52fd7a47`, D288 `17209df6`, D289 `d26d1c83`, Activity `d9b467e5`, D75 `3b36592b`, final docs `6d1e3ca8` |
| D288/D75 migrations exist and are pinned | proved | `src/infra/sqlite/migrations.ts` v20-v24; `tests/unit/architecture/migration-history-immutability.test.ts` |
| Activity sends aggregate count availability only | proved | `src/domain/dashboard/activity.ts` |
| Comparison uses its closed D289 contract | source-backed; q2 reviews behavior | `docs/rebuild/reference/operator-trust.md` and receipt-comparison implementation/tests |
| XLSX omits person/run/trace/retry identities | test-backed | `tests/unit/server/operator-xlsx-workbook.test.ts` |
| Prior exact gates and independent review passed | historical reviewer-backed, not rerun by q1 | `dcr-historical-review-provenance.md`, exact reviewer task identifiers and returns |
| Four cited reporting PNGs exist | proved by filesystem metadata | Paths in `docs/handoffs/2026-08-28-r-dcr-authority-close-report.md` |
| Present live corpus has seven ineligible rows | historical observation only | Historical final reviewer return; no current live read authorized by this assignment |

## Receive findings and supervisor disposition

1. Report privacy wording incorrectly groups search with XLSX. The strict search wire deliberately
   contains `runId`, `traceId`, and `retryOf`; only XLSX omits those identifiers. Correct the report;
   do not change the agreed search contract.
2. The 2026-08-29 status title identifies inspected product HEAD `58bcca32`, while its later artifact
   commit is `6d1e3ca8`. This is a dated snapshot, not evidence of a branch mismatch. Add explicit
   historical-snapshot wording rather than replacing its old conclusions with current claims.
3. Seven-row eligibility and schema-v18 claims must remain dated historical observations. The new
   receive does not execute a backfill or inspect/migrate live authority; fixtures and q3 gates
   verify implementation only. No synthetic pseudonym evidence is permitted.

Acceptance: evidence matrix delivered; q2 boundary review and q3 fresh gates remain required.
