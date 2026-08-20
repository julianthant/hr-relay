_Superseded by `docs/rebuild/reference/frontend-backend-integration.md` §3 (the transport contracts
as built), §5 (the wiring matrix with its Built column) and §5.1 (the wire squares). This was §1.3
of that document — the 2026-07-30 audit's list of integration requirements the reference specs did
not yet carry. Every item is now either built and specified in the section named below, or a named
absence with an owner. Kept verbatim; never cite as normative._

### 1.3 Existing rebuild contracts are strong but not yet sufficient for the current target

Refs workflow-model/dashboard-surfaces/data-intake-and-edit-data/write-safety/clock-config-secrets/operator-trust already settle the hard backend foundation: descriptors, spans/notes,
authority vs projection storage, checkpoint edits, intake manifests, write fences, evidence,
archive-on-version-bump, explorer, notifications, and config provenance. The current target adds
or clarifies these integration requirements:

- a bootstrap document rather than several startup registries and requests;
- a resumable, sequenced subscription protocol rather than change-gated payloads without cursor
  semantics;
- panel-kind and available-section projection matching the approved tab/Context/Receipt layout;
- strict start planning and enqueue contracts for every descriptor method;
- command families for settings, workers, version changes, and intake—not route-local mutations;
- progressive per-record Review patches;
- month day-counts and Activity aggregates produced by the same projection family as queue counts;
- exact archive snapshots that never need old runtime code;
- per-candidate and per-capture evidence metadata;
- contextual command results keyed to the affected run/member/record, especially in bulk flows.

These are amendments for the owning documents, not reasons to introduce frontend workarounds.

---

## Where each item landed (2026-08-20, the docs-cohesion rewrite)

| Item | Where it is now |
|---|---|
| a bootstrap document | **BUILT** — `FrontendBootstrapWire`, §3.1. `preflight` is its one optional leaf and is declared-unserved (D184). |
| a resumable, sequenced subscription protocol | **BUILT for one topic** — §3.5. `dashboard-day` is emitted; the other five declared topics have no producer, which §3 and §3.5 now record as to-build. |
| panel-kind and available-section projection | **BUILT** — §3.3. Eleven section arms, four of them declared-unserved in `config/pending-wire-bindings.json`; `review` and `group` panel kinds have no declaring descriptor. |
| strict start planning and enqueue contracts for every descriptor method | **BUILT for the typed method** — §3.4, §5.1.1. The upload/capture/spreadsheet/bare methods have no registered declarer (D251). |
| command families for settings, workers, version changes, and intake | **BUILT** — §3.4: nine families, 35 actions, one route. `apply-settings` is the one arm that answers `capability-unavailable` (D113). |
| progressive per-record Review patches | **NOT BUILT** — the `review` section arm and the `run-review` topic are both unserved; §5.1.4 records that the flow this document once described has no producer on either side. |
| month day-counts and Activity aggregates from the same projection family | **BUILT** — §3.2 (`monthCounts` on the day wire, no calendar route) and §6.7's D180, both inside `run-queue-projection.ts`; `one-projection-counts` holds it. |
| exact archive snapshots that never need old runtime code | **BUILT** — D179, §5.1.5, held by `archive-invariants` over the read path's whole import closure. |
| per-candidate and per-capture evidence metadata | **PARTIAL** — the metadata schemas exist (§3.6); nothing serves artifact BYTES, so the `captures` section is declared-unserved. |
| contextual command results keyed to the affected run/member/record | **BUILT** — the result's `affectedTargets` and the bulk route's per-target vector, §3.4. |
