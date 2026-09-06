# Task 6 · Consolidate settings in SQLite and prove upgrade/recovery
<!-- roadmap: p1f-migration-proof -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

**D340 verification scope (2026-09-06).** The immediate mobile-only dashboard proof and
coarse-pointer cleanup is implemented: 12 mobile-only parity cases retired, 257 desktop cases
passed, and unique image/receipt/notification assertions moved to desktop. Consume its desktop-only
parity lane; do not run or restore phone/coarse-pointer variants during settings/upgrade work.
Desktop resizing/accessibility and all backend, migration, credential and safety gates remain.
Ref frontend-backend-integration §10 records the exact proof dispositions.

**Approved Task 1.6.6 execution plan (2026-09-06; D336 binding).** Implement ref
clock-config-secrets §D336 after Task 5. This is the focused binding that D336 delegated to Task 6,
not a new architecture decision. It replaces the previous Task-6 binding to D332's paired
file/SQLite transaction while preserving phase order, completed-task evidence, the existing Settings
command family and wire behavior, and Task 7's integrated/live close.

**Assignment and integration contract.** One supervisor owns all seven sequential steps because the
schema, ordinary authority, credentials, recovery and consumer cutover share one failure boundary.
Implement on branch `codex/phase-1-6-sqlite-settings` in dedicated worktree
`/Users/julianhein/Projects/hr-worktree-sqlite-settings`. Create it from the committed approved-plan
SHA on local `master`; that commit must retain base `c51784995ff7011fffe4524d4fc34f5b335a88d1`,
Task 5 `5f1c6907f002c839b1af95060cdafab9415aff87`, and D340
`3e6a7d1f7607052c407303c2357f70a6828176c7` as ancestors. The primary checkout is shared and remains
integration-only. After an exact-commit fresh `sup_review` PASS and candidate gates, the same
supervisor integrates to local `master`, reruns material-integration gates, converts the operator
root only with the merged code, records evidence, and removes the owned worktree/branch. A
behavior-changing conflict fix requires renewed review. Never push.

**Outcome and exact production owners.** Raise both the upgrade floor and current append-only schema
from 30/31 to 31/32 in `src/infra/sqlite/migrations.ts`. Expand the singleton represented through
`src/domain/config/settings-current.ts`, `src/domain/config/settings.ts`,
`src/domain/authority.ts`, `src/infra/sqlite/authority-database.ts`,
`src/core/command-kernel.ts`, `src/server/dashboard/commands/settings-service.ts`, and
`src/server/settings-runtime.ts` so SQLite atomically owns ordinary values, revision, command result,
audit metadata and authority generation. Revision 1 with empty ordinary settings is represented by
an absent current row. Remove `protected_settings_current` from the v32 current schema/API while
retaining historical command/audit rows.

Move credentials to an independent store rooted at `.tracker/credentials/protected.json`, mode 0600
under a mode-0700 directory and protected by its own lock. The successor credential contracts/store
are owned by `src/domain/config/credential-store.ts` and `src/infra/config/credential-store.ts`; retire
runtime authority in `src/infra/config/settings-file.ts`,
`src/infra/config/protected-settings-journal.ts`, and the ordinary/protected shared-root coupling in
`src/domain/config/settings-root.ts`. Keep one sole credential reader and the existing
`apply-settings` / `apply-protected-settings` public command family with loopback authorization; do
not add a second settings service or public command family.

Add `storage upgrade [--plan] [--json]` through `src/server/storage/upgrade.ts`,
`src/server/storage/compose.ts`, and the existing CLI surface. One invocation orchestrates two
separately settled operations: SQLite ordinary conversion, then independent credential import/setup.
Recovery changes are owned by `src/infra/sqlite/backup-service.ts`,
`src/infra/sqlite/recovery-contracts.ts`, `src/infra/sqlite/offline-restore.ts`, and
`src/infra/sqlite/storage-doctor.ts`. New backups use DB-only manifest v3. Strict v1/v2 backup readers
remain, but restore swaps SQLite without reading, authenticating or changing the credential store.
Migration-only old-layout readers stay under `src/infra/compat/` and are handed to Phase 2.6 for
deletion; production/runtime fallback is forbidden.

Cut all ordinary consumers over in the same candidate: dashboard and worker composition,
dry-run composition/runtime, activity-pseudonym backfill composition, and the two storage smoke
scripts. Update their nearest tests and instructions only if their rules or commands actually change.
The only intended visible change is `src/dashboard/surfaces/settings.tsx`: change the saved-value
source label from `settings.json` to `Saved`. Preserve DOM structure, layout, behavior, control text,
themes, resizing and accessibility. D340 remains desktop-only; do not restore mobile or
coarse-pointer cases.

**Credential settlement contract.** Validate and authorize the request before accessing secrets;
check revision conflict before write-ID replay. The credential store owns revision, last command,
write-ID history and direct replay. Exact command/write ID plus byte-equal values is idempotent;
reusing either identity with different values is command-divergent. A credential commit settles
independently. If the later value-free SQLite audit fails, report a named uncertain-audit outcome and
do not roll back the credential store. Exact retry verifies the store, then records or verifies a
marked SQLite audit. Database restore cannot change credential availability or revision. No
credential values, digests, comparators, lengths or derived identities may enter SQLite, backups,
JSON/text output, logs, snapshots or child environments.

**Admitted inputs and refusal boundary.** A fresh root with no database or migration sources creates
v32 directly with empty authority baselines. Admit common schemas v1–v18; the exact integrated
v27/v28/v29 layouts; the exact v30/v31 D331 layouts; the old state-root settings family; the D331
settings directory; and declared migration environment keys only inside the stopped upgrade command.
An already-settled v32 root is a no-write success. Refuse before conversion: schemas v19–v26,
divergent or ahead schemas, malformed or conflicting sources, live locks, stale/missing required
backup evidence, and unsupported mixed layouts. Preserve `.env`, legacy production, and all D331
sources byte-identically. Report imported key names, source basenames, conflicts and cleanup
requirements without values. The admitted migration environment path is not a runtime fallback.

At plan time, clean local `master` was `c51784995ff7011fffe4524d4fc34f5b335a88d1`; the operator root
was schema v29 / authority generation 91 with a virgin old-layout authority sidecar, no ordinary
settings file and no backup. Server and worker locks were released. Secure bootstrap currently
refuses the migrated `UCPATH_USER_ID` environment key before `storage doctor`; that is an expected
migration input, not permission to print or inspect its value. Reverify every fact at supervisor
start and before operator-root conversion.

**Sequential supervisor steps.** Each numbered step is a verified checkpoint; implementation commits
may combine only adjacent steps when their proof is indivisible.

1. **1.6.6.1 — Schema and contracts.** Add v32, widen `settings_current`, retire the protected
   singleton from the current schema/API, define the independent credential contract, and emit v3
   DB-only backup manifests while retaining strict historical readers.
2. **1.6.6.2 — Ordinary SQLite authority.** Cut the settings executor, command kernel, runtime and
   compositions to SQLite. Prove ordinary settings + command result + audit + authority generation
   commit atomically, including empty revision 1 and failure rollback.
3. **1.6.6.3 — Independent credentials.** Land the sole credential store/reader and prove
   authorization, CAS, exact replay, write-ID uniqueness, divergent reuse, uncertain audit, clear,
   missing-value refusal and next-use behavior.
4. **1.6.6.4 — Upgrade and recovery.** Add the stopped `storage upgrade` plan/apply paths, isolated
   migration-only environment admission, A0/A1 adapters, complete v1–v31 preflight, verified backup,
   interruption/rerun idempotence, restore and doctor behavior.
5. **1.6.6.5 — Consumers, guards and copy.** Remove every production ordinary file reader; activate
   the SQLite-only authority guard and update `docs/rebuild/guard-inventory.json`; bind migration-only
   code to its Phase-2.6 deletion task; apply the exact `Saved` copy change.
6. **1.6.6.6 — Fixture and candidate proof.** Prove fresh, v29, v30, v31, refusal, interruption,
   replay, restore and credential-independence fixtures. Run intended parity red, authorize only the
   expected references, refresh and inspect both themes at all three desktop viewports, then run the
   full candidate gates and submit the exact commit to fresh read-only review.
7. **1.6.6.7 — Integration and operator root.** Only after `sup_review` PASS, integrate the reviewed
   tree to local `master`, rerun all material-integration gates, then use merged code to back up,
   plan and convert the primary `.tracker` root. Run doctor/readback and report keys, conflicts and
   cleanup without values; do not edit `.env`.

**D331/D332/adapter proof disposition.** Retain or rebind D331 P1–P6, P8–P10, P12–P14, P16–P20,
P32–P39 and P41. Replace P7, P21, P22, P26, P28, P29 and P31 with independent-credential proofs.
Replace P11, P15, P23–P25, P27 and P30 because the protected singleton, paired backup, shared lock,
prepare/rollback and file coupling are retired. P40/A8's immediate pathname arm changes the 12
current settings/storage-settings body triples (two themes × three desktop viewports × two scenes)
to `Saved`; A8's full eight-leaf Settings/Setup expansion remains Phase 3.1.

Retain D332 M1–M6, M9, M11–M14, M16, M18–M23, M25 and M26, extending version/backup proof through
v31 and manifest v3. Replace M7, M8, M10, M15, M17, M24 and M27 because coupled settlement, the old
matrix, protected staging, paired restore, sidecar and upgrade-file behavior are retired. A0/A1 are
migration-only and remain assigned for Phase-2.6 deletion. A2/A3 remain unchanged Phase-2.6 work;
A4/A5 closed in Task 5; A6/A7 remain permanent guards.

The highest-risk seam is credential commit before SQLite audit. Inject failure after the credential
rename and before/during audit, then prove exact and divergent retry, SQLite restore, doctor/readback
and the next credential use without exposing values.

- [ ] Store ordinary settings values, revision and successful command/audit records atomically in
  SQLite and remove ordinary file authority plus its sidecars, locks and reconciliation protocol.
- [ ] Keep protected values solely in the independent credential store; preserve truthful outcomes,
  authorization, replay/CAS safety, missing-value refusal and complete value exclusion.
- [ ] Implement planned and backed-up stopped upgrades across every admitted layout, with strict
  preflight, separate credential settlement, no runtime fallback and no source mutation.
- [ ] Preserve run identities/evidence/unknown-write fences and historical backup readability; prove
  failure, interruption, replay, restore and credential independence.
- [ ] Land the mapped proof/guard changes and the exact desktop `Saved` parity update without layout,
  accessibility or unrelated reference drift.
- [ ] Convert the operator rebuild root only after accepted review and merged-code gates, preserving
  `.env`, legacy production and existing local data.

**Gate and evidence schedule.** During iteration, run the narrow owner tests for the changed schema,
settings, credential, upgrade, recovery, composition or UI seam. Every implementation commit must
pass `npm run typecheck`, `npm run lint`, `npm run test:coverage`, and `git diff --check`; run coverage
without compiler/linter contention and use at most four file workers. Run affected generation before
its check. The exact candidate and any materially changed integration tree additionally pass
`npm run build:manifest:check`, `npm run stores:catalog:check`, `npm run roadmap:check`,
`npm run test:architecture`, and `npm run test:parity`, plus fixture upgrade/restore and storage-doctor
acceptance. Parity may refresh generated provenance caused by the candidate, but the only permitted
non-generated body change is the 12 exact `settings`/`storage-settings` triples showing `Saved`; any
other body, layout, control, accessibility, mobile or coarse-pointer change stops the task.
