# R2 u11 — storage, migrations, recovery, outbox, ledger, and events

## Owned ledger

The family owns 14 files / 238 expanded cases:
`archive-ledger-read-through` 12, `archive-retention` 7, `config-snapshot-generations` 7,
`durable-control-records` 6, `events/jsonl-writers` 26, `events/span-events` 17,
`ledger-activity-fold` 8, `ledger-projector` 6, `run-checkpoints` 11,
`sqlite-authority-boundary` 2, `sqlite-authority-database` 45,
`storage-diagnostic-redaction` 56, `storage-span-authority-reconciliation` 31,
and `storage-summary` 4. All paths are under `tests/unit/` and end in `.test.ts`.

## Risk and disposition

| Family | Unique failure protected | Disposition |
| --- | --- | --- |
| SQLite schema/migrations/generation | foreign/divergent suffix, migration mutation, nested transaction leakage, mirrored-column disagreement | Retain real-database tests |
| ledger/outbox | lease race, torn tail, sequence gap, digest mismatch, crash between assign/append/mark | Retain projector/read-through tests and distinct static one-writer guard |
| JSONL spans/notes | duplicate roots, multiline/raw-secret append, torn cursor, wrong partition/range, invalid reconstruction marker | Retain writer/reader/refusal matrix |
| checkpoints/config snapshots/control records | schema/impl/freshness drift or old authority silently rewritten | Retain strict schema and repository tests |
| storage doctor/summary | unreadable evidence becomes healthy/current or absence is invented from a mixed snapshot | Retain combinatorial redaction/reconciliation cases |

`events/jsonl-writers.test.ts` covers writers, readers, cursoring, pruning, and scoped reads; its name
understates its breadth, but splitting it is R7 final-taxonomy work and must preserve every negative
case. Local span-root builders duplicate setup only, not assertions; extracting them would add an
adapter without shrinking a behavior seam.

## Residue and proof

`archive-model`, `claim-sweep-recovery`, notifications, parallel-run authority, run authority,
storage-health/restore/root-repair, and their server/runtime ownership stay with R3/R4. R2 does not
move them opportunistically.

The final explicit 82-file R2 run measured and passed this family's 14/14 files and 238/238 expanded
cases. Architecture counterparts are retained because they prove static ownership rather than
runtime behavior.
