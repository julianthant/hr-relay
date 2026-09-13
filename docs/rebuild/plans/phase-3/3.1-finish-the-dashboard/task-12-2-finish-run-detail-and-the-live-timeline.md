# Task 12-2 · Finish run detail and the live timeline
<!-- roadmap: dash-run-detail -->

**Current assignment: 3.1.14.1.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full gates at finalization, no independent review.
Historical filenames and headings remain citation aliases, not another assignment.


Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Render groups/attempts/status arms/duration/systems/provenance and preserve exact live UI state
  across patches, retry, archive, reconnect, and out-of-order delivery.
D344 moves the shared section projector/component/test extraction to
[the detail foundation](prerequisite-detail-foundation.md), which must be accepted first.
This task retains all timeline/rendering/realtime acceptance above and owns none of the four
section tasks. Those tasks depend on the accepted foundation and Queue, not this timeline task.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes `ref dashboard-surfaces` §D330.3's seven closed lifecycle states
> (`queued` · `claimed` · `validating` · `running` · `parked-gate` · `parked-write` · `terminal`) — a
> park IS a state, never a sentinel — and §D330.4, where the served `version` is the row revision the
> wire calls `rowRevision`. D268's ONE run-status derivation is retained with the span fold
> contributing no lifecycle arm (§D330.12 item 1). Attempts render as separately selectable evidence
> rows under one item and are never compared for the operator (the D289 amendment, root `CLAUDE.md`).
> No redesign.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.
