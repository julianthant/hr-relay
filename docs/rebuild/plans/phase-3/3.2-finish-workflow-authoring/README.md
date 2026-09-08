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

## Current assignment names (D344)

| Current task | Outcome | Historical task alias |
| --- | --- | --- |
| 3.2.1 | Authoring platform | 1 |
| 3.2.2 | Read/store substrate | 2 |
| 3.2.3 | Safety mechanics and shared proof prerequisite | 3 |
| 3.2.3.1 | Runtime inheritance proof | 4-1 |
| 3.2.3.2 | Clean-context guide proof | 4-2 |
| 3.2.4 | Independent workflow acceptance base | new prerequisite |
| 3.2.4.1 | Person Lookup acceptance | 5-1 |
| 3.2.4.2 | Compiled Separations acceptance | 5-2 |
| 3.2.5 | Current Separations read-only acceptance | 6 |
| 3.2.6 | Candidate audit and freeze | 7 |

Complete and merge 3.2.3 before launching 3.2.3.1/3.2.3.2. Both proofs feed 3.2.4;
complete that prerequisite before launching 3.2.4.1/3.2.4.2. Each pair is independent and
supports either merge order. Parent acceptance excludes its children's unfinished work. Exact
shared ownership, independent gates and private runtime/live-session resources must be settled
before launch under [D344](../../../../roadmap/roadmap.md#d344--operator-coordinated-prerequisite-groups-2026-09-08).
The operator chooses launches and integration. Agents work independently by default and coordinate
when necessary under D344 to resolve blockers, overlap or duplicate effort; no automatic merge.
Historical headings below are citation aliases. Current assignments use the table above.

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
- [~] Tasks 1–3 carry substantial landed implementation, but each remains current-verification pending
- [ ] Tasks 3.1 and 3.2 prove runtime inheritance and the author guide independently after Task 3
- [ ] Task 4 establishes the independent acceptance base; Tasks 4.1 and 4.2 accept the workflows in parallel without real writes
- [ ] Task 5 records a current-source Separations dry-run preview with exact 0/0/0 write-authority evidence
- [ ] Task 6 independently audits and freezes the acceptance candidate
> 2026-09-04 | D329 replan | consolidated nineteen old tasks into nine current seams with a complete crosswalk; historical completion no longer substitutes for proof at current HEAD
<!-- /roadmap-status -->

### Governing boundary

The phase owns code-changing and diagnostic work. Read-only live checks belong here because they can
expose selector, runtime, compiler, workflow, or target defects before the candidate is frozen. A
revalidation supervisor may repair a defect wholly inside its assigned seam. A cross-seam defect
creates a newly numbered remediation task.

Task 6 (historical Task 7) is audit-only. It fixes nothing. Any failure returns to a focused Phase 3.2 remediation task,
invalidates the candidate, and requires the audit to restart. The frozen record names:

- the exact git commit and generated build manifest;
- Person Lookup and Separations contract fingerprints;
- the resolved runtime/configuration schema without secret values;
- the focused proof artifacts and exact current live-read/dry-run result ids; and
- green typecheck, lint, coverage, architecture, parity, manifest, store-catalog, and roadmap gates.

## Task 1 · Verify the workflow-definition platform
<!-- roadmap: workflow-authoring-core -->

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

## Task 2 · Revalidate the Separations read and task-store substrate
<!-- roadmap: workflow-task-substrate -->

<!-- roadmap-status: workflow-task-substrate -->
- [~] Kuali, UCPath, and New Kronos reads and the Separations mini-store landed historically; current verification is required
- [ ] verify strict contracts, driver boundaries, selectors/provenance, task registration, and provenance recording for every consumed leaf
- [ ] verify no retired descriptor/module/fragment path remains load-bearing
> 2026-09-04 | D329 carry-forward | absorbs former 3.2 Tasks 1–3
<!-- /roadmap-status -->

## Task 3 · Revalidate Separations transaction and safety mechanics
<!-- roadmap: workflow-write-mechanics -->

<!-- roadmap-status: workflow-write-mechanics -->
- [~] termination, pending-sweep, Kuali finalization, D309 identity authority, and D310 exact-set/filing-survival mechanics landed historically; current verification is required
- [ ] verify prepare/probe/fence/commit/verify contracts with fake external systems and red-capable negative controls
- [ ] verify no software path can delete the filing that Kuali finalization cites, bypass identity authority, or repeat a completed write
- [ ] finish the software-only recovery, failure-explain, knowledge-record, and capability-disposition obligations carried from former 3.2 Task 10
- [ ] perform no live write and claim no controlled-commit evidence
> 2026-09-04 | D329 carry-forward | absorbs former 3.2 Tasks 4–5, Task 9, and the software portions of Task 10
<!-- /roadmap-status -->

Before closing current 3.2.3, settle the runtime-proof/guide-proof ownership boundary. Complete
shared compiler/runtime/fixture changes; bind separate proof artifacts and exact gates. Demonstrate
both children can pass from this base and integrate in either order without an unmerged sibling.

## Task 4-1 · Prove automatic runtime inheritance
<!-- roadmap: workflow-runtime-inheritance -->

**Current assignment: 3.2.3.1.** The heading is a historical citation alias.

<!-- roadmap-status: workflow-runtime-inheritance -->
- [ ] prove a compiled workflow inherits worker/session acquisition, authentication, checkpoints, semantic logs, screenshots, receipts, notifications, and Archive without workflow-specific glue
- [ ] include one broken-link negative control that fails through the production composition boundary
> 2026-09-04 | D329 move | former 3.3 Task 2 now runs before either acceptance workflow can freeze
<!-- /roadmap-status -->

Current 3.2.3.1 and 3.2.3.2 run independently after their accepted parent prerequisite 3.2.3.
Use the operator-approved ownership and integration conditions above.

## Task 4-2 · Prove the workflow-author guide from clean contexts
<!-- roadmap: workflow-guide-proof -->

**Current assignment: 3.2.3.2.** The heading is a historical citation alias.

<!-- roadmap-status: workflow-guide-proof -->
- [ ] follow the canonical guide for Person Lookup and Separations without undocumented steps, extra authored files, or escape hatches
- [ ] correct the guide or authoring contract for every discovered mismatch and re-prove the path from a clean context
> 2026-09-04 | D329 move | former 3.3 Task 3 now runs before workflow acceptance and candidate freeze
<!-- /roadmap-status -->

## Task 4 · Establish the independent workflow acceptance base
<!-- roadmap: workflow-acceptance-foundation -->

- [ ] accept the integrated runtime-inheritance and clean-context guide proofs on an exact base
- [ ] complete shared registration, fixture, generated-product or contract changes needed by both workflow acceptance tasks
- [ ] bind disjoint paths, private runtime/live-session resources, generated-output ownership and independently passing gate commands for 3.2.4.1/3.2.4.2
- [ ] verify either-order integration and record the reviewed, merged prerequisite; do not claim workflow acceptance or freeze here

This is a prerequisite scope, not a launch-ready brief. Use `/phase-plan` before implementation.
If a workflow later exposes a shared defect outside its assignment, return it to the operator for
focused remediation. Peers may clarify the defect and propose a resolution; changed contracts or
ownership require an operator-approved plan amendment before affected writes resume.

## Task 5-1 · Complete and accept Person Lookup
<!-- roadmap: person-lookup-acceptance -->

**Current assignment: 3.2.4.1.** The heading is a historical citation alias.

<!-- roadmap-status: person-lookup-acceptance -->
- [~] the final workflow conversion and one historical `live-read` result exist; Search/Match and current authority must be reconciled before completion
- [ ] verify the final compiled definition, Search and Match behavior, generic projections, structural T1, and any genuinely new T2/T3 interaction
- [ ] record a current transaction-free `live-read` with exact before/after 0/0/0 write-authority deltas
- [ ] reconcile `docs/rebuild/migrations/person-lookup.md` and capability dispositions to current behavior
> 2026-09-04 | D329 carry-forward | absorbs former 3.3 Task 4 and its nested dashboard evidence
<!-- /roadmap-status -->

Current 3.2.4.1 and 3.2.4.2 run independently after their accepted parent prerequisite 3.2.4.

## Task 5-2 · Accept the final compiled Separations workflow without writes
<!-- roadmap: separations-compiled-acceptance -->

**Current assignment: 3.2.4.2.** The heading is a historical citation alias.

<!-- roadmap-status: separations-compiled-acceptance -->
- [~] composition, dashboard scenarios, workflow layout, final `workflow.ts`, and public-equivalence proofs landed historically; current verification is required
- [ ] verify the nineteen-node behavior, omissions, conditional identity authority, transaction fences, checkpoints, screenshots, logs, receipts, and generic projections from the final compiler
- [ ] verify structural T1 and only the T2/T3 cases justified by genuinely new interaction or wire behavior
- [ ] settle or route every inherited Separations dashboard/operator-surface discrepancy before the candidate can freeze
- [ ] reconcile the final compiled workflow against the migration record without converting structural proof into controlled-write evidence
> 2026-09-04 | D329 carry-forward | absorbs former 3.2 Tasks 6, 11, and 12 plus former 3.3 Task 5
<!-- /roadmap-status -->

## Task 6 · Record current-source Separations read-only acceptance
<!-- roadmap: separations-readonly-acceptance -->

**Current assignment: 3.2.5.** The heading is a historical citation alias.

<!-- roadmap-status: separations-readonly-acceptance -->
- [~] historical previews remain evidence; the 2026-09-03 replacement run failed at New Kronos with 0/0/0 write authority and did not meet the strict T1b gate
- [ ] reverify the selected closed Kuali document and every live read against the integrated 3.2.4.2 workflow
- [ ] reach the declared dry-run preview terminal and record a fresh `met` T1b result with exact-run 0/0/0 intents/attempts/outbox
- [ ] route any software defect to a new Phase 3.2 remediation task; do not weaken or waive the gate
> 2026-09-04 | D329 carry-forward | absorbs former 3.2 Tasks 7–8 and the live remainder of Task 12
<!-- /roadmap-status -->

## Task 7 · Audit and freeze the acceptance candidate
<!-- roadmap: workflow-candidate-freeze -->

**Current assignment: 3.2.6.** The heading is a historical citation alias.

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
| former 3.2 Task 6 | 3.2 Task 4.2 | composed Separations behavior |
| former 3.2 Tasks 7–8 | 3.2 Task 5 | historical dry-run and preview-terminal observations |
| former 3.2 Task 9 | 3.2 Tasks 2–3 and 4.2 | task/runtime defects exposed by the first live pass, routed by current owner |
| former 3.2 Task 10 | 3.2 Task 3; 3.3 Tasks 1–4 | software recovery mechanics here; controlled evidence and close in Phase 3.3 |
| former 3.2 Tasks 11–12 | 3.2 Tasks 4.2 and 5 | dashboard/T1/layout evidence and the still-open strict live result |
| former 3.2 Task 13 | 3.3 Tasks 1–4 | target decisions, controlled proofs, and close |
| former 3.3 Task 1 | 3.2 Task 1 | workflow-definition/compiler core and deletion acceptance |
| former 3.3 Tasks 2–3 | 3.2 Tasks 3.1–3.2 | runtime inheritance and clean-context guide proof |
| former 3.3 Task 4 | 3.2 Task 4.1 | Person Lookup acceptance |
| former 3.3 Task 5 | 3.2 Task 4.2 | compiled Separations acceptance |
| former 3.3 Task 6 | 3.2 Tasks 1, 4.1, 4.2, 5, and 6; 3.3 Task 4; 3.5 Task 3 | shared test infrastructure and T1–T3 implementation in 3.2; candidate audit/freeze in 3.2 Task 6; final evidence/lifecycle close in 3.3; T4 remains with the cooperation proof |

## Exit criteria

Phase 3.2 closes only when all ten supervisor tasks are current-source verified, Person Lookup has a current
`live-read`, Separations has a fresh green dry-run preview, the exact acceptance candidate is frozen,
all integrated gates pass, and every owned execution row is closed. A historical commit, green test
from an earlier fingerprint, or old task checkbox is never sufficient by itself.

## What Phase 3.3 may assume

Phase 3.3 may assume only the recorded frozen candidate and its evidence. It may not modify source,
reinterpret a failed rehearsal, substitute a target, or carry authority across candidate drift. A
defect returns to Phase 3.2; a new candidate supersedes the old one and restarts affected acceptance.
