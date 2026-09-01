# DCC4 alternate v19 — immutable-history dependency

2026-08-30, supervisor read-only Git/docs audit. No live database was opened or converted.

Original HEAD `49c6206cbc3d3e30e97603628590823787d120d8` declares version 19 with digest
`bef14546c5a4bba520dca00f2bd0d950bc6f3824c5f953f54729d233b1701b8d`.
Commit `854b8733f598a97bf0d7483a37343781480d0c5b` (2026-08-28 09:53:07 -07:00)
introduced the Explorer review/outbox DDL in `src/infra/sqlite/migrations.ts`.
At original HEAD the migration is lines 1227–1262, after the shared v18 history.

The original `tests/unit/architecture/migration-history-immutability.test.ts:17–40`
explicitly calls its list `RELEASED_MIGRATION_DIGESTS`, includes v19, and says historical
hashes are never recomputed to bless changed statements. That is a declared immutable-history
obligation, even though the migration's runtime protocol is superseded by current D283.

The historical `docs/plans/dashboard-control-plane-board.md` at original HEAD still lists
DCC4 as `briefed`, with no merge/gate evidence. The scoped committed docs/handoffs search found
implementation/verification claims, but no evidence this v19 ran against a deployed authority.
`tests/unit/sqlite-authority-database.test.ts:311` and
`tests/unit/server/explorer-edit-service.test.ts:39` use temporary `mkdtemp` fixtures.
These prove a test setup, not live deployment or absence of deployment.

Therefore: deployment is **unverified**, not proven absent. Replacing/dropping this released
v19 cannot be justified solely by obsolete product code. The coordinator reports distinct v19
histories in DCC1 and DCR as well; final migration-history disposition is coordinator-owned.
The original commits/digest remain preserved in Git ancestry. Do not renumber, convert live data,
reintroduce the broad protocol, or bless changed released bytes merely to make the gate pass.

Evidence commands (all in assigned DCC4 worktree): `git show 49c6206c:<path>`,
`git show --stat 854b8733`, scoped `git grep` across original docs, tests and migration source.
This record is a named integration dependency until the coordinator supplies a disposition.

## Coordinator ruling, 2026-08-30

No rewrite, drop or renumber of v19 is authorized. Preserve the exact original SQL, digest and
history while retaining the current narrow protocol. Dormant schema does not reactivate the
superseded outbox protocol. If that cannot remain coherent/green, hand off that exact seam rather
than weaken the history guard. Final shared integration is explicitly blocked pending a reviewed
history disposition. Any metadata investigation belongs to the coordinator, not this DCC4 run.
