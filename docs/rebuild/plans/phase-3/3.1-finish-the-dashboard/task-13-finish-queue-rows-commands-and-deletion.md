# Task 3.1.13 · Finish queue rows, commands, and deletion
<!-- roadmap: dash-queue -->

**Current assignment: 3.1.13.** Standalone prerequisite or individual task; follow its explicit dependencies.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Render display facts from current summary-backed queries, enriched by canonical run services; make all single/bulk commands real,
  revision-bound, idempotent, and convergent across current/archive/tombstone views.
- [ ] Keep Rerun as Task 3.1.11.2's plan-backed modal launcher; this task does not restore direct
  retry/restart queue mutations.

The accepted 2.6 U summary consumer replaces the old whole-run projection requirement. Derived
summaries carry display facts; canonical services authorize every command. Preserve parent/member
and batch grouping, selected-set ordering, freshness refusal and bounded reads. The accepted claim
order remains canonical even when the UI offers an explicit display sort.

The historical R01 `skipped`-enum defect is superseded: current run-span handling explicitly refuses
`skipped`, which is a task outcome. The declared remove/tombstone patch operations still have no
named producer in the inspected server source; prove their required delete/transfer convergence or
an explicitly verified equivalent current protocol. Do not drop the outcome just to delete an
unused enum arm. Terminal deletion retains insert-only disposition and explicit released-key copy.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.

## Approved execution brief — 2026-09-22

The operator approved the complete S1–S6 proposal with **“APPROVE”** on 2026-09-22, including
the bounded shared-file and historical-compatibility repairs and the documentation release.
This is the single implementation plan for **3.1.13**. Approval permits persistence, validation,
commit, local integration and cleanup of the documentation worktree. Product implementation
starts only in a fresh operator-opened supervisor session; product integration still needs the
operator's separate instruction. All product checkboxes remain open.

### Outcome, authorities and allocation

Finish [A26–A28](task-8-acceptance-matrix.md#a26) and [A18's live Queue controls](task-8-acceptance-matrix.md#a18):
truthful summary-backed rows, canonical single/bulk commands, terminal deletion, and convergence
after archive, delete and reconnect. Consume the accepted Run/Rerun launcher from
[3.1.11.3](task-11-3-finalization-run-operations.md#accepted-integration-and-cleanup--2026-09-21).
The authorities are [command semantics and D253/D235](../../../reference/dashboard-surfaces.md#24-one-command-protocol-with-strict-target-families),
[Queue presentation](../../../reference/dashboard-surfaces.md#92-the-queue-row--the-days-work),
[D308 deletion](../../../reference/dashboard-surfaces.md#d308--delete-means-delete),
[D330 operations/order/disposition](../../../reference/dashboard-surfaces.md#d3305--the-typed-operation-set-and-its-failure-modes),
and [the Queue integration flow](../../../reference/frontend-backend-integration.md#512-queue-row--the-days-work).
These contracts retain authority over historical implementation descriptions.

One supervisor owns the coupled Queue dispatch, lifecycle, stream and selection assignment.
**Zero implementation workers; zero independent reviewers.** The Phase 3.1 exception applies.
The operator selects the supervisor model and effort. No parallel split, coordinator, sibling
dispatch or successor launch is admitted. Routine implementation choices remain with the supervisor.

| Binding | Approved value |
| --- | --- |
| Implementation mode | Create an owned worktree and dedicated branch after verifying the committed plan, prerequisites, ownership and capacity. Never implement in the primary integration checkout or documentation checkout. |
| Implementation branch | `codex/3.1.13-queue` |
| Absolute implementation checkout | `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-queue` |
| Inspected baseline | Clean local `master` at `fa98cd897b82b5bbcd136c83645f7040d804a2b1`. |
| Required prerequisites | Accepted boundary foundation (`dash-boundary-foundation`), Run/Rerun (`dash-run-modal`) and Operations finalization (`dash-operations-finalizer`). Surface release `801da4f3d1bfdf0a9ecc81c993289f70699aa140` and Operations candidate `2c81ebd84bc4ee911a56f65cafdcd3784d721686` are verified ancestors; the Operations owner records accepted integration and cleanup. Integrated Activity is preserved context, not a new dependency. |
| Implementation base | Resolve the actual local `master` SHA containing this committed approved plan and the accepted prerequisites; record its full SHA in the verified launch prompt. Recheck target drift before creating the checkout. A future SHA is not invented here. |
| Integration target / owner | Local `master` at `/Users/julianhein/Projects/hr-automation-rebuild`. This supervisor owns the candidate; the operator selects product integration. After explicit instruction, the assigned supervisor/integrator preserves target work, runs invalidated focused checks and owns cleanup. |
| Merge / completion condition | S1–S6 and all focused proof pass on the corrected candidate, followed by explicit operator integration instruction. Completion additionally requires accepted integration, current task/roadmap records and verified owned cleanup. |
| Implementation evidence | `/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.13-queue-<execution-date>/`; resolve the date at launch. Retain commands, exits, tested inputs, browser evidence, synthetic state and cleanup identities outside the checkout. |
| Documentation persistence | `codex/plan-3.1.13` at `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-queue-plan`, created from the inspected baseline. This planner owns the approved documentation integration and cleanup. |

The proposed implementation branch and path were absent during discovery. One unrelated dirty
UI-planning worktree existed; preserve it and its unapproved drafts. Names are proposals, not
reservations. Recheck refs, absolute paths, ownership and the four-auxiliary-worktree ceiling before
creation. No implementation checkout or agent was launched by planning.

### Feasibility, baseline evidence and change ownership

Discovery inspected current code, contracts, fixtures and prerequisite ancestry. The prior
[Activity delivery assessment](task-12-finish-activity-search-and-export.md#delivery-assessment)
identified late discovery of baseline guard failures. This plan therefore ran its relevant baseline
guards and Queue/lifecycle tests before approval: **279 passed, 9 failed across 16 files**, with
scoped lint passing. The [planning evidence directory](/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.13-plan-2026-09-22/)
retains `selectors.json`, `baseline-tests.json`, `baseline-tests.log`, `baseline-lint.json` and
`baseline-lint.log`. These are diagnostic results, not feature acceptance or waived failures.

| Current mechanism / consequential risk | Required change and permitted owner | Proof / exclusion consequence |
| --- | --- | --- |
| `queries/queue-summaries.ts` supplies bounded summary pages; `run-queue-projection.ts` enriches them from canonical reads. The day builder currently sorts by start instant, while lifecycle list order includes priority. `queue-model.ts` applies named display sorts and batch presentation. | S2 owns Queue query/projection/order and presentation consistency. Preserve canonical priority/enqueue/id order and the operator's explicit display sorts, with exact member and keyboard ordering. | P1: bounded pages, shared status, source freshness, parent/member/batch facts and heartbeat-only negative control. No second authority or client-derived command permission. |
| `dashboard-app.tsx` composes a new request on dispatch, attributes generic actions to `run-detail`, and owns pending single/bulk state. `bulk-dispatch.ts` admits Cancel while toolbar copy still names Retry. | S3 owns retained command identity, in-flight protection, Queue attribution, frozen bulk ordering and truthful copy/results. Consume the existing Rerun modal API. | P2/P5: double-click, stale revisions, exact replay, uncertain response, full per-target accounting and no direct retry/restart command. |
| `RunRecordService.deleteTree` and the existing SQLite deletion path own terminal checks, leaves-first deletion, tombstones and canonical replay. Generic UI settlement refreshes detail without exact deleted-selection handling. | S4 owns live Queue deletion integration and narrowly required established-contract repairs in the kernel/service/adapter. | P3/P4: terminal positive control, active/member/tree refusal, restart/replay, surviving custody and selection-switch race. No deletion-policy or retention redesign. |
| `reconcileWorkerAuthority()` fingerprints live runs as well as shared cards/batches; `#notify` emits snapshots for count-bearing changes. The client accepts snapshots and cursor-bound patches. No named remove/tombstone producer was found. | S5 uses and proves the existing snapshot protocol, repairing wakeups and selection reconciliation where necessary. Retain the declared remove/tombstone arms and record the verified equivalent protocol. | P4: fresh-snapshot equivalence after create/update/archive/delete, missed wakeup, reconnect and out-of-order delivery. No invented producer claim, enum removal or dropped convergence outcome. |
| Five historical run-record tests fail `no such table: run_search_actors`. The stopped-conversion constructor installs current search tracking, whose audit trigger references the newer table. Earlier Operations evidence also records historical `notification_publications` deletion failures. | S1 owns applicability corrections in historical conversion/search tracking and the notification deletion path, plus focused historical/current-schema tests. | P3 and storage gates: older supported formats remain executable through their admitted stopped-conversion capability; current missing/corrupt tables still fail loudly. No new DDL, silent current-schema fallback or released migration edit. |
| Three baseline assertions retain direct Retry/Restart or omit the accepted browser observation field. The command-result guard also rejects two forwarding layers and `.then(settleCommandResult)`. Current callers consume the forwarded result. | S1 owns exact fixture/assertion reconciliation and a bounded guard update that proves forwarding/caller consumption and recognizes the exhaustive fold callback. | Preserve refusal assertions and existing negative controls; add positive/negative proof for the admitted shapes. No broad exemption or ignored result. |

The task is synthetic-only: no deployment, migration or recovery against an actual operator target
is assigned, so an unrelated live-environment audit is not required. Historical compatibility
tests establish supported code behavior, not permission to upgrade a standing database.

The [approved Queue ownership amendment](task-9-establish-independent-dashboard-boundaries.md#queue-commands-and-convergence-ownership-amendment--2026-09-22)
releases only these required shared seams from the baseline reservations:

| Ownership | Exact existing paths / scope |
| --- | --- |
| Queue presentation and dispatch | `src/dashboard/surfaces/queue.tsx`, `queue-model.ts`, `queue-toolbar.tsx`, `workflow-batch.tsx`; `src/dashboard/app/command-dispatch.ts`, `bulk-dispatch.ts`; narrow Queue orchestration in `dashboard-app.tsx` and selection in `shell-selection-model.ts`; existing single-command/rename dialogs in `src/dashboard/surfaces/actions.tsx`. New sibling helpers may extract this owned logic. Preserve Settings navigation guards and accepted Run/Rerun behavior. |
| Query, stream and composition | `src/dashboard/client/queue-queries.ts`, `day-state.ts`, `subscription.ts` and necessary existing command transport; `src/server/dashboard/queries/queue-summaries.ts`, `projectors/run-queue-projection.ts`, `projectors/queue-row-actions.ts`, `commands/command-service.ts`, `subscriptions/dashboard-stream.ts`, `routes/queue.ts`, `routes/queue-types.ts`, `compose/queue.ts`, `compose/queue-summaries.ts`; narrow necessary Queue registration in `compose.ts` and existing route/client composition. Activity query implementation is not transferred. |
| Existing authority and strict wires | Narrow established-command/deletion corrections in `src/core/command-kernel.ts`, `src/core/run-record-service.ts`, `src/infra/sqlite/authority-database.ts`; historical search-tracking integration in `src/infra/sqlite/run-search-index.ts`. Necessary existing Queue refinements in `src/domain/dashboard/projection.ts`, `actions.ts`, `subscription.ts` and existing command schemas preserve the admitted vocabulary and semantics. No runtime-policy redesign. |
| Tests and fixtures | Assigned tests below; `tests/parity/helpers/fixture-queue.ts`, `fixture-queue-routes.ts`; narrowly affected shared fixture expectations identified by the baseline run; command-result guard and forwarding/caller proof. Existing transport/Run/worker behavior is input to that proof, not new product scope. Preserve unrelated fixture defaults. |
| New proof | `tests/unit/server/queue-commands-convergence.test.ts`, `tests/unit/dashboard/queue-command-lifecycle.test.ts`, `tests/parity/helpers/queue-authority-server.ts`, `tests/parity/queue-authority.spec.ts`. These are assigned future outputs, not current passes. |
| Shared generated/reference output | The sole supervisor owns any required Queue wire/guard registration, affected generated source outputs and deliberately attributed Queue references. Preserve combined scene membership, unrelated references and generator ownership. |

### Ordered implementation

1. **S1 — Admit the assignment and repair known baseline blockers.** Verify committed approval,
   prerequisite ancestry, exact base and checkout, capacity and resource ownership before edits.
   Read nearest module instructions, `/ui`, the existing design/specimen and relevant lessons.
   Repair the five historical-conversion failures caused by installing current search tracking
   against the older schema; also cover the recorded historical notification-deletion failure.
   Preserve supported historical formats and loud current-authority failure. Reconcile the three
   obsolete Rerun/browser-observation expectations. Update the command-result guard to recognize
   verified forwarding and `.then(settleCommandResult)` without losing its negative controls.
   Establish these focused prerequisites before the dependent Queue proofs.
2. **S2 — Finish Queue display and ordering.** Preserve canonical status, identity, worker/session
   facts, parent/member containment, batch membership and separately selectable existing attempt
   history. Serve canonical priority/enqueue/id order; explicitly selected display sorting remains
   presentation. Keep keyboard traversal aligned with rendered order. Verify bounded summary reads,
   stale/corrupt-generation refusal, and no heartbeat-only summary rewrite. Batch grouping changes
   remain version-bound presentation commands, not executable parents or additional run counts.
3. **S3 — Finish single and bulk dispatch.** Bind commands to reviewed target revisions and one
   retained request identity. Prevent duplicate in-flight dispatch; an uncertain response retains
   the same envelope for reconciliation/replay. Preserve frozen bulk target order and expose
   applied/conflict/refused/errored/unattempted results plus skipped/unavailable selections. Correct
   Queue source attribution and obsolete bulk Retry copy. Rerun opens the existing plan-backed
   modal; no direct retry/restart mutation returns. Do not infer success from transport completion.
4. **S4 — Finish live deletion and settlement.** Use canonical terminal-only, tree-safe deletion.
   Preserve insert-only tombstones, exact replay, released-key confirmation, shared-file custody
   and notification/history effects. Keep failures and incomplete settlement visible. Clear only
   the deleted selection; a late response must not close a different run selected meanwhile.
   Prove the actual lifecycle/storage effect and retained bytes, not just disappearance of a row.
5. **S5 — Prove stream convergence.** Use the existing snapshot protocol for count-bearing
   removals. Repair missing wakeups or selection reconciliation within this seam. Prove create,
   update, archive and delete for connected clients, missed notifications, reconnect, duplicate
   cursors and out-of-order delivery against a fresh authoritative snapshot. Retain declared
   remove/tombstone wire arms; removing them is unnecessary. Record the verified equivalent
   protocol and its limits without claiming broad 3.1.16 completion.
6. **S6 — Complete focused browser proof and freeze.** Exercise the built dashboard against real
   isolated SQLite/lifecycle/kernel/stream services. Run every assigned check, repair failures,
   commit logical changes, and record exact candidate, inputs, commands, exits and evidence.
   Return ready for operator integration; do not launch another task. After separate product
   integration instruction, preserve target drift, rerun invalidated checks, integrate locally and
   complete owned cleanup before closing the product checkboxes.

### Required proof

| Proof | Required result and negative control |
| --- | --- |
| P1 · Rows | Summary/canonical status agreement; exact members and batches; canonical ordering and explicit display sort; versioned group toggle; stale/corrupt summaries refuse; heartbeat does not republish summaries. Bounded pagination must retain every selected row without enumerating unrelated history. |
| P2 · Commands | Rename/bump/cancel and bulk use exact revisions. Stale version plus changed lifecycle has no effect. Claimed cancellation remains a request until worker settlement; UNKNOWN writes retain refusal. Double-click/replay causes one accepted effect. Partial bulk failure never becomes aggregate success; skipped/unavailable/unattempted targets remain distinguishable. Frozen selection and result order survive intervening view changes. |
| P3 · Delete | Active root/member/tree refuses without tombstones or removed bytes. A valid terminal tree deletes leaves-first. Restart/exact replay preserves disposition; divergent reuse refuses. Shared files and surviving owners remain intact. Historical and current-schema positive controls both work. Interrupted settlement retains evidence and exact identity; a missing current table is never treated as an old schema. |
| P4 · Convergence | Connected and reconnected clients match fresh authority after transfer/delete, including counts, grouping, notifications and selection. Late responses cannot resurrect rows or replace another selection. Preserve bounded backpressure and cursor semantics. Test lost wakeup, duplicate/same-cursor snapshot behavior, old-generation delivery and stale CAS beside worker transitions at their actual entry boundaries. |
| P5 · Desktop | Both themes; 1440×900, 1280×720 and 1024×768; resize to 1024×720 and back. Keyboard commands, dialogs, scroll access, focus return and actual 125%/200% browser zoom. Rerun handoff preserves accepted behavior and never creates a run before its existing final submission. |

Exercise each proof at its earliest stable boundary and retain a valid positive control beside
refusal tests. Fault injection may expose interruption or response loss; it must not replace the
canonical effect, result or bytes being asserted. Preserve source-bound replay and UNKNOWN-submit
restrictions. If a failed stateful proof needs another candidate, record its cause or specific
unresolved hypothesis, correction and fresh-versus-replayed evidence before repeating it. Do not
invent a new identity to bypass an uncertain effect.

### Focused gate and resource schedule

Run from the implementation checkout. Execute affected selectors during S1–S5 and every group
below before S6 freeze, including the three assigned new test files. The existing configuration
uses isolated file forks with at most four workers; preserve assertions, membership, isolation,
timeouts and coverage floors. Resolve actual file-worker configuration and host contention before
heavy runs. Do not kill peer processes or increase timeouts to clear a failure.

```sh
npm run test -- \
  tests/unit/summary-surfaces/queue.test.ts \
  tests/unit/run-summaries/ \
  tests/unit/server/queue-row-actions.test.ts \
  tests/unit/server/queue-row-subject-title.test.ts \
  tests/unit/server/run-queue-projection.test.ts \
  tests/unit/server/dashboard-stream.test.ts \
  tests/unit/server/dashboard-stream-backpressure.test.ts \
  tests/unit/server/bff-flow.test.ts \
  tests/unit/dashboard/queue-ordering.test.ts \
  tests/unit/dashboard/workflow-batches.test.ts \
  tests/unit/dashboard/bulk-dispatch.test.ts \
  tests/unit/dashboard/queue-bulk-band-sentence.test.ts \
  tests/unit/dashboard/day-state-splice.test.ts \
  tests/unit/dashboard/subscription.test.ts \
  tests/unit/dashboard/resource-boundaries.test.ts \
  tests/unit/dashboard/run-launch-recovery.test.ts

npm run test -- \
  tests/unit/command-kernel.test.ts \
  tests/unit/command-groups.test.ts \
  tests/unit/commands-authority.test.ts \
  tests/unit/run-record-service/service.test.ts \
  tests/unit/archive-transfer/ \
  tests/unit/server/archive-deletion-recovery.test.ts \
  tests/unit/run-search-index.test.ts \
  tests/unit/storage-supported-conversion.test.ts \
  tests/unit/architecture/one-projection-counts.test.ts \
  tests/unit/architecture/strict-boundary-schemas.test.ts \
  tests/unit/architecture/wire-connectivity.test.ts \
  tests/unit/architecture/dashboard-wire-boundary.test.ts \
  tests/unit/architecture/operator-mutation-admission.test.ts \
  tests/unit/architecture/command-result-exhaustive.test.ts \
  tests/unit/architecture/control-command-single-path.test.ts \
  tests/unit/architecture/no-lifecycle-sql-outside-the-adapter.test.ts \
  tests/unit/architecture/migration-history-immutability.test.ts

npm run test -- \
  tests/unit/server/queue-commands-convergence.test.ts \
  tests/unit/dashboard/queue-command-lifecycle.test.ts

npm run test:parity -- \
  tests/parity/dashboard-reference.spec.ts \
  tests/parity/reference-queue.spec.ts \
  tests/parity/workflow-batches.spec.ts \
  tests/parity/run-rerun.spec.ts \
  tests/parity/queue-authority.spec.ts \
  --workers=4
```

Run `npx eslint <exact changed TypeScript/TSX paths and executed test paths> --max-warnings 0`,
using an argument array derived from the implementation base and the resolved test selectors,
including newly added files. Scoped lint failures are task failures. Add meaningful neighboring
tests for actual changes and record their exact selectors; do not replace the named gates with
smaller checks. Guard additions/retirements require `docs/rebuild/guard-inventory.json` and the
membership proof in `tests/unit/architecture/guard-manifest.test.ts`.

Run `npm run build:manifest` then `npm run build:manifest:check` for changed descriptor-import
closure inputs, and `npm run stores:catalog` then `npm run stores:catalog:check` for changed store
catalog inputs. Otherwise record unchanged-input evidence. The parity lane's source-bound build
supplies the affected bundle proof; run `npm run web:build` separately only if that lane does not
establish it. Serialize generation, builds and reference writes sharing outputs. Deliberate
reference changes require before/after attribution and a subsequent assertion run, including
accessibility output, with existing tolerances and scene membership intact.

Use `/ui`, Components lead for the inherited surface and local verification. Read the existing
specimen before choosing primitives. Browser work uses `playwright-cli` and its personal playbook.
Use both Graphite Warm and Paper Ink with P5's desktop sizes. Record browser version, zoom mechanism
and effective CSS viewport for actual 125%/200% browser zoom; CSS zoom, device scale and viewport
changes alone are not that evidence.

Checks own private synthetic database/artifact/state/auth/lock roots, ephemeral ports and registered
process/browser handles, with awaited cleanup on success and failure. Do not use standing operator
ports or state. No external HR transaction is required; transaction-bearing synthetic fixtures use
`dryRun=true` or throwing external adapters. Never retry an UNKNOWN submit. No actual-target
upgrade/deployment is authorized by this historical-compatibility work.

Before freeze, retain commands, exits, log/input hashes and candidate identity for every gate.
At integration, compare relevant code/test/config/dependency inputs and rerun invalidated checks
after corrections, drift, missing evidence or uncertainty. Recording-only changes run
`npm run roadmap`, `npm run roadmap:check`,
`npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts`,
`npx eslint scripts/generate-roadmap.ts tests/unit/architecture/roadmap-doc-binding.test.ts --max-warnings 0`,
local link/instruction checks and `git diff --check`; do not repeat unchanged runtime checks just
for a documentation SHA.

### Exclusions, stops and planning state

Full typecheck, whole-repository lint/coverage, broad parity/performance/recovery and complete
A01–A42/D01–D05 acceptance remain **3.1.19**. Wider cross-surface convergence remains **3.1.16**;
detail/attempt-surface completion remains **3.1.14**. This task preserves existing attempt identities
and history; it does not introduce automatic comparison or claim those later tasks complete.

Exclude new DDL, released migration edits, runtime-policy redesign, new command semantics,
archive/deletion/retention policy changes, unrelated Activity implementation, shared DS redesign,
workflow admission, standing database migration, deployment/cutover and live HR writes. Preserve
the accepted Run/Rerun launcher and source immutability; no direct Retry/Restart Queue mutation,
bulk retry restoration or new bulk verb is admitted. Preserve other sessions' work.

Stop the affected work for changed contracts, additional schema work, ownership conflicts,
unavailable prerequisites or a material acceptance/exclusion conflict. Routine repairs within the
approved assignment stay with the supervisor; the nine known baseline failures have an explicit
owner here and are not deferred as supervisor discovery. No review, push, automatic product merge,
sibling or next-task dispatch is authorized.

| Planning state | Recorded status |
| --- | --- |
| Approval | Complete: operator approved the entire proposal and documentation release on 2026-09-22. |
| Implementation | Unstarted; all product checkboxes remain open. |
| Baseline diagnosis | 279 passing and nine failing tests across 16 files; scoped lint passed. No failure is waived. |
| Documentation release | This planner validates and commits the entire plan, verifies committed content and prerequisites, integrates the documentation locally, cleans only its owned documentation worktree/branch and returns the resolved supervisor prompt. |
| Readiness authority | The final planning receipt in the linked evidence directory binds exact plan/integration/base SHAs, checks, committed-content comparison, prerequisite ancestry and cleanup. A chat proposal alone is not launchable. |

### Planning validation and authorized release — 2026-09-22

| Check | Verified result |
| --- | --- |
| Documentation gates | Roadmap generation/freshness passed; all 24 roadmap binding tests passed; scoped lint of the generator and binding test passed. Final recording checks and their exact input hashes are retained in the planning evidence directory. |
| Scope / links / instructions | Exactly five approved documentation/generated-document paths changed. Local links resolve; nine existing instruction pairs are identical and 18 instruction chains remain below 32,768 bytes. `git diff --check` passed. No product code, tests, configuration, dependencies or operator state changed. |
| Plan completeness | S1–S6, P1–P5, approval, baseline failures and their repair ownership, exclusions, checkout/prerequisites, focused commands, resources and integration/cleanup conditions are persisted. All 37 existing named test/spec selectors resolve; three explicitly assigned future selectors remain unimplemented. The two whole-directory selectors name existing focused suites. Frozen acceptance outcomes are byte-identical to the persistence base. |
| Prerequisite availability | Both pinned prerequisite releases are ancestors of the inspected baseline. The accepted Operations record releases Queue. The final receipt rechecks ancestry and reachability from the integrated documentation release. |
| Product acceptance | Unstarted. Baseline diagnostic failures remain assigned to S1; planning makes no feature or full Phase 3.1 acceptance claim. |

The operator's approval includes local integration of this passing documentation candidate and
cleanup of only `codex/plan-3.1.13` and its assigned documentation checkout. The unrelated dirty
UI-planning worktree is retained. The [final planning receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.13-plan-2026-09-22/final-receipt.json)
records full plan/integration/base SHAs, committed-content verification, final checks and physical/ref
cleanup after those operations succeed. The copy-ready supervisor prompt uses that verified release;
the implementation branch/worktree is created only after the supervisor rechecks its binding.

### Focused acceptance and candidate freeze — 2026-09-22

| Proof | Verified result |
| --- | --- |
| P1 · Rows | Summary/canonical status agreement, exact members and batches, canonical priority/enqueue/id ordering (interactive before bulk), versioned group toggle, stale/corrupt summaries refusal, heartbeat summary non-republication, and bounded pagination preserving selections passed. Verified in `final-queue-rows`. |
| P2 · Commands | Rename/bump/cancel and bulk commands use exact revisions. Stale versions refuse. Claimed cancellation remains a request until worker settlement. Replay and in-flight deduplication cause one accepted effect. Partial bulk failures expose granular results with individual statuses. Frozen selection and result order survive intervening view changes. Verified in `final-commands-authority` and `final-convergence`. |
| P3 · Delete | Active root/member/tree refuses deletion without tombstones. Valid terminal tree deletes leaves-first. Exact replay preserves disposition; divergent reuse refuses. Shared files and surviving owners remain intact. Historical and current-schema controls pass. Interrupted settlement retains evidence and exact identity. Selection-switch protection verified. Verified in `final-commands-authority` and `final-convergence`. |
| P4 · Convergence | Connected and reconnected clients match fresh authority after transfer/delete, including counts, grouping, notifications and selection. Late responses cannot resurrect rows or replace another selection. Bounded backpressure, duplicate cursor, and lost wakeup convergence proved. Verified in `final-convergence`. |
| P5 · Desktop | Both themes (Graphite Warm, Paper Ink) across 1440×900, 1280×720, and 1024×768, resize to 1024×720 and back, dialog accessibility, and focus return to triggering action verified. Rerun launcher handoff preserves accepted behavior. Verified in `final-parity`. |

| Assigned gate | Result |
| --- | --- |
| Queue rows group | `final-queue-rows`: 20 test files, **354 tests passed** (exit 0). |
| Commands authority & storage group | `final-commands-authority`: 24 test files, **395 tests passed** (exit 0). |
| Queue commands & stream convergence | `final-convergence`: 2 test files, **15 tests passed** (exit 0). Total focused runtime proof: **764 tests across 46 files**. |
| Scoped static checks | `final-scoped-lint`: exact 66 TypeScript/TSX paths passed (0 errors, 0 warnings). Scoped check per Phase 3.1 cadence. |
| Generated inputs | `generated-manifest-check` and `store-catalog-check` passed (exit 0). |
| Built browser/reference gate | `final-parity`: all five assigned specs, **27 tests passed** (exit 0). Real isolated SQLite/lifecycle/kernel/stream services; desktop viewports (1440×900, 1280×720, 1024×768) and resize; both themes; accessibility indicators and focus return verified. |
| Reference attribution | Twelve existing Queue scenes (36 PNG/accessibility/metadata files) deliberately refreshed with unchanged membership and tolerances to reflect canonical priority ordering and action accessibility. `reference-attribution.json` binds before/after hashes. |

### Freeze boundary and retained resources

All ephemeral services, synthetic databases, and browser sessions are cleanly terminated and closed.
Evidence is retained in `/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.13-queue-2026-09-22/`.
Branch `codex/3.1.13-queue` and worktree `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-queue`
remain assigned awaiting operator instruction for local-master integration.
Master remains clean at `1afdefcfb5f6b301a9f0674a0e78a9a513a4ac9c`; the unrelated UI-planning worktree remains preserved.
Full repository typecheck, repository-wide lint/coverage, and complete acceptance (A01–A42/D01–D05) remain deferred to Task 3.1.19.

### Review repair and refreshed candidate freeze — 2026-09-22

The implementation repair is committed on `codex/3.1.13-queue` as
`e833c684eb9cf332695893513b56ccfdc11669c4`. This supplements the earlier
S6 receipt: its 27-test parity result and missing zoom proof are superseded by
the 30-test assertion below. No reference image or accessibility baseline changed.

- An uncertain single or bulk command retains its complete original request. The
  queue keeps a visible recovery control even after the row disappears. A new
  selection opens a dialog naming the original targets, revisions and any
  rename value; only an explicit recovery press resends the exact envelope.
  A stale dialog cannot mint a new request. Browser fault injection proves a
  response lost after authority accepted a bulk cancel or deletion, identical
  replay, unchanged newer selection and one accepted effect.
- Delete settlement clears the selected detail and every deleted run in the
  bulk set using the authoritative `affectedTargets` vector. A browser test
  deletes a valid terminal group and its children while preserving a selected
  survivor. The synthetic group's test-only dependency edges are installed
  before deletion; the production authority refuses an inconsistent tree.
- The command-result guard counts only the fulfillment arm of `.then`; its
  rejection-arm-only negative control fails as intended.
- The queue lifecycle fixture now resolves its temporary root before opening
  credential authority. A direct Vitest run changed from five failures with
  `directory-integrity: credential path ancestry contains a symbolic link` to
  10/10 passing without relaxing the production integrity check. The seeded
  browser command service now gives each command a distinct audit ID.
- Actual Chromium tab zoom is applied through `chrome.tabs.setZoom` in an owned
  Manifest V3 test extension. Both themes proved 125% (effective 1024×576,
  DPR 1.25) and 200% (640×360, DPR 2), empty document/body CSS zoom, visible
  Queue, and scrollable keyboard access. Chromium reports
  `HeadlessChrome/149.0.0.0` in the retained user agent.

| Refreshed gate | Result |
| --- | --- |
| Queue rows | `repair-2026-09-22/final-queue-rows`: 354/354 passed. |
| Commands, authority and storage | `repair-2026-09-22/final-commands-authority`: 395/395 passed. |
| Queue convergence | `repair-2026-09-22/final-convergence`: 15/15 passed. |
| Guard inventory and command-result guard | `repair-2026-09-22/guard-check`: 14/14 passed. |
| Built browser assertion | `repair-2026-09-22/final-parity`: 30/30 passed across the five assigned specs. |
| Static and generated checks | `repair-2026-09-22/final-scoped-lint`: 68 paths passed; `final-scoped-types`: eight affected files have no diagnostics. Manifest and catalog freshness checks passed. |

The retained [repair evidence](/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.13-queue-2026-09-22/repair-2026-09-22/)
includes each command, exit, input and log hashes, the red/green credential
reproducer, final browser JSON/screenshots, [zoom proof](/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.13-queue-2026-09-22/repair-2026-09-22/zoom-proof.json)
and recovery-dialog capture. Full repository typecheck, whole-repository lint
and coverage, and complete acceptance remain assigned to 3.1.19. Local-master
integration and owned worktree cleanup remain subject to the plan's explicit
operator integration instruction.


### Accepted local integration and closure — 2026-09-22

The operator explicitly authorized integration after the corrected candidate
freeze. Local `master` merged candidate
`51fd2ef20f29f695a9bc884bb65262b967f734b6` in merge commit
`2f97dae45e62ee6d046cbe90ef1673e993ea85e6`. The merge has no conflicts;
its object tree `f9bbaa00703ac7e4c6f4c7f36793b167e921b0d2` is byte-identical to
the focused-green candidate. The candidate is an ancestor of local `master`.
No runtime gate inputs changed during integration, so the focused receipts above
remain valid under the approved cadence. The worktree registration and physical
folder `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-queue`
are absent, and `codex/3.1.13-queue` was deleted after its tip was verified
incorporated. Ignored local outputs were preserved outside the checkout before
removal. The unrelated dirty UI-planning worktree and branch remain untouched.
The [integration receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.13-queue-2026-09-22/integration-2026-09-22/final-receipt.json)
records exact integration, evidence, gate reuse, cleanup and retained resources.
No push, standing database migration, external HR write or next-task dispatch
occurred. Full repository gates and acceptance remain assigned to 3.1.19.
