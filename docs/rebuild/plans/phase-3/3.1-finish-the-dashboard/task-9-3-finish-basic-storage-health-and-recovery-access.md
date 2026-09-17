# Task 3.1.9.3 · Finish basic storage health and recovery access
<!-- roadmap: dash-storage -->

**Current delivery: complete — 2026-09-17.** Accepted candidate
`1514c27f069765cb62cf5bcf2b461ba5555eca92` is incorporated into local master through
`b3f5904e28ca7c23f11a2a4d8d217cbdecafa5a8`. Required focused child/group gates, integration
and owned cleanup are complete; see the [finalizer closure](task-9-8-finalization-dashboard-surfaces.md#accepted-integration-and-group-closure--2026-09-17).
Full acceptance remains 3.1.19. Earlier dated plan/freeze receipts below retain their historical state.

**Current assignment: 3.1.9.3.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

Consume the [3.1.9 B ownership and working-interface record](task-9-establish-independent-dashboard-boundaries.md#b-implementation-and-child-release-contract--2026-09-13) at its accepted integration. The approved execution brief below and the [Storage ownership amendment](task-9-establish-independent-dashboard-boundaries.md#storage-child-ownership-amendment--2026-09-13) add the narrowly required read-only doctor correction. Other shared registration and generated outputs remain reserved.

- [x] Serve truthful storage health, doctor findings and actionable recovery instructions. Keep
  supported explicit backup/restore/upgrade commands reachable through clear instructions; preserve
  working existing controls without requiring new interactive recovery UI for the first release.
- [x] Prove the surfaced corruption/interruption/stale/stopped-system cases against the underlying
  recovery commands. D336's SQLite settings and independent credentials replace the old settings-file authority.
  The live/archive database pair and retained capture/report files still require authenticated recovery.
- [x] Record the D339 deferral of new interactive restore, migration and repair interfaces. Admit
  them only for a concrete workflow need or an explicit post-release request; core recovery and its
  tests remain mandatory. Do not present an unimplemented action as an available button.

The 3.1.8 baseline recorded schema 50 and stopped 46–49 conversion. The accepted 3.1.9 prerequisite
now supplies schema 51, unchanged floor 46 and explicit stopped 46–50 conversion. Below-floor inputs
refuse before conversion with the compatible-release remedy. Preserve pending/published capture
custody, shared retained files, exact paired replay and the recovery marker on missing/corrupt
bytes. Retired settings imports and obsolete adapters do not return. No operator database upgrade
or new advanced recovery interface is implied by health/readiness presentation.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.

## Approved execution brief — 2026-09-13

The operator approved the complete S1–S4 proposal on 2026-09-13 after directing the planner to
include the narrow read-only doctor correction. This approval covers planning persistence and one
fresh supervisor assignment. It does not implement the task, accept its future candidate, merge
into master, change a database schema or authorize recovery against operator state.

### Current state, prerequisites and allocation

Planning inspected clean local master at `07221394ece638d5de9f38407654ad2b305f1f9f`.
The accepted parent integrations `c990662e91604cfd38baa53e12bfb6e7c60610eb` (A) and
`3d4d8c0c64cf2e96096b193966a66741861d6f1c` (B) are ancestors of that base. The accepted
3.1.8 inventory and frozen A06/A42 outcomes remain the acceptance source; their dated schema-50
facts are read with the parent's implemented schema-51 release, not rewritten as new history.
`src/infra/sqlite/migrations.ts` supplies current schema 51 and recovery floor 46. No sibling
implementation is a start prerequisite.

One **GPT-6 Astra supervisor at medium reasoning** owns the coupled diagnosis, strict report,
presentation, command guidance and recovery/browser proof. The work is consequential across the
storage, CLI, BFF and frontend boundaries, so low reasoning is not selected. **Zero workers and
zero independent reviewers** are assigned. Use `/ui`: Components lead, Content support, local
execution in Operate mode. The phase's no-independent-review/focused-gate exception controls.

| Assignment | Branch and absolute checkout | Base and availability | Release and merge condition |
| --- | --- | --- | --- |
| 3.1.9.3, S1–S4 | `codex/3.1.9.3-storage`; `/Users/julianhein/Projects/hr-worktree-storage` | Created for approved documentation persistence from `07221394ece638d5de9f38407654ad2b305f1f9f`. Reuse this dedicated checkout at the verified approved-plan commit supplied by the planning handoff. Verify clean status, ownership, exact plan content and base ancestry before product edits. | Deliver exact committed candidate and focused evidence for 3.1.9.8. The operator controls integration into local `master`; 3.1.9.8 combines candidates, resolves shared/generated/reference output, performs focused group gates and owned cleanup. This assignment grants no merge or push. |

At persistence preflight, the only other auxiliary worktree was
`/Users/julianhein/Projects/hr-worktree-settings` on `codex/3.1.9.2-settings`, with committed
candidate `368496e0d55a259e8dd098c81a37bbcc9a966763`. Preserve that task's approved ownership,
candidate and reference exceptions. The storage ref/path were absent before this planner created
them. Recheck worktree/ref ownership and the four-auxiliary-worktree ceiling at start/resume;
never reset a colliding branch or move another session. A new checkout, if the owned one was
released, must be recreated from the verified approved-plan ref, not from an uncommitted document.

### Feasibility and highest-risk evidence

| Question and current evidence | Required change and permitted owner | Proof and forbidden result |
| --- | --- | --- |
| `AuthorityDatabase.open` refuses `.lifecycle-restore.json`, `.archive-conversion.json` and `.archive-restore.json` during ordinary writable startup. `doctorAuthorityStorage` inspects database integrity without exposing those recovery markers. A disposable planning probe wrote an interrupted-pair marker: startup returned `lifecycle-restore-incomplete`, while doctor authority was `healthy`, spans `reconciled` and upgrades `baseline` to schema 51. The probe inspected no operator state and removed its private root. | S1: the infra doctor/report and, only if useful, a storage-local read-only helper expose recovery interruption or unavailable inspection truthfully. S2 separates database integrity from recovery readiness; a healthy database is not permission to claim writable runtime. | A real interrupted-recovery fixture must retain its startup refusal and marker while the doctor, CLI and browser show the finding. Missing/unreadable/corrupt evidence is distinct from clear recovery state. No marker repair, deletion, boot relaxation or fake healthy default. |
| `inspectCandidates` enumerates individual `.manifest.json` backups. `restoreCommand` and `restoreLifecyclePair` can require a `.lifecycle.json` manifest covering live/archive databases and retained files. `verifyLifecyclePair` already validates database digests, archive fingerprint, pending/published file membership and bytes. | S1 reuses the existing read-only verifier and current identity/floor admission facts. Distinguish verified bytes from eligibility to restore with this release; show the exact complete candidate rather than promoting a lone half. Preserve valid historical inspection with an explicit compatible-release remedy when current restore is unsupported. | Valid pair is a positive control; missing/corrupt archive or file, wrong source identity, incomplete pair, unsupported source and uncertain inspection cannot be presented as an eligible complete restore. No alternate/latest candidate selection or recovery write. |
| `buildStorageDoctor` already serves `authorityUpgrades` and `protectedSettings`; `StorageSection` omits both. It renders useful authority/count/span/backup/candidate findings but has no backup/upgrade/restore instructions. | S2 renders existing safe facts and the S1 correction through the dedicated strict storage wire/query/client. S3 adds reachable command guidance inside the existing surface. | Actual service output reaches strict client and rendered UI. Presence is not a credential value; unavailable is not absent. No private credential value, path, digest or parser payload leaks. |
| `StorageBanner` still describes stale backups using a retired cadence and can append an unaffected-writes claim beside unavailable authority. The section labels healthy summary storage as read-write without proving recovery readiness. | S2 corrects storage-owned copy and status presentation. Preserve the bootstrap's cheap-summary provenance and the doctor's on-demand byte verification; age is information, not the retired production freshness rule. | Cross authority/backup states, unavailable generation, pending recovery, loading and failed refresh retain distinct facts. Missing/stale backup alone does not stop ordinary work or create a new automatic backup policy. |
| Existing command/restore/conversion tests exercise supported sources, stopped admission, exact replay, preserved external-write uncertainty and independent credentials. The accepted parent advanced current schema without changing floor 46. | S3 guidance follows existing CLI argv and admission; S4 executes focused preservation proofs at current candidate inputs. Current version/floor facts come from their server/infra owner, not a second browser policy. | Supported 46–50 conversion remains explicit/stopped; below-floor input refuses before effects. Preserve live/archive/file custody, marker on incomplete recovery, corrected exact replay and unchanged credential store. No new migration, retired settings importer or UNKNOWN-submit retry. |

This is a generic feature and synthetic proof task, not recovery against an actual operator target.
No operator database, credential store, `.env`, provider file or legacy live state is opened, copied
or converted for acceptance. Consequently no actual-target migration preflight is assigned. The
supervisor verifies the disposable target identity/schema, exact backup identity and stopped/runtime
conditions before each synthetic recovery operation. The planning probe is discovery evidence,
not a passed implementation gate or a claim that the future correction works.

### Permitted files and exclusions

The parent amendment grants the following exact production ownership for this task:

- `src/dashboard/surfaces/storage-settings.tsx` and `storage-settings-model.ts`,
  `src/dashboard/client/storage-queries.ts`, `src/dashboard/state/storage-client.ts`.
- `src/domain/dashboard/storage.ts`, `src/server/dashboard/queries/storage.ts`,
  `src/server/dashboard/routes/storage.ts`, `routes/storage-types.ts` and `compose/storage.ts`.
- Narrow read-only diagnosis/report changes in `src/infra/sqlite/storage-doctor.ts` and
  `src/infra/sqlite/recovery-contracts.ts`. If necessary, add only a dedicated read-only
  `src/infra/sqlite/storage-recovery-status.ts` helper consumed by the existing doctor.
- In `src/server/storage/compose.ts`, only doctor formatting, doctor help/status and the read-only
  doctor dispatch result. Preserve D322: missing/stale backup is reported, not a new exit gate.
  Interrupted/unavailable recovery must not receive a healthy readiness claim. Do not change
  backup, restore, upgrade, repair or transaction-export execution or their admission.

Own the storage fixture/spec/reference family: `tests/parity/helpers/fixture-storage.ts`,
`fixture-storage-routes.ts`, `tests/parity/reference-storage.spec.ts`, and new
`tests/parity/storage-recovery.spec.ts` with optional
`tests/parity/helpers/storage-recovery-server.ts`. Own storage-focused unit tests named below and
new `tests/unit/storage-recovery-status.test.ts` and
`tests/unit/dashboard/storage-recovery-guidance.test.ts`. Existing recovery suites remain
preservation proof; extend their storage assertions only when the approved outcome needs it.
Within `tests/unit/architecture/strict-boundary-schemas.test.ts`, only the storage report fixtures
and strict-boundary coverage may change. Do not alter unrelated assertions or add/retire a guard.

Preserve `StorageSection`'s Settings editor/preflight props, the Settings host/draft lifetime,
shared query/client/provider registration, the root BFF/command composition and all sibling
contracts. Read the existing pair verifier; do not change `lifecycle-storage.ts`, its writers,
`backup-service.ts`, `authority-database.ts`, migration statements, conversion/restore admission,
credential authority or runtime lock behavior. The task may extend read-only report/wire schemas;
it does not change a database schema, persisted recovery format or a mutation protocol.

No new interactive restore/upgrade/repair UI, automatic backup or recovery, configurable backup
destination/retention feature, Settings/catalog expansion, workflow-specific behavior, generic
People/Review page, external HR action, operator-state change, legacy execution dependency, push
or cutover. New advanced recovery interfaces remain deferred under D339 until a concrete workflow
need or an explicit post-release request; core recovery behavior and proof remain required.

### Ordered implementation

| Step | Required outcome and sequence |
| --- | --- |
| **S1 — Correct doctor findings** | Verify plan/base/ref/path/capacity and scoped ownership first. Establish failing recovery-marker and complete-pair diagnosis cases against real disposable storage. Correct the read-only report at its infra owner, retain exact identity and no-follow/read-only boundaries, project the strict browser wire and CLI output, and establish positive/negative controls before presentation work. Do not infer absent custody from an unreadable database. |
| **S2 — Complete storage presentation** | Read dashboard/server instructions and applicable `/ui` guidance; inspect the existing specimen through `playwright-cli` before choosing primitives. Render recovery status, safe upgrade history and independent credential presence/unavailability alongside retained count/span/backup facts. Preserve idle/loading/failure/refresh behavior and existing controls. Correct cadence and writable-runtime claims. Verify the mounted component and all affected summary combinations. |
| **S3 — Add recovery guidance** | Make concise instructions reachable in the existing Storage surface for `npm run cli -- storage doctor --json`, `npm run cli -- storage backup --json`, `npm run cli -- storage upgrade --plan --json`, explicit stopped `storage upgrade --json` and `storage restore --from <exact-manifest-path> --json` through the same CLI prefix. Explain when to stop the dashboard/BFF/workers, exact paired selection, unchanged independent credentials, unsupported-source remedies, and preserving interrupted evidence before exact recovery. Never choose a manifest, imply a generic retry is safe, or expose an unsupported action as a button. |
| **S4 — Prove and deliver** | Execute the focused service/recovery/browser matrix and gates on final inputs; inspect reference changes and actual desktop zoom. Record candidate/source/bundle/fixture/reference/evidence identities, commands/exits and deferred gates. Commit exact paths by logical category and freeze the candidate for operator-controlled 3.1.9.8 intake. Close owned processes, preserve evidence and report remaining integration/cleanup. |

### Acceptance proof and failure combinations

| Proof | Boundary, outcome and negative control |
| --- | --- |
| **P1 — Read-only recovery truth** | S1: real current database with an interrupted lifecycle/archive marker, including otherwise healthy integrity; corrupt/unreadable marker and simultaneous corrupt authority; valid clear-state control. CLI/BFF/browser report interruption or unknown without hiding the database finding. Snapshot authority, credentials, markers and retained files before/after doctor reads; no semantic authority or recovery-byte change is permitted. Preserve existing SQLite reader bookkeeping treatment rather than weakening evidence comparisons. |
| **P2 — Complete restore selection** | S1: valid authenticated live/archive/file pair; missing/corrupt pair manifest, archive bytes or retained capture/report file; pending and published custody; wrong source identity; historical/below-floor source; unavailable inspection. Use the exact pair verifier and current restore eligibility facts. A verified individual database is not proof of a complete eligible pair. No lone-half/latest substitution, silent skip or fabricated generation. |
| **P3 — Surface and guidance** | S2/S3: idle/loading/success/failure/refresh, corruption, pending recovery, current/stale/missing backup, unavailable generation, upgrade baseline/planned/committed/settled/unavailable, present/absent/unavailable credentials and preserved span accounting. Assert the actual served facts and actionable command instructions, no secret output, no invented zero counts and no recovery mutation request from the browser. |
| **P4 — Existing recovery preservation** | S4: supported stopped 46–50 conversion, active runtime plus invalid/stale backup refusal ordering, below-floor refusal before conversion/credential effects, interruption before/after commit, live/archive/file replacement interruption, changed/missing custody retaining marker, exact corrected replay and unchanged credentials. Preserve settings, pending/published capture ownership, shared retained files and external-write uncertainty without re-admitting lost runs or retrying UNKNOWN submits. Existing positive controls must still reach valid backup/restore/conversion. |
| **P5 — Production route and desktop journey** | S4: built dashboard and strict storage client fetch the real `registerStorageRoutes` → `buildStorageDoctor` → infra doctor over disposable storage, not a browser-fulfilled canned doctor. A storage-owned helper may host the real storage route and use the existing fixture app for unrelated shell/settings responses without changing shared factories. Bind the exact built bundle before serving; record which surrounding responses are fixtures. Exercise real paired recovery with services stopped, restart the owned test service, rerun doctor and observe corrected facts. Verify both themes, minimum 1024×720 canvas, existing desktop reference sizes, resize, reachable scrolling, keyboard/focus and actual 125%/200% zoom. No external HR system is involved. |

The existing `createFixtureBff` factory and dedicated production storage route allow a child-owned
test host to register the real storage route before mounting the unrelated fixture app. This is
test composition inside storage-owned files, not permission to replace the shared seeded service,
fixture profile, reference harness or production root registration. Browser proof must name this
scope accurately; it does not claim a full production-runtime recovery journey before 3.1.19.

### Gate commands, schedule and reference ownership

Run from `/Users/julianhein/Projects/hr-worktree-storage`. S1 and S2/S3 create the two new unit
files below; S4 creates the new browser spec before candidate gates. During iteration, run the
affected subset that distinguishes the next repair. After related fixes settle, run this complete
focused selection on final candidate inputs:

```sh
npm run test -- \
  tests/unit/storage-recovery-status.test.ts \
  tests/unit/dashboard/storage-recovery-guidance.test.ts \
  tests/unit/dashboard/settings-storage-doctor.test.ts \
  tests/unit/dashboard/storage-banner.test.ts \
  tests/unit/dashboard/surface-fixture-boundaries.test.ts \
  tests/unit/protected-settings-doctor.test.ts \
  tests/unit/storage-diagnostic-redaction.test.ts \
  tests/unit/storage-summary.test.ts \
  tests/unit/storage-supported-conversion.test.ts \
  tests/unit/storage-upgrade-admission.test.ts \
  tests/unit/storage-restore-drill.test.ts \
  tests/unit/storage-backup-command.test.ts \
  tests/unit/lifecycle-foundation/two-store-recovery.test.ts \
  tests/unit/archive-transfer/custody-recovery.test.ts \
  tests/unit/database-table-retirement.test.ts \
  tests/unit/architecture/strict-boundary-schemas.test.ts

npm run web:build
npm run test:parity -- reference-storage.spec.ts storage-recovery.spec.ts --workers=4
git diff --check
```

Run `npx eslint <every-changed-authored-code-and-test-path> --max-warnings 0` with the exact
candidate path list recorded in evidence. This is an exact-diff selector, not permission to omit
new helpers or tests. If the doctor/import changes affect the recovery or browser boundary guards,
run `npm run test -- tests/unit/architecture/storage-recovery.test.ts tests/unit/architecture/dashboard-wire-boundary.test.ts`.
Preserve the strict-schema and redaction checks; no guard addition or retirement is planned.
If a descriptor import closure changes, run `npm run build:manifest` followed by
`npm run build:manifest:check`; unexpected generated runtime ownership returns for allocation.
Documentation-only records use applicable links/instruction-pair/roadmap checks and whitespace,
with unchanged-input evidence for any reused gates. No full suite is repeated solely for a new
documentation SHA. Repeat invalidated checks after corrections; never call unrun checks passed.

Capture a complete test-title/reference census before refreeze. The existing storage-owned
families are `storage-queue`, `storage-settings` and `storage-doctor-degraded`; new storage
journey states belong only to this task's spec/reference namespace. Preserve every existing
title, theme, viewport, metadata identity and meaningful assertion. Deliberate updates use:

```sh
npm run test:parity:update -- reference-storage.spec.ts storage-recovery.spec.ts --workers=4
```

This command admits only attributed changes caused by the approved storage outcomes. Record
exact paths, before/after hashes and the reason for each PNG/a11y/metadata change; inspect visual
and semantic diffs, preserve unchanged metadata, then rerun assert mode. Unexpected non-storage
reference changes stop dependent refreeze work. Preserve actual 125%/200% browser-zoom proof
separately from any fixture technique; do not change tolerances, drop cases or invent mobile proof.

The in-flight Settings candidate has operator-approved changes to the same storage reference
families: Settings navigation/body effects and eleven additional reference-only fixes, including
inherited queue baselines. That candidate's exact evidence is retained at
`/Users/julianhein/Projects/hr-settings-evidence-20260913/` and in its committed task record on
`codex/3.1.9.2-settings`. Do not cherry-pick only its reference images into Storage, overwrite its
candidate or silently treat its scope as unapproved. Each candidate proves its own source tree.
3.1.9.8 is the sole combined reference/generated-output owner: preserve both source changes,
resolve overlapping reference output from the actual combined implementation, attribute the
combined refresh and verify the assigned either-order combination. Images are generated evidence,
not a choice between conflicting product behavior. This preserves the existing in-flight merge
conditions and creates no sibling implementation dependency.

The Git index, `dist/dashboard`, `tests/parity/.output`, compiler evidence, fixture roots,
screenshots and evidence namespace must be private. Installed `node_modules` may be a read-only
link to the primary checkout; never install into that shared directory. Use the repository
runner's private `/tmp/hrt-<uid>/run-*` roots and ephemeral HTTP/SSE ports, never 3938/5174 or
operator authority. Keep the test runner's at-most-four file workers; parity uses the explicit
four-worker selector. Do not overlap build/parity writers within this checkout. Record effective
worker counts, commands, input identities, exits and owned process handles. Evidence root:
`/Users/julianhein/Projects/hr-storage-evidence-20260913/`; create only if absent or verify ownership.
No coverage run is assigned here; keep later coverage free of this task's compiler/linter contention.

3.1.9.8 combines all worker candidates, runs typecheck, focused integration/regression tests,
scoped lint and affected build/generated checks, repairs group defects and completes authorized
integration/cleanup. Full coverage, whole-repository lint/architecture, broad parity, production,
performance, recovery/live acceptance and all A01–A42/D01–D05 remain **3.1.19**. This child still
supplies its specifically assigned P1–P5 recovery and browser evidence; their existence is not
deferred by the broad-gate rule. No independent review is required at either boundary in Phase 3.1.

### Fix, stop and delivery boundaries

Routine implementation choices, failing fixtures and regression repairs within these owners stay
with the supervisor. Stop dependent work for changed prerequisites/ref/path ownership, unexplained
authority/backup identity, required writer/migration/credential/lock changes, a missing shared root
hook, another owner's required edits, unsupported target evidence or reference drift outside this
allowlist. Return the concrete conflict for amendment; never guess a fallback, weaken a guard or
defer a known acceptance contradiction to finalization. Do not create fix agents/worktrees or
dispatch a sibling/next task. If interrupted with unique unresolved state, use `/handoff`.

At start/resume and after each verified S1–S4 completion, send **Done / Now / Remaining** in chat
before the next tool call. Keep one current-state record here with plan/base/head, checkout,
accepted focused proof and tested inputs, next action/blocker, remaining integration/cleanup and
deferred broad gates. Retain linked dated evidence and write persisted records in normal prose.

Commit and freeze the focused candidate, retaining its branch and evidence for 3.1.9.8. Close only
owned browser/HTTP/SSE/database processes. Remove an owned auxiliary checkout only from a safe
checkout after preserving evidence and its committed candidate, retaining the unintegrated ref;
otherwise report it for finalizer cleanup. Never remove the active supervisor checkout, primary
checkout or another task's resources. Task/roadmap completion waits for assigned integration and
cleanup; the development session may finish with those obligations explicitly pending.

### Planning persistence and handoff

Approved persistence owns only this task file and the necessary Storage amendment in the parent
boundary record. Master is integration-only and remains untouched. The planner created the
dedicated branch/worktree above, writes and validates the complete plan there, commits exact paths,
reads back committed content and supplies the full verified plan SHA. No separate master merge
is needed to launch this task: its execution checkout contains the approved plan and all already
integrated prerequisites. Its future candidate carries both plan and implementation for 3.1.9.8.

Planning checks: `npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts`;
`npx eslint tests/unit/architecture/roadmap-doc-binding.test.ts scripts/generate-roadmap.ts scripts/roadmap --max-warnings 0`;
`npm run roadmap:check`; exact changed-document links/fragments, existing instruction-pair equality
and complete chain size below 32,768 UTF-8 bytes; approved-control/path/ancestry audit; and
`git diff --check`. If generation changes because of the approved documents, use the generator
and validate its exact output rather than hand-editing it. Product/test/config/dependency/reference
inputs remain unchanged; planning runs no product acceptance and marks no implementation checkbox.
The final handoff verifies plan reachability, committed owner equality and prerequisite availability.

### Planning validation — 2026-09-13

The approved persistence changes only this task owner and the parent Storage ownership amendment.
All 2,560 other tracked inputs remain unchanged from
`07221394ece638d5de9f38407654ad2b305f1f9f`; no product source, test, configuration, dependency,
instruction or reference file was changed, and the generated roadmap remains fresh. The current task and parent
implementation checkboxes are unchanged. This is planning validation, not product acceptance.

| Check | Result and evidence |
| --- | --- |
| `npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts` | PASS: 1 file / 24 tests, exit 0; `roadmap-binding.log`. |
| Scoped ESLint over that test and `scripts/generate-roadmap.ts scripts/roadmap` | PASS, exit 0; `lint.log`. |
| `npm run roadmap:check` | PASS, exit 0; generated index is fresh without regeneration; `roadmap-check.log`. |
| `python3 /Users/julianhein/Projects/hr-storage-plan-evidence-20260913/audit.py` | PASS: 23 document links/fragments, nine identical instruction pairs, maximum complete instruction chain 22,199 UTF-8 bytes, 27 required execution controls, 17 existing unit-test paths and prerequisite ancestry. The two prospective unit paths are explicitly assigned to implementation. |
| Source/whitespace boundary | PASS: exact two-document allowlist, 2,560 unchanged tracked inputs and `git diff --check`. |

Evidence root: `/Users/julianhein/Projects/hr-storage-plan-evidence-20260913/`.
`audit.py` is the reproducible audit; `audit.json` and `unchanged-inputs.json` bind checked document
hashes, ownership, controls and unchanged baseline objects. The receipt adds no runtime/test or
roadmap binding input; reuse the passed binding/lint results on that inspected basis. Recheck
roadmap freshness, the final document audit and whitespace after recording, then commit exact paths
and verify the committed documents against those hashes. The final planning handoff records the
full plan SHA outside the commit to avoid a self-referential hash. The dedicated checkout/ref
remain available for the operator's fresh supervisor session; no master merge or push occurred.


### Execution amendment — 2026-09-14

The operator approved both narrow corrections after the assigned focused gates exposed inherited
prerequisite defects: extend production ownership to the read-only `authorityContentFingerprint`
function in `src/infra/sqlite/authority-database.ts`, and regenerate the seven inherited
`storage-queue` reference states from this candidate's actual rendering. No writer, migration,
recovery floor, credential, lock or Settings contract change is authorized by this amendment.

Schema 51 introduced `explorer_overrides`, but the historical schema-48 read-only fingerprint used
the current table registry unconditionally. Eighteen existing historical recovery checks therefore
failed, including direct inspector calls that bypass the modified doctor. The current fingerprint
and historical test helper were byte-identical to implementation base `07221394ece638d5de9f38407654ad2b305f1f9f`.
The correction excludes this table only for pre-51 schemas; a missing table in a current-schema
source must still fail. Existing recovery assertions and their historical source layouts remain.
The explicit current physical inventory and native SQLite owner lists also retain the prerequisite's
new table and two native owners; no guard is added or retired.

The seven queue states retained older no-run copy despite the already-integrated source correction.
The Storage candidate regenerates and verifies its own output. The Settings candidate's approved
reference changes remain untouched, and 3.1.9.8 retains sole combined-reference ownership.
Evidence and the proposed source patch are in `/Users/julianhein/Projects/hr-storage-evidence-20260913/`.


### Execution delivery — 2026-09-14

**State at child freeze:** S1–S4 and P1–P5 are delivered as a tested, committed candidate frozen for
operator-controlled 3.1.9.8 intake. The final recording commit is identified in the external receipt
below. This task's completion checkboxes remain open until integration and assigned cleanup.
No independent review is assigned under the Phase 3.1 cadence.

| Identity | Verified value |
| --- | --- |
| Checkout / branch | `/Users/julianhein/Projects/hr-worktree-storage` / `codex/3.1.9.3-storage` |
| Implementation base / approved plan | `07221394ece638d5de9f38407654ad2b305f1f9f` / `8e41297f27ccc9ce480d0551b50eaa296fad7954` |
| Implementation and tests | `9fcd074e4a16385aae3285481777d0133f93ed33` |
| Approved reference output | `205e6b5eb1a6e41c4e762c036a9471d1aec0fe6f` |
| Frozen input receipt | `frozen-inputs.json`: 2,566 tracked/new inputs excluding this evidence owner; receipt SHA-256 `8cf65c9e9e3ed12e2b434bfd55688db17d572bc2befc52262d993bca34fdd5cb` |
| Built input / emitted bundle | `9bd0ab8020748a50de73f1cb460bfe07a6a1f1ac4c42b8eca3f1e71b05abd210` / `21626f1da779ddfbd4432727d72c7170891d8045fd6a750101230299e3a6363c` |

Evidence files named here live in `/Users/julianhein/Projects/hr-storage-evidence-20260913/`.
The final recording commit is bound externally by `frozen-candidate.json`, avoiding a self-referential
commit hash. `preflight.json` records initial clean ownership and prerequisite ancestry; later
checks retained the same base and Settings candidate. Two auxiliary worktrees stayed below the
four-worktree ceiling. Master and the Settings worktree/ref were not mutated.

| Proof | Implemented outcome and focused evidence |
| --- | --- |
| P1 | Doctor, CLI and BFF distinguish clear, interrupted and unavailable lifecycle/archive markers, including healthy integrity with blocked startup and simultaneous corrupt authority/marker. Marker reads use bounded no-follow inspection and before/after identity comparison. `storage-recovery-status.test.ts` snapshots authority, markers, credentials and retained files. Only existing SQLite reader bookkeeping is normalized: warmed `.db-shm` read marks at offsets 100–120, with an empty live WAL asserted; semantic authority and recovery bytes remain unchanged. |
| P2 | The doctor authenticates exact lifecycle manifests through `verifyLifecyclePair`, including pending/published files. The matrix refuses missing/corrupt manifests, archive/files, source mismatch and aliases; a lone half is incomplete when custody exists. Unreadable authority does not establish absent custody. Verified bytes, complete pair selection, generation availability, supported conversion and below-floor remedies are separate facts. Current-schema missing-table validation remains a negative control after the approved historical fingerprint correction. |
| P3 | Mounted Settings tests cover idle/loading/success/failure/failed refresh, authority/backup combinations, counts/spans, upgrade phases and independent credential presence/unavailability. The surface exposes five exact CLI commands through the existing accessible popover. Opening instructions makes no doctor or mutation request. Stale/missing backup is informational; summary health no longer claims writable runtime. Settings editor/preflight contracts remain intact. |
| P4 | The assigned recovery/conversion/backup suites pass with stopped 46–50 conversion, floor 46 refusal ordering, interruption retention, exact corrected replay, pending/published custody, unchanged independent credentials and preserved external-write uncertainty. Recovery writers, migration statements, conversion/restore admission and runtime-lock implementation are unchanged. |
| P5 | Four theme/viewport journeys use the built strict browser client and real `registerStorageRoutes → buildStorageDoctor → doctorAuthorityStorage` over private disposable schema-51 roots. Each proves ordinary startup refusal, stops its diagnostic host, executes the real exact-pair CLI restore, restarts and observes cleared markers with identical credentials/retained bytes. A fifth browser case preserves corrupt-authority plus invalid-marker findings. All browser requests are GET. Source identity, pair digest, bundle stamp and request traces are retained in `real-route-final-provenance.json` and `parity-frozen-artifacts/results.json`. |

P5's surrounding shell, Settings, SSE and unrelated API responses use the existing fixture server;
static transport serves the bound production bundle. This is a real storage-route journey through a
diagnostic host, not a full production-runtime acceptance claim. The synthetic fixture's unavailable
span-stream evidence remains visibly unavailable; it is not replaced by fabricated healthy spans.
No operator authority, credential store, `.env`, legacy live state or external HR system was used.

Both themes pass at 1024×720 and 1440×900, with 1100×760 resize, keyboard activation, Escape/focus
restoration and reachable scrolling. Existing references retain 1280×720, 1440×900 and 1024×768.
`playwright-cli` also verified actual Chromium 149.0.7827.55 zoom using an owned extension's
`chrome.tabs.setZoom/getZoom`: 125% at 1280×900 yields 1024×720 CSS pixels; 200% at 1440×900
yields 720×450 with the preserved 1024×720 canvas and document scrolling. CSS zoom remains 1.
`zoom-final-receipts.json`, `zoom-server.json`, `zoom-proof.js` and four `zoom-final-*.png`/a11y
captures bind the final bundle, reachable credentials/restore command and settled opacity. All four
captures were visually inspected. The only manual-browser console entry was the fixture favicon 404.

| Assigned gate | Final result / evidence |
| --- | --- |
| Full listed focused unit selection plus both conditional boundary guards | PASS: 18 files, 411 tests, exit 0; `focused-gates-verified.log`. Four observed Vitest fork workers under the unchanged configuration; `final-gate-processes.txt`. |
| Exact authored-file ESLint | PASS: 20 files, exit 0; exact argv in `lint-final.log`, paths in `lint-paths.json`. The later browser-capture assertion also passes `lint-capture-final.log`. |
| `npm run web:build` / parity bundle validation | PASS; `web-build.log`, `storage-reference-final-update.log` and bundle stamp. Existing Vite chunk-size advisory only. |
| `npm run test:parity:update -- reference-storage.spec.ts storage-recovery.spec.ts --workers=4` | PASS: 22 cases, exit 0; `storage-reference-final-update.log`. |
| `npm run test:parity -- reference-storage.spec.ts storage-recovery.spec.ts --workers=4` | PASS: final 22 cases, four resolved workers, zero skipped/unexpected/flaky cases; `storage-parity-frozen-assert.log` and `parity-frozen-artifacts/results.json`. |
| Actual 125%/200% zoom, both themes | PASS: four final-bundle samples, command geometry and focus assertions, exit 0; `zoom-proof-final-settled-output.txt`, `zoom-final-receipts.json`. |
| Descriptor/task manifest impact | PASS: computed seven descriptor and 37 task closures; no intersection with changed inputs and no stale generated bytes. `manifest-scope.json`; no regeneration required. |
| Evidence-record checks | PASS: 24 roadmap binding tests, scoped documentation-tool lint, fresh roadmap, 23 links/fragments, nine identical instruction pairs and maximum complete chain 22,199 bytes; `docs-binding-final.log`, `docs-lint-final.log`, `roadmap-check-final.log`, `docs-audit.json`. Whitespace is clean. |

`reference-attribution.json` names all before/after hashes and reasons: four loaded-doctor states
and the seven operator-approved inherited queue states, each PNG plus accessibility YAML, 22 changed
files total. All 17 metadata files and the six Settings states remain unchanged. The original 17
reference cases and five new journey cases are preserved; original reference spec bytes and the
before/after title census were checked. All eleven changed PNGs and semantic diffs were inspected.
The Settings candidate `368496e0d55a259e8dd098c81a37bbcc9a966763` remains intact. 3.1.9.8 must
resolve reference overlap from its actual combined source and verify the assigned either-order
combination; neither candidate's images substitute for combined evidence.

After the 411-test run, the only authored change was an additional browser assertion awaiting help
popover opacity 1 before capture. The complete browser selector and its lint reran. No unit,
production, dependency, configuration or reference input changed; `evidence-reuse.json` binds this
comparison. Documentation recording reuses those unchanged product gates and runs the assigned
roadmap binding, scoped lint, freshness, links/instruction-pair and whitespace checks.

D339 remains explicit: new interactive restore, upgrade and repair interfaces are deferred until a
concrete workflow need or explicit post-release request. Recovery commands and core proof remain
implemented and mandatory. No new backup cadence, recovery writer, migration, credential authority,
runtime admission or Settings behavior was introduced.

All owned Vite, browser, diagnostic HTTP/SSE and database processes are stopped. The two named
browser sessions were closed; final zoom server PID 74916 and browser PID 74940 exited. Successful
private runner roots removed themselves. Seven failed synthetic runner roots were removed only
after verifying recorded ownership and absent process groups; `synthetic-cleanup.json` preserves
those receipts and failure logs remain. The first specimen launch briefly used Vite's default cache
through shared `node_modules`; it was stopped and subsequent launches used the private evidence
cache and explicit read-only dependency allowlist. No dependency installation or tracked dependency
change occurred. The unintegrated Storage checkout/ref, private build/parity output and evidence
remain for finalizer intake/cleanup. No merge, push, sibling dispatch or operator-state recovery ran.

**Remaining owner:** the operator launches 3.1.9.8 for combined integration, typecheck, focused group
checks, reference/generated reconciliation and checkout/ref cleanup. Full coverage, whole-repository
lint/architecture, broad parity and production/performance/recovery/live acceptance remain 3.1.19 as allocated above;
none is claimed passed here. This supervisor stops after freezing this assignment.

**Delivery assessment:** one amendment addressed inherited prerequisite defects: schema-51 registry
use during historical fingerprint reads and seven old queue baselines. Earlier baseline execution
of the assigned historical recovery suites and storage parity would have exposed these ownership
conflicts before implementation. Static native-owner/current-table expectations were corrected to
the prerequisite's explicit ownership without retiring guards. Test-fixture repair rounds addressed
SQLite reader bookkeeping, a permission-test snapshot, source-table error classification, contention
output synchronization and browser stop/restart/capture evidence. The contention test now waits for
the child snapshot message before retaining its active-state assertion; lock behavior and deadlines
are unchanged. Browser screenshots now wait for the existing entrance animation to settle. Logs
retain failed and corrected runs; no independent review occurred. Context was compacted during the
long assignment without adding workers or changing task boundaries. Complete elapsed-time and
repair-round telemetry is unavailable, so no aggregate cost or quality score is inferred.
