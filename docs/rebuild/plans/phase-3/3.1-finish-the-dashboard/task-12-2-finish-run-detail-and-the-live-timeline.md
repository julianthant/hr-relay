# Task 12-2 · Finish run detail and the live timeline
<!-- roadmap: dash-run-detail -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Render groups/attempts/status arms/duration/systems/provenance and preserve exact live UI state
  across patches, retry, archive, reconnect, and out-of-order delivery.
- [ ] Freeze separate section projector/component/test seams for Context/Data, Logs,
  Receipts/Failures, and Gates so Tasks 13-1–13-4 can run without a shared mutable switch or query file.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes `ref dashboard-surfaces` §D330.3's seven closed lifecycle states
> (`queued` · `claimed` · `validating` · `running` · `parked-gate` · `parked-write` · `terminal`) — a
> park IS a state, never a sentinel — and §D330.4, where the served `version` is the row revision the
> wire calls `rowRevision`. D268's ONE run-status derivation is retained with the span fold
> contributing no lifecycle arm (§D330.12 item 1). Attempts render as separately selectable evidence
> rows under one item and are never compared for the operator (the D289 amendment, root `CLAUDE.md`).
> No redesign.
