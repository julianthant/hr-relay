# 04 · Phase 4 — close the deferrals

This doc is the dedicated home of **Phase 4**, tree node `{#deferred}` — every X → Y deferral and the
trigger that ends it. It holds those tasks, what is done and what is left, and its exit criteria;
contracts it built live in `reference/`.

## Phase summary
<!-- roadmap: deferred -->

<!-- roadmap-status: deferred -->
<!-- /roadmap-status -->

_Moved from `history/superseded/2026-08-20-master-plan-dissolved.md` §3.5 on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

- **Service stores** (`extraction`/`normalization`/`ocr`/`roster` contract+impl) — **Phase 2h** (they need 01+11+12)
  so they exist before consumers; the **ocr pipeline workflow** migrates at **order 3** (before its
  OCR/roster consumers at orders 4–5, 9).
- **Provider infrastructure + advisory AI.** The capability-neutral admission/budget core lands in
  1f. Production model/key pools, adapters, and consumers land in 2h for OCR and normalization.
  Operator triage/sanity/selector/summary adapters land in 2i against redacted
  structured evidence but stay disabled for authority and cut over after Phase 2 proves the receipt/
  failure surfaces. Provider absence is an explicit advisory-unavailable result.
- **Column mapping + intake manifest + Edit-Data UI** (ref data-intake-and-edit-data) — land in **Phase 2h/2i** as base
  capabilities over synthetic fixtures, even though their first production workflow consumer is
  work-study (order 6). This avoids inventing data/rerun/edit contracts during a high-risk write
  migration. Note **i9-check (order 5) does not exercise operator mapping**—it matches against a
  fixed retention roster—but it does exercise the same stable artifact/outbox/evidence machinery.
  Work-study and onboarding therefore validate an already-built mapping surface rather than owning it.
- **Mobile capture** backend/session recovery/bundle outbox lands in **2h** and its dashboard/phone UI
  in **2i** over synthetic handoffs. Legacy capture remains production-authoritative; rebuild
  capture uses isolated state and hands off only within the rebuild repo. Both switch together at final cutover.

_Moved from `history/superseded/2026-08-20-master-plan-dissolved.md` §3 (Phase 0's deferred decisions — logged with the point each resolves at) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

**Deferred decisions (logged, resolved at the named point).** OnBase
`upload-verify` vs `unverifiableByPage` (ref write-safety OQ2—before order 7); per-workflow prewrite
probe policy/elapsed budget and pending-termination sweep modeling (09 OQ4/OQ5—each §b questionnaire).
Canonical EID is now settled as `/^10\d{6}$/` with a legacy-fixture audit; roster-match freshness is
settled at a 24h base maximum over immutable artifact observation time (ref data-intake-and-edit-data §1/§4). Checkpoint
retention is settled by D14—logical-item deletion only, never JSONL age. Ledger altitude, config
snapshots, one active item per worker, explicit fresh-session boundaries, and context-exclusive transactions are also settled defaults, not open
Phase-1 dependencies.

## Photograph a paper form on your phone → it becomes an OCR-backed run
<!-- roadmap: def-capture-binding -->

<!-- roadmap-status: def-capture-binding -->
<!-- /roadmap-status -->

## Run the dashboard without the dev server / use the phone page in production
<!-- roadmap: def-byte-path -->

<!-- roadmap-status: def-byte-path -->
<!-- /roadmap-status -->

## Edit a workflow's presentation / policy without a code change
<!-- roadmap: def-explorer-edit -->

<!-- roadmap-status: def-explorer-edit -->
<!-- /roadmap-status -->

## A record-sanity-check advisory panel
<!-- roadmap: def-sanity-check -->

<!-- roadmap-status: def-sanity-check -->
<!-- /roadmap-status -->

## Edit settings in the dashboard
<!-- roadmap: def-settings -->

<!-- roadmap-status: def-settings -->
<!-- /roadmap-status -->

## Trust UCPath / ServiceNow wait-before-negative-read windows
<!-- roadmap: def-propagation -->

<!-- roadmap-status: def-propagation -->
<!-- /roadmap-status -->

## Search runs across dates / view screenshots / export Excel
<!-- roadmap: def-search-export -->

<!-- roadmap-status: def-search-export -->
<!-- /roadmap-status -->

## Auto-purge diagnostics on the 14/8/5 schedule · reclaim unreferenced artifact bytes
<!-- roadmap: def-retention -->

<!-- roadmap-status: def-retention -->
<!-- /roadmap-status -->

## Decisions this phase ratified

_Derived from `reference/decisions.md`'s round headings on 2026-08-20 (3b) — the
ratification act and the normative pointer stay in the ledger; this is the phase index._

**Nothing has been ratified in this phase yet** — a deferral is closed by the decision that ends it,
and none has been written. What is listed here is the decision that CREATED each deferral, so the
trigger can be read beside the reasoning that deferred it:

| Deferral | Created by | Round · date |
|---|---|---|
| the explorer's EDIT half | D79a (the DSL mode cut) then **D186** (reassigned out of Phase 2 on D79a's own argument) | rounds 8 · 2026-07-23 and 45 · 2026-08-09 |
| the production frontend byte path / the phone in production | **D189** (a named gap, not a waiver) with D174/D175's capture ingress | rounds 41 · 2026-08-09 and 45 · 2026-08-09 |
| the capture → OCR-backed run binding | **D174** (the handoff seam's idempotent identities) | round 41 · 2026-08-09 |
| the record-sanity-check advisory | **D192** (retire run-summary and selector-suggest; sanity check stays open, deferred to order-8) | round 46 · 2026-08-12 |
| editable settings | **D193**'s storage clause (done until asked) | round 47 · 2026-08-12 |
| UCPath / ServiceNow propagation windows | **D207** (separations' provisional `stabilized` window, confirmable only by a controlled commit) and D128/D135's measured Kuali window | rounds 52 · 2026-08-14 and 30 · 2026-08-04 |
| cross-date search · screenshots · Excel export | the Phase-2 tail scope (D168–D180) that named them out | round 44 · 2026-08-09 |
| diagnostic auto-purge · unreferenced artifact bytes | **D137** (retention purges the row and its index, never the shared content-addressed bytes) | round 32 · 2026-08-04 |

## Exit criteria

07 records no exit block for the deferrals — by construction: a deferral closes when
its own trigger fires, and each trigger is named in that deferral's section above (and normatively
in its owning `reference/` doc). Two of them are Phase-2's explicit dispositions and carry their
owners in `02-prove-writes-build-the-tails.md` §Exit criteria: the explorer's EDIT half (D186) and
the production BFF's frontend bytes (D189).
