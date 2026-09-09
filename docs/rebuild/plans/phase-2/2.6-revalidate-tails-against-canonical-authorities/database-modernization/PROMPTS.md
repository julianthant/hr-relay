# Launch registry and exact prompts

**Phase 2.6-only execution rule:** 2.6.9 is the single Finalization task and the last task of
the phase. No intermediate or nested finalizers. Earlier implementation tasks use focused tests,
lint and affected freshness; 2.6.9 owns full gates, independent review, remaining repairs, master
integration when assigned, handover and cleanup. Other phases retain their existing rules.

## Readiness

R/C0/T/C development releases are incorporated in master. C integration
`e43a8d8515486c73c276fa319bbe06d196b309e3` and its
[scoped release/cleanup](run-completion.md#c-schema-39-upgrade-repair--2026-09-09)
are verified prerequisites for F. C's removed branch/path must not be recreated as a prerequisite.

F (2.6.6) is locally integrated at `2bb25b6efbe62ca88d64a429f01dc567a76ecfbc` with focused PASS.
Its [release/closure record](foundation.md#f-resolver-port-repair--2026-09-09) and complete
external cleanup receipt supply one common prerequisite for P/D/G/S. All four remain unlaunched;
later tasks still wait for their actual named candidates. Full gates/review remain 2.6.9.

For C and F, their approved briefs override generic prompt/retention rules: one supervisor, zero
workers, focused PASS, local master merge and owned worktree/ref cleanup. Full gates and independent
review stay in 2.6.9. G’s approved G01–G06 brief below also assigns focused PASS, local merge and owned cleanup. Other tasks retain their approved integration boundaries.

**P-specific approval, 2026-09-09:** the [approved P01–P06 brief](provider-usage.md#approved-execution-brief--2026-09-09) consumes repaired F
`2bb25b6efbe62ca88d64a429f01dc567a76ecfbc`. It assigns P local master merge and owned
worktree/ref cleanup after focused PASS, with full gates and complete independent review in 2.6.9.
It also reserves to P only the named provider reservation invariant and its historical adaptation
in `authority-database.ts`; all other frozen shared inputs and sibling ownership remain unchanged.
This supersedes conflicting generic retention/no-master/shared-file prohibitions for P only.
L consumes the immutable recorded P candidate/integration; no P implementation or launch is claimed.

## Visible task IDs

R=2.6.2; C0=2.6.3; T=2.6.4; C=2.6.5; F=2.6.6; P/D/G/S=2.6.6.1/2/3/4;
L=2.6.7; A/Q=2.6.7.1/2; V=2.6.8; U/H=2.6.8.1/2; finalization=2.6.9 (includes handover/cleanup).
No intermediate or nested finalization tasks exist in this Phase 2.6 trial.
Use the exact numeric task and its letter alias together when resolving an implementation prompt.
The old single-card numbering is historical; do not assign timeline T2 to the final proof task.

## Binding registry

Create task branches only at authorized execution after availability/capacity checks. Create a missing
physical lane once; later tasks may reuse it only after its previous owner releases a clean committed
checkout. Candidate commits remain immutable and reachable for final verification; C/F remove
their integrated branches after approved cleanup. P also removes its branch only after its approved local integration and verified cleanup. Other retained candidate refs remain protected.
The prefix for every checkout below is `/Users/julianhein/Projects/`. Proposed names are not reserved.
C0 records R and its own actual release; later prerequisite cells remain unresolved until those tasks finish.

| Assignment | Branch | Checkout name | Required release |
| --- | --- | --- | --- |
| R | codex/database-renames | hr-worktree-database-renames | Retained completed R release |
| C0 | codex/database-contracts | hr-worktree-database-contracts | R release + admitted C0 brief |
| T | codex/history-views | hr-worktree-database-contracts | Accepted T1 + R + C0 |
| C | codex/run-completion | hr-worktree-database-contracts | T |
| F | codex/database-foundation | hr-worktree-database-foundation | Repaired C release + approved F plan |
| P | codex/provider-usage | hr-worktree-provider-usage | `2bb25b6efbe62ca88d64a429f01dc567a76ecfbc` |
| D | codex/diagnostics | hr-worktree-diagnostics | `2bb25b6efbe62ca88d64a429f01dc567a76ecfbc` |
| G | codex/artifact-outputs | hr-worktree-artifact-outputs | `2bb25b6efbe62ca88d64a429f01dc567a76ecfbc` |
| S | codex/settings-activation | hr-worktree-settings-activation | `2bb25b6efbe62ca88d64a429f01dc567a76ecfbc` |
| L | codex/lifecycle-foundation | hr-worktree-database-contracts | P + D + G + S |
| A | codex/archive-transfer | hr-worktree-database-peer | L |
| Q | codex/run-summaries | hr-worktree-database-other | L |
| V | codex/database-surfaces | hr-worktree-database-contracts | A + Q |
| U | codex/activity-views | hr-worktree-database-peer | V |
| H | codex/archive-viewer | hr-worktree-database-other | V |
| 2.6.9 | codex/database-validation | hr-worktree-database-contracts | U + H and their complete prerequisite ancestry |

The task-to-file map in README.md is authoritative. R uses renames.md; T uses timeline.md; C uses run-completion.md;
F uses foundation.md plus prerequisites.md; P/D/G use provider-usage.md/diagnostics.md/artifacts.md;
S/A/Q/U/H use the named approved section of decisions.md plus their C0-resolved execution brief;
L/V use prerequisites.md. Do not launch before the brief exists and is complete.

## Implementation prompt — one resolved copy per assignment

C0/prerequisite release fills the five binding fields from verified evidence; placeholders must
never be presented as READY. The following template applies except where the approved C/F brief
explicitly assigns local merge/cleanup; F uses its resolved handoff below. Preserve that exception
when producing its prompt:

```text
/supervise EXACT_NUMERIC_TASK (ASSIGNMENT_ID), using the single owning folder /Users/julianhein/Projects/hr-automation-rebuild/docs/rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/. Read README.md, prerequisites.md and the assigned product/execution brief at APPROVED_PLAN_SHA. Use GPT-6 Astra/high. Verify prerequisite BASE_SHA, create or verify the task-owned BRANCH at ABSOLUTE_WORKTREE from the registry, and confirm the exact approved file/test ownership before edits. Never use another task's checkout or master for implementation. Implement the entire assigned scope, fix in-scope failures and run meaningful focused tests, lint and affected freshness checks. No intermediate finalizers; 2.6.9 is the final task including handover and cleanup. Follow the Phase 2.6-only gate trial: full heavy gates and fresh independent review belong to final 2.6.9; this handoff is a development candidate only. Record proof rows and unverified heavy requirements explicitly. A prerequisite must deliver working composed interfaces and verify both descendant peer merge orders before release. Return a compact committed candidate handoff with base/head/tree, paths, tests/exits and remaining work. Do not launch siblings, poll idle tasks, merge into master or push. The operator opens tasks; 2.6.9 owns final integration and all later repairs. Send Done / Now / Remaining at start and each verified step.
```

## Final session prompt

```text
/supervise 2.6.9 (p2f-proof; historical numbers are not launch IDs) using /Users/julianhein/Projects/hr-automation-rebuild/docs/rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/final-validation.md and the parent phase Task 9. Use GPT-6 Astra/high. Verify the approved plan commit and every recorded development candidate before creating the registry's task-owned validation branch/worktree. You are the single final integration/repair owner. Combine the exact candidates, check peer merge order independence, run all required heavy gates and original migration/recovery/adapter-retirement proof, and fix every remaining failure here. Do not send repair work back to completed peers. Obtain fresh independent read-only sup_review on Astra/high for the complete frozen candidate; fix findings here and rerun required gates/review. Preserve all assertions, coverage floors, historical recovery evidence, UNKNOWN refusal and no-second-controlled-write boundaries. Integrate locally only when the operator assigns it after PASS and gates; never push. Complete fixture handover and owned cleanup within this same final task after acceptance, reusing unchanged gate evidence only under D191. Keep Done / Now / Remaining visible. No automatic next-task dispatch or idle observers.
```

## Four-checkout capacity and ownership transfer

The repository limit is four auxiliary worktrees, including unrelated work. On 2026-09-09 F
planning inspection, only the primary master checkout was registered; R/C0/T/C had integrated and
cleaned their old refs/paths. C subsequently reopened its old lane for a migration repair. F uses its own absent
`/Users/julianhein/Projects/hr-worktree-database-foundation`, then merges and removes its owned
worktree/ref. F waits for C's verified repaired integration before launch. These names are proposals, not reservations.

After F cleanup, P/D/G/S may use up to four independent worktrees on the same integrated F release:

- P: `/Users/julianhein/Projects/hr-worktree-provider-usage`.
- D: `/Users/julianhein/Projects/hr-worktree-diagnostics`.
- G: `/Users/julianhein/Projects/hr-worktree-artifact-outputs`.
- S: `/Users/julianhein/Projects/hr-worktree-settings-activation`.

This supersedes the old P-before-G and D-before-S physical lane schedule for these unstarted
children. It adds no dependency or automatic launch. Any unrelated occupied slot reduces capacity;
never exceed four or borrow an active checkout. Each child's actual file/test/contract manifest
and common base must be released by F before launch. Either semantic merge order remains required.
The batch test budget is at most four effective file workers, normally one per active child;
verify resolved configuration/observed workers and release only the task's own process allocation.

L needs capacity after the four candidates finish. Each child records its exact committed
base/head/tree/proof and preserves ignored evidence outside its checkout, stops owned processes,
and releases its physical checkout when verified safe to remove. Retain unintegrated candidate
branches/commits for L and final 2.6.9; physical cleanup never authorizes deleting their refs.
L may reclaim a verified released physical checkout to free its own slot, preserving candidate refs
and evidence. Do not remove another task's active checkout or infer release from idle status.
A/Q and U/H retain their registry lane assignments and existing release/integration rules.

For any later lane reuse, verify the prior owner has committed its work, preserved evidence,
stopped owned processes and released exclusive ownership. The receiving operator-started task
verifies the record and creates its own branch at the exact prerequisite. Never reset or rewrite
the sender's candidate. Fan-in prerequisites assemble their named committed inputs under their
admitted boundaries; no extra coordinator, full intermediate gate or review is introduced.
Final 2.6.9 owns final acceptance and cleanup of remaining retained resources. The operator opens
tasks; no cross-task messaging or dispatch is authorized by this registry.

## Resolved next assignment — 2.6.6 F

The operator approved [F01–F07](foundation.md#approved-execution-brief--2026-09-09) on 2026-09-09.
The planning source is master `977805e200a2788b2ba8d2d75854d7346b32329b`, with verified C integration
`0dd02a89056bd4ccec1a2089bacd8bd7f6cf2645`, schema41/floor40 and unchanged C code/test/config inputs.
C reopened during persistence for schema39 → 41 repair candidate
`47a64d33a6b20569a7e3598e74463694bc8c4c9d`. After documentation gates and C's focused release/merge,
the planner returns the exact approved-plan SHA and a verified implementation base containing
both it and the repaired integration. Until then F is WAITING ON C, not READY on the earlier release.
Verify F01–F07, both ancestries and the repaired C evidence before editing.

C repair is now integrated at `e43a8d8515486c73c276fa319bbe06d196b309e3` after focused PASS.
Its [repair evidence](run-completion.md#c-schema-39-upgrade-repair--2026-09-09) and closure receipt supersede the earlier C prerequisite; the preceding planning-source description is historical.

Create `codex/database-foundation` at `/Users/julianhein/Projects/hr-worktree-database-foundation`
from that verified base after rechecking absent ref/path and capacity. Execute only F with one
Astra/high supervisor and zero workers. Run focused tests/lint/freshness and affected filtered UI
proof; no full gates or independent reviewer here. Commit, merge locally to master after focused
PASS, repair invalidated integration proof and remove only F's owned worktree/ref after preserving
its evidence. Full gates and complete independent review remain 2.6.9. Record one actual integrated
F release for all four children and stop; no live application, push or successor dispatch.
Readiness is established by committed-plan content, successful documentation checks and prerequisite
availability, not by this planning record alone. No implementation is claimed.

## Resolved next assignment — 2.6.4 T

The operator approved the expanded [T01–T06 execution brief](timeline.md#approved-execution-brief--2026-09-09)
on 2026-09-09. The following records the historical T launch, now superseded by its integrated
release at `5e446a90f018456d11ad38442c0fe3ba13e31dd1`; do not execute it again.

The fresh supervisor consumes the exact approved planning commit containing that brief, verified
by the planning session after commit. Create `codex/history-views` at
`/Users/julianhein/Projects/hr-worktree-database-contracts` from C0 release
`c7b8b1e037bf27dd70d4df62bbfcac407e475631`, then cherry-pick that planning commit and verify
identical brief content before implementation. C0 final record
`dc26c74fde0bb5ec9436e1409884451cd5dd698d` is incorporated in master through
`8cf605a426553b6eeb169fffb0ec3ccc5b2f94d0`; its removed task branch is not required.
Recheck absence or clean explicit ownership release of the lane, branch availability, prerequisite
ancestry and the four-auxiliary-worktree limit. Preserve unrelated worktrees.

Use `/supervise 2.6.4 (T)` with Astra/high, one supervisor and zero implementation workers.
The linked owner contains the complete approved allocation, ordered steps, P1–P9, failure controls,
exact focused commands, exclusions and release conditions. Full gates, remaining repairs, fresh
independent complete review, operator-assigned master integration and final cleanup remain 2.6.9.
Return the committed development candidate to C only; no master merge, push, live application or
automatic next-task dispatch. The planning session returns the copy-ready prompt with the full
verified plan SHA after documentation gates and commit verification.

## Executed assignment — 2.6.5 C

The operator approved the complete [C01–C05 execution brief](run-completion.md#approved-execution-brief--2026-09-09)
on 2026-09-09. The planner returns the full verified plan SHA after committing and checking the
owning section. That SHA is the implementation base on master, descended from T integration
`5e446a90f018456d11ad38442c0fe3ba13e31dd1`; it includes the approved plan and all prerequisites.

Use `/supervise 2.6.5 (C)`, GPT-6 Astra/high, with one supervisor and zero workers. Create
`codex/run-completion` at `/Users/julianhein/Projects/hr-worktree-database-contracts` from that exact
plan commit after checking branch/path absence, ownership, capacity and prerequisite ancestry.
Both branch and path were absent during planning; no checkout is reserved or created by planning.

Execute C01–C05 and all P1–P6 under the linked brief. Focused tests, lint, affected guards/freshness
and filtered Storage Doctor verification are due here. Full gates and fresh complete independent
review stay in 2.6.9. The same C supervisor commits, merges locally into master after focused PASS,
verifies integration, preserves proof artifacts and removes its owned worktree/branch. Record F's
actual merged prerequisite without dispatching it. Preserve historical replay/frozen evidence and
UNKNOWN refusal. No push, operator database application, HR submission or automatic successor.
Keep Done / Now / Remaining visible, including integration, cleanup and deferred phase acceptance.

## Next prerequisite record — 2.6.6 F

C is locally integrated at `e43a8d8515486c73c276fa319bbe06d196b309e3`. Its [focused release](run-completion.md#c-schema-39-upgrade-repair--2026-09-09) supplies F's actual master source prerequisite. The [closure receipt](/Users/julianhein/Projects/hr-run-completion-repair-evidence-20260909/closure.json) verifies C's owned branch/path removal. F is not dispatched, planned anew or implemented by C. The operator opens F's next session and its committed brief must pin a descendant of this integration. No removed C/T branch is required. Full phase gates and complete independent review remain 2.6.9.

## Resolved F child prerequisite — 2026-09-09

These are operator-started prompts, not dispatches. Every child uses F integration
`2bb25b6efbe62ca88d64a429f01dc567a76ecfbc`, the C0 allocation approved in
`b5ba39efbca023b673be3c4aac509ca42b2a751c`, and F's frozen 27-path production/test manifest.
Require F's [repair closure receipt](/Users/julianhein/Projects/hr-database-foundation-resolver-evidence-20260909/closure.json) to be complete. Recheck ancestry, path/ref availability and
capacity; consume the current F release record from master. Do not recreate F's removed branch.
Each child has one Astra/high supervisor and zero workers. Full gates/review stay with 2.6.9.
The repaired F callers remove the proposed G/S shared-file scope expansion: preserve the existing
exclusive allocations. G’s approved task-specific handoff below consumes the repair. S’s resolver-port blocker is repaired;
its existing ownership and focused gate schedule remain unchanged. P/D/G planners retain their
approved plan commits and rebind their exact implementation bases to a verified descendant
containing this F release. This records one common runtime prerequisite, not a child launch.

```text
/supervise 2.6.6.1 (P), GPT-6 Astra/high. Repository /Users/julianhein/Projects/hr-automation-rebuild. Execute the operator-approved P01–P06 brief in docs/rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/provider-usage.md#approved-execution-brief--2026-09-09 at the full plan commit supplied by the verified planning handoff. Verify repaired F prerequisite 2bb25b6efbe62ca88d64a429f01dc567a76ecfbc and complete repair closure receipt. Create codex/provider-usage at /Users/julianhein/Projects/hr-worktree-provider-usage from that exact prerequisite; load the approved owner from its pinned plan commit. One supervisor, zero workers. Implement generic accounting and the exact approved provider-active-reservations-match/historical-adaptation exception in authority-database.ts; preserve other frozen shared inputs and sibling ownership. Complete P1–P6 with real concurrency, mixed-kind/current/historical corruption controls, replay, uncertainty, retention and legacy runtime proof. Run the brief’s focused tests, lint and affected freshness; full gates and independent review remain 2.6.9. Commit, merge locally into clean master after focused PASS, rerun invalidated integration checks, preserve evidence, remove only the owned worktree/merged branch and record L’s immutable release. No push, live database upgrade, real provider/key wiring, HR submission or automatic task launch. Send Done / Now / Remaining at start and every verified step; stop after P.
```

D uses its [approved D01–D05 brief](diagnostics.md#approved-execution-brief--2026-09-09) and the resolved binding below,
not the older C0 no-merge prompt. The planner supplies its exact verified plan/base SHA after
persistence checks; the common runtime prerequisite remains repaired F above.

### G task-specific approved handoff

G’s operator-approved [G01–G06 brief](artifacts.md#approved-execution-brief--2026-09-09) supersedes
its earlier C0-only launch prompt. The planner retains the immutable approved-plan SHA and returns a verified committed descendant
containing both that plan and the current F resolver-port integration `2bb25b6efbe62ca88d64a429f01dc567a76ecfbc` as G’s execution base.
Require the complete [F resolver cleanup receipt](/Users/julianhein/Projects/hr-database-foundation-resolver-evidence-20260909/closure.json) before releasing
the F dependency. Do not substitute the old C0 plan SHA or an unverified later master.
Create `codex/artifact-outputs` at `/Users/julianhein/Projects/hr-worktree-artifact-outputs` from
the returned plan commit. One Astra/high supervisor, zero workers/reviewers here. Execute G01–G06,
pass focused tests/lint/freshness, merge locally into master, preserve evidence and remove only
G’s owned worktree/ref. Read and apply the [G parallel coordination binding](artifacts.md#parallel-coordination-binding--amended-2026-09-09)
and its [current protocol](/Users/julianhein/.agents/skill-library/focused-sessions/REFERENCE.md#parallel-coordination)
before G01: independent work and no peer messages by default. Inspect primary evidence and recorded
ownership before shared writes; isolate work and serialize only actual conflicts. Contact only the
exact affected owner when a necessary unresolved action remains; no check-ins, availability surveys,
speculative queues, status/readiness broadcasts, acknowledgment rounds or duplicate native delivery.
G retains its gates, merge, final verification and cleanup unless explicitly transferred and accepted.
L/2.6.9 already own later combined work and need no new completion handshake. After G’s own duties
finish, record its release and end the turn; no sibling observer loop. Use an existing authorized
resume mechanism only for an owned repair, missing evidence or assigned verification. Do not invent
automations or dispatch. Full gates and complete independent review remain in 2.6.9. No push,
live database application, HR submission, sibling launch or cleanup of other lanes.


```text
/supervise 2.6.6.4 (S), GPT-6 Astra/high. Repository /Users/julianhein/Projects/hr-automation-rebuild. Execute the C0 execution allocation — 2.6.6.4 S in docs/rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/decisions.md from approved plan b5ba39efbca023b673be3c4aac509ca42b2a751c. Verify the complete F closure and common prerequisite 2bb25b6efbe62ca88d64a429f01dc567a76ecfbc. Create codex/settings-activation at /Users/julianhein/Projects/hr-worktree-settings-activation from that exact prerequisite. One supervisor, zero workers. Preserve the F-frozen shared contracts and exact exclusive source/test ownership; implement all assigned proof and repair focused failures. Run focused tests, lint and affected freshness; full gates and independent review belong to 2.6.9. Commit the development candidate for L; no master merge, cleanup of other lanes, push, live database upgrade, HR submission or automatic task launch. Send Done / Now / Remaining at start and every verified step.
```


## Approved D binding — 2.6.6.2

The operator approved the complete [D01–D05 execution brief](diagnostics.md#approved-execution-brief--2026-09-09)
and its three ownership amendments on 2026-09-09 after F repair verification. The planner retains its approved plan SHA and supplies an exact
implementation-base descendant containing that complete section and the current repaired
F integration `2bb25b6efbe62ca88d64a429f01dc567a76ecfbc`. Use the returned verified prompt; do not
substitute C0's older plan SHA or treat the runtime prerequisite alone as the approved D plan.

One Astra/high supervisor, zero workers, creates `codex/diagnostics` at
`/Users/julianhein/Projects/hr-worktree-diagnostics` after ref/path/capacity checks. D includes its
new timeline payload, live-panel context and two foundation-test amendments; other P/G/S allocations
remain unchanged. D01–D05 assign meaningful focused checks, lint, affected freshness and dedicated
desktop proof, local master merge after focused PASS, invalidated integration rechecks, preserved
evidence and owned worktree/ref cleanup. This overrides generic no-peer-merge/retention rules for
D only. Full gates and independent complete review stay in 2.6.9. Record integrated D for L; no
push, live application, unrelated cleanup or sibling dispatch. Implementation remains unstarted.
