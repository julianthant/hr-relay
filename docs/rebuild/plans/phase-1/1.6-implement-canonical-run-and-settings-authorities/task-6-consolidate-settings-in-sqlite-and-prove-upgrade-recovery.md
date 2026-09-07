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

**Assignment and integration contract (structure rebound 2026-09-06).** One supervisor owns all seven
sequential steps because the schema, ordinary authority, credentials, recovery and consumer cutover
share one failure boundary. The roadmap now binds this task to this file,
`docs/rebuild/plans/phase-1/1.6-implement-canonical-run-and-settings-authorities/task-6-consolidate-settings-in-sqlite-and-prove-upgrade-recovery.md`; the
retired flat `docs/rebuild/01-build-the-spine.md` is no longer current plan authority.

The assigned branch `codex/phase-1-6-sqlite-settings` and dedicated worktree
`/Users/julianhein/Projects/hr-worktree-sqlite-settings` already exist from approved-plan commit
`9969857a79ba06d07a88b71ba2f0d4d64dc9967e`. Preserve them: at replan inspection the worktree had
uncommitted Task-6 edits in `src/domain/authority.ts`, `src/domain/config/settings-current.ts`,
`src/infra/sqlite/authority-database.ts`, and `src/infra/sqlite/migrations.ts`. Do not reset, recreate,
stash, rebase or overwrite that work. Local `master` subsequently integrated the documentation-only
plan restructuring as `21e085c56449cd03802df0caabede5f22482a40b`; `src/**` is unchanged between
the old plan base and that commit. Before the next implementation edit, the same supervisor must
verify the existing checkout/branch/base and dirty-path ownership, merge the exact structure-rebound
plan commit named in the continuation prompt into the task branch, and confirm that this section is
present at its current path while the four in-flight source edits remain intact. Any unexpected
overlap or unrelated dirty path stops the merge for diagnosis.

The rebound plan commit must retain Task 5 `5f1c6907f002c839b1af95060cdafab9415aff87`, D340
`3e6a7d1f7607052c407303c2357f70a6828176c7`, original approved-plan commit `9969857a79ba06d07a88b71ba2f0d4d64dc9967e`,
and structure integration `21e085c56449cd03802df0caabede5f22482a40b` as ancestors. The primary
checkout remains shared and integration-only. After an exact-commit fresh `sup_review` PASS and
candidate gates, the same supervisor integrates to local `master`, reruns material-integration gates,
converts the operator root only with the merged code, records evidence, and removes the owned
worktree/branch. A behavior-changing conflict fix requires renewed review. Never push.

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

### Task 1.6.6 implementation evidence — blocked on complete-review sizing

Approved plan: `9969857a79ba06d07a88b71ba2f0d4d64dc9967e`. The requested branch
`codex/phase-1-6-sqlite-settings` was created at that exact commit in
`/Users/julianhein/Projects/hr-worktree-sqlite-settings`. The operator's subsequent plan-folder
restructure was incorporated through `e314fb0d3c155bc2823a6f0bf2648a7f9521fbc6`; the original
plan commit remains an ancestor and the four existing implementation files were hash-verified
unchanged during that integration. Implementation candidate: `bd3d0f24816969032d664831b094f03d8fbd7ddc`,
base `e314fb0d3c155bc2823a6f0bf2648a7f9521fbc6`. Status: **awaiting independent review**.
Local master integration requires fresh native `sup_review` PASS on this exact candidate plus every
required gate. No push is authorized.

**Approved amendment.** On 2026-09-06 the operator answered: “Recover known fields; record missing
runNumber.” Released queued roots have no runNumber. D332 §D332.7 and the D332 decision pointer
now record partial recovery, final evidenced attempt, NULL runNumber, and explicit doctor findings.
Zero-root counts remain distinct from missing-runNumber counts. No guessed ordinal is admitted.

**Implementation checkpoints.** Step 1.6.6.1 is verified: schema/admission/recovery focused
checks, typecheck and lint pass. Step 1.6.6.2 is verified by SQLite atomicity, rollback, CAS and replay checks in
`/tmp/hr-settings-settings-closure.log`. Step 1.6.6.3 is verified by all 16 private-store checks and the combined real-restore
uncertain-audit proof in that same run. Step 1.6.6.4 is verified by all 116 upgrade/source/recovery checks in
`/tmp/hr-settings-recovery-closure.log`. Step 1.6.6.5 is verified by the 33 guard checks in `/tmp/hr-settings-guard-closure.log`,
rebound consumer tests and the inspected 12-scene Saved copy update. Steps 1.6.6.1–1.6.6.5
remain subject to complete candidate gates and independent review; the task checkboxes stay open. Step 1.6.6.6 has complete candidate gates and a committed implementation; independent review remains
pending. Step 1.6.6.7 has not begun: no operator backup, conversion or master merge has occurred.
Supporting worker worktrees and branches have been cleaned up as recorded below.

The independent store owns its private history and exact replay. SQLite restore does not alter
it. Historical readers under `infra/compat` are permanent where required for backups; only the four
A0/A1 adapters enumerated in guards §5.2 expire in Phase 2.6. The frozen D331 file writer now lives
only in `tests/fixtures/d331-settings-file.ts`; its historical producer tests are not evidence of
the new runtime protocol. Runtime ordinary settings use SQLite exclusively.

#### Proof mapping

Paths below are relative to `tests/unit/` unless otherwise stated. Retained tests are checked
again by final full coverage/architecture gates; focused passes below describe iteration evidence,
not candidate acceptance. Replacement rows implement the approved D336 disposition above.

| D331 rows | Current oracle / negative control |
| --- | --- |
| P1–P6 | `architecture/settings-catalog.test.ts`, `architecture/runtime-environment-coverage.test.ts`, `config.test.ts`: missing/extra catalog leaves, illegal ownership, hostile environment and fingerprint/provenance exclusion. |
| P7, P21–P22 | `sqlite-settings-authority.test.ts`, `config/credential-store.test.ts`, `server/settings-runtime-reader.test.ts`: marked SQL audit, exact/divergent private replay, retained identity history, no value-derived public comparator. |
| P8–P10 | `config.test.ts`, `architecture/settings-catalog.test.ts`, `config-snapshot-generations.test.ts`: protected paths cannot enter ordinary settings/config; historical reads do not admit new writes. |
| P11, P26–P27 | `sqlite-authority-database.test.ts`, `sqlite-settings-authority.test.ts`, `server/settings-runtime-reader.test.ts`: protected singleton absent; SQLite current values atomic; independent credentials survive missing/restored SQL and revision-one paths create nothing. |
| P12–P14 | `server/settings-runtime-reader.test.ts`, `server/bff-flow.test.ts`, `architecture/strict-boundary-schemas.test.ts`: exhaustive presence-only readback, unchanged facts/schema identities, injected unknown leaves refused. |
| P15 | `storage-backup.test.ts`, `storage-backup-command.test.ts`, `sqlite-settings-authority.test.ts`: v3 database-only sets; strict v1/v2 readers; real restore leaves credentials untouched; secret canaries absent. |
| P16 | `protected-settings-doctor.test.ts`, `storage-upgrade.test.ts`, `sqlite-settings-authority.test.ts`: direct independent presence, read-only observations and uncertain-audit/restore readback. |
| P17–P20 | Existing diagnostic/export tests and `architecture/no-secret-values-in-logs.test.ts`, `architecture/secrets-single-source.test.ts`, `worker-composition.test.ts`: unchanged sinks and forbidden environment publication. |
| P23–P25 | `config/credential-store.test.ts` replaces the runtime shared-file protocol with private ancestry/mode/inode/lock/dead-owner/rename/replay checks. `storage-upgrade-sources.test.ts` and `storage-upgrade-d331.test.ts` retain A0/A1 historical interruption admission at the real upgrade boundary. |
| P28–P31 | `sqlite-settings-authority.test.ts`, `config/credential-store.test.ts`, `command-kernel.test.ts`: request validation, CAS, clear, missing/unknown, direct replay, ordinary rollback and independent uncertain credential settlement. |
| P32–P39 | Existing catalog/environment/snapshot/target guards and `config.test.ts`, `secure-env-bootstrap.test.ts`, `dry-run-scenario-composition.test.ts`, `worker-composition.test.ts`, `server/compose-real-port.test.ts`; source and reader fixtures deliberately rebound. |
| P40/A8 | Exactly 12 settings/storage-settings desktop scenes: intended red, scoped reference update and visual inspection completed; full parity passed 259 cases. Full Settings expansion remains Phase 3.1. |
| P41 | `architecture/redaction-surface-scan.test.ts` and strict schemas; new migration/doctor facts are counts, closed missing-field/exposure literals, run UUIDs, controlled key names and basenames. No protected values or comparators are served. |

| D332 rows | Current oracle / negative control |
| --- | --- |
| M1, M3–M5, M9, M19, M21–M22 | `storage-upgrade-admission.test.ts`, `sqlite-authority-database.test.ts`, `server/compose-real-port.test.ts`, `storage-backup.test.ts`, `storage-restore-drill.test.ts`, `storage-backup-command.test.ts`: all 23 admitted schemas; gap/ahead/divergent/live/stale/corrupt rejection, actual downgrade refusal and strict historical restore; unsupported flags refused before state access. |
| M2, M13–M14 | `storage-upgrade.test.ts`, `storage-upgrade-tombstones.test.ts`, existing snapshot-generation tests: stale claimed row and historical snapshot bytes preserved; retained exposure named without its value; span bytes unchanged; undeclared retirement still refuses. |
| M6 | `storage-upgrade-sources.test.ts`: all three constructible numeric overlaps test equal/unequal/invalid inputs; leaf-disjoint historical CRM routes are preserved beside the imported entry. Historical protected-name/URL overlaps excluded by the old strict grammar are not fabricated as accepted records. |
| M7–M8, M10, M15–M17, M24, M27 | Replaced by `storage-upgrade.test.ts`, `storage-upgrade-admission.test.ts`, `storage-upgrade-d331.test.ts`, `storage-upgrade-sources.test.ts`, `config/credential-store.test.ts`, `sqlite-settings-authority.test.ts`: SQL rollback and post-commit retry; independent rename/audit uncertainty; real SQLite restore and exact/divergent replay; private A0/A1 source authentication; no source rewrite or runtime file matrix. |
| M11–M12 | `storage-upgrade-tombstones.test.ts`: normal/reconstructed/absent/duplicate/mismatched roots; approved partial backfill; attempt watermark; NULL runNumber; doctor findings; rollback; restored trigger refuses every ordinal and identity edit. |
| M18 | `storage-backup-command.test.ts`: real restore drops authority while retaining a fenced stream; doctor marks possibleExternalWrite; service reads absent across repeated opens; only a new run UUID can be enqueued. Registered person-lookup currently contains no transaction node; no new write node is invented. `write-sequencer.test.ts` executes unseen-key probes using each of the three registered separations transaction policies; a changed policy or omitted initial probe is red. Person-lookup’s zero-transaction graph is asserted, not assumed. |
| M20 | `storage-upgrade-environment.test.ts`: all 45 migration inputs and all 50 cleanup names, five retired model names, provider exclusion, source-byte preservation and invalid/duplicate/pseudonym-pair refusals; runtime migrated-name refusal remains in bootstrap/secret tests. |
| M23 | `storage-upgrade.test.ts`: remove exactly one tombstoned gate prefix; retain other gate bytes and the settled tally; journal the removal count and retain delete protection. |
| M25 | `storage-upgrade.test.ts` plus existing real-port/kernel/run-authority tests: actual dashboard activation after conversion; ordinary revision and values match; stale runtime claims/pool starts refuse. |
| M26 | Strict migration/doctor report schemas; possibleExternalWrite is an optional positive closed literal derived only from fenced spans; tombstone finding code/field names and historicalExposure are closed literals, UUIDs are identifier-free. Redaction and strict-boundary guards remain required. |

#### Iteration evidence and remaining gates

The following local `/tmp/` logs record iteration history. The final candidate provenance below
supersedes their provisional state without treating a failed iteration as acceptance.

- `/tmp/hr-settings-coverage-iteration.log`: 5,391 pass / 5 failures across four suites. Stale
  fixture outputs, missing worktree `.env`, and one architecture timeout were investigated;
  `/tmp/hr-settings-backfill-iteration.log` subsequently passed all 67 targeted checks.
- `/tmp/hr-settings-tombstones-proof2.log`: 73 pass across backfill, admission and span reconciliation.
- `/tmp/hr-settings-combination-proof.log`: 44 pass, including uncertain audit → real CLI restore →
  divergent refusal → exact retry → doctor/next-use without credential or backup mutation.
- `/tmp/hr-settings-environment-proof2.log`: six complete-environment/refusal checks pass.
- `/tmp/hr-settings-doctor-guard-fixes.log`: 161 doctor, recovery, strict-schema and redaction checks pass.
- `/tmp/hr-settings-historical-invariants.log`: 66 historical backup/restore/admission checks pass.
- `/tmp/hr-settings-closure-focused.log`: 88 schema, preservation, activation and CLI restore checks pass.
- `/tmp/hr-settings-m18-proof.log`: 59 restore/probe checks pass, including all three registered separations policies and person-lookup’s zero-transaction assertion.
- `/tmp/hr-settings-settings-closure.log`: 133 settings/credential/kernel/reader/real-port checks pass.
- Parity: `/tmp/hr-settings-parity-red.log` captures intended failure;
  `/tmp/hr-settings-parity-update.log` refreshed only the 12 selected PNG/a11y bodies, all visually
  inspected. The filtered wrapper exited 1 because full-suite annotation membership was absent;
  this is not a full parity pass. The subsequent full candidate lane passed 259 cases.

Fresh native independent review, integration full gates, merged-code operator-root
backup/plan/conversion/doctor, final evidence and supervisor-worktree cleanup remain open.
No operator `.env` or legacy production file has been changed.


#### Candidate gates and supporting cleanup (2026-09-06)

Candidate `bd3d0f24816969032d664831b094f03d8fbd7ddc` combines adjacent steps whose schema,
runtime and recovery proofs are indivisible. Its final tested working-tree fingerprint is
`6a5a858e69283028c04d907077a5f7be50c13f19fc7c59a67e5f352c7496414c` (2,117 tracked/nonignored paths;
sorted path, NUL, binary SHA-256 of contents or `<deleted>`, NUL). Per-path evidence is retained at
`/tmp/hr-settings-final-candidate-inputs.json`. This recording changes only this task owner;
implementation, tests, configuration, dependencies and generated inputs remain unchanged.

| Required gate | Result and local evidence |
| --- | --- |
| `npm run typecheck` / `npm run lint` | PASS, exit 0; `/tmp/hr-settings-final-candidate-typecheck.log`, `-lint.log`. |
| `npm run test:coverage` | PASS, exit 0; 5,423 tests / 433 files; statements 85.76%, branches 77.30% (report-only), functions 89.78%, lines 87.89%; all configured floors and suite-size check pass. `/tmp/hr-settings-final-candidate-coverage.log`; four workers, no compiler/linter contention. |
| `npm run test:architecture` | PASS, 827 tests / 79 files, exit 0; `/tmp/hr-settings-final-candidate-architecture.log`. |
| Manifest / catalog / roadmap freshness | PASS, exit 0; `/tmp/hr-settings-final-candidate-manifest.log`, `-catalog.log`, `-roadmap.log`; generation previously completed without generated-output drift. |
| `npm run test:parity` | PASS, 259 desktop cases, exit 0; `/tmp/hr-settings-candidate-parity.log`. Exactly 12 PNGs and 12 corresponding a11y bodies differ, solely the approved Saved copy. No metadata, unrelated body, layout or control drift. |
| Fixture upgrade / restore / doctor | Included in the passing full coverage gate; proof-row mappings above identify real-entry combinations and negative controls. |
| Diff / documentation | Staged diff check PASS; nine existing instruction pairs byte-identical, project chains below 32,768 bytes and all eight relative links in changed documents resolve. |

Parity ran on the working tree captured as provisional `7dac31da3ae35ba66e812085a0c1f4bc3cf6a554`
(fingerprint `025f3140c54cc9154da568576d80f1b71f7c08e5feab1e1e9f1aebe465092597`). Staging exposed
a trailing blank line in a newly added file that the earlier unstaged diff check had not inspected;
the shell continued to the provisional commit. That provisional candidate was never submitted for
review or integration. It was amended after removing the blank line, updating stale operating
guidance, and rerunning typecheck, lint, coverage, architecture and freshness checks. The sole
post-parity code difference is that terminal blank line in `infra/compat/pre-floor-settings.ts`;
all browser source, tests, references, configuration and generated inputs are unchanged, so D191
permits reuse of the complete parity result. No failed check is claimed as passed.

Supporting native workers `/root/sup_sol_credentials` and `/root/sup_sol_recovery` returned drafts
on branches `codex/sqlite-credentials` and `codex/sqlite-recovery`, both based on `e314fb0d` with no
unique commits. Their owned contributions were inspected, incorporated and corrected by the
supervisor, then covered by the candidate gates. The credential worker reported a compaction;
its late guard contribution was accepted only after direct supervisor inspection and rerun, with
no new assignment to that worker. The prior scout was research-only and is not the reviewer.

The two inactive worktrees were classified dirty (65 and 61 task paths). Every draft file was
archived and SHA-256 verified in private `/tmp/hr-settings-supporting-drafts-7dac31da/` before exact
owned paths were restored/removed. Historical helper relocations and supervisor corrections were
accounted for; no unpreserved draft was discarded. Only the inspected node_modules symlinks were
unlinked. Ordinary `git worktree remove` and `git branch -d` succeeded; registrations, physical
paths and both refs are absent. Native workers have no associated sidebar tasks. The supervisor
worktree remains active. Fresh native role-policy check passed (three supporting roles plus one
reviewer); a new independent `sup_review` is required for the entire committed candidate.


#### First independent review — BLOCKED, findings retained

Fresh native `/root/sup_review_sqlite_settings` reviewed base `e314fb0d3c155bc2823a6f0bf2648a7f9521fbc6`,
implementation `bd3d0f24816969032d664831b094f03d8fbd7ddc`, evidence `56de5f197379ba921dc6c3df5485ec0facf77e14`,
and approved plan `9969857a79ba06d07a88b71ba2f0d4d64dc9967e`. It returned BLOCKED after automatic
compaction, not PASS. It must not be reused. The reviewer inspected core authority, credentials,
upgrade and substantial recovery code, but did not complete consumers, populated historical backup
coverage, all doctor/restore paths, every guard/test change, documentation/parity/proof dispositions,
or direct gate-log/fingerprint inspection. Its only rerun checks were read-only Git checks.

| Finding | Required correction | Current disposition |
| --- | --- | --- |
| R1 HIGH — credential-store.ts:208–249,576–605 at reviewed head | Full ancestor ownership/permission verification, raw alias refusal and identity rechecks; P23 negative controls. | Supervisor confirmed. Repair and new writable/foreign-owner/raw-alias/replaced-ancestor tests pass in the focused run; full gates and fresh complete review remain required. |
| R2 HIGH — settings-database-upgrade.ts:175–176,206–209 and storage/upgrade.ts:102–105,131–137 at reviewed head | A crash after SQLite commit but before first credential apply must not import changed protected source bytes with pending identities. | Supervisor confirmed. Private durable import binding precedes SQL commit; missing/divergent binding refuses. Before/after-SQL interruptions, exact retry and binding-loss tests pass; full gates and fresh complete review remain required. |

The repair stays within D336's existing one-time import and independent-commit requirements.
The private binding advances no current credential revision, leaks no comparator and is never
rolled back by SQLite. A new full reviewer must independently inspect the complete changed candidate
and reconcile R1/R2. The predecessor review's covered sections are not a substitute for complete
review. No implementation has been merged and no operator conversion has occurred.


#### Repaired candidate — awaiting fresh complete review

Current implementation head: `4646ab6cede1fea82e38344cc26dad8c4a071533`; complete candidate base remains
`e314fb0d3c155bc2823a6f0bf2648a7f9521fbc6`, approved plan remains `9969857a79ba06d07a88b71ba2f0d4d64dc9967e`.
Both first-review findings remain pending independent verification. A new complete review is required
because the predecessor compacted and the repair changes import replay/order across private storage
and SQLite. It must independently cover the whole candidate, not approve only this correction.

All repaired-candidate gates passed on unchanged input fingerprint
`a156262bdde94dc67015f475ca11a18b6a48d45f0be93335f153a1e599553740`; exact per-path hashes are retained in
`/tmp/hr-settings-r2-inputs.json`. Logs `/tmp/hr-settings-r2-{typecheck,lint,coverage,architecture,manifest,catalog,roadmap,parity}.log`
all report exit 0. Coverage: 5,431 tests / 433 files, statements 85.78%, branches 77.32% (report-only),
functions 89.79%, lines 87.92%, every configured floor and suite-size check pass. Coverage used four
workers without compiler/linter contention. Standalone architecture: 827 / 79. Full parity was rerun:
259 desktop cases, still only the 12 approved PNG/a11y pairs changed against the candidate base.
Generation/freshness, staged diff, nine instruction pairs, project chain sizes and eight relative
links passed. `/tmp/hr-settings-review-fixes-combinations.log` passes 75 focused tests, including
real SIGKILL recovery of a staged private binding, its exact replay and divergent refusal without
applying a credential. The full gate includes these cases and every retained proof.

This evidence-only recording changes no implementation, tests, configuration, dependencies or
other gate inputs; D191 permits reuse of those exact repaired-candidate results. Roadmap freshness
and diff checks run again. Task completion remains open and operator state remains untouched.


#### Second independent review — BLOCKED; return to planning for review sizing

Fresh native `/root/sup_review_sqlite_complete` reviewed the complete candidate base
`e314fb0d3c155bc2823a6f0bf2648a7f9521fbc6`, implementation `4646ab6cede1fea82e38344cc26dad8c4a071533`,
evidence `78c758f7209327659f83a3c4f430d496e80d754c`, approved plan
`9969857a79ba06d07a88b71ba2f0d4d64dc9967e` and approved amendments. It also returned BLOCKED after
automatic compaction. It cannot be reused. This attempt received bounded contract ranges, explicit
avoidance of whole ledgers/full gate logs, rename-aware diff guidance and the complete prior-finding
ledger. The native reviewer configuration was verified as 240,000 context / 220,000 auto-compaction;
no limit or compaction setting was changed.

The second reviewer inspected revision/branch/cleanliness/ancestry, requirements and instructions,
and substantial production code across credentials, upgrade/source recovery, backup inspection/service,
restore/doctor, migrations/SQLite, kernel/settings, consumers, CLI/bootstrap and Saved copy. It inspected
R1's production ancestry checks and R2's private binding order, but could not finish their negative
controls and call-path verification. **R1/R2 remain pending independent closure.** It ran no gates.

Remaining independent coverage: every changed test and guard, guard inventory, remaining consumer/script
hunks, renamed-fixture provenance, all remaining document/decision changes, evidence-only diffs,
D332.7/D330 exact coverage, parity a11y/PNG inspection, and direct gate-log/fingerprint verification.
No new actionable finding was finalized. Two unconfirmed suspicions remain explicit review questions:
older credential replay after failed SQL audit followed by a newer credential write; and pending-upgrade
comparison of model environment values represented only in cleanup names. Supervisor readback found
existing tests deliberately enforce revision-conflict before historical write-ID reuse, while the five
singular `_MODEL` names are declared cleanup-only and not imported. These observations are not an
independent resolution of either question and do not constitute a PASS.

The supervise independent-review rule now requires planning to bound the complete candidate rather
than repeating an oversized review or combining partial verdicts. Preserve all task requirements,
existing implementation, proof mappings and both prior-review ledgers when selecting reviewable units.
The original one-candidate atomic consumer cutover remains the approved scope until the operator
approves a revised binding. No new plan, third reviewer, local master merge or operator conversion
has been started.

**Resume boundary.** The task worktree remains
`/Users/julianhein/Projects/hr-worktree-sqlite-settings`, branch `codex/phase-1-6-sqlite-settings`, with
implementation `4646ab6cede1fea82e38344cc26dad8c4a071533` and passing repaired-candidate gates above.
Only this evidence record changes after `78c758f7209327659f83a3c4f430d496e80d754c`; D191 code-gate reuse
remains valid. Primary master is still `e314fb0d3c155bc2823a6f0bf2648a7f9521fbc6` and clean. Operator
read-only inspection observed v29/generation91, zero pending commands/unresolved writes/pending outbox
or provider reservations, one historical lease, server stopped generation3 and workers stopped
generation2. Revalidate these volatile facts before effects. No operator backup, migration, credential
import, `.env` edit or legacy change occurred. No push occurred. Both supporting worktrees/branches
are removed; only the supervisor worktree remains, with its ignored environment template, build/test
outputs, dependency symlink and parity-report lock. Private supporting-draft archives remain in `/tmp`
as recorded above. All unique resume state lives in this owner; no duplicate handoff document is needed.


#### Approved review-allocation amendment

The reloaded supervise independent-review skill now admits planned focused scopes followed by a
separate integration reviewer. The operator explicitly approved this allocation in the supervisor session on 2026-09-06.
This admits only the review allocation below. Product scope, the one-candidate consumer cutover, all acceptance/proof rows,
required gates, review independence, merged-code operator conversion and cleanup remain unchanged.
The complete candidate continues to use base `e314fb0d3c155bc2823a6f0bf2648a7f9521fbc6` and implementation
`4646ab6cede1fea82e38344cc26dad8c4a071533`; every reviewer receives the same current evidence head,
approved plan/amendments and both BLOCKED-review ledgers. Prior attempts supply no PASS credit.

| Review ID | Complete assigned behaviors and acceptance | Primary source boundaries and proof expectations | Overlap / dependency |
| --- | --- | --- | --- |
| 1.6.6.RA — settings, credentials and consumers | D331 P1–P41 under the existing Task-6 retain/replace dispositions; ordinary atomicity, protected authorization/CAS/history/readback, environment exclusion, runtime next-use/restart, public secrecy, Saved parity and the corresponding task checkboxes. Resolve R1 and challenge the older-audit-retry suspicion. | Current settings/credential domain contracts, command-kernel settings paths, credential-store, settings service/runtime, all dashboard/worker/dry-run/activity/bootstrap/smoke consumers, their tests and settings/secrets/SQLite-authority guards. Inspect every affected settings instruction/contract hunk and all 12 PNG/a11y pairs. Historical schemas/readers are RB-owned, but RA checks their current-runtime callers and inability to admit historical writes. | Shared P15/P16/P23/P41, settings schema migration, source admission/public outputs and private import binding with RB. Inspect the credential side of R2 and preservation across SQLite restore. No gate or proof-row omission is implied by shared ownership. |
| 1.6.6.RB — upgrade, historical authorities and recovery | D332 M1–M27 under existing dispositions; every admitted/refused schema/layout, backup/restore, no source mutation, interrupted conversion, tombstone/evidence preservation, externally uncertain writes, doctor, adapter isolation/expiry and corresponding task checkboxes. Resolve R2 and challenge the cleanup-only model-source suspicion. | All infra/compat modules and immutable historical schemas, v30–v32 migrations and authority inspection/history paths, backup-service/offline-restore/storage-doctor/recovery contracts, storage CLI/coordinator, recovery fixtures/tests/guards, guard inventory and Phase-2.6 deletion/doc changes. Inspect all remaining changed historical-producer tests and rename provenance. | Shared P15/P16/P23/P41, settings schema migration, source admission/public outputs and private import binding with RA. Independently inspect binding-before-SQL and all crash/source-change/restore combinations, including RA-owned backend entrypoints needed to establish ordering. |
| 1.6.6.RI — final integration review | Complete acceptance and changed-boundary coverage mapping; final independent decision only after RA and RB PASS on the final candidate, with no unresolved required finding. | Receive complete diff, plan, all scope verdicts/findings and gate evidence. Independently inspect cross-boundary transactions/order, identity and data propagation, runtime wiring, source/credential/SQLite recovery, value exclusion, tombstone/unknown-write behavior and real-entry proofs. Verify every changed path and proof row has an owner, directly verify all gate summaries/fingerprint and evidence-only diffs, and reconcile both prior-review ledgers. | Depends on both RA and RB PASS. Does not repeat every module-internal check, but independently verifies integration rather than accepting reports alone. Any uncovered acceptance or boundary remains blocked. |

Total: three fresh native `sup_review` assignments, no nested agents. RA/RB may run concurrently
(maximum two review agents); RI runs afterwards alone. Each remains read-only, receives the same
pinned candidate, and must finish its entire assigned scope before compaction. Existing compacted
reviewers are not reused. If native capacity is unavailable, sequence supported fresh dispatches;
never recycle a compacted agent or fabricate retirement. Candidate remains frozen during a round.
After fixes, re-review affected scopes and neighboring boundaries, then integration; unaffected
scope reuse needs exact unchanged-input evidence and RI verification. RA/RB PASS is scoped; only
the final RI PASS plus all scope PASS and required gates permits local master integration.

Execute the admitted allocation in this supervisor session. Local integration and operator-root
conversion remain gated on all required scope and integration verdicts. This approval record changes
no code, tests, runtime configuration, dependencies or gate results; D191 evidence-only checks reuse
the unchanged implementation `4646ab6cede1fea82e38344cc26dad8c4a071533` and its recorded candidate
gates. Roadmap consistency and diff checks apply to this record.

#### Focused round RA/RB — BLOCKED on the frozen 403a3278 candidate

The operator approved RA/RB/RI at evidence HEAD `403a32789cf73132048ac61be4b4473f4f0c277e`.
Fresh native reviewers `/root/sup_review_sqlite_ra` and `/root/sup_review_sqlite_rb` independently
started their complete approved scopes against implementation `4646ab6cede1fea82e38344cc26dad8c4a071533`
and base `e314fb0d3c155bc2823a6f0bf2648a7f9521fbc6`. Both unexpectedly compacted and returned
BLOCKED. Neither may resume substantive review or supply scoped PASS credit. RI was not dispatched.

RA inspected current schemas, SQLite/kernel paths, credential storage/ancestry, ingress/runtime and
principal consumers. Its remaining scope was complete P1–P41 reconciliation, related tests/guards,
shared R2/restore combinations, remaining contract/instruction hunks, all parity pairs, direct gates
and fingerprint inspection. R1 production and negative controls supported the repair, but no complete
acceptance resulted. Historical credential retry after a newer revision appeared deliberately CAS
conflicted; its kernel/public consequences remained unresolved. R2 remained open for independent closure.

RB inspected source admission/recovery, stopped upgrade, conversion/migrations, historical backup,
restore and tombstone/uncertain-write paths. Remaining scope was the complete interruption/source/restore
matrix, historical-producer provenance, recovery tails, guards/inventory/Phase-2.6 docs, M1–M27 mapping
and direct gates/fingerprint. Its source-model suspicion was disproved: singular `_MODEL` variables
are explicitly cleanup-only (50 cleanup names, 45 admitted inputs, 44 imported keys). R2's production
ordering was inspected but complete combination-proof closure remained open.

**R3 (MEDIUM, RB): pre-SQL interrupted retry plan could approve divergent private input.** After
binding credentials and interrupting before SQL COMMIT, SQLite remained pre-v32 while the binding
survived. Changing protected bytes then running `--plan` returned `planned`; apply later refused.
`src/server/storage/upgrade.ts` only verified the binding on the pending-v32 arm. The supervisor
reproduced this with `npm test -- tests/unit/storage-upgrade.test.ts`: one failure, 15 passes,
`Missing expected rejection` at the plan assertion (`/tmp/hr-settings-r3-red.log`).

The repair adds read-only `verifyUpgradePreflight` to the concrete private store and checks the
in-memory conversion's exact upgrade identity before pre-v32 plan/apply proceeds. A first import
with no binding remains admissible without creating a store. A surviving binding must match even
if all protected inputs were removed or ordinary inputs changed. Post-SQL missing-binding refusal
remains strict; the existing binding-under-lock check remains before SQL COMMIT. Tests cover plan
and apply after both pre/post-COMMIT interruption, exact retry, changed protected bytes, removed
protected input, changed ordinary input, and unchanged database/private/source bytes. One expanded
fixture initially used an undeclared environment name and was corrected to the declared
`HRAUTO_DEFAULT_WORKERS`; that fixture failure was not counted as regression proof.

#### Repaired candidate 466f1f8e — gates passed, independent review still open

Implementation HEAD is `466f1f8edd4251bf31f4e7dfc7abdd9c38f996b2`, based on approved evidence
`403a32789cf73132048ac61be4b4473f4f0c277e`. R3 changes exactly the private credential backend,
storage upgrade coordinator and upgrade tests (three files, 41 insertions/one deletion). R1/R2/R3
remain subject to fresh independent closure; no partial reviewer report is converted into acceptance.

| Gate | Verified result on the repaired implementation |
| --- | --- |
| Focused combined recovery | 81 tests / six files PASS, exit 0, `/tmp/hr-settings-r3-combinations.log`; credential backend, upgrade, D331 input, environment, restore and doctor together. |
| Typecheck and lint | Both exit 0, `/tmp/hr-settings-r3-typecheck.log` and `/tmp/hr-settings-r3-lint.log`. |
| Full coverage | 5,433 tests / 433 files PASS, exit 0, `/tmp/hr-settings-r3-coverage.log`; statements 85.78%, branches 77.33% report-only, functions 89.80%, lines 87.92%; all configured floors and suite-size checks pass. Four workers; no compiler/linter contention; 190.6 seconds. |
| Architecture | 827 tests / 79 files PASS, exit 0, `/tmp/hr-settings-r3-architecture-exclusive.log`, 36.2 seconds. An earlier concurrent parity/architecture run timed out the `no-lifecycle-sql-outside-the-adapter` injected-violation case at its unchanged 30-second limit (826 passed/one failed, `/tmp/hr-settings-r3-architecture.log`). Rerunning alone with unchanged inputs, workers, assertions and timeout passed. Serialize architecture and parity for subsequent gates because this resource conflict is now evidenced. |
| Desktop parity | All 259 cases PASS, exit 0, `/tmp/hr-settings-r3-parity.log`; no reference changes. |
| Manifest/catalog/roadmap | Generation left the build manifest unchanged. All three freshness checks and diff check pass, exit 0, `/tmp/hr-settings-r3-freshness.log`. |
| Input/evidence binding | 2,117 paths; fingerprint `f850e29d4959b54392b5b7e79c3d6594a19a3c7e8ce2e163b99c923320269fb0`, `/tmp/hr-settings-r3-inputs.json` and `/tmp/hr-settings-r3-sha256.txt`. Relative to R2 only these three implementation files and the task-owner evidence differ. R2's recorded fingerprint was independently recomputed exactly. |

The fingerprint covers the implementation commit before this evidence-only append. This append
changes only the task owner: D191 reuses the above unchanged implementation/gate inputs; roadmap,
relative-link, existing instruction-pair/size and diff checks apply to the recording commit.
Primary master remains clean at `e314fb0d3c155bc2823a6f0bf2648a7f9521fbc6`. No operator backup,
conversion, credential import, `.env` edit, legacy access/change, merge or push occurred. Step .7
is wholly pending. Existing task worktree/branch and ignored owned artifacts remain as previously
recorded. The two supporting worktrees/branches remain removed. No app-task archival is applicable.
This owner contains the complete resume state; there is no additional unique handoff artifact.

#### Approved smaller review allocation

The approved two-scope allocation still exceeded the effective context available to both reviewers.
The operator explicitly approved this replacement in the supervisor session on 2026-09-06.
Do not send either unchanged scope to another reviewer. This allocation replaces RA/RB/RI with six
smaller behavioral scopes and a separate fresh integration review, while keeping one implementation
candidate, all acceptance requirements, every existing proof disposition and all gates unchanged.
Prior partial reviews remain finding ledgers only. Every new reviewer independently covers its whole
scope; none is assigned an exhausted reviewer's unreviewed tail.

| Review ID | Complete behavior and acceptance ownership | Production, proof and overlap boundaries |
| --- | --- | --- |
| 1.6.6.RA1 — ordinary SQLite authority | D336 ordinary transaction; D331 P1–P6, P8–P11 ordinary arm, P26/P28–P30 ordinary arms, P33 ordinary generation, P36–P38; M14 snapshot model. | Current settings/domain contracts, current settings row and migration, ordinary command-kernel/service paths, resolver/fingerprint/snapshots; corresponding unit/schema/catalog/SQLite-authority guards and removed-proof dispositions. Overlap RA2 at the common settings executor and generation isolation; RA3 at runtime activation; RB2 at v32 conversion and historical/current schema separation. |
| 1.6.6.RA2 — credential authority and command settlement | D336 independent private authority, authorization/CAS/history/replay/uncertain audit; D331 P7, P11 protected arm, P21–P31 protected/private arms; R1 and older-audit-retry closure. | Entire credential backend/domain contract, protected command-kernel/service path, sole reader and related credential/kernel/secrecy tests. Verify entry authorization before reads, private protocol, historical identity reuse, clear/missing behavior, independent audit outcomes. Overlap RA3 at ingress/readback/next-use/environment exclusion; RB2 at R2/R3 binding/retry order; RB3 at restore and doctor independence. |
| 1.6.6.RA3 — runtime consumers, environment and Settings UI | D331 P12–P14, P17–P20, P32, P34/P35/P40; P33 runtime/claim arm; M3 boot refusal and M25 activation. | Settings runtime, dashboard/worker/dry-run/activity/bootstrap/smoke compositions and all changed nearest consumer tests, ingress/readback contracts and guards. Inspect all 12 PNG/a11y pairs against the exact Saved-only change and full desktop parity result. Overlap RA1/RA2 at current reads/authorization/next-use; RB1 at migration-only environment admission; RB2 at post-upgrade activation; RB3 at public storage readback. |
| 1.6.6.RB1 — migration sources and historical grammars | D332 M4 source-preflight arm, M6, M20, M21 source/lineage arm, M24, M27 source-private arm; A0/A1 isolation and expiry. | Upgrade source readers, old-file reconciliation, immutable settings/command grammars and D331 compatibility modules; source/environment/D331/admission tests, all remaining changed historical-producer tests and rename provenance. Own adapter guard/inventory/Phase-2.6 deletion changes. Overlap RA3 at no runtime fallback; RB2 at full source admission and protected binding; RB3 at permanent historical backup readers. Reconcile the disproved cleanup-only model suspicion from primary evidence. |
| 1.6.6.RB2 — stopped conversion and interrupted settlement | D332 M1/M2, M4 ordering, M5 upgrade prerequisite, M7/M8/M10–M13/M15/M16/M19/M21 conversion/M23/M25; R2 and R3 closure. | Full SQL conversion/coordinator/upgrade CLI, v30–v32 migrations, tombstone and orphan recovery; complete upgrade interruption/source-change/retry matrix, lifecycle/evidence preservation and related guards. Independently inspect binding before COMMIT, pre-SQL plan validation, post-SQL strict binding, audit/settlement, and no forbidden writes. Overlap RA1 at atomic ordinary state, RA2 at private credential operations, RA3 at boot activation, RB1 at source/private admission, RB3 at backup identity/restore/doctor. |
| 1.6.6.RB3 — backup, restore and doctor | D331 P15/P16 and restore parts of P23/P27; D332 M3 read-only storage arm, M5 backup verification, M9, M14 retained history, M17/M18/M22/M26 storage output. | Historical backup inspector, backup writer/manifests, offline restore, doctor and recovery contracts plus all changed recovery tests/guards. Verify v1/v2 readers/v3 writer, admitted/refused versions, no credential copy or rollback, read-only observation and tombstone/unknown-write truthfulness. Overlap RA2 at private independence, RA3 at public outputs, RB1 at frozen grammars, RB2 at upgrade backup identity and source/restore combinations. |
| 1.6.6.RI2 — final independent integration decision | Complete task acceptance, all D331/D332 dispositions and changed-boundary coverage; starts only after all six scopes PASS on the final candidate. | Independently inspect cross-boundary transactions/order, identity/data propagation, real-entry proofs, shared binding/source/credential/SQL recovery, runtime wiring, value exclusion and tombstone/unknown-write fences. Reconcile every focused verdict and R1–R3/suspicion ledger with code. Verify complete path/proof ownership, all gate summaries/fingerprints, evidence-only diffs, exact candidate and integration conditions. Do not repeat module-internal review, and do not accept reports without checking integration code. |

P39 (proof preservation), P41 (D183 wire disposition), M26 (new public leaves), changed instruction/
contract hunks and relevant gate evidence belong to every scope whose behavior they affect. Shared
proof rows are intentionally checked at both sides and by RI2. Unchanged baseline guards may be
reused as evidence only after the reviewer verifies applicability; no required proof disappears.
Historical contract sections superseded by D336 are read only for admitted input grammar or retained
invariants. Reviewers start with the task's existing proof map and exact changed hunks, expand relevant
callers as necessary, and avoid wholesale ledger/test/log dumps. This changes input routing, not depth
or acceptance. Every uncovered requirement or boundary keeps acceptance open.

Total: seven fresh native `sup_review` assignments; no nested agents. At most two focused reviewers
concurrently, on the same pinned candidate; RI2 afterwards alone. Native capacity shortages serialize
fresh dispatch. Each assignment must finish in one context; a failed fit returns to planning rather
than silently adding reviewers. After fixes, affected scopes and neighbors require renewed review,
followed by RI2; any unaffected carry-forward needs exact unchanged-input evidence independently
verified by RI2. No merge, operator conversion or active-worktree removal until accepted review and
required gates. The replacement round is admitted. This approval-only record reuses implementation
`466f1f8edd4251bf31f4e7dfc7abdd9c38f996b2` and its unchanged gate inputs under D191; roadmap and
diff checks pass before committing the record.

#### RA1/RA2 stop boundary and repaired candidate 1a9484ad

Both dispatched scopes in the approved smaller round returned **BLOCKED** after automatic
compaction, on implementation `466f1f8edd4251bf31f4e7dfc7abdd9c38f996b2` and evidence
`dcc55729edea7c46689bba61402a1a20b8380ec5`, against base
`e314fb0d3c155bc2823a6f0bf2648a7f9521fbc6`. Neither result provides scoped or whole-task acceptance.
The supervisor preserved the findings and repaired them before requesting another process decision.

| Reviewer | Observed findings and uncovered scope |
| --- | --- |
| `/root/sup_review_sqlite_ra1`, native `sup_review` | MEDIUM R4: grouped settings merge throws before typed cross-field classification. MEDIUM R5, initially unresolved: delayed ordinary replay depends on the overwritten singleton, and divergent journal identity escapes as a generic error. Unreviewed: remaining strict-boundary hunks, inventory dispositions, full P36 negative control, affected migration/history tests, removed-proof reconciliation, gate logs/fingerprint and final RA1 coverage mapping. |
| `/root/sup_review_sqlite_ra2`, native `sup_review` | HIGH R6: after credential commit and failed SQLite audit, HTTP retry receives a new server timestamp and cannot authenticate its original private request. Unconfirmed R7: second fstat omits mode/UID/link-count equality. Unreviewed: R1–R3 closure, older uncertain-audit retry after a newer credential write, complete R7 challenge, remaining guards/docs, gate-log/fingerprint verification and final identity check. |

RA3, RB1, RB2, RB3 and RI2 were not dispatched. No compacted reviewer was resumed. The approved
allocation's own stop rule returns failed sizing to planning; another unchanged RA1/RA2 assignment
would repeat the demonstrated failure. Earlier R1–R3 and the two recorded suspicions remain in their
existing ledger, pending independent reconciliation. The newer-code repairs below are supervisor
verification, not independent closure of any finding.

Implementation `1a9484ad3e52fef7452ce781fc2e86470b2bbbf7` changes seven production and six test
files (223 insertions, 30 deletions), adding 18 regression cases. No guard or threshold was relaxed.

| ID | Repair and deciding proof |
| --- | --- |
| R4 | Merge and resolver validation share typed cross-field classification, preserving sorted issue paths. Four real BFF cases cover incomplete display/annual-date set and clear, exact 422 refusal and unchanged settings, credentials, journal, audit and generation. |
| R5 | The command kernel authenticates the immutable ordinary audit request/result and returns the original revision/fingerprint after a later command advances current settings. Divergent journal content produces `command-divergent`. The A/B/retry test checks the original result, typed divergence and unchanged B/current generation. The initial repair read the audit from the service; full coverage caught the existing single-command-owner guard. Audit access was moved into the kernel, and the service replay interface now covers credentials only. The guard remains unchanged. |
| R6 | Authorized, validated protected ingress recovers the original value-free acceptance time from the private store when SQLite has no journal. It retains complete private request/value equality. Real HTTP set/clear tests inject post-credential audit failure, advance the clock, refuse divergent values, then settle and replay the exact request without rewriting private bytes or leaking values into the audit. Real SIGKILL tests cover both sides of rename: authenticated uncommitted staging is discarded, while a committed request retains its original time. The command lookup uses the existing owned lock/reaper; read-only credential observation and doctor remain read-only. |
| R7 | Both private-document and lock readers compare second-fstat mode, UID and link count, in addition to existing inode/size/time checks. Six negative controls independently change one post-read field while leaving times and bytes unchanged, requiring a named integrity refusal and unchanged evidence. Three private-document controls failed before the repair. Lock controls deliberately enter through apply, since read-only observation does not read lock contents. |
| R8 — neighboring validation order | Ordinary schema/fingerprint validation runs before authority access, and ingress validates ordinary/protected schema identity before journal or private retry lookup. Two kernel controls fail if authority is reached; a real BFF case proves invalid schema/value and foreign Origin cause zero journal/private lookup calls and no durable changes. Both kernel controls reproduced forbidden authority access before the repair. |

Red evidence: `/tmp/hr-settings-r4-r6-red.log` (six failures/152 passes: four grouped patches,
delayed ordinary replay and advancing-clock HTTP retry), `/tmp/hr-settings-r7-red.log` (three
failures/21 passes), and `/tmp/hr-settings-r4-r8-iteration.log` (two failures/182 passes).
The divergent ordinary assertion was not reached in its initial red test; it is covered in green.
Iteration also corrected test-only fixture mistakes: branded hash/time construction, using apply
to observe lock reads, the pre-rename discard expectation, and lowercase `origin` header override.
Those fixture failures are not claimed as production defects. The first full run is preserved at
`/tmp/hr-settings-r4-r8-coverage-audit-owner-failure.log`: one guard failure/5,450 passes, 433 files.
The final implementation keeps that guard's audit-owner boundary intact.

| Gate on implementation 1a9484ad | Result and evidence |
| --- | --- |
| Combined repairs and neighboring boundaries | 290 tests/seven files PASS, exit 0, `/tmp/hr-settings-r4-r8-combinations-final.log`, 15.2 seconds. Includes real SQLite settings, BFF, credential store, kernel, upgrade, runtime reader and command-owner guard. |
| Typecheck / lint | Both PASS, exit 0, `/tmp/hr-settings-r4-r8-typecheck.log` and `/tmp/hr-settings-r4-r8-lint.log`; rerun after the audit-owner repair. |
| Full coverage | 5,451 tests/433 files PASS, exit 0, `/tmp/hr-settings-r4-r8-coverage.log`, 178.9 seconds. Statements 85.79%, branches 77.35% report-only, functions 89.80%, lines 87.94%; configured floors and suite-size check pass. Four workers, no compiler/linter contention. Full run includes the fixture upgrade, restore and doctor suites. |
| Standalone architecture | 827 tests/79 files PASS, exit 0, `/tmp/hr-settings-r4-r8-architecture.log`, 32.3 seconds, run exclusively after coverage. |
| Desktop parity | 259 PASS, exit 0, `/tmp/hr-settings-r4-r8-parity.log`, 56.9 seconds, run after architecture. No reference or generated-provenance changes. |
| Freshness / diff | `build:manifest:check`, `stores:catalog:check`, `roadmap:check` and `git diff --check` PASS. Manifest and catalog reported current in captured command output; `/tmp/hr-settings-r4-r8-roadmap.log` records the roadmap check. Earlier generation is recorded at `/tmp/hr-settings-r4-r8-generate.log`; final checks were rerun after the audit-owner repair. |
| Input binding | 2,117 paths; fingerprint `d892751aec04c46f4e9796a7c7ebd18032925994b2d95b6957912c7c946fd842`, `/tmp/hr-settings-r4-r8-inputs.json` and `/tmp/hr-settings-r4-r8-sha256.txt`. Relative to R3 only the 13 repair paths and this task owner's prior approval evidence differ. R3's fingerprint was independently recomputed exactly. |

The input manifest binds the implementation before this evidence append. This recording changes
only the task owner; D191 reuses unchanged code gates, with roadmap, relative-link, existing twin/
instruction-size and diff checks for the evidence commit. Nine instruction pairs remain identical;
the maximum project instruction chain is 15,457 bytes, below 32,768. No implementation is accepted
merely because these gates pass. Status remains **awaiting independent review**.

#### Approved standalone review exception

The operator explicitly approved the following exception in the supervisor session after evidence
commit `f65453c39b03928dff9039c1cfb345ec3551f219`. It replaces the six focused scopes plus RI2.
All six prior blocked review attempts remain findings/evidence only; none supplies PASS credit.
No role configuration is changed. The supervisor will record the created standalone task's identity
with its verdict after holding this approval commit stable throughout review.

Replace the six-scope/RI2 allocation and native `sup_review` dispatch requirement for Task 1.6.6
only with **one fresh, independent standalone `/review` task using GPT-5.6 Sol at high reasoning**.
Create it in the saved rebuild project directly, with a read-only assignment to the existing frozen
task checkout above. It receives the exact approved requirements/amendments, base and final candidate
SHA, the proof map and separate prior-finding ledger, and gate/input evidence; no implementation
conversation. It must inspect the complete candidate, relevant callers, all D331/D332 dispositions,
changed tests/guards/contracts, cross-boundary recovery, all 12 Saved PNG/a11y pairs and gate evidence.
Every changed path and required proof row must have a recorded disposition. Prior summaries are
navigation aids, never acceptance evidence. Nothing in the product scope or gate requirements changes.

For this standalone review only, explicitly permit continuation across automatic compaction.
Keep a complete coverage/finding checklist in that task's visible progress, reopen primary code and
evidence after a resume where necessary, verify the frozen candidate and full checklist before the
final verdict, and never infer PASS from a compacted summary or omit unfinished scope. The task stays
read-only: no edits, commits, write-producing gates, external effects or delegation. Necessary gates
return to this supervisor. No context cap is increased and compaction is not disabled. This is an
explicit exception to the one-uncompacted-context review rule, not a claim that the failed native
reviewers completed. Native reviewers cannot use it because their role instructions require stopping.

The standalone review's exact-candidate PASS, complete coverage and closure of all required findings
would replace focused/RI2 acceptance. CHANGES REQUIRED or BLOCKED keeps finalization closed; the
supervisor owns repairs, appropriate gates and renewed independent review. Local integration,
merged-code gates, operator-root backup/plan/upgrade/doctor, completion evidence and cleanup remain
unchanged and authorized only after accepted review. No push. This exception is now admitted;
do not launch another superseded allocation or self-approve.

**Resume boundary and residue.** Candidate `1a9484ad3e52fef7452ce781fc2e86470b2bbbf7`; primary
master remains clean at `e314fb0d3c155bc2823a6f0bf2648a7f9521fbc6`. Steps .1–.5 are implemented
and gated, subject to independent acceptance; .6 review remains open; .7 has not started. No master
merge, operator-root backup/conversion, credential import, `.env` change, legacy access/change or push
occurred. Reverify volatile operator state after accepted review and merged-code integration gates.
The two supporting worktrees/branches remain removed; their recorded private archives remain.
Retain the active task worktree/branch, owned ignored artifacts and diagnostic logs pending finalization.
Failed test-run scratch recorded by the logs is retained for diagnosis and must be considered in owned
cleanup; do not sweep unrelated runs. Completed native reviewers are closed to further assignments.
No app-task archival applies yet. This owner contains the complete durable continuation state, so no
separate handoff file is needed.


#### Complete standalone review and R9 repair

The approved standalone reviewer is **Review Task 1.6.6 SQLite settings**, task
`01a07a45-50d7-7d01-bd47-672d3dfa1720`, host `local`, GPT-5.6 Sol/high. Its complete review
of base `e314fb0d3c155bc2823a6f0bf2648a7f9521fbc6`, implementation
`1a9484ad3e52fef7452ce781fc2e86470b2bbbf7` and evidence HEAD
`0a9f901cc1c8a07401bacb01d6d1a5a967fc8b44` returned **CHANGES REQUIRED**. It dispositioned all
116 changed paths (37 production, 43 unit/fixture, 25 parity, seven docs, three scripts and one
repository reference), all D331 P1–P41 and D332 M1–M27, supported R1–R8 independently, and verified
the recorded gates and input fingerprint. All 12 PNG pairs had zero changed rendered pixels;
a11y changes were limited to Saved copy. P28–P31 remained open solely for R9.

**R9 — HIGH, global command identity across independent credential settlement.** Protected prepare
could commit credentials before discovering that another command already owned the SQLite ID.
The inverse history also failed: after a private commit and failed SQLite audit, a foreign command
could acquire the ID and permanently strand exact retry. The reviewer explicitly confirmed that
ownership must survive this window, including concurrent writers; no contract requires immediate
operator retry. This is an implementation defect, not new scope or an amended credential contract.
The two isolated reproductions are recorded in `/tmp/hr-settings-r9-collision.log` and
`/tmp/hr-settings-r9-history.log`; the tracked regression run
`/tmp/hr-settings-r9-red.log` produced two failures before repair.

The repair admits global identity under the existing SQLite BEGIN IMMEDIATE writer transaction
before protected prepare. Credential settlement remains independent: SQL rollback never undoes
private history. The sole credential backend exposes a value-free history-membership check, and
the shared SQLite command journal refuses foreign IDs retained there, including its internal
lifecycle writers. Request/schema validation still precedes authority access. Existing private
history also protects IDs after DB-only restore. Only a successful private prepare can produce
credential-audit-uncertain; a pre-commit identity refusal is typed command-divergent.

Focused proofs now cover existing foreign ownership with zero credential/SQL effects, foreign
reuse after audit rollback, a competing process blocked during the private commit, rejection by a
second process after rollback, internal lifecycle insertion, real HTTP set/clear retries and foreign
run commands, and restore followed by foreign refusal and exact settlement. BFF fixtures now place
the database beside credentials under their actual state root; their SQL inspection paths and
empty-root doctor expectation follow that layout. Audit-failure injections occur inside the SQL
transaction after the callback, preserving the actual private-commit/SQL-rollback boundary.
`/tmp/hr-settings-r9-combinations-iteration4.log` passed 275 tests in five files (14.32 seconds).
The wider final gates and renewed independent review remain pending; no R9 acceptance is claimed.

Primary master remains unmerged. No operator-root conversion, .env edit, legacy access or push has
occurred. Steps .1–.5 remain implemented subject to final acceptance; .6 R9 gates/review and all of
.7 remain open. The standalone reviewer may receive the repaired committed candidate under the
already approved exception. Preserve the task worktree and branch until finalization.


The first R9 full gate (`/tmp/hr-settings-r9-coverage.log`, run-p8Fyxy) failed after 225 seconds:
two unchanged lifecycle-guard scans exceeded their 30-second limits under four workers, and the
restore drill seeded an ordinary command with the same fixture ID as its independently applied
credential. The latter fixture now uses distinct command IDs; all restore assertions remain intact.
The retry uses the same contained Vitest coverage runner and suite-size check with an explicit
two-worker CLI limit. No suite membership, assertion, timeout, isolation rule or coverage floor is
changed. Failed scratch is retained for the final exact-owned cleanup audit.


The focused restore/identity/lifecycle check passed 37 tests in three files, including unchanged
lifecycle scans at 10.1 and 9.3 seconds (`/tmp/hr-settings-r9-recovery-guard.log`). The second full
attempt (`/tmp/hr-settings-r9-coverage-two-workers.log`, run-WTLubT) passed 5,453 tests but retained
the two 30-second guard timeouts. Inspection of the installed Vitest resolver confirmed that
inherited per-project `maxWorkers: 4` takes precedence over the root CLI override; observed child
processes were still four. Thus that attempt did not demonstrate reduced concurrency.
The corrected gate-only config `/tmp/hr-settings-r9-two-workers.config.mts` imports the unchanged
repository config and sets root and each project's worker count to two. It asserts deep equality
after removing precisely those overrides. This changes resource scheduling only and is not a
repository/configuration edit or a relaxed acceptance gate. The full contained coverage runner and
suite-size check are repeated with this effective override; their final result follows below.


#### R9 candidate gates — awaiting renewed independent review

Implementation **`c1fb29917935f33ca014f78a64cc121fa1550b4b`** contains the complete R9 repair. Base remains
`e314fb0d3c155bc2823a6f0bf2648a7f9521fbc6`; the original approved plan is
`9969857a79ba06d07a88b71ba2f0d4d64dc9967e`, with the recorded structure/decision/review amendments.
The renewed reviewer must close R9 and reconfirm complete candidate acceptance; passing gates alone
is not acceptance. All completion checkboxes remain open.

| Gate | Evidence |
| --- | --- |
| Typecheck / lint | Both PASS on final repair inputs; `/tmp/hr-settings-r9-typecheck.log`, `/tmp/hr-settings-r9-lint.log`. |
| Neighboring combinations | 275 tests / five files PASS, `/tmp/hr-settings-r9-combinations-iteration4.log`; the later restore-fixture correction and lifecycle guard passed 37 tests / three files in `/tmp/hr-settings-r9-recovery-guard.log`. Full coverage below includes the wider runtime-reader and single-command-owner neighbors. |
| Full coverage and suite size | 5,455 tests / 433 files PASS, 359.88 seconds; statements 85.79%, branches 77.35% report-only, functions 89.81%, lines 87.94%; all configured floors and the chained suite-size check pass. `/tmp/hr-settings-r9-coverage-effective-two.log`. Command: `npm test -- --coverage --config /tmp/hr-settings-r9-two-workers.config.mts && node --import tsx scripts/suite-size.ts`. |
| Standalone architecture | 827 tests / 79 files PASS, 69.00 seconds; `/tmp/hr-settings-r9-architecture.log`. Command: `npm run test:architecture -- --config /tmp/hr-settings-r9-two-workers.config.mts`. |
| Desktop parity | All 259 PASS, 65.6 seconds; `/tmp/hr-settings-r9-parity.log`. No reference changes. Architecture completed before parity started. |
| Freshness / scoped evidence | Manifest, store catalog and roadmap checks PASS in `/tmp/hr-settings-r9-manifest.log`, `/tmp/hr-settings-r9-catalog.log`, `/tmp/hr-settings-r9-roadmap.log`; nine instruction twins identical, maximum chain 15,457 bytes, one owner-relative link valid, diff check PASS. |
| Resource override | Temporary config SHA256 `803dac79b5caed1c6934d2034c2f4c834f6b4a6a6794b807a6c8a067c27303ca`; imports the committed repository config and asserts that only root/per-project worker counts differ. Two actual workers observed. Full coverage had no compiler/linter contention; no gate setting besides concurrency changed. |
| Input binding | 2,117 paths; fingerprint `5f29e14c958cee52b3df04f2f8a2f3d058f727cbdab60b9c8a581bda17e5a3d4`, `/tmp/hr-settings-r9-inputs.json` and `/tmp/hr-settings-r9-sha256.txt`. The R4–R8 fingerprint was recomputed exactly; only ten R9 production/test paths and the owner evidence differ. |

This fingerprint covers implementation commit `c1fb29917935f33ca014f78a64cc121fa1550b4b` before this evidence-only append.
D191 permits reuse of the unchanged implementation gates for the recording commit, with scoped
instruction/link, generated-output and diff checks. No implementation, test, dependency, configuration,
reference image or acceptance requirement changes in this append. The full independent reviewer
remains task `01a07a45-50d7-7d01-bd47-672d3dfa1720` under the approved standalone exception.

The operator root was rechecked read-only at v29 / generation 91 with unchanged nonempty-table
counts, no independent credential file, and no listeners on 3938/5174. These are preflight facts,
not byte-preservation evidence. Exact row/file preservation will be checked across merged-code
backup/plan/upgrade/doctor after integration gates. The prepared operator verification script has
not been executed; it retains source comparison bytes only in memory and emits names/counts/states.


#### Renewed R9 review — async zero-effect proof

The same independent Sol/high task returned **CHANGES REQUIRED** on implementation
`c1fb29917935f33ca014f78a64cc121fa1550b4b` / evidence
`8ab94c44cad7ca72c281dec68b07eea3c8b2ff83`. It verified the gates, resource override and input
fingerprint and dispositioned all 117 changed paths (38 production, 43 unit/fixture, 25 parity,
seven docs, three scripts, one repository reference). It corrected its interim R9 delta count to
five production paths, five tests and the owner. The review resumed under the approved exception,
caught an initial primary-checkout cwd before drawing conclusions, and rechecked the pinned worktree.
P1–P41, M1–M27 and R1–R8 remained supported. The reviewer found no new production defect and
supported R9's synchronous/lifecycle/cross-process/history/restore behavior, but required a P2 proof:
exercise a retained credential ID through the asynchronous worker-pool kernel and prove refusal
before its external process seam. A phase-C refusal alone could otherwise hide a prior effect.

`tests/unit/sqlite-settings-authority.test.ts` now creates real credential history by committing
privately and failing its SQL audit, then sends that ID through `executeWorkerPool` with a valid
worker-count request and recording process seam. It requires typed command-divergent, zero effect
calls, no journal/audit/pool/generation mutation, unchanged credential bytes/readback, and successful
exact private retry. A fresh-ID positive control reaches the same process seam and applies, proving
that valid setup can reach the effect. The focused file passed 15 tests in
`/tmp/hr-settings-r9-async-green.log`. Temporarily removing only phase A's identity check produced
the intended `1 !== 0` forbidden-effect failure while phase C still returned command-divergent
(`/tmp/hr-settings-r9-async-negative-control.log`); exact production bytes were restored and verified
against HEAD. This addition changes only the test and evidence, with no production fix or contract
change. Required gates and renewed independent acceptance remain open; no integration or operator
conversion has occurred.


#### Async proof candidate gates — awaiting renewed independent review

Candidate **`024b34e12803120d57ee3f629ffdcb42bc8a34fd`** adds only the async unit proof and its owner evidence to the prior
reviewed tree. Production, contracts, guards, configuration and parity inputs remain byte-identical
to `c1fb29917935f33ca014f78a64cc121fa1550b4b`. All 117 candidate paths remain in review scope;
only the P2 async zero-effect proof is newly changed. No operator-root write or integration occurred.

| Gate | Evidence |
| --- | --- |
| Typecheck / lint | PASS; `/tmp/hr-settings-r9-async-typecheck.log`, `/tmp/hr-settings-r9-async-lint.log`. |
| Focused proof / negative control | 15 tests PASS in `/tmp/hr-settings-r9-async-green.log`; removing only phase-A admission yields exactly one forbidden effect in `/tmp/hr-settings-r9-async-negative-control.log`. Production bytes were restored exactly before subsequent gates. |
| Full coverage / suite size | 5,456 tests / 433 files PASS, 331.74 seconds; statements 85.79%, branches 77.36% report-only, functions 89.80%, lines 87.94%; all configured floors and suite-size check PASS. `/tmp/hr-settings-r9-async-coverage.log`. Same contained coverage/suite-size commands and verified two-worker config as the prior candidate. |
| Standalone architecture | 827 tests / 79 files PASS, 56.99 seconds; `/tmp/hr-settings-r9-async-architecture.log`. |
| Desktop parity | All 259 PASS, 55.4 seconds; `/tmp/hr-settings-r9-async-parity.log`. No reference changes; architecture completed before parity began. |
| Freshness / scoped checks | Manifest, catalog and roadmap checks PASS in the corresponding `/tmp/hr-settings-r9-async-{manifest,catalog,roadmap}.log` files; instruction twins, owner links and diff checks remain passing. |
| Input binding | 2,117 paths; fingerprint `4adb96c0b598cd5517da7ec7aa72efb3cb1af3ef567bb28745cde124f9ac30cb`, `/tmp/hr-settings-r9-async-inputs.json` and `/tmp/hr-settings-r9-async-sha256.txt`. Compared with the verified R9 map, only the unit test and task owner differ. |

The input map binds `024b34e12803120d57ee3f629ffdcb42bc8a34fd` before this evidence-only append. Its recording commit reuses
unchanged code-gate results under D191, with scoped instruction/link, roadmap freshness and diff
checks. Review task `01a07a45-50d7-7d01-bd47-672d3dfa1720` must independently accept the proof
and final candidate before the authorized integration/operator sequence starts.


#### Accepted candidate, first integration, and R10 fixture isolation

The independent review task `01a07a45-50d7-7d01-bd47-672d3dfa1720` returned **PASS, no findings**
on candidate `024b34e12803120d57ee3f629ffdcb42bc8a34fd` / evidence
`94d540e4788845b2020293ecaf31c053426c19a5`. It closed the async P2, supported R1–R9 and every
P1–P41/M1–M27 disposition across all 117 paths, and independently recomputed the 2,117-input map
with zero mismatches. The supervisor verified clean branch/target identities and ancestry, then
merged without conflicts as **`c69992ec2f6d4be8102c3ea1330905809505e080`**. Its tree exactly matches
the accepted evidence HEAD. This is local integration only; no push or operator-root write occurred.

Integration typecheck and lint passed. The full integration coverage run
(`/tmp/hr-settings-r9-integration-coverage.log`, run-UWW2ni) failed solely in the existing real
CLI lifecycle test: its bootstrap was anchored to the primary checkout's `.env`, whose migrated
`UCPATH_USER_ID` correctly refuses normal startup. Candidate runs had a provider-only test `.env`,
so this dependency appeared only at integration. This is **R10, a test-isolation defect**, not
permission to change the operator's `.env`, bypass secure admission, or convert before gates.
The integration root remains at c69992ec with v29 operator data; finalization stays open.

The repair is on the existing dedicated task branch. `tests/unit/cli-dashboard-lifecycle.test.ts`
copies the byte-identical production bootstrap and a mode-0600 provider-only `.env.example` into its
disposable root, links the real source/dependencies, and invokes that copied bootstrap. Its fixed
module-relative environment now belongs to the fixture. Source/dependency links are explicitly
unlinked before recursive cleanup. Both Ctrl+C deliveries, bounded waiting, exit-zero, exact released
process-lock and checkout-state assertions remain intact; no production, timeout or assertion change.

The lifecycle/bootstrap/runtime neighbors pass 28 tests in three files
(`/tmp/hr-settings-r10-lifecycle-green.log`). An additional disposable source-bound checkout carries
synthetic `UCPATH_USER_ID` in its caller `.env`: the old test fails on the expected migrated-key
refusal, while the repaired test passes the complete real-process lifecycle (one test, 2.21 seconds).
Both runs preserve that synthetic caller file exactly. Logs are
`/tmp/hr-settings-r10-migrated-env-red.log` and `/tmp/hr-settings-r10-migrated-env-green.log`;
`/tmp/hr-settings-r10-env-proof.py` constructs/removes the isolated fixture without reading or copying
the operator's environment. Required repair-candidate gates, renewed review, reintegration and all
integration gates remain pending. Operator backup/plan/upgrade/doctor, completion and cleanup remain
unstarted. Preserve both worktrees and the assigned branch; the primary merge must not be reset.


#### R10 repair candidate gates — awaiting independent review

The R10 candidate changes only the lifecycle fixture and this evidence owner. Production, contracts,
dependencies, parity references and all other tests remain identical to the independently accepted
024b34e1 / 94d540e4 state. No assertions, timeouts, membership, isolation settings or floors changed.

| Gate | Result | Evidence |
| --- | --- | --- |
| Typecheck / lint | PASS, exit 0 each | `/tmp/hr-settings-r10-typecheck.log`, `/tmp/hr-settings-r10-lint.log` |
| Full coverage and suite size | PASS: 5,456 tests / 433 files; 317.95 seconds; floors pass | `/tmp/hr-settings-r10-coverage.log` |
| Standalone architecture | PASS: 827 tests / 79 files; 61.05 seconds | `/tmp/hr-settings-r10-architecture.log` |
| Desktop parity | PASS: 259 cases; 59.1 seconds; no tracked reference changes | `/tmp/hr-settings-r10-parity.log` |
| Manifest / catalog / roadmap freshness | PASS, exit 0 each | `/tmp/hr-settings-r10-{manifest,catalog,roadmap}.log` |
| Instruction pairs / chains / owner links / diff | PASS: nine equal pairs; maximum 15,457 bytes; one valid relative link; clean diff check | supervisor scoped checks |

Coverage used the unchanged verified effective-two-worker temporary adapter
`/tmp/hr-settings-r9-two-workers.config.mts` (SHA-256
`803dac79b5caed1c6934d2034c2f4c834f6b4a6a6794b807a6c8a067c27303ca`), with no compiler/linter
contention. Architecture and parity ran sequentially. Coverage reports statements 85.79%, branches
77.36% (report-only), functions 89.80%, lines 87.94%; the repository's configured floors and chained
suite-size check passed. The full suite includes the unchanged upgrade/restore/doctor fixture proofs.
The first typecheck/lint exit handles were unavailable after context recovery, so both were rerun
to capture explicit exit-zero evidence before coverage; no duplicate gate remained active.

The approved standalone Sol/high reviewer will reopen the fixture and neighboring bootstrap/runtime
proof coverage on the new commit, independently verify unchanged production and prior accepted
coverage, and issue a new commit-bound verdict. The prior PASS is not a verdict on R10. All completion
checkboxes remain open until accepted review, new merged-code gates, operator conversion and cleanup.


R10 implementation candidate: **`ad15bb982757a2e2342cf85f98df6eeca2a48050`**, base
`e314fb0d3c155bc2823a6f0bf2648a7f9521fbc6`, original plan
`9969857a79ba06d07a88b71ba2f0d4d64dc9967e`. The 2,117-path input map
`/tmp/hr-settings-r10-inputs.json` binds that exact commit; aggregate SHA-256 is
`413311868b752faeaee8e664f0a1f1b185fcf19ac887ea9c7feaad02ad0c448c`.
Comparison with the prior accepted map differs only in this evidence owner and the lifecycle test.
This recording append changes no gate inputs beyond task evidence; D191 reuses the candidate results
above with scoped instruction/link, roadmap freshness and diff checks. Review remains assigned to
`01a07a45-50d7-7d01-bd47-672d3dfa1720` under the operator-approved standalone continuation arrangement.


#### R10 independent review and documentation correction

Standalone review turn `01a07abb-23a3-70d0-9d19-86f2aac7ad86` returned **CHANGES REQUIRED**
on implementation `ad15bb982757a2e2342cf85f98df6eeca2a48050` / evidence
`e3294572cab2deda1b589081f0361cef8868ae91`: executable R10 accepted, no production findings,
but one P3 correction to the active lifecycle fixture recipe in `src/server/LESSONS.md`.
The reviewer covered 118 entries, verified every prior P/M/R disposition through unchanged inputs,
and independently recomputed the 2,117-input map with zero mismatches. The recipe still prescribed
only package files and a dependency symlink, which could recreate the demonstrated environment
coupling. It now requires the unchanged copied bootstrap, private provider-only fixture environment,
source link and explicit cleanup of both links. No executable input changes.

The app returned completed review turns with no message items; the exact local review rollout's
`task_complete.last_agent_message` supplied the verdict, subsequently restated in turn
`01a07abf-0ef5-7bf2-99bd-3a455e2ed2db`. This is a retrieval issue, not missing independent work.
The same approved reviewer will verify this documentation-only correction before integration.
D191 reuses the unchanged R10 executable gates above, with scoped instruction/link, roadmap
freshness and diff checks for this lesson/evidence commit. Completion remains open.
