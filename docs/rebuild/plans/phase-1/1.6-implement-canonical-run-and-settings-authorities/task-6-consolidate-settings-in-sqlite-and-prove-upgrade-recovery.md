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


#### Proposed review-allocation amendment — awaiting operator approval

The reloaded supervise independent-review skill now admits planned focused scopes followed by a
separate integration reviewer. This is a concrete proposal, not an approved allocation or another
implementation plan. Product scope, the one-candidate consumer cutover, all acceptance/proof rows,
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

On operator approval, mark only this review allocation admitted, record that approval here and
execute it in the supervisor session. Until then do not dispatch this partitioned round, merge,
convert the operator root or remove the active supervisor worktree. This proposal changes no code,
tests, runtime configuration, dependencies or gate results; D191 evidence-only checks apply.
