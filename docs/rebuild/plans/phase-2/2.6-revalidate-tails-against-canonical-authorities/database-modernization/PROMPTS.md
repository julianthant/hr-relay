# Launch registry and exact prompts

**Phase 2.6-only execution rule:** 2.6.9 is the single Finalization task and the last task of
the phase. No intermediate or nested finalizers. Earlier implementation tasks use focused tests,
lint and affected freshness; 2.6.9 owns full gates, independent review, remaining repairs, master
integration when assigned, handover and cleanup. Other phases retain their existing rules.

## Readiness

R is released at `60b356dd119140dc972a077751ad16af934acb2e`. C0 consumed it and accepted T1;
C0's scoped-validated handoff is `c7b8b1e037bf27dd70d4df62bbfcac407e475631`
(admitted plan `0010c51c4189f14a8aa61dac55984c2df791045e`). **T is READY** for an operator-started task. C/F/P/D/G/S/L/A/Q/V/U/H and final 2.6.9 remain **WAITING ON** their actual
named prerequisite releases. No placeholder SHA or old side-task prompt is executable.

C0 planning/execution was explicitly preapproved and run in the same scheduled task. Its single
owner is [prerequisites.md](prerequisites.md#c0-execution-brief--preapproved-2026-09-09). Do not
repeat C0 or interpret its completion as authorization to implement every downstream task.

## Visible task IDs

R=2.6.2; C0=2.6.3; T=2.6.4; C=2.6.5; F=2.6.6; P/D/G/S=2.6.6.1/2/3/4;
L=2.6.7; A/Q=2.6.7.1/2; V=2.6.8; U/H=2.6.8.1/2; finalization=2.6.9 (includes handover/cleanup).
No intermediate or nested finalization tasks exist in this Phase 2.6 trial.
Use the exact numeric task and its letter alias together when resolving an implementation prompt.
The old single-card numbering is historical; do not assign timeline T2 to the final proof task.

## Binding registry

Create task branches only at authorized execution after availability/capacity checks. Create a missing
physical lane once; later tasks may reuse it only after its previous owner releases a clean committed
checkout. Candidate branches remain immutable and retained for final verification.
The prefix for every checkout below is `/Users/julianhein/Projects/`. Proposed names are not reserved.
C0 records R and its own actual release; later prerequisite cells remain unresolved until those tasks finish.

| Assignment | Branch | Checkout name | Required release |
| --- | --- | --- | --- |
| R | codex/database-renames | hr-worktree-database-renames | Retained completed R release |
| C0 | codex/database-contracts | hr-worktree-database-contracts | R release + admitted C0 brief |
| T | codex/history-views | hr-worktree-database-contracts | Accepted T1 + R + C0 |
| C | codex/run-completion | hr-worktree-database-contracts | T |
| F | codex/database-foundation | hr-worktree-database-contracts | C |
| P | codex/provider-usage | hr-worktree-database-peer | F |
| D | codex/diagnostics | hr-worktree-database-other | F |
| G | codex/artifact-outputs | hr-worktree-database-peer | F |
| S | codex/settings-activation | hr-worktree-database-other | F |
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
never be presented as READY. Each emitted prompt retains this exact control language:

```text
/supervise EXACT_NUMERIC_TASK (ASSIGNMENT_ID), using the single owning folder /Users/julianhein/Projects/hr-automation-rebuild/docs/rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/. Read README.md, prerequisites.md and the assigned product/execution brief at APPROVED_PLAN_SHA. Use GPT-6 Astra/high. Verify prerequisite BASE_SHA, create or verify the task-owned BRANCH at ABSOLUTE_WORKTREE from the registry, and confirm the exact approved file/test ownership before edits. Never use another task's checkout or master for implementation. Implement the entire assigned scope, fix in-scope failures and run meaningful focused tests, lint and affected freshness checks. No intermediate finalizers; 2.6.9 is the final task including handover and cleanup. Follow the Phase 2.6-only gate trial: full heavy gates and fresh independent review belong to final 2.6.9; this handoff is a development candidate only. Record proof rows and unverified heavy requirements explicitly. A prerequisite must deliver working composed interfaces and verify both descendant peer merge orders before release. Return a compact committed candidate handoff with base/head/tree, paths, tests/exits and remaining work. Do not launch siblings, poll idle tasks, merge into master or push. The operator opens tasks; 2.6.9 owns final integration and all later repairs. Send Done / Now / Remaining at start and each verified step.
```

## Final session prompt

```text
/supervise 2.6.9 (p2f-proof; historical numbers are not launch IDs) using /Users/julianhein/Projects/hr-automation-rebuild/docs/rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/final-validation.md and the parent phase Task 9. Use GPT-6 Astra/high. Verify the approved plan commit and every recorded development candidate before creating the registry's task-owned validation branch/worktree. You are the single final integration/repair owner. Combine the exact candidates, check peer merge order independence, run all required heavy gates and original migration/recovery/adapter-retirement proof, and fix every remaining failure here. Do not send repair work back to completed peers. Obtain fresh independent read-only sup_review on Astra/high for the complete frozen candidate; fix findings here and rerun required gates/review. Preserve all assertions, coverage floors, historical recovery evidence, UNKNOWN refusal and no-second-controlled-write boundaries. Integrate locally only when the operator assigns it after PASS and gates; never push. Complete fixture handover and owned cleanup within this same final task after acceptance, reusing unchanged gate evidence only under D191. Keep Done / Now / Remaining visible. No automatic next-task dispatch or idle observers.
```

## Four-checkout capacity and ownership transfer

The repository limit is four auxiliary worktrees, including unrelated work. At C0 inspection only
R and C0 occupy auxiliary slots; the primary master checkout is integration-only. Preserve R's
retained branch/path. The registry reserves no extra checkout and permits these exclusive lanes:

- Sequential lane `/Users/julianhein/Projects/hr-worktree-database-contracts`: C0 → T → C → F → L → V → 2.6.9.
- Peer lane `/Users/julianhein/Projects/hr-worktree-database-peer`: P → G → A → U.
- Peer lane `/Users/julianhein/Projects/hr-worktree-database-other`: D → S → Q → H.

P/D/G/S remain independent on one F base; at most two execute concurrently because R and the
sequential lane occupy the other slots. P-before-G and D-before-S are physical capacity scheduling,
not API or merge dependencies. A/Q and U/H may execute in parallel on their common release.
Both semantic merge orders remain permitted and required to pass. Any unrelated occupied slot
reduces available concurrency; never exceed four or borrow an active checkout.

Before reuse, verify the sender completed its scoped release, recorded exact base/head/tree/gates,
committed all owned work, stopped its processes and explicitly released exclusive checkout ownership.
The receiving operator-started task accepts that record, verifies clean status and retained candidate
ref, then creates its own named branch at its verified prerequisite with `git switch -c` in that lane.
Do not reset/rewrite the sender's branch or delete its candidate. For a fan-in prerequisite, create
its branch on the named common base and assemble the exact inputs under its admitted merge order.
If ownership is uncertain, do not switch: resolve ownership or wait. Mere idle status is insufficient.

This implements the repository's existing sequential exclusive-checkout option and resolves the
otherwise impossible accumulation of retained worktrees. Only future unused registry paths change;
R's in-flight/retained binding is untouched. Final 2.6.9 owns integration when assigned and cleanup
of all retained candidate refs and the actual remaining physical lanes after acceptance.

## Resolved next assignment — 2.6.4 T

This prompt is saved, not dispatched. C0 is complete as a documentation development release;
T remains unstarted. Later tasks remain WAITING ON their named releases. The receiving supervisor
must confirm C0 released its clean checkout and retain C0's branch before switching it.

```text
/supervise 2.6.4 (T), using /Users/julianhein/Projects/hr-worktree-database-contracts/docs/rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/timeline.md and its C0 execution allocation. Approved plan commit: 0010c51c4189f14a8aa61dac55984c2df791045e. Verified C0 release/base: c7b8b1e037bf27dd70d4df62bbfcac407e475631, containing R 60b356dd119140dc972a077751ad16af934acb2e and accepted T1 46930920696ab214b036d5f2681b8ffb4e5620ea. Use GPT-6 Astra/high and the Phase 2.6 focused-development/final-2.6.9 gate schedule. Verify the exact base, committed plan, C04 evidence, clean status and exclusive checkout release. Retain codex/database-contracts unchanged. In that released checkout create codex/history-views from c7b8b1e037bf27dd70d4df62bbfcac407e475631; do not create another auxiliary worktree or reset a colliding branch. Implement the entire T scope: retained database transaction history, existing Activity CSV/XLSX and explicit safe CLI export, compatible frozen archive transaction capture, and source-complete ledger/outbox retirement. Preserve every T P1–P9 proof, original source/protected identities, historical fingerprints, shared retry evidence and UNKNOWN refusal. Do not rerun T1 or implement archive.sqlite, run summaries or run-completion retirement. Follow exact path/test ownership in timeline.md and the C0 prerequisite/registry records; run meaningful focused tests, lint and affected freshness. Commit and release the focused-tested development candidate to C, recording exact base/head/tree, commands/exits, source/schema interfaces and unverified heavy proof. Release clean exclusive checkout ownership only after the record is committed and owned processes stop. No intermediate review/finalizer, master merge, push, operator DB upgrade, live submit or automatic next-task dispatch. Full gates, remaining repairs, independent complete review, operator-assigned integration and final cleanup remain 2.6.9. Send Done / Now / Remaining at start and every verified step.
```
