# Intermediate group finalization

This file owns the two sequential finalization children in the [database workflow](README.md).
The parent task supplies working prerequisites. Its workers run independently. This last child
combines all of them and publishes the next development release; it is not another parallel worker.

| Finalization child | Parent | Required worker candidates | Releases |
| --- | --- | --- | --- |
| 2.6.6.5 · Finalization | 2.6.6 F | 2.6.6.1 P, 2.6.6.2 D, 2.6.6.3 G, 2.6.6.4 S | 2.6.7 L |
| 2.6.7.3 · Finalization | 2.6.7 L | 2.6.7.1 A, 2.6.7.2 Q | 2.6.8 V |

## Scope and release

One operator-started Astra/high supervisor, default zero workers. Consume every exact committed
candidate, plan/proof record and prerequisite ancestry. Assemble them in this task's own isolated
branch/worktree; no master merge. Verify no unowned path, missing proof or red focused check is
hidden by the handoff. Integrate peers in either permitted order, reconcile generated/shared output,
fix immediate integration defects here and run meaningful focused combination tests, lint and
affected freshness. Record which product proofs remain deferred to final acceptance.

2.6.6.5 proves composed provider/diagnostic/artifact/settings interactions, migration identity,
settings continuity, evidence references and source interfaces needed by L. 2.6.7.3 proves archive
capture/cleanup and summary updates/rebuild agree under version application, deletion and recovery.
Use populated isolated fixtures and negative controls. C0 supplies exact test paths/commands after
module allocation; no guessed scripts or broad suite repeats are required at this stage.

Publish a compact development release record: plan/base/head/tree, branch/worktree, exact input
SHAs, owned fixes, focused commands/exits, contract versions, unverified heavy proof and next binding.
Do not hand repairs back to finished workers, launch the next task, or claim master acceptance.
A missing/failed prerequisite leaves this child unreleased. All heavy gates and independent review
remain assigned to **2.6.8.3**, the one fresh final acceptance/repair session for the whole batch.
Intermediate children do not spawn reviewers or repeat heavy suites under the scoped exception.

## Isolation and conditional launch wording

| Task | Branch | Absolute worktree |
| --- | --- | --- |
| 2.6.6.5 | codex/domain-finalization | /Users/julianhein/Projects/hr-worktree-domain-finalization |
| 2.6.7.3 | codex/lifecycle-finalization | /Users/julianhein/Projects/hr-worktree-lifecycle-finalization |

Names are proposals, not reservations. At launch verify capacity/ownership and record actual
parent/candidate SHAs and approved plan commit. Preserve the four-worktree ceiling and candidate
branches/evidence if an idle clean worker worktree is released. Never remove another active checkout.
Use invocation-owned temporary DB/files and assigned test workers; serialize shared target writes.

```text
/supervise EXACT_FINALIZATION_CHILD using the group-finalization.md owner in /Users/julianhein/Projects/hr-automation-rebuild/docs/rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/. Verify the approved plan SHA, parent release and every named child candidate before creating the registry's exact owned branch/worktree. Use Astra/high, no implementation subagents by default. Combine all candidates, fix immediate integration failures here, run focused combination tests, lint and affected freshness, and record an exact development release. Follow the batch exception: heavy gates and independent review remain with 2.6.8.3; no green claim for unrun proof. Do not return repairs to finished peers, merge master, push, dispatch the next task or run idle observer loops. Return the compact handoff and Done / Now / Remaining updates. C0 must resolve this prompt's exact numeric child, plan/input SHAs and command set before launch.
```

**WAITING ON:** C0's admitted file/test allocation and all required worker releases.
