# 03b · Phase 3b — finish separations

This doc is the dedicated home of **Phase 3b** — separations, order 8, the first migration — and it
carries phase 3's own tree node `{#phase-3}`. Phase 3 is three docs: **3a** finishes the dashboard
(`03a-finish-the-dashboard.md`, tree node `{#dash-defaults}`), **3b** is this one, **3c**
migrates the remaining workflows (`03c-migrate-the-remaining-workflows.md`). It holds those
tasks, what is done and what is left, and its exit criteria; contracts it built live in
`reference/`, and the as-built record of the migration itself stays `docs/migrations/separations.md`.

## Phase summary
<!-- roadmap: phase-3 -->

<!-- roadmap-status: phase-3 -->
<!-- /roadmap-status -->

_Moved from 07-master-plan §3.1 (the PHASE 3 ENTRY block — D193's operator choice and its reasoning) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

**PHASE 3 ENTRY — SEPARATIONS (order 8). Operator choice, 2026-08-12 (D193).** This loop has always
left *which workflow goes first* to the operator; the choice is now made and it is **separations**.

**The operator's reasoning, recorded because it is the part that generalizes.** A big multi-system
workflow **forces the store task libraries into existence**. Separations touches UCPath (the
termination write), Kuali (the separation document read plus the finalization write), and
**new-kronos** (a driver, a login recipe, and timecard reads that do not exist at all today), so
one migration mints the write family, the read family, and a whole new system store in one pass —
and every later migration draws from them. Entering through the small reads instead would trickle
the same stores in a task at a time, spending the same total effort with the reuse arriving last
rather than first. The trade is taken with eyes open: separations is also the **deepest**
write-safety proof (§3.3 order 8), so the entry is deliberately the hard one.

**What this does NOT change.** §3.3 is **not re-sequenced** — it remains the risk-proof ordering,
and its reasoning about why the highest-stakes writes sit at 8–9 is still the honest read of the
risk. Entering there is a decision about *which proof is bought first*, not a claim that the proof
is cheaper. Every workflow still owes its own §3.2 exit criteria in full, separations included:
§b questionnaire first (step 1 — **nothing is built before it is answered**), live dry-run, and a
**controlled-commit proof on an operator-approved target**. No such target exists for a UCPath
termination or a Kuali finalization today and **none is invented here** — naming one is operator
work at the point the migration reaches step 5, the same standing rule as ServiceNow/OnBase in
§3.8.

**Where its questionnaire lives:** `docs/migrations/separations.md` — the first Phase-3 migration
doc, and therefore the convention every later one follows (§0.1: migration docs are children of
this plan; they answer §3.4 and record reuse/additions, and never re-order the program).

## Separations — order 8, the first migration
<!-- roadmap: order-8 -->

<!-- roadmap-status: order-8 -->
<!-- /roadmap-status -->

_Moved from 07-master-plan §3.1 (separations' §3.2 status block, 2026-08-14) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

> **Separations' §3.2 status, 2026-08-14 (`docs/migrations/separations.md` §6 owns the checklist;
> §9.17 is the latest as-built).** **The live dry-run criterion and the D58 sweep are now MET; the
> regression-record criterion is PARTLY MET; ONE criterion is fully open, and it is one fact:**
>
> - **The three controlled commits**, on a target the operator names (§4f2), and the three
>   confirmation obligations that can only be discharged by them: **D207**'s provisional
>   `stabilized` recovery-absence window, **D215**'s `would-prepare` preview arm observed against a
>   real settlement, and **D217**'s two date write-backs' WIRE SHAPES — their `formKey`s are captured
>   but a `Date` gadget's model value is epoch milliseconds, so only the real payload settles them.
>
> **What §9.17 closed.** The composed dry run reached its **preview terminal** through the real
> pipeline (run `7565a88d`, doc 4502, terminal `done`) with `transaction.previewed`, the
> preview-bound terminal record and the receipt's live `DRY_RUN_PREVIEW` warning — which also proved
> **D215's `already-present` arm live** and **D214** across three claim generations. The **D58
> disposition sweep** is done (three entries, all correctly dispositioned; `legacy-tool-ops-sanity-check-record`'s
> D192 condition is flagged as materially satisfied by the §14.2 packet's prose comparisons, for the
> operator to close). Reaching the preview terminal also found a fourth live defect — D215's
> `not-observed` subject verdict had never reached the span WIRE leaf, so the first preview that ever
> settled killed the worker one emit short of its terminal — fixed with its test in `e1ba81b`, and
> the run itself was correct throughout (zero intent, zero fence, D200's self-sweep released the
> orphaned claim). One live-lane finding — a `run`/`retry` minted a new run at attempt 1, so an
> `always-rerun` node re-collided with the ORIGINAL run's checkpoint and **a separations run that
> failed at or after `timecard-search` could not be retried at all** — was closed the SAME DAY as
> **D221** (doc 02 §5.7: the checkpoint key's attempt is the ITEM's attempt) with its regression
> pinned in `tests/unit/retry-item-attempt.test.ts`; the fix has not yet been exercised on a live
> retry, which stays owed. The composed **REAL** run on canary doc 4510 (`ee9824f7`, not dry) refused
> `NO_ACTIVE_EMPLOYMENT` **before the gate** — a valid result: UCPath shows one `Inactive` employment
> for EID 10001799, so there is no employment for the separation to end, and 4510 cannot proceed on
> the composed graph until the operator makes an active terminable employment exist. Zero durable
> write rows across both parts.
>
> **One §3.2 expectation was corrected rather than met.** §4f3's `probeToFenceMaxMs` per-beat
> measurement does NOT ride on the preview terminal: a settled preview emits one event and has no
> fence at all, so the number can only come from a real fenced transaction. It rides with the
> controlled commits.
>
> This is a status line, not a waiver: an open criterion still blocks rebuild-ready status exactly as
> §3.2 says.

### 1 · new-kronos timecard read
<!-- roadmap: sep-1 -->

<!-- roadmap-status: sep-1 -->
<!-- /roadmap-status -->

### 2 · Kuali separation-document read
<!-- roadmap: sep-2 -->

<!-- roadmap-status: sep-2 -->
<!-- /roadmap-status -->

### 3 · UCPath employment grid + the ALWAYS-GATE
<!-- roadmap: sep-3 -->

<!-- roadmap-status: sep-3 -->
<!-- /roadmap-status -->

### 4 · UCPath termination WRITE
<!-- roadmap: sep-4 -->

<!-- roadmap-status: sep-4 -->
<!-- /roadmap-status -->

### 5a/b/c · Kuali finalization WRITE
<!-- roadmap: sep-5 -->

<!-- roadmap-status: sep-5 -->
<!-- /roadmap-status -->

### 6a · THE COMPOSITION
<!-- roadmap: sep-6a -->

<!-- roadmap-status: sep-6a -->
<!-- /roadmap-status -->

### 6b · composed LIVE pass
<!-- roadmap: sep-6b -->

<!-- roadmap-status: sep-6b -->
<!-- /roadmap-status -->

### 6c · PREVIEW TERMINAL reached
<!-- roadmap: sep-6c -->

<!-- roadmap-status: sep-6c -->
<!-- /roadmap-status -->

### Track A · separations backend completion
<!-- roadmap: track-a -->

<!-- roadmap-status: track-a -->
<!-- /roadmap-status -->

### Dashboard · wire separations
<!-- roadmap: sep-dash -->

<!-- roadmap-status: sep-dash -->
<!-- /roadmap-status -->

## Platform fixes the live runs forced
<!-- roadmap: platform-fixes -->

<!-- roadmap-status: platform-fixes -->
<!-- /roadmap-status -->

## Smaller operator calls open
<!-- roadmap: operator-calls -->

<!-- roadmap-status: operator-calls -->
<!-- /roadmap-status -->

## Decisions this phase ratified

_Derived from `reference/decisions.md`'s round headings on 2026-08-20 (3b) — the
ratification act and the normative pointer stay in the ledger; this is the phase index._

| Rounds | Dates | D-range | What they settled |
|---|---|---|---|
| 47 | 2026-08-12 | D193 | **the Phase-3 entry is separations** (with the scope and storage clauses) |
| 48 | 2026-08-12 | D194, D196 | the rich-extraction convention — one task per page visit — and the five rules `new-kronos` settled for every store after it |
| 49–51 | 2026-08-12 | D197–D205 | chunk 2's Kuali separation-document read (D197/D198), the two platform items it surfaced (D199 the receipt's own fingerprint, D200 the lease as evidence), chunk 3's UCPath identity read + the ALWAYS-GATE (D201–D205) |
| 52–56 | 2026-08-14 | D206–D213 | chunk 4's UCPath termination write (D206/D207), chunk 5's Kuali finalization write (D208–D210), the gate PACKET binding every value it authorizes (D211), chunk 6a's composition (D212/D213) |
| 57–62 | 2026-08-14 | D214–D221 | the two blockers the composed live pass surfaced (D214 the claim generation, D215 the preview's probe), the one browser-profile root (D216), §4e's date staging (D217), the cross-process span ingest (D218), workflow roles (D219/D220), **a retry is the item's next attempt** (D221) |
| 66 | 2026-08-19 | D226 | the identity gate's three ceremonies |
| 77 | 2026-08-20 | D245–D246 | the parked write gets a way in and keeps its way out |
| 84–86 | 2026-08-20 | D260–D262 | the separations start door refused with its trigger named (D260), then built — the graph resolves its own action id (D261) — and the gate park published as the product's one needs-you moment (D262) |

## Exit criteria

Separations owes the **per-workflow** exit criteria in full — 07 §3.2, moved verbatim
to `03c-migrate-the-remaining-workflows.md` §Exit criteria, which every migration answers including
this one. Its live state as 07 recorded it (8 of 9 met; the three controlled commits and the three
confirmation obligations that only they can discharge are the open one) is the status block under
§Separations — order 8 above; `docs/migrations/separations.md` §6 owns the checklist itself.
