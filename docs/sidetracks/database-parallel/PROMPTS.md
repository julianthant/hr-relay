# Launch one prerequisite, then three parallel tasks

## Archive-report amendment — 2026-09-08

The pasted prompts below pin the earlier plan revision and do not include the approved independent
archive-report design. They remain historical launch specifications, not ready prompts for the
revised combined scope. Before a new launch, resolve the shared archive prerequisite and peer
ownership, commit all amended owners, then replace these prompts with the verified plan/base SHAs
and exact revised scope. Do not launch the new archive work in parallel with overlapping old shared
storage assignments. Do not restart or message already running tasks automatically.

The subsequently approved shared `run_summaries` read model also requires revised prerequisite and
mutation-hook ownership; include the [existing summary owner](../database-remaining/README.md#approved-group-5-dryrun-results-and-shared-run-summaries)
when regenerating these prompts. The old pinned prompts contain neither this scope nor its proof.

Archive design owner: [independent archive reports](../database-remaining/README.md#approved-group-3-independent-archive-reports-and-no-relaunch).
This is a planning amendment. Preserve existing in-flight gate schedules, candidate evidence and
accepted work; it does not launch implementation or reschedule reviews. New launch readiness awaits
the complete revised allocation and verified prompts.

All plans are in this folder. Approved plan commit: `4045ef4f77d1622ef5a3bdc584a60acd58eb63a7`.

1. Launch **00 — prerequisites** once. It completes A then B, with their separate reviews, gates,
   explicitly assigned local integration and cleanup. Do not separately launch A or B.
2. After its release record says **READY**, launch **01, 02 and 03 together**, subject to capacity.
   They use the same accepted B SHA, without dependencies on one another.
3. Assign peer integration to the existing provider task with the last prompt when candidates are ready.

That means **one prerequisite supervisor first; three implementation supervisors afterward**.
Each peer uses one independent reviewer when needed (up to six active agents across the three tasks,
subject to capacity). Test-process workers are a separate resource budget; coverage windows remain
scheduled. There is no fourth coordinator. Existing running tasks are excluded from this count.

Current launch status: **WAITING ON timeline T2 and verified prerequisite release**, as applicable.
No future execution SHA is invented; resolve it from the accepted record before checkout creation.

## 00 — Prerequisites: launch once

```text
/supervise side/database-prerequisites
Plan: /Users/julianhein/Projects/hr-automation-rebuild/docs/sidetracks/database-parallel/00-prerequisites.md
Approved plan commit: 4045ef4f77d1622ef5a3bdc584a60acd58eb63a7
Execution binding: /Users/julianhein/Projects/hr-automation-rebuild/docs/sidetracks/database-parallel/README.md
Use GPT-6 Astra at high reasoning. This is one approved side-work assignment: execute units A then B
locally in this supervisor task. The side plans own scope, progress, proof and completion wherever
/supervise refers to a task/phase section. Do not create a phase number or mark roadmap tasks complete.
Read the pinned committed plans and current accepted prerequisite evidence before effects.

WAITING ON accepted local-master integration of side/timeline-history-2 and its existing prerequisites.
Resolve and verify that actual full base SHA; planning HEAD or an unmerged branch is not a substitute.
Leave all four running plans/tasks unchanged. Verify free worktree capacity and exact ref/path ownership.

A: execute the complete /Users/julianhein/Projects/hr-automation-rebuild/docs/sidetracks/database-parallel/00a-run-completion.md specification.
Create codex/run-completion at /Users/julianhein/Projects/hr-worktree-run-completion from the verified
timeline T2 integration. Preserve all P1–P6 and gates; obtain fresh independent read-only sup_review
on Astra/high, fix/re-review, then integrate and clean up A before beginning B.

B: execute the full shared-foundation unit and release criteria in /Users/julianhein/Projects/hr-automation-rebuild/docs/sidetracks/database-parallel/README.md.
Create codex/database-foundation at /Users/julianhein/Projects/hr-worktree-database-foundation from A's
actual accepted local-master integration. Complete the assigned shared storage, migration, real adapters,
former artifacts T1, frozen interfaces and all allocated proof. Use only the optional bounded sup_astra
worker admitted there, after stable inputs; finish it before fresh independent sup_review. Preserve
A/B's separate commit-bound reviews and all implementation/integration gates. No nested supervisors.
Reuse only this exact task/unit's verified interrupted checkout; do not reserve both worktrees at once.

I explicitly assign this prerequisite task local integration and cleanup of A, then B, after independent
review PASS and required gates. Target is local master at /Users/julianhein/Projects/hr-automation-rebuild. Verify target ownership and serialize
its updates; isolate shared/dirty integration as the plan requires. Review behavioral conflict fixes
independently and gate every materially changed integration tree. Remove only exact accepted owned
branches/worktrees from a safe checkout. Do not push or apply migrations to the operator database.

Complete the release record in 00-prerequisites.md only after B's accepted integration, gates, cleanup,
real-interface/independence proof and resource admission. Return three copy-ready peer prompts pinned
to the actual accepted B release SHA. Do not launch peers or an extra prerequisite task. If no real B
release exists, say exactly what remains; do not mark this prerequisite complete from a reviewed branch.
Send Done / Now / Remaining at start/resume and after every verified step. Preserve D191, test slots,
compact durable handoffs, all contracts and no idle observer loops. End after the complete release.
```

## 01 — Provider accounting: parallel

```text
/supervise side/provider-usage
Plan: /Users/julianhein/Projects/hr-automation-rebuild/docs/sidetracks/database-parallel/01-provider-usage.md
Approved plan commit: 4045ef4f77d1622ef5a3bdc584a60acd58eb63a7.
Execution binding: /Users/julianhein/Projects/hr-automation-rebuild/docs/sidetracks/database-parallel/README.md.
Read the committed approved scope with git show, then read the owning plan's current progress and
accepted prerequisite evidence. Do not treat later progress-only records as a scope amendment.
This is an approved side-work assignment. The side plan is the task owner wherever /supervise refers
to a task/phase section. Record progress, review, gate evidence and completion there. Do not create
a phase number or mark roadmap tasks complete. Preserve repository contracts, independent review,
required gates and the authorized integration/cleanup conditions.
Use GPT-6 Astra/high; execution workers, if admitted, use sup_astra. Obtain fresh read-only sup_review
on Astra/high against the complete pinned candidate. Send Done / Now / Remaining at start/resume
and after each verified step. Respect exact ownership, test-resource slots, D191, compact accepted
handoffs and no idle observer loops. Return a reviewed candidate for operator-chosen integration;
do not merge automatically, push, launch sibling tasks, modify the four in-flight assignments or
apply an upgrade to the operator database.
Create branch codex/provider-usage at /Users/julianhein/Projects/hr-worktree-provider-usage only after verifying prerequisites,
ref/path ownership and worktree capacity. Reuse only this exact task's verified interrupted checkout.
WAITING ON accepted prerequisite B and its complete release record. Resolve the exact accepted B
release commit from 00-prerequisites.md#release-record, verify it is integrated into local master, and use
that same pinned B base as D/G even if a peer subsequently merges. Implement only peer P's generic
provider-neutral accounting behavior and proof allocation. No actual key/provider wiring. Do not
edit frozen schema/migration/composition or D/G files. Prove this peer on B without either sibling.
Record this task's actual returned identity as the designated peer integration owner in its evidence.
Naming that owner does not authorize automatic merges. Finish the reviewed accounting candidate;
end the turn if no local work remains. Resume later for a concrete operator integration assignment
or an accepted actionable handoff, not status polling.
```

## 02 — Diagnostic resolution: parallel

```text
/supervise side/diagnostics
Plan: /Users/julianhein/Projects/hr-automation-rebuild/docs/sidetracks/database-parallel/02-diagnostics.md
Approved plan commit: 4045ef4f77d1622ef5a3bdc584a60acd58eb63a7.
Execution binding: /Users/julianhein/Projects/hr-automation-rebuild/docs/sidetracks/database-parallel/README.md.
Read the committed approved scope with git show, then read the owning plan's current progress and
accepted prerequisite evidence. Do not treat later progress-only records as a scope amendment.
This is an approved side-work assignment. The side plan is the task owner wherever /supervise refers
to a task/phase section. Record progress, review, gate evidence and completion there. Do not create
a phase number or mark roadmap tasks complete. Preserve repository contracts, independent review,
required gates and the authorized integration/cleanup conditions.
Use GPT-6 Astra/high; execution workers, if admitted, use sup_astra. Obtain fresh read-only sup_review
on Astra/high against the complete pinned candidate. Send Done / Now / Remaining at start/resume
and after each verified step. Respect exact ownership, test-resource slots, D191, compact accepted
handoffs and no idle observer loops. Return a reviewed candidate for operator-chosen integration;
do not merge automatically, push, launch sibling tasks, modify the four in-flight assignments or
apply an upgrade to the operator database.
Create branch codex/diagnostics at /Users/julianhein/Projects/hr-worktree-diagnostics only after verifying prerequisites,
ref/path ownership and worktree capacity. Reuse only this exact task's verified interrupted checkout.
WAITING ON accepted prerequisite B and its complete release record. Resolve the exact accepted B
release commit from 00-prerequisites.md#release-record, verify local-master integration, and pin the same
base as P/G. Implement peer D: admitted Mark resolved/Reopen command, atomic annotation/audit/timeline,
readback and usable failure/archive controls. B already owns renames, retirement and shared storage;
do not redo them or edit frozen files. Prove the complete command/UI flow on B without P/G. Use /ui
and required full parity. Return the pinned reviewed candidate to the provider-usage integration
owner when its actual task ID is known; otherwise return it to the operator without guessing a
recipient. Retain responsibility until transfer is accepted, then end if no local work remains.
```

## 03 — Generated artifacts: parallel

```text
/supervise side/artifacts-2
Plan: /Users/julianhein/Projects/hr-automation-rebuild/docs/sidetracks/database-parallel/03-artifacts.md
Approved plan commit: 4045ef4f77d1622ef5a3bdc584a60acd58eb63a7.
Execution binding: /Users/julianhein/Projects/hr-automation-rebuild/docs/sidetracks/database-parallel/README.md.
Read the committed approved scope with git show, then read the owning plan's current progress and
accepted prerequisite evidence. Do not treat later progress-only records as a scope amendment.
This is an approved side-work assignment. The side plan is the task owner wherever /supervise refers
to a task/phase section. Record progress, review, gate evidence and completion there. Do not create
a phase number or mark roadmap tasks complete. Preserve repository contracts, independent review,
required gates and the authorized integration/cleanup conditions.
Use GPT-6 Astra/high; execution workers, if admitted, use sup_astra. Obtain fresh read-only sup_review
on Astra/high against the complete pinned candidate. Send Done / Now / Remaining at start/resume
and after each verified step. Respect exact ownership, test-resource slots, D191, compact accepted
handoffs and no idle observer loops. Return a reviewed candidate for operator-chosen integration;
do not merge automatically, push, launch sibling tasks, modify the four in-flight assignments or
apply an upgrade to the operator database.
Create branch codex/artifact-outputs at /Users/julianhein/Projects/hr-worktree-artifact-outputs only after verifying prerequisites,
ref/path ownership and worktree capacity. Reuse only this exact task's verified interrupted checkout.
WAITING ON accepted prerequisite B and its complete release record, including former artifacts T1
and generated-storage conversion. Resolve and verify the exact integrated B release SHA and pin the
same base as P/D. Implement peer G's managed file publication, immutable versions, ordered/fenced
checkpoint consumption and registration of existing explicit XLSX exports. Do not redo import/schema
work, edit frozen composition, or activate a new provider/workflow/output format. Prove the filesystem
failure windows and complete existing export service on B without P/D. Return the pinned reviewed
candidate with proof to the provider-usage integration owner when its actual task ID is known;
otherwise return it to the operator. No observer loop or unaccepted responsibility transfer.
```

## Later — Integration: resume the existing provider task

```text
/supervise side/provider-usage — peer-batch integration
I assign you integration of the reviewed database peers that have accepted handoffs. You are the
existing implementing integration owner; do not create another task or dispatch siblings.
Approved plan commit: 4045ef4f77d1622ef5a3bdc584a60acd58eb63a7
Execution owner: /Users/julianhein/Projects/hr-automation-rebuild/docs/sidetracks/database-parallel/README.md
Product owner: /Users/julianhein/Projects/hr-automation-rebuild/docs/sidetracks/database-parallel/01-provider-usage.md
Use GPT-6 Astra/high and preserve fresh independent sup_review, D191 and all product gates.
Read 00-prerequisites.md#release-record and the accepted P/D/G handoffs. Verify each exact base/head/tree, actual task
identity, full proof/gate/review verdict and clean/dirty state. Integrate only candidates with complete
accepted evidence; list any missing candidate as unfinished, not a reason to watch it in an idle loop.
Verify pairwise merge-order independence against B for available candidates. Serialize target changes
under the plan. Local target is master at /Users/julianhein/Projects/hr-automation-rebuild; verify its ownership/state first.
If a shared/dirty target requires isolation, create codex/database-integration at
/Users/julianhein/Projects/hr-worktree-database-integration from the verified target SHA, only with a free
worktree slot, and perform the later target update in an assigned serialized window.
Run required gates on every materially changed combined tree, independently review behavioral conflict
fixes, and reconcile shared contract/index status from the peers' exact evidence. A new shared dependency
or order-sensitive implementation returns for a plan amendment; do not hide it in conflict resolution.
After accepted integration/gates, remove only the exact integrated owned branches/worktrees from a safe
checkout and verify registration, path and ref cleanup. Do not remove dirty evidence or unrelated work.
Mark product completion only when all allocated proof, review, integration and cleanup are verified.
Send Done / Now / Remaining after each verified step. Use compact accepted handoffs and actionable
resumes; end when no local work remains. No push, live database conversion or automatic task archival.
```
