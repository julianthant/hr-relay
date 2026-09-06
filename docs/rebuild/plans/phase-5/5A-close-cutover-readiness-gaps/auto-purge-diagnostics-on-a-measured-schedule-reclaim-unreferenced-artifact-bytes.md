# Auto-purge diagnostics on a measured schedule · reclaim unreferenced artifact bytes
<!-- roadmap: def-retention -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

<!-- roadmap-status: def-retention -->
- [x] the sweep is built and tested — `createDiagnosticRetentionSweep` reads the `(retention_kind, purge_after)` index, re-derives each disposition and throws if it disagrees with the row (`src/services/trust/diagnostic-retention.ts:45-85`)
- [x] retention itself is explicit and shipped: an ordinary bundle's `purgeAfter` is its own capture instant plus 30 days (`DIAGNOSTIC_ORDINARY_RETENTION_DAYS`, `src/domain/trust/diagnostic-capture.ts:44`); a pinned bundle stores a named reason and no instant, and is structurally unreachable from the due query
- [x] **D193(b) dispositioned BOTH remainders `wont-build-unless-asked`** — off every milestone, blocking no gate
- [ ] scheduling the sweep — nothing in `compose.ts`, in `src/cli.ts` or on any timer calls it, so **no bundle has ever been purged on this machine**
- [ ] the content-store reference count that would let the sweep's reported unreferenced artifact bytes actually be reclaimed
> 2026-08-20 | docs-cohesion 04 | verified against src/services/trust/diagnostic-retention.ts:45-85 (no production caller — only tests/unit/diagnostic-capture.test.ts:389-393) and src/domain/trust/diagnostic-capture.ts:44; left: both, and both are `wont-build-unless-asked`
<!-- /roadmap-status -->

**The node used to be titled "the 14/8/5 schedule". No constant in this tree implements one, and
the title is corrected here.** The phrase reached the tree and `ref dashboard-surfaces` from an early
draft; the shipped schedule is ONE number — **30 days from the bundle's own capture instant**, D86's
notes floor, which is where the number comes from — with no tiering by kind, sensitivity or age.
Cite the constant, not the phrase. (`ref operator-trust` §2.2 carries the same correction as its own
normative text.)

**What the deferral is.** Two things, and they are different sizes. **(1)** Nothing ever RUNS the
retention sweep, so no diagnostic bundle has ever been purged here. **(2)** Even when it runs, the
content-addressed artifact bytes an attachment points at are **not** deleted — the sweep reports the
now-unreferenced artifact ids and stops there, because reclaiming them needs a reference count the
artifact store does not keep.

**The decision that deferred them: D193(b)** (round 47, 2026-08-12), the operator's own storage
ruling, and it is a **stance, not a schedule** — both items moved from "deferred with an owner" to
`wont-build-unless-asked`: not planned, not owed by any slice, no future gate blocked on them.
D137 (round 32) is where the second half's shape was set: retention purges the bundle row and its
attachment index together and never the shared bytes, because a receipt, a second bundle or a
scenario fixture may still reference exactly those bytes by digest.

**Its trigger: you ask.** There is no event. That is the honest state and the node's chip says so.

**The operator's reasoning, recorded because it is the part that generalizes.** This authority
database stores records of **COMPLETIONS, not primary records.** The real record of a filed HR
transaction lives in the external system — the UCPath transaction, the Kuali document — and can be
checked there in more than one way; the rows here carry HOW a thing was completed and WHETHER it
completed, and once it is completed and approved they mean little going forward. That is what makes
disk growth on one local machine not worth a durable reference count. It says nothing about
durability DURING a write: the fence, its binding proof and a parked intent stay load-bearing for
the run in flight.

**Built today.** More than "the sweep exists". It re-derives each disposition from the row and
throws if the two disagree, purges bundle and attachment rows in ONE transaction so the boot
invariant tying a bundle's `attachments` array to its indexed rows can never see a half-purged
bundle, reports a bundle that was due at query time and gone at purge time as `vanished` rather than
as an error, and **throws by name if asked to purge a pinned bundle** — retention never silently
unpins evidence a knowledge/fix record or a write recovery still depends on. The adjacent stream
prune is a different mechanism and it IS wired: `pruneEventStreams` runs at dashboard boot before
the fold (`src/server/dashboard/compose.ts:574-578`), prunes `spans/` and `notes/` at 30 days by file
date, and can structurally never see `ledger/`, whose floor is forever.

**Not built.** A caller, and a refcount. Read `ref operator-trust` §10's fourth residual through
this: a restricted bundle is local, and it is not short-lived.
