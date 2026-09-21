# Task 3.1.12 · Finish Activity, search, and export
<!-- roadmap: dash-activity -->

**Current assignment: 3.1.12.** Standalone prerequisite or individual task; follow its explicit dependencies.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Implement bounded cross-date filters and stable redacted exports; prove pagination,
  cancellation, stale responses, large history, errors, and exported-row reconciliation.

Accepted U supplies summary-backed Activity, current range/group metrics and the separate confirmed transaction-history query. Preserve unavailable distinct-person facts, privacy and archived confirmed totals until explicit deletion. Remaining search/export, pagination/cancellation, stale response and exported-row reconciliation proof stays open; no generic all-time archive Activity population is added.

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
