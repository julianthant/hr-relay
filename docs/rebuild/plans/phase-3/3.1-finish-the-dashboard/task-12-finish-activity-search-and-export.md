# Task 3.1.12 · Finish Activity, search, and export
<!-- roadmap: dash-activity -->

**Current assignment: 3.1.12.** Standalone prerequisite or individual task; follow its explicit dependencies.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [x] Implement bounded cross-date filters and stable redacted exports; prove pagination,
  cancellation, stale responses, large history, errors, and exported-row reconciliation.

Accepted U supplied summary-backed Activity, current range/group metrics and the separate confirmed transaction-history query. Task 3.1.12 now closes the assigned search/export, pagination/cancellation, stale response and exported-row reconciliation proof. Unavailable distinct-person facts, privacy and archived confirmed totals until explicit deletion are preserved; no generic all-time archive Activity population is added.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.

## Approved execution brief — 2026-09-21

The operator selected **1 A, 2 A and 3 A**, then approved the complete seven-step proposal with
“approve.” The choices admit the full roadmap search scope and necessary shared/database changes,
spreadsheet-safe CSV encoding in place of D240's exact-text rule, and a snapshot-bound diagnostic
metadata export. This is the single plan for **3.1.12**; implementation remains unstarted.
The normative amendment is [search and export contract](../../../reference/frontend-backend-integration.md#activity-search-and-export-amendment--2026-09-21).
The [ownership amendment](task-9-establish-independent-dashboard-boundaries.md#activity-search-and-export-ownership-amendment--2026-09-21)
supersedes shared-file reservations only for the operations listed here. Frozen
[A20](task-8-acceptance-matrix.md#a20) and [A21](task-8-acceptance-matrix.md#a21) outcomes are unchanged.

### Assignment and checkout binding

| Binding | Approved assignment |
| --- | --- |
| Supervisor / allocation | One operator-opened supervisor; the operator selects model and effort. **Zero implementation workers; zero independent reviewers**, under the Phase 3.1 exception. Search authority, snapshot exports and historical compatibility form one coupled assignment. |
| Execution mode | Create an owned implementation worktree after verifying committed-plan availability, prerequisites, path/ref ownership and capacity. Do not implement in the primary integration checkout or the documentation checkout. |
| Implementation branch | `codex/3.1.12-activity-search` |
| Absolute implementation checkout | `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-activity-search` |
| Discovery baseline | `db8433c83830a0c23b980be13abaa190761ff975` on local `master`. |
| Persistence baseline | `3633b7cd023379746c2d5642fa7960ef8e2d5535`, after the operator-directed Operations worktree sweep. The intervening release preserves the inspected search/Activity implementation seams; its accepted Run/Rerun app changes must remain intact. |
| Required prerequisites | Accepted boundary foundation, Archive and dashboard-surface finalization (`dash-boundary-foundation`, `dash-archive`, `dash-surfaces-finalizer`), present in `801da4f3d1bfdf0a9ecc81c993289f70699aa140` and verified ancestors of both baselines. Run operations is integrated context, not an added dependency. |
| Implementation base | The verified local `master` descendant containing this committed approved plan and those prerequisites. The delivered READY prompt must name its actual full SHA; do not invent a future base or start from uncommitted documentation. Recheck target drift before creation. |
| Integration target / owner | Local `master` at `/Users/julianhein/Projects/hr-automation-rebuild`. This supervisor freezes the candidate; the operator selects product integration. After instruction, the assigned integrator preserves target work, reruns invalidated focused checks and owns cleanup. |
| Merge / completion condition | Approved sequence and focused proof pass on the final inputs; explicit operator instruction permits product integration. Completion additionally requires accepted integration, current task/roadmap/evidence records and owned resource cleanup. |
| Implementation evidence | `/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.12-activity-search-<execution-date>/`; resolve the actual date at launch. Retain commands, exits, inputs, database/query observations, export reconciliation and browser/resource evidence outside the worktree. |

The implementation branch/path were absent at planning. Names are proposals, not reservations.
The operator's `/worktree-sweep` merged Operations and removed its three incorporated worktrees;
the unrelated dirty UI planning checkout was retained. Planning now occupies the second auxiliary
slot in `codex/plan-3.1.12` at
`/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-activity-plan`.
Recheck the four-worktree ceiling and peers before every creation. Unapproved UI draft ownership
does not authorize consuming or editing that peer's working tree.

### Feasibility, source authority and change ownership

Discovery inspected code, contracts, fixtures and Git. These findings are mechanisms to repair,
not runtime acceptance evidence. The prior surface-finalizer assessment found narrowed fixtures
and unregistered disposable writers; use real composed services, register all test writers and
retain failed proof rather than replacing it with smaller fixtures.

| Inspected evidence / risk | Required operation and permitted owner | Proof / boundary |
| --- | --- | --- |
| `src/domain/dashboard/search.ts` closes the corpus to Separations, selected terminal states, single shape and dry-run. `authority-database.ts` validates every active run before SQL paging. A warm generation cache hides the cold/post-write cost. | Widen strict search contracts to the approved metadata dimensions; maintain validated searchable metadata/indexes atomically with source changes. Replace request-time full-corpus validation and ranking/materialization of unrelated rows. Missing, stale or corrupt derived authority must refuse, not silently fall back to raw scans. | P1/P2. Exercise cold/open, post-write and corrupt-index cases; prove selection/read bounds with query plans and instrumentation. |
| `run-subject-title.ts` already resolves descriptor-declared subject projections; summaries retain private person identity for counting. Start plans/commands carry attribution, while old runs may lack it. | Reuse approved displayed subject metadata and authentic recorded actor links; retained run version, typed failure codes and evidence availability supply their own dimensions. Never search arbitrary inputs/checkpoint bodies or infer absent actors from the current requester. | P1/P5. Protected values and private identities/digests remain outside public search/export/log/provenance. Missing historical facts remain explicitly unavailable. |
| `queries/search.ts` already authenticates source identity, generation, query and ordering. `day-search.tsx` drops old replies but supplies no abort signal or complete filters/export controls. | Extend the existing query/client/surface, preserving signed cursor/source binding and exact selection callback. Cancel obsolete requests and fence every delayed page/export. | P3. Changed filter/query/order/source, expired tokens, restart and late responses must not authorize the prior selection. |
| `compose/activity.ts` serves summary-backed reports, while `compose/shell.ts` still supplies XLSX from the older projection; CSV re-reads the range. | Page, CSV and XLSX consume one accepted summary-backed report and authenticated snapshot identity. Preserve date/group/member containment, distinct-person availability, lower-median/duration semantics and report caveats. | P4/P5. No export can substitute a newly read range for the report the operator reviewed. |
| `transaction-history.ts` reads all timeline/historical/archive sources before filtering; `capture(runId)` also filters an all-time result. | Add bounded range/run selection before materializing canonical confirmation evidence. Preserve deduplication, archive transfer, interruption/restart/replay and explicit deletion semantics. | P2/P4. No generic archived-run Activity population; dry-run, UNKNOWN and observed-present are not confirmed transactions. |
| Strict historical XLSX requests/evidence embed the current search schema; `generated-artifacts.ts` validates immutable selection, version and bytes. Widening current schemas naively can break stored exports. | Version new requests/evidence and retain parsers/readback for historical versions and their exact immutable bytes, actor availability, selection and digest. Preserve actor-attributed XLSX custody and byte verification before success. | P5/P6. Fresh, persisted, reopened and historical paths; refusal/cancellation after persistence must not claim rollback of issued evidence. |

The supervisor owns these exact feature responsibilities, including narrowly necessary edits in
shared files. A listed directory is not permission for unrelated refactoring.

| Area | Permitted paths / responsibility |
| --- | --- |
| Contracts / metadata | `src/domain/dashboard/search.ts`, `activity.ts`, `xlsx-export.ts` and dedicated diagnostic/snapshot types; necessary query/repository ports in `src/domain/authority.ts` and approved run-summary metadata derivation. Preserve existing non-Activity authorized subject projections. |
| SQLite and compatibility | Search-related portions of `src/infra/sqlite/authority-database.ts`, focused new SQLite query/index modules, `transaction-history.ts`, `generated-artifacts.ts`, `storage-records.ts`, additive `migrations.ts`, and affected `src/infra/compat/backup-inspection.ts`/upgrade validation. Maintain source publication, archive/delete and explicit rebuild consistency. Do not edit released migrations or redesign execution/kernel policy. |
| BFF / export | `src/server/dashboard/queries/search.ts`, `activity-summaries.ts`, `activity-export.ts`; `exports/`; dedicated `routes/activity.ts`, shell/export route/dependency types, `compose/activity.ts`, `compose/shell.ts` and only their required `compose.ts`/API registration. Reuse accepted source and actor derivation. |
| UI / transport | `src/dashboard/surfaces/day-search*.ts*`, `activity*.ts*`, their models/hooks; `client/shell-queries.ts`, `activity-queries.ts`, `export-commands.ts`, dedicated types and necessary export/query interface registration. Preserve the existing exact day/workflow/run callback and Settings-leave guard. No new `dashboard-app.tsx` navigation or Run/Rerun edit is assigned. |
| Proof / fixtures | Corresponding unit/architecture tests; `tests/parity/cross-date-search.spec.ts`, `reference-activity.spec.ts`, `top-bar-search-desktop-target.spec.ts`; Activity/search fixture/scenes and deliberately attributed references. Only the Activity report portions of `helpers/fixture-archive.ts` may change; preserve Archive behavior. Add a task-owned real-service host and spec rather than taking over common fixture defaults. |
| Generated / records | This task, approved reference/decision/ownership pointers, roadmap; affected descriptor manifest, catalog and guard inventory generated/updated at their owning sources. The supervisor is the single writer for this assignment's generated outputs and reference attribution. |

### Ordered implementation

1. **S1 — Admit and isolate.** Verify the committed plan, exact prerequisite ancestry, owned path/ref,
   current target and resource capacity. Record plan/base SHAs and current schema/migration/backup
   compatibility. Read nearest module instructions, `/ui` and the relevant specimen/lessons before
   frontend work. Preserve the integrated Operations release and peer work. Reconfirm that no live
   database, deployment or external HR action is part of this assignment.
2. **S2 — Establish bounded searchable authority.** Implement strict dimensions for date range,
   workflow, subject, lifecycle status, actor, retained version, failure and evidence availability.
   Cover eligible registered and historical/unregistered run metadata and all supported run shapes,
   with missing-fact coverage reported explicitly. Maintain validated index publication in the
   source transaction or an equally fail-closed revision protocol; readers cannot accept a partial
   index. Add necessary additive migrations, storage/backup registration and explicit bounded
   rebuild/resume validation. Preserve current non-archived run membership and privacy. Empty or
   broad input must have explicit validated limits; never silently mean unlimited work. Preserve
   stable ranking/order and the existing 50-row page ceiling. Establish P1/P2 before adding UI trust.
3. **S3 — Complete controls and selection.** Add the approved filters, paging, coverage/availability
   and explicit snapshot export actions to the current search surface. Retain current-day scope
   and exact result navigation. Query/filter changes, close, cancellation and stale replies
   invalidate prior selection/export authority. Propagate AbortSignal and also guard request
   identity, because cancellation alone cannot prevent a response race. Changed/expired/restarted
   snapshots refuse explicitly and offer a deliberate fresh query; no automatic latest substitution.
4. **S4 — Unify Activity and bound transaction history.** Bind the displayed report and both tabular
   exports to the same summary-backed snapshot. Preserve current range/group/count/duration and
   unavailable-person rules, with confirmed transactions as a separately explained block. Select
   transaction sources by range/run before evidence decoding, preserving archive transfer, restart,
   duplicate/replayed confirmation and explicit deletion. Correct stale Activity fixture/copy about
   retired pseudonym generations and “never pruned” history without changing Archive policy.
5. **S5 — Finish verified exports.** Export the explicitly reviewed whole result snapshot, disclosing
   selection count and coverage. Preserve existing export caps; an oversized/incomplete selection
   refuses instead of producing an unlabeled partial file. Implement redacted XLSX and diagnostic
   JSON manifest of result metadata, filters/coverage, statuses, typed failure codes and evidence
   availability. Captures and complete diagnostic bundles remain 3.1.14.4. Apply documented
   spreadsheet-safe CSV encoding to dangerous text while preserving numeric values and meaning.
   Validate snapshot/query identity, exact ordered rows/counts, media type, safe filename, byte
   length and digest before reporting verified download. Retain actor-attributed XLSX persistence,
   historical parsers and immutable bytes. Cancellation may stop delivery; it cannot assert that
   an already committed export was undone.
6. **S6 — Prove and repair the slice.** Execute P1–P6 at the earliest meaningful boundary, then run
   the focused candidate schedule below. Use real SQLite/composed services and built-browser proof
   over private synthetic state, both themes, keyboard, desktop resize and actual zoom. Demonstrate
   failures by controlled missing/stale/incorrect inputs where appropriate; preserve assertions,
   isolation, membership, floors and timeouts. Fix within-scope defects and rerun invalidated proof.
7. **S7 — Freeze, integrate when instructed, and close.** Commit logical categories with exact
   paths. Record candidate SHA, tested inputs, commands/exits, proof/limits and owned resources.
   Return the focused-green candidate for operator-directed local-master integration. Recheck target
   drift and run affected integration checks; reuse only verified unchanged inputs. After authorized
   integration, retain evidence, close the existing task/roadmap record and remove owned processes,
   worktree registration, physical folder and incorporated branch. No push or next-task dispatch.

### Required proof

| ID | Required positive / reconciliation proof | Failure, negative control or interleaving |
| --- | --- | --- |
| P1 · metadata and privacy | Multiple eligible workflows, all supported shapes and lifecycle states; each filter and combined filters; retained versions, real recorded actors, safe subjects and typed failure/evidence availability. Verify empty results and disclosed missing-history coverage. | Missing attribution/metadata never becomes a guessed value; malformed records/index generations refuse. Secret values, raw HR inputs, private person IDs and protected-derived digests cannot become matching or export oracles. |
| P2 · bounded database work | Instrument cold-start and post-mutation search, paging and range/run transaction queries with a large unrelated history. Record SQL query-plan/index evidence plus actual reads/decodes/materialized rows; bound work before reading raw evidence. | No pre-page `.all()` over active run JSON, unbounded all-history decoding, or full unrelated candidate ranking masked by a page limit. Prove instruments detect a deliberately widened reader; do not claim SQLite rows visited when the instrument cannot observe them. Rebuild has explicit chunk/progress/failure semantics outside interactive search. |
| P3 · snapshot and UI races | Stable ordered pages and exact day/workflow/run selection; cancellation/close/reopen; delayed request and page responses; filter-only/empty input according to explicit limits. | Query/filter/order tampering, foreign source/key, stale generation, expired token and BFF restart reject old cursors/exports. A late page or download cannot overwrite new selection or report false success. |
| P4 · report/history truth | Same accepted Activity report in page/CSV/XLSX; exact range/group/member containment; private cross-day distinct union and lower median; unavailable identity stays unavailable. Confirmed totals survive archive/restart until explicit deletion. | No summed daily distincts, averaged medians, archive run counts, dry-run/UNKNOWN/observed-present writes. Interrupt archive transfer, reopen, replay and delete; prove no double count, premature loss or reconstruction from current descriptors. |
| P5 · export trust | Every reviewed result in the same order, exact counts/coverage and snapshot identity, safe CSV numeric/text semantics, redacted JSON/XLSX, documented caveats and validated download headers/body. | Formula-like/control/leading-whitespace text, secrets/IDs, wrong/missing headers, type/name/length/hash mismatch, truncation, reordered/partial rows, changed selection, cancellation before/after persistence and response loss. No successful-looking fallback or claim of undoing durable evidence. |
| P6 · historical and browser acceptance | Real storage reopen/backup/upgrade checks for the new metadata and prior issued exports; built production-service search/report/export journeys with retained authority/output correlation; both themes, desktop geometry, accessibility/keyboard/focus and native zoom. | Historical absent actors remain absent; immutable old bytes/requests stay readable without inventing new authority. Missing/corrupt index or artifact produces a named refusal. An HTTP stub or reference image alone cannot certify the database/export path. |

### Focused gate and resource schedule

Run from the assigned implementation checkout. During S2–S5 execute affected selectors while the
boundary is small; by S6 run every group below against the corrected candidate. Add new meaningful
tests beside the owned boundaries. These commands name existing selectors; new proof files are
explicitly assigned separately. Keep unit file workers at the configured maximum of four.

```sh
npm run test -- \
  tests/unit/server/cross-date-search.test.ts \
  tests/unit/server/cross-date-search-snapshot-token.test.ts \
  tests/unit/dashboard/cross-date-search-ui.test.ts \
  tests/unit/dashboard/day-search-control.test.ts \
  tests/unit/server/operator-xlsx-export-service.test.ts \
  tests/unit/server/operator-xlsx-workbook.test.ts \
  tests/unit/operator-xlsx-export.test.ts \
  tests/unit/generated-artifacts/publication.test.ts

npm run test -- \
  tests/unit/server/activity-report.test.ts \
  tests/unit/server/activity-export.test.ts \
  tests/unit/dashboard/activity-render.test.ts \
  tests/unit/summary-surfaces/activity.test.ts \
  tests/unit/run-summaries/privacy.test.ts \
  tests/unit/run-summaries/queries.test.ts \
  tests/unit/run-summaries/mutations.test.ts \
  tests/unit/run-summaries/rebuild.test.ts \
  tests/unit/run-summaries/derivation.test.ts \
  tests/unit/transaction-history.test.ts \
  tests/unit/transaction-history-archive.test.ts

npm run test -- \
  tests/unit/sqlite-authority-database.test.ts \
  tests/unit/sqlite-authority-boundary.test.ts \
  tests/unit/storage-upgrade.test.ts \
  tests/unit/storage-upgrade-admission.test.ts \
  tests/unit/storage-supported-conversion.test.ts \
  tests/unit/storage-backup.test.ts \
  tests/unit/architecture/migration-history-immutability.test.ts

npm run test -- \
  tests/unit/architecture/one-projection-counts.test.ts \
  tests/unit/architecture/strict-boundary-schemas.test.ts \
  tests/unit/architecture/wire-connectivity.test.ts \
  tests/unit/architecture/dashboard-wire-boundary.test.ts \
  tests/unit/architecture/operator-mutation-admission.test.ts \
  tests/unit/architecture/artifact-effect-boundary.test.ts
```

Assign new indexed-authority/boundedness/rebuild proof to
`tests/unit/run-search-index.test.ts`, snapshot/report/diagnostic-export composed proof to
`tests/unit/server/activity-search-export.test.ts`, and a real-service browser host to
`tests/parity/helpers/activity-search-authority-server.ts` consumed by
`tests/parity/activity-search-authority.spec.ts`. These are future outputs, not existing passes.
Use real authority and production composition; fakes may inject faults, never replace the effects
or bytes whose correctness is claimed. Include meaningful download and cancellation tests in
existing client files or dedicated owned tests and record their exact additional selectors.

```sh
npm run test -- tests/unit/run-search-index.test.ts tests/unit/server/activity-search-export.test.ts

npm run test:parity -- \
  tests/parity/cross-date-search.spec.ts \
  tests/parity/reference-activity.spec.ts \
  tests/parity/top-bar-search-desktop-target.spec.ts \
  tests/parity/activity-search-authority.spec.ts \
  --workers=4
```

Run `npx eslint <exact changed TypeScript/TSX paths> --max-warnings 0` using an argument array
derived from the real implementation base, including new files, followed by affected neighboring
tests. Any additional executed test selector also belongs in the scoped lint set. No test/lint
failure is waived. Run affected storage/ingress/redaction guards discovered by the actual changed
declarations, recording exact selectors; this is not permission to replace a named gate with a
smaller check. Guard additions/retirements update `docs/rebuild/guard-inventory.json` with deciding
evidence; verify its membership test. Do not run the entire architecture suite as a per-commit gate.

For changed descriptor import closures, run `npm run build:manifest` and
`npm run build:manifest:check`; for changed store-catalog inputs, run `npm run stores:catalog` and
`npm run stores:catalog:check`. Record unchanged-input evidence if a generator is unaffected.
Parity's source-bound production build supplies the affected bundle check; run `npm run web:build`
separately only if that lane does not prove it. Serialize generation/build/reference writes sharing
this checkout. Deliberate reference updates require before/after attribution and a subsequent
assertion run with the existing tolerances and scene membership.

Use `/ui`, Components lead for the existing surfaces and Verification for proof, locally. Read the
current specimen and module instructions. Browser work uses the personal `playwright-cli` playbook.
Preserve Graphite Warm/Paper Ink at 1280×720 and 1440×900; retain 1024×768 references and exercise
resize down to 1024×720 and back. Verify affected filters/export/report controls with keyboard,
scroll and focus at actual 125%/200% browser zoom, recording mechanism, version and effective CSS
viewport. CSS zoom/device scale or viewport changes alone are not native zoom evidence. These are
focused A20/A21 and affected desktop proofs, not full D01–D05 acceptance.

Each check owns private synthetic database/artifact/state/auth/lock roots, ephemeral ports and
registered process handles; await cleanup on success and failure. Do not use standing ports
3938/5174 or operator state. No external HR transaction is required. Transaction-bearing synthetic
fixtures retain `dryRun=true` or throwing external adapters. Do not retry an UNKNOWN effect.

New metadata DDL uses the explicit upgrade/compatibility path and retains the current recovery
floor, tombstones and verified-backup requirements. Do not silently migrate during an interactive
search or alter a standing database. Tests must cover historical/current schema and backup custody;
they do not claim actual-target deployment. Any later real upgrade needs its separately authorized
stopped-target identity, fresh schema/health/custody inspection and verified backup immediately
before the effect. An unexpected target format returns to its storage owner, never a guessed repair.

Before freeze, retain exact input hashes and command/exits for each passing gate. At integration,
compare relevant code/test/config/dependency inputs; rerun affected checks for corrections, drift,
missing proof or uncertainty. Recording-only changes use `npm run roadmap`, `npm run roadmap:check`,
`npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts`, scoped lint of that test and
`scripts/generate-roadmap.ts`, link/instruction checks and `git diff --check`. Do not repeat unchanged
runtime gates merely for a documentation SHA.

### Exclusions and stop conditions

Full typecheck, whole-repository lint/coverage/architecture, broad parity, production/performance/
recovery/live acceptance and complete A01–A42/D01–D05 execution remain **3.1.19**. Focused database
cost evidence, relevant historical compatibility and P1–P6 are required here and cannot be deferred.
No independent review applies. Preserve the Operations release's documented failures/limits;
passing Activity tests do not clear them.

Exclude workflow admission/execution changes, worker/runtime redesign, archive/deletion/retention
policy changes, generic all-time archive Activity membership, full per-run diagnostic bundles and
captures (3.1.14.4), shared app navigation/Run/Rerun edits, live operator-state upgrades, legacy live
state, mobile redesign, cutover, push and automatic task dispatch. Use the existing result-navigation
callback; if it cannot meet the unchanged exact-selection contract, surface the concrete conflict
before taking shared app ownership. Do not use raw HR inputs or current requester identity to fill
missing searchable history. New product/contract choices, changed prerequisites or necessary
out-of-owner changes require amendment; routine query/index/UI/test repairs remain local.

### Planning persistence and start state

| State | Verified disposition |
| --- | --- |
| Approval | Full S1–S7 scope and choices 1 A / 2 A / 3 A approved 2026-09-21. |
| Implementation | Unstarted; all product checkboxes remain open. No runtime gate is claimed by planning. |
| Prerequisites | Required accepted releases are ancestors of persistence base `3633b7cd023379746c2d5642fa7960ef8e2d5535`. |
| Planning ownership | This task owns the approved documentation candidate on `codex/plan-3.1.12`; peers remain untouched. |
| Documentation integration | The operator explicitly approved local-master integration and owned planning-worktree cleanup on 2026-09-21. The final receipt below records the actual integrated plan/base SHA and cleanup. Product integration remains a separate later decision. |
| Launch readiness | READY at the verified handoff: approved scope, passing documentation checks, committed content and required integrated prerequisites are established. Verify the final receipt's actual integration/base SHA and current checkout/ref/capacity before implementation. |

Retain planning checks and the final commit/integration/cleanup/readiness receipt in
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.12-plan-2026-09-21/`.
The supervisor gives Done / Now / Remaining once at start or genuine resume, then reports only new
verified results, blockers or decisions. Maintain this owner for routine transfer; use `/handoff`
only for interrupted unique state. Stop after the assigned task; never re-ask settled scope.

### Planning validation — 2026-09-21

| Check | Result / retained evidence |
| --- | --- |
| Binding and lint | `npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts`: 24 tests passed. `npx eslint scripts/generate-roadmap.ts tests/unit/architecture/roadmap-doc-binding.test.ts --max-warnings 0`: passed. |
| Generated roadmap | `npm run roadmap` and `npm run roadmap:check`: passed; HTML generated from source. |
| Scope / instructions | Exactly nine approved documentation/generated-document paths; no code, tests, config, dependencies or operator state changed. Local links resolve; all nine existing instruction pairs match and 18 chains stay below 32,768 bytes. `git diff --check` passes. |
| Plan / proof completeness | S1–S7, P1–P6, three approved decisions, ownership, checkout, prerequisites and integration controls verified. All 36 existing test/spec selectors resolve; three explicitly assigned future proof selectors remain unimplemented. Frozen A20/A21 sections are byte-identical to the persistence base. |
| Prerequisite / drift | `801da4f3d1bfdf0a9ecc81c993289f70699aa140` is an ancestor of `3633b7cd023379746c2d5642fa7960ef8e2d5535`; inspected search/Activity implementation paths are unchanged by the intervening Operations release. |
| Runtime acceptance | Not executed or claimed by planning. Product implementation, focused feature proof and later operator-directed product integration remain open. |

The [planning evidence directory](/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.12-plan-2026-09-21/)
retains check scripts, exact commands/exits, logs, tested file hashes, committed-content comparison
and the final persistence/readiness receipt. Approval is preserved; no new scope decision is pending.

### Authorized planning release — 2026-09-21

The operator approved local integration of the verified planning candidate
`f5a7e9139057117e3b4e5f69a345af095efe93a5`, followed by cleanup of its owned documentation branch
and worktree. This authorization resolves the earlier WAITING ON integration state; it does not
start product implementation or authorize the later product merge. S1–S7, P1–P6, the three approved
choices, ownership and gate schedule are unchanged.

The [final planning receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.12-plan-2026-09-21/final-receipt.json)
records the full plan/integration SHAs, committed-content and unchanged-input checks, passing
recording checks, prerequisite ancestry and physical/ref cleanup. The copy-ready supervisor prompt
uses the verified integrated SHA as its implementation base. The supervisor creates the assigned
`codex/3.1.12-activity-search` branch/worktree only after checking that exact release and capacity;
no existing UI draft checkout or integration checkout is repurposed. Full product acceptance remains
open under this assignment and 3.1.19.

## Execution state — 2026-09-21

S1 admission passed. The committed approved plan `8d1e6acc30ac469311dc507f0021aa3711a3fb40`
and prerequisite `801da4f3d1bfdf0a9ecc81c993289f70699aa140` are ancestors of the exact clean
implementation base `e82e32f5007e5a7f3b4b0f62a86565f223932cf8`. Implementation used branch
`codex/3.1.12-activity-search` in
`/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-activity-search`;
both were removed after accepted integration.
The existing UI planning checkout and Operations release are preserved. Admission hashes and
peer state are retained in the task evidence directory's `admission.json`.

S1–S7 are complete. Focused P1–P6 proof passes; the operator's “do it” authorized integration of
frozen candidate `6d42b66fd133bb9cef59e26a43b7b5fd86028911` into local master as
`b77def9af67bc73e4a15b0fb4f09427d32d19688`. The merged tree exactly matches the frozen candidate.
Integration input checks, completion records and owned worktree/branch cleanup are complete.
One supervisor performed implementation and verification; no workers or independent reviewer
participated. The final local-master recording SHA is retained in `final-receipt.json`.

Implementation commit: `cefb7064ffeb5dfafd8c622f63cb07250ce7520a`, after the authorized guard/fixture
repair commit `aac9e94a0933cf7832a1abd4ecd9f694b414275b`. The final recording commit is identified
by `candidate-freeze.json`; both product and guard inputs remain fixed during that recording step.

Schema 54 publishes bounded searchable metadata and transaction selection. Released migrations
1–53 remain immutable; the recovery floor remains 46. Current XLSX requests use version 3, while
versions 1/2 retain separate historical schemas and exact issued-byte readback. Activity page,
CSV and XLSX share one authenticated report selection. Search exports reconcile the whole ordered
selection; CSV protects spreadsheet text and diagnostic JSON contains only redacted metadata.
Full diagnostic bundles remain 3.1.14.4. No standing database or external HR system was altered.

Search limits are explicit: 160-character query, 50-row pages, 10,000 selected metadata candidates
before ranking and raw run materialization, and 5,000 export rows. Over-limit selections refuse.
Empty text permits bounded filter-only search. Missing historical actor/subject facts remain
unavailable. Metadata repair uses the explicit `rebuildRunSearchIndex({ restart, limit })` storage
API with chunks of at most 500, durable progress and resume checks. No interactive fallback or new
maintenance CLI is added. Large descriptor changes invalidate publication until explicit rebuild;
unrelated ordinary authority writes remain available. Transaction metadata selection also caps at
10,000 before reading canonical evidence. Evidence within an admitted selected run can still be
large; this proof bounds unrelated history, not every selected report's byte size.

### Candidate proof and gate results

All named receipts below live in
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.12-activity-search-2026-09-21/`.
Each gate JSON records its exact command, exit, timestamp and input hashes; the paired log retains
the full output, including failed attempts. `candidate-freeze.json` binds the final committed tree
to these receipts and records actual commit SHAs without a self-referential documentation commit.

| Proof | Verified result and retained evidence |
| --- | --- |
| P1 · metadata/privacy | Real SQLite tests cover registered and retained unregistered workflows, all four shapes and all 12 lifecycle states across the focused tests/browser fixture; independent/combined filters, safe declared subjects, recorded actors, retained versions, failures, receipts and missing-history coverage. Corrupt metadata, stale declarations, protected values and invented attribution are rejected. `final-search`, `final-additional`, `bounded-evidence-final`; redaction-surface audit includes the new durable index tables. |
| P2 · bounded work | `bounded-query-proof.json` records actual raw-row observations and indexed SQL plans. Cold search among 504 runs reads three raw rows for a two-row page and two for the next; after mutation, 505 historical runs still require three raw reads. Deliberately widening the reader exposes all 504 rows. Range/run transaction selection among 120 confirmations and 40 archives reads only the selected archive twice for ownership/source verification; the widened negative control reads all 40. Post-mutation evidence adds only the selected live row. A 10,001-match selection refuses before any raw run read. Rebuild interruption/reopen/resume, chunk limits and ordinary-write availability pass. Counts do not claim SQLite internal rows visited or constant-cost whole-database boot admission. |
| P3 · selection/races | Signed query/source/generation/order snapshots, expiry/restart/tamper rejection, ordered pages, exact result callback, AbortSignal delivery and independent stale-response fencing pass. UI tests cover delayed query/page/export, close/reopen and changed filters; built browser exercises refresh, paging and keyboard focus. `final-search`, `final-additional`, `final-parity`. |
| P4 · report/history | Summary-backed report, CSV and XLSX reconcile exact range, counts, unavailable people and selection digest. Existing distinct-union/lower-median tests remain. Archive interruption at each phase, reopen, replay, tombstone and explicit deletion preserve confirmed totals without counting archived runs or unconfirmed effects. Historical stopped conversion uses its explicit pre-54 path. `final-report`, `final-storage`, `final-parity`. |
| P5 · export trust | CSV formula/control/whitespace defense preserves typed numbers. Redacted metadata excludes query text, subject/actor values, run/trace/retry IDs and private payloads. Full-selection order/count/coverage, row caps, snapshot identity and download type/name/length/SHA-256 validation pass, including wrong/missing/truncated responses, cancellation and durable XLSX response-loss/replay behavior. Built browser correlates 23 search rows, CSV/JSON/XLSX and persisted artifact digest, then refuses the stale selection after XLSX publication. `final-search`, `final-additional`, `final-parity-output/results.json`. |
| P6 · compatibility/browser | Real reopen, supported stopped upgrades, verified backup custody, frozen old requests and immutable bytes pass. Production-composed browser journeys use private synthetic authority and retain six output correlations, screenshots and body accessibility evidence. Native zoom proof covers both themes at 125% and 200%. `final-storage`, `final-parity`, `browser-evidence-retention.json`, `native-zoom-evidence.json`. |

| Assigned gate | Result |
| --- | --- |
| Search/export group | `final-search`: 8 files, 72 tests passed. |
| Activity/history group | `final-report`: 11 files, 81 tests passed. |
| Storage/compatibility group | `final-storage`: 7 files, 298 tests passed. |
| Assigned boundary guards | `final-guards`: 6 files, 72 tests passed. |
| Additional affected proof | `final-additional`: 6 files, 136 tests passed: `run-search-index`, `server/activity-search-export`, `dashboard/client-transport`, `architecture/redaction-surface-scan`, `architecture/guard-manifest`, `storage-diagnostic-redaction`. Total focused runtime/guard proof: **659 tests across 38 files**. |
| Final cost observations | `bounded-evidence-final`: search-index, transaction-history-archive and guard-manifest, 24 tests passed after adding observation output and updating inventory. Assertions and membership are preserved. |
| Scoped static checks | `final-scoped-lint`: exact 107 TypeScript/TSX paths passed; the two later observation-only test changes pass `bounded-proof-scoped-lint`. `bounded-proof-scoped-types`: affected TypeScript dependency closure passed. These are scoped checks, not full repository lint/typecheck. |
| Generated inputs | `generated-manifest-check` and `store-catalog-check` passed. `generated-inputs.json` verifies unchanged descriptor manifest and all 214 store-catalog closure inputs; no unrelated regeneration. |
| Built browser/reference gate | `final-parity`: all four assigned specs, **25 tests passed**, including the source-bound production bundle and required accessibility evidence. Six new composed journeys preserve both themes at all three assigned viewports and resize to 1024×720 and back. |
| Reference attribution | Eighteen existing search/Activity scenes (54 PNG/accessibility/metadata files) deliberately refreshed with unchanged membership and tolerances. Original bytes/hashes remain under `references-before`; `reference-attribution.json` binds before/after hashes. Complete update lane passed, followed by the independent assertion run above. |
| Native browser zoom | Four playwright-cli cases passed in HeadlessChrome/153.0.0.0 using the native Chrome Settings → Appearance → Page zoom combobox in an owned persistent profile. At 125%, physical 1440×900 yields 1152×720 CSS; at 200%, physical 2048×1440 yields 1024×720 CSS. CSS zoom and visual viewport scale remain 1. Filters, scroll, result focus, close/focus return and report/export controls are exercised with keyboard downloads. The additional 1440×900/200% probe yields 720×450 CSS over the existing 1024px desktop canvas; keyboard/scroll reachability was checked, and unclipped visual proof uses the larger physical window. |
| Recording checks | `freeze-roadmap-generate`, `freeze-roadmap-check`, `freeze-doc-binding` (24 tests), `freeze-doc-lint` and `freeze-record-checks.json`: passed. All 39 assigned selectors exist; 12 local links resolve, nine instruction pairs match and 18 chains remain below 32,768 bytes. The approved plan and frozen acceptance matrix remain unchanged. `git diff --check` passes. |

The only production-source change after the grouped runtime gates corrects comments in the search
contract. `source-comment-reuse.json` verifies identical TypeScript output with comments removed;
the final browser/static checks include those comments. The later query observations only add
test output; their affected files were rerun and linted. No unchanged runtime group is rerun solely
for documentation or commit SHA changes.

Early failures remain in the evidence directory. In particular, the exact admitted base reproduced
50 guard failures; the authorized amendment below permits only their guard/fixture repairs.
The initial 10,001-row cost fixture was stopped during slow sequential setup; the final fixture
uses valid bulk synthetic rows and the real bounded rebuild, preserves the 30-second timeout,
and passes. An initial reference update omitted the wrapper's required accessibility lane and
returned exit 1 despite 18 scene passes; the complete 25-test update and assertion lanes pass.
None of these failed attempts is represented as a passing receipt.

### Accepted local integration and cleanup — 2026-09-21

`product-integration.json` records operator authorization, the clean unchanged target, prerequisite
ancestry and conflict-free integration. The merge tree is
`c60b456500016f9a62b2c5dc09d196321638c9a1`, identical to the accepted candidate. All 143 changed-file
hashes and 17 passing gate receipt/log hashes were verified; the worktree used the same dependency
installation as the primary checkout. No runtime, test, configuration or dependency change
invalidated the 659 focused tests, 25 browser cases, scoped lint/types, generated checks or native
zoom proof. Those results are reused under the assigned cadence, not represented as fresh runs.

The recording-only closeout passes fresh `integration-roadmap-generate`, `integration-roadmap-check`,
`integration-doc-binding` (24 tests), `integration-doc-lint`, link/instruction checks and
`git diff --check`. Only this task's owner, roadmap entry and generated roadmap change after the
product merge. `final-receipt.json` binds the final committed state to those checks and confirms
that all other merged inputs remain unchanged.

`owned-cleanup.json` verifies ordinary worktree removal, absence of its physical folder and deletion
of the incorporated branch. All ignored browser output, bundle and lock-file bytes were retained
with hashes under `worktree-residue/`; the dependency symlink was removed and its target preserved.
Owned Vite/composed-browser servers and playwright-cli sessions are closed. Synthetic evidence and
the owned Chrome profile remain deliberately retained. No owned checkout/branch/process residue
remains. The calling task is not archived, and there are no dispatched child tasks to close.

The dirty UI planning checkout remains at `f93994501f69ff04a8114311fee7630c34b529e4`; its status,
tracked changes and four untracked planning files match their recorded hashes. Integrated Operations
work is preserved. No push or sibling/next-task dispatch occurred.

Full repository typecheck/lint/coverage/architecture, broad parity and complete A01–A42/D01–D05
acceptance remain 3.1.19. This evidence does not clear the integrated Operations release's separate
documented limitations. No standing database migration, live HR write or deployment is claimed.

### Delivery assessment

The approved plan and operator amendment governed the same coupled assignment throughout. One
planning omission was exposed: the assigned baseline guards had not been run during feasibility,
so necessary reconciliation of already-integrated Calendar/Operations/Archive fixtures was not
included in the initial ownership. `base-guards.json` reproduced 50 failures in four files on the
exact admitted base. The operator authorized guard/fixture repairs only; this added no product
scope. Running those assigned guards before the implementation brief would have exposed the
ownership need earlier.

Implementation/proof repairs included historical stopped-conversion compatibility, native-zoom
filter scrolling and test setup. The first large-history fixture used unnecessarily slow sequential
admission; the final fixture uses valid bulk synthetic data and the real bounded rebuild without
changing the timeout. The first reference update omitted the required accessibility lane; the
complete update and assertion runs repaired that proof. These were covered by the approved plan,
not new operator requirements. Earlier logs retain the repair attempts; they do not establish a
reliable count of independent repair rounds or avoidable elapsed time.

No allocation change or independent review occurred, as required by Phase 3.1. Context compaction
did not lose the recorded acceptance state. Product integration introduced no conflicts or repairs;
exact-tree verification permitted reuse of unchanged runtime evidence, followed by fresh recording
checks. No broader quality or time-savings claim is made.

### Operator scope amendment — 2026-09-21

The operator approved “Include guard/fixture repairs only” after the exact admitted base reproduced
50 failures in four assigned guard files. This permits reconciling the Calendar projection guard,
Operations operational-port/command accounting, Archive native-download fixture, and reviewed
fail-loud catch classifications with the integrated product behavior. Assertions, negative controls,
test membership, product behavior and all existing task exclusions remain unchanged. The baseline
comparison and exact input hashes are retained in `base-guards.json` and its log in this task's
evidence directory. This amendment does not authorize integration, push or unrelated product edits.

## Operating-report presentation — 2026-09-26

The operator selected Activity A and approved implementation with a Sol worker. It groups the
served date-range report into outcomes, outstanding work and a per-workflow breakdown, preserving
all authoritative counts, unknowns, duration semantics, caveats and export snapshot identity.
A workflow focus control belongs within the breakdown and affects only that section. Headline
totals and exports remain explicitly date-range-wide; this presentation does not invent a
workflow-scoped summary/export authority or derive totals from partial client rows. Confirmed
write-ledger counts retain their separately named authority. The approved visual direction permits
attributable updates to affected Activity references without assertion or membership weakening.

Candidate: `codex/activity-report` at
`/Users/julianhein/.codex/worktrees/activity-report/hr-automation-rebuild`, from the committed
Settings-derived base `897158ece84471dd86b67ca8d49e73477b1280e8`. The previous implementation's
zero-worker assignment is unchanged historically; this separately approved presentation refinement
uses one Sol worker under the current coordinator. Focused Phase 3.1 cadence applies, with no
independent review or automatic integration. The operator retains product integration choice.
Evidence: `/Users/julianhein/Projects/hr-automation-rebuild-evidence/archive-explorer-activity-2026-09-26/implementation/activity/`.
