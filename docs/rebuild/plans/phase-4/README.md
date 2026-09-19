# Phase 4 · Workflow migrations

## Phase summary
<!-- roadmap: migrations -->

Phase 4 migrates workflows after Phase 3 closes. Workflow subphases use decimal numbering:
**4.1 Background Check**, then 4.2, 4.3 and onward. The operator selected Background Check and
requested a reusable dashboard workflow with implementation tasks beneath 4.1. The walkthrough
is discovery evidence, not the roadmap task list. Implementation still requires Phase 3 completion
and D319 admission.

The admission contract remains [workflow-model §1.6.2](../../reference/workflow-model.md#162-workflow-admission-before-a-phase-4-part-d319d323-2026-09-03).
The roadmap owns current status and prerequisites; migration records stay in `docs/rebuild/migrations/`.

## Subphase plans

- [Phase 4.1 · Background Check](4.1-background-check/README.md) — tasks 4.1.1–4.1.5

## Delivery cadence from Phase 3.2

The [2026-09-19 roadmap amendment](../../../roadmap/roadmap.md#tangible-tasks-and-phase-exit-gates)
requires concrete feature/outcome tasks and tangible subtasks, sequential unless labelled Parallel.
Each delivery part runs focused checks throughout and full gates at its end under
[the gate owner](../../reference/guards-and-tests.md#phase-exit-gates-from-3-2).
Phase 3.1 retains its existing cadence. Proof, admission, freeze and cutover boundaries remain.
