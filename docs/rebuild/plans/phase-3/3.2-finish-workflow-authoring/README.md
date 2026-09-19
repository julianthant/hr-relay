# Phase 3.2 · Finish workflow authoring and freeze the acceptance candidate

**D341 input foundation (approved 2026-09-07).** Author new workflows against the completed shared
test-data/fixture interface. Public labels and named safe assets live in tracked test configuration;
real canaries/private paths live in ignored local test configuration, outside application settings.
Structural cases stay synthetic. The operator reset existing rebuild runtime data; historical
previews remain documentary history only, never a substitute for this phase’s fresh live acceptance.
This phase does not finish deferred fixture consolidation: the detour owns its complete delivery.

Read the [phase overview](../README.md) for shared context, decisions and phase-wide exit criteria.

Phase 3.2 owns every activity that may still change the workflow compiler, shared runtime,
Person Lookup, Separations, their task-store substrate, or their read-only acceptance evidence.
It closes by freezing one exact acceptance candidate. Phase 3.3 may exercise real write authority
only against that candidate.

D329 replaces the former `03b`/`03c`, 3c-A/3c-B, and Separations-before-authoring plan. The old
documents remain verbatim in `history/superseded/`; their commits and observations are evidence to
reverify, not current completion authority. The current source wins over every carried claim.

## Current assignment names

The operator's 2026-09-19 amendment names concrete deliverables, permits sequential subtasks and
moves integration under the feature it finishes. Stable node IDs and every existing proof obligation
are retained. Old assignment numbers are historical aliases; new focused plans use the current map.

| Current task | Deliverable | Previous assignment |
| --- | --- | --- |
| 3.2.1 | Finish the workflow compiler | 3.2.1 |
| 3.2.2 | Finish Separations data reads | 3.2.2 |
| 3.2.3 | Finish safe Separations transactions | 3.2.3 |
| 3.2.4 | Connect workflows to the shared runtime | 3.2.3.1 |
| 3.2.5 | Finish the workflow author guide | 3.2.3.2 |
| 3.2.5.1 | Make guide examples reproduce runtime behavior | 3.2.7 |
| 3.2.6 | Finish shared workflow registration and test fixtures | 3.2.4 |
| 3.2.7 | Finish Person Lookup | 3.2.4.1 |
| 3.2.8 | Finish the compiled Separations workflow | 3.2.4.2 |
| 3.2.8.1 | Connect compiled workflows to dashboard evidence | 3.2.8 |
| 3.2.8.2 | Finish the Separations dry-run preview | 3.2.5 |
| 3.2.9 | Freeze the tested acceptance candidate | 3.2.6 |

**Order:** 1 → 2 → 3 → **Parallel: 4 / 5** → 5.1 → 6 → **Parallel: 7 / 8** → 8.1 → 8.2 → 9.
The authoring pair shares the `authoring` Parallel label; the workflow pair shares `workflows`.
Tasks 5.1 and 8.1 are sequential integration subtasks with concrete reproducible-example and
registered-dashboard outcomes. Their focused checks establish an accepted development base;
full gates belong only to Task 9 at this phase's end.

The focused plans still bind stable inputs, disjoint paths, private runtime/live-session resources,
independent acceptance, either-order integration, available capacity and an integration/cleanup owner.
No parallel label dispatches work or authorizes a merge. Independent review requirements remain.
A task's own implementation can be accepted as an explicit prerequisite base before its extension
subtasks start; completing the whole feature also requires those subtasks. No unfinished sibling API
is a prerequisite. Existing test floors, transaction boundaries and candidate-freeze rules remain.

## Verification cadence

Tasks 1–8.2 run affected tests, lint and affected static/generated checks, including their intermediate
integration and repairs. Record actual commands, results, candidate identity and deferred broad gates.
Task 9 runs typecheck, lint, full coverage and every applicable phase-wide gate under
[the D191 phase-exit rule](../../../reference/guards-and-tests.md#phase-exit-gates-from-3-2).
Task 9 remains an independent read-only audit: failures return to bounded 3.2 remediation, then the
audit and invalidated full gates restart against the corrected candidate before freeze.

## Phase 3 chronology
<!-- roadmap: phase-3 -->

<!-- roadmap-status: phase-3 -->
- [x] 3.1 remains the prerequisite shared-dashboard part under D326/D328
- [ ] 3.2 verifies every mutable workflow seam, completes read-only acceptance, and freezes one exact candidate
- [ ] 3.3 exercises controlled write authority only against that frozen candidate
- [?] 3.4 offers optional document tools; no feature blocks the required phase sequence
- [ ] 3.5 proves attributed Codex/Claude cooperation and closes Phase 3
> 2026-09-07 | D342 optional documents | optional 3.4 inserted; cooperation moves to 3.5; 3.2/3.3 freeze and proof rules unchanged
> 2026-09-04 | D329 chronology correction | authoring and read-only acceptance now precede the frozen-candidate controlled proof; the old lettered filenames and active 3c-A/3c-B structure are retired
<!-- /roadmap-status -->

## Phase summary
<!-- roadmap: workflow-authoring-model -->

<!-- roadmap-status: workflow-authoring-model -->
> 2026-09-19 | tangible tasks | current deliverable map and Parallel labels replace scheduling wrappers; full gates move to Task 9 at phase exit; implementation remains open
- [~] Tasks 1–3 carry substantial landed implementation, but each remains current-verification pending
- [ ] Tasks 4 and 5 finish runtime integration and the author guide independently after Task 3; Task 5.1 reconciles their runnable examples
- [ ] Task 6 finishes shared registration/fixtures; Tasks 7 and 8 finish Person Lookup and Separations in parallel without real writes; Task 8.1 connects their dashboard evidence
- [ ] Task 8.2 records a current-source Separations dry-run preview with exact 0/0/0 write-authority evidence
- [ ] Task 9 independently audits and freezes the acceptance candidate
> 2026-09-04 | D329 replan | consolidated nineteen old tasks into nine current seams with a complete crosswalk; historical completion no longer substitutes for proof at current HEAD
<!-- /roadmap-status -->

### Governing boundary

The phase owns code-changing and diagnostic work. Read-only live checks belong here because they can
expose selector, runtime, compiler, workflow, or target defects before the candidate is frozen. A
revalidation supervisor may repair a defect wholly inside its assigned seam. A cross-seam defect
creates a newly numbered remediation task.

Task 9 (previous assignment 3.2.6) is audit-only. It fixes nothing. Any failure returns to a focused Phase 3.2 remediation task,
invalidates the candidate, and requires the audit to restart. The frozen record names:

- the exact git commit and generated build manifest;
- Person Lookup and Separations contract fingerprints;
- the resolved runtime/configuration schema without secret values;
- the focused proof artifacts and exact current live-read/dry-run result ids; and
- green typecheck, lint, full coverage (including architecture), parity, manifest, store-catalog, and roadmap gates.

## Task 1 · Finish the workflow compiler
<!-- roadmap: workflow-authoring-core -->

**Previous assignment:** 3.2.1. Current scope and acceptance remain binding.

<!-- roadmap-status: workflow-authoring-core -->
- [~] D311–D318 implementation and deletion acceptance landed historically through `ab04231c`; current verification is required
- [ ] verify one `workflow.ts` authoring seam, final D317 names, direct entry algebra, omissions, recovery, and compiled products at current HEAD
- [ ] verify the four-artifact/change-routing guards and prove the retired descriptor/module/fragment authoring path is absent
- [ ] finish the shared T1–T3 collection layout, component render lane, and 80/80/80 global coverage floor carried from the former test-tiers task
- [ ] repair only defects wholly inside the compiler/authoring seam; route cross-seam findings to a new task
> 2026-09-04 | D329 carry-forward | absorbs former 3.3 Task 1; no historical checkbox survives without current-source inspection and red-capable proof
<!-- /roadmap-status -->

This task owns the shared authoring/compiler boundary. It does not accept either workflow and never
touches a live write.

## Task 2 · Finish Separations data reads
<!-- roadmap: workflow-task-substrate -->

**Previous assignment:** 3.2.2. Current scope and acceptance remain binding.

<!-- roadmap-status: workflow-task-substrate -->
- [~] Kuali, UCPath, and New Kronos reads and the Separations mini-store landed historically; current verification is required
- [ ] verify strict contracts, driver boundaries, selectors/provenance, task registration, and provenance recording for every consumed leaf
- [ ] verify no retired descriptor/module/fragment path remains load-bearing
> 2026-09-04 | D329 carry-forward | absorbs former 3.2 Tasks 1–3
<!-- /roadmap-status -->

## Task 3 · Finish safe Separations transactions
<!-- roadmap: workflow-write-mechanics -->

**Previous assignment:** 3.2.3. Current scope and acceptance remain binding.

<!-- roadmap-status: workflow-write-mechanics -->
- [~] termination, pending-sweep, Kuali finalization, D309 identity authority, and D310 exact-set/filing-survival mechanics landed historically; current verification is required
- [ ] verify prepare/probe/fence/commit/verify contracts with fake external systems and red-capable negative controls
- [ ] verify no software path can delete the filing that Kuali finalization cites, bypass identity authority, or repeat a completed write
- [ ] finish the software-only recovery, failure-explain, knowledge-record, and capability-disposition obligations carried from former 3.2 Task 10
- [ ] perform no live write and claim no controlled-commit evidence
> 2026-09-04 | D329 carry-forward | absorbs former 3.2 Tasks 4–5, Task 9, and the software portions of Task 10
<!-- /roadmap-status -->

Complete the shared compiler/runtime/fixture changes needed by Tasks 4 and 5. Their focused plans
bind separate artifacts, private resources and exact focused checks before concurrent execution.
Both use this accepted base and can integrate in either order without an unmerged sibling.

## Task 4 · Connect workflows to the shared runtime
<!-- roadmap: workflow-runtime-inheritance -->

**Previous assignment:** 3.2.3.1. Current scope and acceptance remain binding.

<!-- roadmap-status: workflow-runtime-inheritance -->
- [ ] prove a compiled workflow inherits worker/session acquisition, authentication, checkpoints, semantic logs, screenshots, receipts, notifications, and Archive without workflow-specific glue
- [ ] include one broken-link negative control that fails through the production composition boundary
> 2026-09-04 | D329 move | former 3.3 Task 2 now runs before either acceptance workflow can freeze
<!-- /roadmap-status -->

**Parallel · authoring.** Run independently of Task 5 after the accepted Task 3 base.
Task 5.1 reconciles the runtime path with the guide's examples using focused checks.

## Task 5 · Finish the workflow author guide
<!-- roadmap: workflow-guide-proof -->

**Previous assignment:** 3.2.3.2. Current scope and acceptance remain binding.

<!-- roadmap-status: workflow-guide-proof -->
- [ ] follow the canonical guide for Person Lookup and Separations without undocumented steps, extra authored files, or escape hatches
- [ ] correct the guide or authoring contract for every discovered mismatch and re-prove the path from a clean context
> 2026-09-04 | D329 move | former 3.3 Task 3 now runs before workflow acceptance and candidate freeze
<!-- /roadmap-status -->

**Parallel · authoring.** Run independently of Task 4 after the accepted Task 3 base.
Task 5.1 finishes reproducible examples on the combined result.

## Task 5.1 · Make guide examples reproduce runtime behavior
<!-- roadmap: workflow-proof-finalizer -->

**Previous assignment:** 3.2.7. Sequential subtask after Tasks 4 and 5, required before Task 6.

- [ ] combine exact reviewed runtime/guide candidates and make the documented examples exercise the inherited runtime behavior without undocumented wiring
- [ ] reconcile generated products and fix guide/runtime mismatches with regression proof
- [ ] run affected tests, lint and applicable static/generated checks; obtain required independent review of fixes and the combined result
- [ ] record the accepted example/runtime base and owned cleanup; defer full gates to Task 9

The deliverable is reproducible author-guide examples against the integrated runtime. It creates no
live-write authority and does not absorb the final independent audit/freeze.

## Task 6 · Finish shared workflow registration and test fixtures
<!-- roadmap: workflow-acceptance-foundation -->

**Previous assignment:** 3.2.4. Current scope and acceptance remain binding.

- [ ] accept the integrated runtime-inheritance and clean-context guide proofs on an exact base
- [ ] complete shared registration, fixture, generated-product or contract changes needed by both workflow acceptance tasks
- [ ] bind disjoint paths, private runtime/live-session resources, generated-output ownership and independently passing gate commands for 3.2.7/3.2.8
- [ ] verify either-order integration and record the reviewed, merged prerequisite; do not claim workflow acceptance or freeze here

The delivered feature is shared workflow registration and reusable test fixtures, including their
generated products. This remains planned scope, not a launch-ready brief. Use `/phase-plan` before
implementation.
If a workflow later exposes a shared defect outside its assignment, return it to the operator for
focused remediation. Peers may clarify the defect and propose a resolution; changed contracts or
ownership require an operator-approved plan amendment before affected writes resume.

## Task 7 · Finish Person Lookup
<!-- roadmap: person-lookup-acceptance -->

**Previous assignment:** 3.2.4.1. Current scope and acceptance remain binding.

<!-- roadmap-status: person-lookup-acceptance -->
- [~] the final workflow conversion and one historical `live-read` result exist; Search/Match and current authority must be reconciled before completion
- [ ] verify the final compiled definition, Search and Match behavior, generic projections, structural T1, and any genuinely new T2/T3 interaction
- [ ] record a current transaction-free `live-read` with exact before/after 0/0/0 write-authority deltas
- [ ] reconcile `docs/rebuild/migrations/person-lookup.md` and capability dispositions to current behavior
> 2026-09-04 | D329 carry-forward | absorbs former 3.3 Task 4 and its nested dashboard evidence
<!-- /roadmap-status -->

**Parallel · workflows.** Run independently of Task 8 after accepted Task 6 registration/fixtures.
Task 8.1 reconciles generated registration and dashboard evidence from both accepted workflows.

## Task 8 · Finish the compiled Separations workflow
<!-- roadmap: separations-compiled-acceptance -->

**Previous assignment:** 3.2.4.2. Current scope and acceptance remain binding.

<!-- roadmap-status: separations-compiled-acceptance -->
- [~] composition, dashboard scenarios, workflow layout, final `workflow.ts`, and public-equivalence proofs landed historically; current verification is required
- [ ] verify the nineteen-node behavior, omissions, conditional identity authority, transaction fences, checkpoints, screenshots, logs, receipts, and generic projections from the final compiler
- [ ] verify structural T1 and only the T2/T3 cases justified by genuinely new interaction or wire behavior
- [ ] settle or route every inherited Separations dashboard/operator-surface discrepancy before the candidate can freeze
- [ ] reconcile the final compiled workflow against the migration record without converting structural proof into controlled-write evidence
> 2026-09-04 | D329 carry-forward | absorbs former 3.2 Tasks 6, 11, and 12 plus former 3.3 Task 5
<!-- /roadmap-status -->

**Parallel · workflows.** Run independently of Task 7 after the accepted Task 6 base.
Tasks 8.1 and 8.2 finish integrated dashboard evidence and the current live dry-run preview.

## Task 8.1 · Connect compiled workflows to dashboard evidence
<!-- roadmap: workflow-acceptance-finalizer -->

**Previous assignment:** 3.2.8. Sequential subtask after Tasks 7 and 8, required before Task 8.2.

- [ ] combine reviewed Person Lookup and Separations candidates and reconcile their generated registry/manifest/catalog output
- [ ] verify both registered workflows produce the required dashboard projections and evidence through shared production composition
- [ ] obtain required current transaction-free/live-read evidence under the existing exact 0/0/0 contract; no controlled write
- [ ] fix integration failures with regression tests, run affected tests/lint/static/generated checks and obtain required independent review
- [ ] record the accepted integrated workflow base and owned cleanup; defer full gates to Task 9

Bind branch/worktree/base/target, focused commands, deferred full gates, resource ownership and
integration permission before execution. Cross-scope changes return to planning. This subtask
finishes workflow wiring and evidence, not candidate freeze or Phase 3.3 admission.

## Task 8.2 · Finish the Separations dry-run preview
<!-- roadmap: separations-readonly-acceptance -->

**Previous assignment:** 3.2.5. Current scope and acceptance remain binding.

<!-- roadmap-status: separations-readonly-acceptance -->
- [~] historical previews remain evidence; the 2026-09-03 replacement run failed at New Kronos with 0/0/0 write authority and did not meet the strict T1b gate
- [ ] reverify the selected closed Kuali document and every live read against the integrated Task 8 workflow after Task 8.1
- [ ] reach the declared dry-run preview terminal and record a fresh `met` T1b result with exact-run 0/0/0 intents/attempts/outbox
- [ ] route any software defect to a new Phase 3.2 remediation task; do not weaken or waive the gate
> 2026-09-04 | D329 carry-forward | absorbs former 3.2 Tasks 7–8 and the live remainder of Task 12
<!-- /roadmap-status -->

## Task 9 · Freeze the tested acceptance candidate
<!-- roadmap: workflow-candidate-freeze -->

**Previous assignment:** 3.2.6. Current scope and acceptance remain binding.


> **D339 (2026-09-06):** verify the required shipped workflow journeys and recorded optional-screen
> deferrals from 3.1. Deferred generic pages and advanced recovery UI do not reopen the candidate;
> missing workflow-required UI does. Every existing write-safety and exact-candidate obligation remains.

<!-- roadmap-status: workflow-candidate-freeze -->
- [ ] independently verify every prerequisite, parallel and read-only acceptance claim against current source and durable evidence
- [ ] run the complete integrated gate family and verify generated artifacts are current
- [ ] record the exact candidate identity and prove no parked write remains against a closure that will change
- [ ] close every Phase 3.2 worktree, branch, task, and coordinator residue before unlocking Phase 3.3
> 2026-09-04 | D329 new boundary | absorbs the T1–T3/gate portion of former 3.3 Task 6; the audit is read-only and returns failures to a focused 3.2 remediation task
<!-- /roadmap-status -->

## Previous-plan crosswalk

Old task numbers are historical lookup keys only. This table is the complete bridge from the two
superseded plans to the new authoritative task structure.

| Superseded task | Current owner | Carried evidence |
|---|---|---|
| former 3.2 Tasks 1–3 | 3.2 Task 2 | New Kronos, Kuali, and UCPath reads plus the Separations mini-store |
| former 3.2 Tasks 4–5 | 3.2 Task 3 | UCPath termination/pending-sweep and Kuali finalization transaction mechanics |
| former 3.2 Task 6 | 3.2 Tasks 8–8.2 | composed Separations behavior |
| former 3.2 Tasks 7–8 | 3.2 Task 8.2 | historical dry-run and preview-terminal observations |
| former 3.2 Task 9 | 3.2 Tasks 2–3 and 8 | task/runtime defects exposed by the first live pass, routed by current owner |
| former 3.2 Task 10 | 3.2 Task 3; 3.3 Tasks 1–4 | software recovery mechanics here; controlled evidence and close in Phase 3.3 |
| former 3.2 Tasks 11–12 | 3.2 Tasks 8–8.2 | dashboard/T1/layout evidence and the still-open strict live result |
| former 3.2 Task 13 | 3.3 Tasks 1–4 | target decisions, controlled proofs, and close |
| former 3.3 Task 1 | 3.2 Task 1 | workflow-definition/compiler core and deletion acceptance |
| former 3.3 Tasks 2–3 | 3.2 Tasks 4–5.1 | runtime inheritance and clean-context guide proof |
| former 3.3 Task 4 | 3.2 Task 7 | Person Lookup acceptance |
| former 3.3 Task 5 | 3.2 Tasks 8–8.2 | compiled Separations acceptance |
| former 3.3 Task 6 | 3.2 Tasks 1, 7–9; 3.3 Task 4; 3.5 Task 3 | shared test infrastructure and T1–T3 implementation in 3.2; candidate audit/freeze in 3.2 Task 9; final evidence/lifecycle close in 3.3; T4 remains with the cooperation proof |

## Exit criteria

Phase 3.2 closes only when all nine feature/outcome tasks and their required subtasks are current-source verified, Person Lookup has a current
`live-read`, Separations has a fresh green dry-run preview, the exact acceptance candidate is frozen,
all integrated gates pass, and every owned execution row is closed. A historical commit, green test
from an earlier fingerprint, or old task checkbox is never sufficient by itself.

## What Phase 3.3 may assume

Phase 3.3 may assume only the recorded frozen candidate and its evidence. It may not modify source,
reinterpret a failed rehearsal, substitute a target, or carry authority across candidate drift. A
defect returns to Phase 3.2; a new candidate supersedes the old one and restarts affected acceptance.
