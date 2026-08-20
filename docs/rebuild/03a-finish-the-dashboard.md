# 03a · Phase 3a — finish the dashboard

This doc is the dedicated home of **Phase 3a** — tree node `{#dash-defaults}`, the dashboard-defaults
half of phase 3: the generic surfaces every workflow inherits (Tracks B, C and D). Phase 3 is three
docs: **3a** is this one, **3b** finishes separations (`03b-finish-separations.md`, which
also carries phase 3's own node `{#phase-3}`), **3c** migrates the remaining workflows
(`03c-migrate-the-remaining-workflows.md`). It holds those tasks, what is done and what is
left, and its exit criteria; contracts it built live in `reference/`.

## Phase summary
<!-- roadmap: dash-defaults -->

<!-- roadmap-status: dash-defaults -->
<!-- /roadmap-status -->

_Moved from `reviews/2026-08-20-master-plan-dissolved.md` §7.1 (the approved target's panel-kind tabs — the shell every later surface lands in) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

- The approved target has panel-kind tabs: run/member `Logs · Receipt`, review
  `Review · Logs · Receipt`, group `People · Logs · Receipt`; Data is in the permanent Context rail
  and captures are inside Receipt/Review. Gate and Failure remain always visible in the centre.

### Track B · dashboard completion
<!-- roadmap: track-b -->

<!-- roadmap-status: track-b -->
<!-- /roadmap-status -->

### Track C · connection proof
<!-- roadmap: track-c -->

<!-- roadmap-status: track-c -->
<!-- /roadmap-status -->

### Track D · dashboard hardening, pre-cutover budgets
<!-- roadmap: track-d -->

<!-- roadmap-status: track-d -->
<!-- /roadmap-status -->

## Integration execution rule (master plan §7.3)

_Moved from `reviews/2026-08-20-master-plan-dissolved.md` §7.3 on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

Every surface lands as one vertical slice: strict schema → server query/projector → subscription
invalidation/patch → command path (when interactive) → production component → schema fixture →
Playwright a11y/screenshot proof. Building the whole React tree against mocks and wiring it later,
or building backend routes with no production surface consumer, does not satisfy a work item.

The demo remains the visual oracle but never becomes runtime infrastructure. It lives in the legacy
repo (`src/dashboard/components/dev/rebuild-demo/**`) and is unreachable from rebuild production
code by construction (D93); approved design-system and surface code is copy-ported with provenance
into the rebuild repo's `src/dashboard/`, while strict schema-valid fixture adapters remain
test-only.

## Decisions this phase ratified

_Derived from `reference/decisions.md`'s round headings on 2026-08-20 (3b) — the
ratification act and the normative pointer stay in the ledger; this is the phase index._

| Rounds | Dates | D-range | What they settled |
|---|---|---|---|
| 48 | 2026-08-12 | D195 | the panel region is a grid; the two side panels share one 376px token; nothing-selected is a state |
| 63–65 | 2026-08-18 | D222–D225 | the backup hazard moves to the inbox (D222), the archived detail is the demo's (D223), the action bar is an island (D224), the timeline is categorical (D225) |
| 67–73 | 2026-08-19 | D227–D242 | the explorer says what the descriptor says (D227–D229), the queue row says what it is and what it made (D230–D233), runs vs archived runs (D234), a batch answers run by run (D235), the report's second authority (D236/D239/D240), short workflow names (D241/D242) |
| 76 | 2026-08-19 | D237–D238 | the two honesty gaps on the run panel — the unreachable `resolved` arm and `done → verified-done` |
| 78–83 | 2026-08-20 | D248–D259 | the Session Panel stops guessing (D248/D249), the run modal (D250/D251), the Data ledger and the unhandled `conflict` arm (D252/D253), the dead channel + findings ledger (D254/D255), the dashboard's clock (D256/D257), the projection stops claiming history it cannot see (D258/D259) |
| 87 | 2026-08-20 | D264 | **Track D is ratified** — dashboard hardening before the second migration, and the descriptor registry leaves the bundle |

`unassigned` — round 46 (D191 the per-commit gate, D192 the advisory tools' dispositions), round 74
(D243/D244 the Duo signCount) and round 75 (D247 the runtime's own name) are platform-wide, not a
phase's: they are listed here only because no phase owns them.

## Exit criteria

07 records no exit block for the dashboard-defaults half of phase 3 — it predates
Tracks B/C/D. What binds instead: every surface lands as one vertical slice (§Integration execution
rule above), the program-wide surface criteria in `05-cut-over.md` §Exit criteria (doc 05 §Exit criteria) must all
pass before the cutover, and each track's own tick-off lives in its section's status block.
