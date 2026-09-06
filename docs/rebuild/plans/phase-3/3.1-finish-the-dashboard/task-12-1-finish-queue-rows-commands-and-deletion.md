# Task 12-1 · Finish queue rows, commands, and deletion
<!-- roadmap: dash-queue -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Render every row fact from the canonical run record; make all single/bulk commands real,
  revision-bound, idempotent, and convergent across current/archive/tombstone views.
- [ ] Keep Rerun as Task 11-2's plan-backed modal launcher; this task does not restore direct
  retry/restart queue mutations.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes `ref dashboard-surfaces` §D330.5 — every row fact comes from the
> run record through `read`/`list`, and `list` uses §D330.6's total order (`priority`, then
> `enqueuedAt` ascending, then `runId`), so the operator sees the row the next claim will take — plus
> §D330.8's `delete` behind its insert-only tombstone, whose released permanent idempotency keys the
> confirm copy states. Two R01 residues belong to this task: the strict subscription wire's
> `remove-queue-surface` / `tombstone-queue-surface` operations
> (`src/domain/dashboard/subscription.ts:30`) have no producer today and are the natural wire for a
> tombstoned run, so 12-1 owns producing them; and the two projector outcome enums that disagree on
> `skipped` (`src/server/dashboard/projectors/run-queue-projection.ts:110` versus `:133`) are 12-1's to
> reconcile. No redesign.
