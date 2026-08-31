# DCC4 m1 — unique-history inventory

2026-08-30. Read-only `sup_scout` (Luna, high; 120k/105k); agent
`01a052ef-c625-7e62-b97c-cf8057e7b8bf`. Supervisor persisted returned findings.
HEAD `49c6206cbc3d3e30e97603628590823787d120d8`; common ancestor `80da3815`.
45 branch-only commits versus frozen baseline `13175b13` and R-DCC `a9b5395f`.
Original brief: `docs/plans/2026-08-28-dashboard-completion-runs.md:84–90` (historical).

| Invariant family | Complete unique commit inventory | Branch evidence |
|---|---|---|
| Protocol/identity/fingerprints | 1608b504 d4119050 54c2d831 8467dc0e 9f4f6da1 be453ede 25dcb0df 6f6fd4b4 9d2695a7 038eb093 cda3db00 50a65e5e 8274a6ed | src/domain/dashboard/explorer-edit.ts:28–307; tests/unit/domain/explorer-edit-protocol.test.ts:20–181 |
| SQLite review/outbox/reconciliation | c6585008 a67ba34b 854b8733 f254b68e e6afb646 b0388073 c9c034a9 a4d4c268 fc568431 b6d13713 7eee99ab bebc6384 89f02833 | src/core/command-kernel.ts:3041–3100; src/infra/sqlite/authority-database.ts:3279–3528 |
| File durability | 1c778d2c 4398c636 26cff6d9 5a4115ab 1f6dffaf d9a7c174 | src/infra/explorer-edit-authority.ts:121–239 |
| Projection/route | 213beeea db8cd656 abaa5fa5 2dc875e1 49c6206c | src/server/dashboard/queries/explorer.ts:706–850; tests/unit/server/explorer-query.test.ts:155–239 |
| Docs/guards | 867cba03 3c17b45e d68108f7 ee40ac3f 6f8dae33 6a7ced45 030fa00b 1a716962 | root AGENTS.md; operator-trust; workflow-editor-compile-integrity |

Baseline owner at `13175b13`, `docs/rebuild/reference/operator-trust.md:1814–1825,1869–1875`
and `src/domain/dashboard/explorer.ts:639–647`, permits only workflow label/icon/category.
Branch `src/domain/dashboard/explorer-edit.ts:55–86` has eight apply arms, folded by
`src/server/dashboard/queries/explorer.ts:736–784` and tested at `:123–150` in its test.
Baseline `src/server/dashboard/commands/explorer-override-store.ts:508–730` uses the
file-first exclusive claim/journal; branch `src/core/command-kernel.ts:3087–3094` uses
SQLite-first outbox projection. These are functional conflicts requiring m2 judgment.

No edits or tests by Scout. Intake typecheck/lint exit 0; build:manifest:check current;
roadmap:check exit 1 (stale generated index). No heavy gates before coordinator allocation.
The supervisor-owned intake and this inventory are the only introduced artifacts.
