
# Launch registry and exact prompts

**Phase 2.6-only execution rule:** 2.6.9 is the single Finalization task and the last task of
the phase. No intermediate or nested finalizers. Earlier implementation tasks use focused tests,
lint and affected freshness; 2.6.9 owns full gates, independent review, remaining repairs, master
integration when assigned, handover and cleanup. Other phases retain their existing rules.

**L-specific operator approval, 2026-09-09:** [L01–L06](prerequisites.md#approved-l-execution-brief--2026-09-09)
assigns 2.6.7 local master merge and owned worktree/ref cleanup after focused PASS to the L
supervisor. Full gates and complete independent review remain at 2.6.9. This supersedes generic
retention/no-master wording for L only; it does not launch implementation or its children.

## Readiness

R/C0/T/C development releases are incorporated in master. C integration
`e43a8d8515486c73c276fa319bbe06d196b309e3` and its
[scoped release/cleanup](run-completion.md#c-schema-39-upgrade-repair--2026-09-09)
are verified prerequisites for F. C's removed branch/path must not be recreated as a prerequisite.

F (2.6.6) is locally integrated at `2bb25b6efbe62ca88d64a429f01dc567a76ecfbc` with focused PASS.
Its [release/closure record](foundation.md#f-resolver-port-repair--2026-09-09) and complete
external cleanup receipt supply one common prerequisite for P/D/G/S. G's [scoped release](artifacts.md#g-scoped-development-release-and-cleanup) is complete;
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
| A | codex/archive-transfer | hr-worktree-database-peer | Common repaired L release below, identical to Q; approved A01–A06 brief |
| Q | codex/run-summaries | hr-worktree-database-other | Common repaired L release below, identical to A; see amended Q01–Q06 |
| V | codex/database-surfaces | hr-worktree-database-contracts | A + Q + archived-history repair + integrated L retirement; approved V01–V06 |
| U | codex/activity-views | hr-worktree-database-peer | V |
| H | codex/archive-viewer | hr-worktree-database-other | V |
| 2.6.9 | codex/database-validation | hr-worktree-database-contracts | U + H and their complete prerequisite ancestry |

The task-to-file map in README.md is authoritative. R uses renames.md; T uses timeline.md; C uses run-completion.md;
F uses foundation.md plus prerequisites.md; P/D/G use provider-usage.md/diagnostics.md/artifacts.md;
S/A/Q/U/H use the named approved section of decisions.md plus their C0-resolved execution brief;
L/V use prerequisites.md. Do not launch before the brief exists and is complete.

## Implementation prompt — one resolved copy per assignment

**V-specific approval:** [V01–V06](prerequisites.md#approved-v-execution-brief--2026-09-09)
assigns focused PASS, local master merge and owned worktree/ref cleanup to V. Full gates and
complete independent review remain at 2.6.9. L retirement is complete: integration
`4591b263ed26d68af91b048a5cfae07f88400b38` and committed closure/base
`9f853d60fd347a998eeacd86a014d1f71b31f391` were verified with the external L evidence.
The old WAITING ON condition is satisfied. V01–V06 are complete with local integration and owned cleanup. V execution and its common U/H release are recorded
in [the execution receipt](prerequisites.md#v-execution-binding--2026-09-10).
No task is dispatched by this registry.

### Historical V conditional supervisor prompt — superseded 2026-09-10

Approved full plan: `c4beb7679b46e15c3aeeb06846ebc3a895469c70`. The following planning-time
prompt is retained as history; its L waiting condition has been satisfied by the verified release.
Do not repeat L retirement or use this historical prompt to relaunch completed V work.

```text
/supervise 2.6.8 V. WAITING ON L retirement focused PASS and local integration; do not launch implementation before that prerequisite is verified. Use GPT-6 Astra/high.

Repository: /Users/julianhein/Projects/hr-automation-rebuild
Plan owner: /Users/julianhein/Projects/hr-automation-rebuild/docs/rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/prerequisites.md
Section: Approved V execution brief — 2026-09-09, retaining the C0 V allocation and proof.
Approved full plan SHA: c4beb7679b46e15c3aeeb06846ebc3a895469c70

Read the full committed plan with git show and verify its local master incorporation. Resolve the exact L retirement implementation/release/integration SHA from its committed receipt, verify focused conversion/upgrade/restore/retirement evidence and A/Q plus archived-history repair ancestry, and record that full product base SHA/tree before editing. Do not substitute the planning SHA or today's master for the required release. L remains separate; do not implement its retirement in V. If the receipt is absent or incomplete, report WAITING ON and stop without creating an implementation candidate.

After admission, recheck ownership, refs, paths and capacity; create codex/database-surfaces at /Users/julianhein/Projects/hr-worktree-database-contracts from the verified base. Consume these approved instructions separately if newer than that product base. One supervisor, zero implementation workers/reviewers here. Never implement on master.

Execute V01–V06 completely: reconcile A/Q and history behavior; serve Queue/Activity summaries and matching exports; serve descriptor-independent saved reports and authenticated retained attachments; retire archive relaunch including the narrowly approved internal fan-out/run-service creation paths; deliver working, independently consumable U/H baselines. Preserve historical journals and lineage, normal start/retry/restart, canonical action authorization, protected projections, missing/stale/deleted distinctions and UNKNOWN refusal. Use /ui locally and the committed focused desktop proof. Run every named focused unit/architecture selector, lint and affected freshness. Full typecheck/coverage, broad architecture/parity/build/performance and complete independent review remain at 2.6.9; no intermediate full gate or reviewer.

Follow Parallel coordination in /Users/julianhein/.agents/skill-library/focused-sessions/REFERENCE.md and the platform supporting-agent reference. No routine peer messages, reservations, broadcasts, observer loops or sibling dispatch. Preserve L/U/H ownership and serialize only actual shared-target mutations or evidenced resource conflicts.

Commit exact paths, freeze the candidate/tree/evidence, then merge V locally into master at /Users/julianhein/Projects/hr-automation-rebuild after focused PASS and target checks. Rerun invalidated integration checks or prove input-identical reuse. Record one immutable V release for U/H, preserve evidence outside the checkout and remove only the incorporated V worktree/ref from a safe checkout; verify physical path, registration and ref absence. No push, operator database migration, HR submission or unrelated cleanup.

Send Done / Now / Remaining at start/resume and after every verified step, keeping merge, cleanup and deferred phase acceptance visible. Stop after V06; do not launch U/H or claim full Phase 2.6 acceptance.
```

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

**P is a merged scoped development release; do not relaunch its original prompt.**
Candidate `594490f8e0dc78c1f7c0efd5319057fde30119c9`, proof
`f00515fb278a2571152100dd17efedd97757dc32`, local integration
`4818223c9da0231481da6051f73f2c33ee16abf0`. L consumes the
[P release and cleanup record](provider-usage.md#p06-integration-and-closure).
The binding table retains P's historical checkout names; its removed branch/path is not a
prerequisite. Full gates/review remain 2.6.9; no successor is dispatched.

D uses its [approved D01–D05 brief](diagnostics.md#approved-execution-brief--2026-09-09) and the resolved binding below,
not the older C0 no-merge prompt. The planner supplies its exact verified plan/base SHA after
persistence checks; the common runtime prerequisite remains repaired F above.

### G task-specific approved handoff

**Completed:** G01–G06 released candidate `272b35676`, integrated locally at `4328ce56a`,
with focused gates and owned cleanup verified. See [G release/receipt](artifacts.md#g-scoped-development-release-and-cleanup).
Do not relaunch this completed assignment from the historical binding below. Full gates/review remain 2.6.9.

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


### S verified supervisor prompt — 2026-09-09

**Completed scoped release; historical launch prompt retired.** S01–S06 passed focused integration and owned cleanup; L consumes the [committed S06 release](decisions.md#s06-scoped-release-and-cleanup--2026-09-09). Full gates and independent review remain at 2.6.9. The complete
[approved S01–S06 plan](decisions.md#approved-s-execution-brief--2026-09-09) is committed at
`d22b6e8e657e442f2c287b679833e96c1e7173f8`, also the exact implementation base. Repaired F
`2bb25b6efbe62ca88d64a429f01dc567a76ecfbc` is an ancestor and its cleanup receipt is complete.
The branch and physical S path were absent at verification; no task was launched. This replaces
S's obsolete C0 prompt and does not change another peer's approved prompt or current ownership.

```text
/supervise 2.6.6.4 (S), GPT-6 Astra/high.

Repository: /Users/julianhein/Projects/hr-automation-rebuild
Owner: /Users/julianhein/Projects/hr-automation-rebuild/docs/rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/decisions.md
Section: Approved S execution brief — 2026-09-09
Approved plan and exact implementation base: d22b6e8e657e442f2c287b679833e96c1e7173f8
Required F ancestor: 2bb25b6efbe62ca88d64a429f01dc567a76ecfbc

Execute S01–S06. Verify the committed full brief, F ancestry and complete resolver-repair cleanup receipt. Recheck path/ref ownership and the four-auxiliary-worktree capacity including unrelated work. Create codex/settings-activation at /Users/julianhein/Projects/hr-worktree-settings-activation from the exact base above; never implement on master. One supervisor, zero workers/reviewers here. Preserve the eleven production paths, two bounded settings-test amendments, isolated desktop proof and every safety/replay/rollback requirement in the brief.

Read the updated ~/.agents/skill-library/parallel-agent-work/REFERENCE.md and Parallel coordination in ~/.agents/skill-library/focused-sessions/REFERENCE.md. Default to independent work and no peer messages. Use primary evidence first; contact only the exact affected owner whose action is necessary for a concrete unresolved conflict/input/duty transfer. No check-ins, broadcasts, acknowledgments, reservation rounds, speculative queues or observer loops. Serialize only actual shared mutations and evidenced resource conflicts; preserve ownership and grants. L/final 2.6.9 already own downstream duties and need no new acceptance handshake.

Run and repair all assigned focused tests/guards, lint, affected freshness and /ui desktop proof with the recorded one-worker adapter. Full typecheck/coverage, broad architecture/parity/build/performance and independent review remain at 2.6.9; do not run them merely to commit or merge S. Freeze exact candidate/tree/evidence. Merge only S locally into master after focused PASS and verified target ownership/cleanliness; rerun invalidated integration checks or prove input-identical reuse. Record the release for L and complete owned worktree/branch cleanup with preserved proof and verified absence. No push, operator database upgrade, HR submission, sibling launch or unrelated cleanup.

Send Done / Now / Remaining at start/resume and after every verified step, keeping integration/cleanup and deferred phase acceptance visible. Finish assigned work, then stop; no automatic successor or monitoring.
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


D also applies its [operator-requested coordination amendment](diagnostics.md#parallel-coordination--operator-requested-protocol-amendment)
and [Parallel coordination](/Users/julianhein/.agents/skill-library/focused-sessions/REFERENCE.md#parallel-coordination).
Default to independent work and no peer messages; no check-ins, availability surveys, reservations,
readiness broadcasts or acknowledgment rounds. Read primary evidence first. Contact only the known
affected owner when an actual unresolved conflict, required-input change or necessary duty transfer
needs that owner's action. Isolate all implementation/owner writes; serialize only actual shared
master/index/generated-output mutation, with a valid grant/acquisition check when contested. Retain
D's merge, verification and cleanup duties; existing downstream assignments need no new handshake.
Verify current F ancestry/release/closure before READY, first edit and integration; a superseded
source blocks the dependent boundary until verified rebind. Keep progress in this task's chat and
stop after owned completion, without a sibling observer loop. The planner returns the exact amended
plan/base SHA after document checks and committed-content verification. No product scope or gate
schedule changes: full gates and independent review remain at 2.6.9.

## Resolved L supervisor prompt — 2.6.7

Approved plan: `c3eb6725e3607a7df82a6c2a94a4765e8579efbd`.
Prerequisite base `de636910cdec61045e965b6c9dd653df15cebefe` and all four recorded domain
integrations are ancestors of that plan. Planning checks: 24 roadmap binding tests, lint,
roadmap generation/freshness, six added links/anchors, nine instruction twins, maximum instruction
chain 17,333 bytes and whitespace PASS. No runtime inputs changed or runtime gates claimed.
This prompt becomes READY after its authorized planning integration and cleanup are verified;
its implementation base is the plan commit itself, which contains all required runtime inputs.

```text
/supervise 2.6.7 L. READY: use approved plan and implementation base c3eb6725e3607a7df82a6c2a94a4765e8579efbd in /Users/julianhein/Projects/hr-automation-rebuild. Read /Users/julianhein/Projects/hr-automation-rebuild/docs/rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/prerequisites.md, section “Approved L execution brief — 2026-09-09”, plus its retained L allocation, exact paths and proof selectors. Use GPT-6 Astra/high, one supervisor and zero implementation workers. Verify plan content and P/D/G/S plus F/T/C/R ancestry; create codex/lifecycle-foundation at /Users/julianhein/Projects/hr-worktree-database-contracts from the exact implementation base after checking availability/capacity. Never implement on master. Execute L01–L06 completely, resolving routine in-scope choices and combination defects autonomously. Deliver real archive/summary baseline ports, verified shared evidence ownership, atomic lifecycle hooks and paired database/file recovery; prove A/Q independent baseline capability orders before release. Preserve historical migrations, protected identity, UNKNOWN refusal and source data until verified capture. Run the committed focused tests, lint and affected freshness; full gates and fresh complete independent review belong only to 2.6.9. Commit exact paths, merge the focused-PASS candidate into local master at /Users/julianhein/Projects/hr-automation-rebuild, rerun invalidated checks, record release evidence and remove the owned worktree/branch. Send Done / Now / Remaining at start/resume and after each verified step, keeping merge, cleanup and deferred review visible. No push, operator database mutation, sibling dispatch or implementation of A/Q beyond the assigned baseline extraction. Stop after 2.6.7 is integrated and cleaned up; report its scoped release without claiming phase acceptance.
```

## Common repaired L release — A and Q

The Q expansion and launch binding at `ceac987a209e0f63d0798c35695bf35b3c674de9` are superseded.
Use the amended Q01–Q06 brief in decisions.md: only its original three production paths plus owned
proof/evidence. A retains its five production paths plus owned proof/evidence. Both use the same
execution base, resolved in the release receipt below after this amendment is committed.
The repaired implementation is `a1d0c4a5c5f63a3d444b6a5c386fc56b2e2cef57`.

A owns conversion; the approved L retirement follow-up in prerequisites.md follows A's populated
conversion proof and blocks combined completion. Q remains independent; either peer merge order is
allowed. Both own local integration and cleanup after focused PASS. Full gates/review remain 2.6.9.
A's approved A01–A06 brief is in decisions.md; its planner verifies persistence and launch readiness.
Q's amended brief is revalidated and operator-approved below.
This registry releases the prerequisite and does not launch either implementation or the follow-up.

### Exact common execution base

A and Q both start from `42df5095160e1ff448e76c155a048134ec395ba5`, after verifying local
incorporation. This exact commit contains the repaired implementation and approved ownership/ordering
amendment. Later plan-only commits may supply instructions but must not silently change one peer's
product base. Recheck shared input identity if either planner proposes a different base.
Implementation: `a1d0c4a5c5f63a3d444b6a5c386fc56b2e2cef57`; full gates/review remain 2.6.9.
No implementation is launched. A's plan is approved and its planner verifies persistence/integration;
Q amended-plan revalidation is complete and operator-approved. The former Q shared-file authorization
and launch SHA are superseded.

### Q amended approval — 2.6.7.2

The operator approved the revalidated Q01–Q06 brief after L repair. The full owner is
[Approved Q execution brief](decisions.md#approved-q-execution-brief--2026-09-09), including its
amended approval/revalidation record. Exactly three production files, owned proof/evidence, local
merge and cleanup are assigned to Q. Shared authority/lifecycle/domain files remain read-only.
The exact product base stays `42df5095160e1ff448e76c155a048134ec395ba5` for both A and Q;
the resolved prompt distinguishes this base from the later instructions-only approval SHA.
No implementation is launched by this approval or registry.

### Verified Q supervisor prompt after repaired L approval

Instructions-only approved plan commit: `1d4629c358f3ba35a6603e118373abf777967415`.
Exact common A/Q execution base: `42df5095160e1ff448e76c155a048134ec395ba5`.
The full committed Q01–Q06 owner and approval record have been read back and verified; all scoped
planning checks passed. The planner verifies local incorporation and owned cleanup before delivering
this prompt as READY. The later instructions commit does not replace the product base.

```text
/supervise 2.6.7.2 Q. READY.
Repository: /Users/julianhein/Projects/hr-automation-rebuild
Plan owner: /Users/julianhein/Projects/hr-automation-rebuild/docs/rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/decisions.md
Section: Approved Q execution brief — 2026-09-09, including its amended approval/revalidation record.
Approved instructions SHA: 1d4629c358f3ba35a6603e118373abf777967415
Exact common A/Q product base: 42df5095160e1ff448e76c155a048134ec395ba5

Read the complete owner from the instructions SHA with git show; verify its local master ancestry and repaired L implementation a1d0c4a5c5f63a3d444b6a5c386fc56b2e2cef57 in the exact product base. Recheck branch/path ownership and capacity, then create codex/run-summaries at /Users/julianhein/Projects/hr-worktree-database-other from that product base. Do not substitute the newer plan commit or master as the product base. Consume the approved instructions separately; do not merge later product changes merely to obtain them.

Execute Q01–Q06 autonomously with one GPT-6 Astra/high supervisor, no implementation workers and no reviewer here. Q owns only src/core/run-summary.ts, src/infra/sqlite/run-summaries.ts and src/server/dashboard/queries/run-summaries.ts plus the explicitly owned tests/performance/evidence. Shared authority/lifecycle/domain files and L regression fixtures remain read-only. Preserve A's archive interfaces and either merge order; do not implement A, V, UI cutover, new DDL or the L retirement follow-up. A's conversion then L's retirement blocks combined completion, not Q start.

Run the exact focused tests, lint, bounded benchmark and generation/freshness checks in the committed brief. Full gates and fresh complete independent review remain 2.6.9. Follow Parallel coordination in /Users/julianhein/.agents/skill-library/focused-sessions/REFERENCE.md: no routine messages, reservations or peer dispatch; serialize actual shared-target mutations only. Commit exact paths, freeze the candidate and evidence, merge Q locally into master at /Users/julianhein/Projects/hr-automation-rebuild after focused PASS and target checks, rerun invalidated integration checks, record 06-summary-evidence.md, and remove only Q's owned auxiliary worktree/branch from a safe checkout with verified absence.

Send Done / Now / Remaining at start/resume and after each verified step, keeping merge, cleanup and deferred 2.6.9 review visible. No push, live database application, UNKNOWN-submit retry or next-task dispatch. Stop after Q's scoped release and cleanup; do not claim full Phase 2.6 acceptance.
```

## Approved A planning handoff — 2.6.7.1

The operator approved the complete [A01–A06 execution brief](decisions.md#approved-a-execution-brief--2026-09-09).
A retains five production paths, four new owned suites, and three bounded existing-test amendments.
Use the exact common product base `42df5095160e1ff448e76c155a048134ec395ba5`; the planner returns a
separate verified plan SHA after persistence/integration/cleanup. Create `codex/archive-transfer` at
`/Users/julianhein/Projects/hr-worktree-database-peer`. One Astra/high supervisor, zero workers/reviewers
here. Execute A01–A06, run the explicit focused gates/lint/freshness, merge locally and remove owned
resources. L owns subsequent physical retirement/shared upgrade wiring after A conversion proof;
V/H own served dashboard and desktop proof; full gates and independent review stay at 2.6.9.
Follow the linked parallel protocol without check-ins/broadcasts or sibling dispatch. No push or live
database application. This pointer does not launch implementation or alter Q's product base.

### Resolved A supervisor prompt — 2026-09-09

Approved full plan: `f8c21e168a421e462665c0c868c781893ce95f88`. Common product base remains
`42df5095160e1ff448e76c155a048134ec395ba5`. The planner verified committed content and all
A01–A06 controls, 24 roadmap-binding tests, lint, freshness, links and instruction chains,
with 2,088 unchanged runtime/test/tooling inputs. Local planning integration and owned cleanup
are verified before the final READY delivery; this record does not launch A.

```text
/supervise 2.6.7.1 A. READY after verifying the recorded planning integration and cleanup. Use GPT-6 Astra/high.

Repository: /Users/julianhein/Projects/hr-automation-rebuild
Owner: /Users/julianhein/Projects/hr-automation-rebuild/docs/rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/decisions.md
Section: Approved A execution brief — 2026-09-09
Approved full plan commit: f8c21e168a421e462665c0c868c781893ce95f88
Exact common A/Q product base: 42df5095160e1ff448e76c155a048134ec395ba5

Read the complete owner at the plan commit with git show; the plan SHA is separate from the product base. Verify both are incorporated in local master, the repaired L evidence/closure, and all A01–A06 controls before editing. Create codex/archive-transfer at /Users/julianhein/Projects/hr-worktree-database-peer from that exact product base after ref/path/capacity checks. Do not substitute the newer plan commit as the product base. One supervisor; zero workers or reviewers here.

Execute A01–A06 completely within the five production files, four new suites and three bounded existing-test amendments. Implement generic capture, version-change review/claim/replay, recoverable transfer, historical conversion entrypoint/mappings, bounded report queries, canonical deletion and relaunch refusal. Preserve command identity before effects, immutable private source versus public report integrity, protected data, shared custody, UNKNOWN refusal, numbering and normal live start/retry/restart. Prove every assigned positive/negative and interruption case; fix in-scope failures autonomously.

Follow the linked parallel protocol: independent work, no check-ins/broadcasts/reservations or observer loops, no sibling dispatch. Either A/Q order is permitted. Run exact scoped unit/architecture selectors, lint and affected generation/freshness from the full brief; record real commands, exits and tested inputs. Full typecheck/coverage, broad parity/build and fresh complete independent review remain 2.6.9; do not run them merely to commit or merge A. L owns physical old-table retirement/shared upgrade-reader wiring after A populated conversion proof; V/H own served UI/desktop proof. Do not launch those owners or claim their work complete.

Commit exact paths, freeze candidate/tree/evidence, merge A locally into master after focused PASS and verified target ownership/cleanliness, rerun invalidated integration checks or prove input-identical reuse. Record release in database-modernization/05-archive-evidence.md, preserve evidence outside the checkout, then remove only A's clean incorporated worktree/ref and verify absence. Send Done / Now / Remaining at start/resume and after every verified step, keeping merge/cleanup and deferred owners visible. No push, operator database migration, HR submission, shared scope expansion or unrelated cleanup. Stop after A's scoped release and owned cleanup.
```
