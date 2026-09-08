# Phase 3.3 · Accept Person Lookup and Separations

Read the [phase overview](../README.md) for shared context, decisions and phase-wide exit criteria.

Phase 3.3 is the controlled-evidence part. It consumes one immutable candidate frozen by Phase 3.2,
records the independent pending-sweep witness, exercises the coupled UCPath filing and Kuali
finalization, and reconciles final acceptance for Person Lookup and Separations. It performs no
software development.

D329 replaces the old assumption that Separations could close before the final workflow-authoring
and acceptance work. Any source, manifest, fingerprint, runtime-schema, or load-bearing configuration
change invalidates admission and returns the defect to a newly numbered Phase 3.2 remediation task.

## Phase summary
<!-- roadmap: workflow-live-acceptance -->

<!-- roadmap-status: workflow-live-acceptance -->
- [ ] Task 1 admits the exact candidate, targets, disposition, and final no-write rehearsal
- [ ] Task 2 proves the pending-sweep commit on an independent disposable target
- [ ] Task 3 performs the coupled UCPath filing and Kuali finalization on the real target
- [ ] Task 4 reconciles evidence, closes both workflows, and closes the Phase 3.3 lifecycle
> 2026-09-04 | D329 chronology correction | controlled evidence now follows the final authoring candidate; no future phase may remove or reshape work after its real-write proof
<!-- /roadmap-status -->

### The bounded authorization

One operator authorization may cover the controlled sequence only after Task 1 presents the complete
packet. It names the exact candidate commit/fingerprints, independent disposable deletion target,
real separation target, restoration/retention disposition, and permitted order. It expires on source
or configuration drift, target drift, an unexpected failure, or an UNKNOWN submission. It is
operational authorization, not a workflow gate and not standing permission for another run.

## Task 1 · Admit the frozen candidate and controlled run
<!-- roadmap: acceptance-admission -->

<!-- roadmap-status: acceptance-admission -->
- [ ] verify the Phase 3.2 freeze record byte-for-byte against the current checkout and generated artifacts
- [ ] verify the disposable and real targets without guessing or printing protected person values
- [ ] record the exact restoration/retention disposition and current external-system availability
- [ ] repeat the final no-write rehearsal against the frozen candidate and prove exact-run 0/0/0 write authority
- [!] obtain the bounded operator authorization before any `dryRun=false` action
> 2026-09-04 | D329 new sequence | absorbs the admission, target, disposition, and rehearsal portions of former 3.2 Tasks 10 and 13
<!-- /roadmap-status -->

Task 1 changes no source. A defect or changed candidate stops here and returns to Phase 3.2.

## Task 2 · Prove the independent pending-sweep commit
<!-- roadmap: pending-sweep-proof -->

<!-- roadmap-status: pending-sweep-proof -->
- [ ] bind D310 authority to the exact machine-observed eligible/protected stable-transaction set
- [ ] commit deletion only on the approved disposable target and verify exactly the selected IDs are gone while protected rows survive
- [ ] execute and verify the recorded restoration/retention disposition
- [ ] record fence timing, reload proof, receipt/ledger evidence, and stop without retry on UNKNOWN
> 2026-09-04 | D329 new sequence | isolates the controlled witness formerly buried in old Track A and Task 13
<!-- /roadmap-status -->

## Task 3 · Prove the UCPath filing and Kuali finalization
<!-- roadmap: separation-filing-finalization -->

<!-- roadmap-status: separation-filing-finalization -->
- [ ] file the approved UCPath termination through the frozen workflow and record its exact durable proof
- [ ] immediately re-read and verify that exact filing still exists with matching subject/date/action authority
- [ ] finalize the corresponding Kuali document only after the filing-survival precondition passes
- [ ] record the seven payload shapes, propagation/fence measurements, reload read-backs, and every receipt/ledger consequence
- [ ] stop without retry or repair on UNKNOWN; never re-file to recover a failed finalization
> 2026-09-04 | D329 new sequence | keeps filing and finalization in one supervisor session because the second write must cite the first write's surviving authority
<!-- /roadmap-status -->

## Task 4 · Reconcile acceptance and close Phase 3.3
<!-- roadmap: workflow-acceptance-close -->

<!-- roadmap-status: workflow-acceptance-close -->
- [ ] reconcile Person Lookup and Separations T1–T3 evidence against the frozen candidate and controlled results
- [ ] update migration records, regression scenarios, knowledge records, capability dispositions, and every owning reference whose truth changed
- [ ] run the complete integrated gate family without weakening floors, limits, or assertions
- [ ] remove and verify every Phase 3.3 worktree and local branch, archive exact tasks, close the coordinator ledger, and unlock optional Phase 3.4 plus required Phase 3.5; no optional feature blocks cooperation
> 2026-09-04 | D329 new sequence | absorbs the close portions of former 3.2 Tasks 10/13 and former 3.3 Task 6
<!-- /roadmap-status -->

## The canary and target registry

`config/test-data.json` owns the public-label registry after the completed D341 detour; ignored
`config/test-data.local.json` is the only current source of private test identifiers and paths.
Application Settings, credentials and `.env` are not alternative test-target sources. A dated `available` observation
is admission evidence, not proof that the target satisfies a scenario. Gone, consumed, unknown, or
incomplete subjects block before a browser starts. No name, EID, or protected value is copied into
this plan. Consume the detour’s shared fixtures and captured test-input identities. The operator’s
old runtime data was reset; acceptance must produce fresh evidence against the frozen candidate.

## Separations controlled-write contract

The three controlled proofs remain mandatory: pending sweep, UCPath filing, and Kuali finalization.
D309's source-conditioned identity authority and D310's independent deletion/surviving-filing
protocol remain binding. Historical previews and prepare evidence remain useful, but only Task 2 and
Task 3 can discharge the controlled-commit criterion for the frozen candidate.

## Previous-plan crosswalk

| Superseded owner | New owner |
|---|---|
| former 3.2 Task 10 A2–A5 | Tasks 1–3 |
| former 3.2 Task 10 A8 | Task 4 |
| former 3.2 Task 12 strict live remainder | Phase 3.2 Task 5, then Task 1 confirmation |
| former 3.2 Task 13 | Tasks 1–4 |
| former 3.3 Task 4 close evidence | Task 4, after Phase 3.2 Task 4.1 accepts Person Lookup |
| former 3.3 Task 5 controlled-write exclusion | Tasks 2–3 now own the real proof explicitly |
| former 3.3 Task 6 lifecycle close | Phase 3.2 Task 6 for freeze; Task 4 for final acceptance close |

## Exit criteria

Phase 3.3 closes only when the candidate identity remained unchanged, all three controlled proofs
are recorded on approved targets, every provisional measurement the writes alone can settle is
reconciled, Person Lookup and Separations satisfy their complete acceptance contracts, all gates are
green, and every owned worktree/branch/task row is closed. A failure is not converted into a waiver;
an UNKNOWN is never retried.
