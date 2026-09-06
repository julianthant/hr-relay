# Search runs across dates / view screenshots / export Excel
<!-- roadmap: def-search-export -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

<!-- roadmap-status: def-search-export -->
- [x] the ONE export that ships is the Activity report's CSV, `GET /api/v1/reports/activity.csv` (`src/server/dashboard/routes/api.ts:192`, D240)
- [x] the evidence the missing surfaces would serve is all durable already — diagnostic bundles are content-addressed with an attachment index, artifact refs and resource schemas are complete
- [x] the per-fact half of rerun transparency exists: `retryOf` plus `reuse` rows carrying `ageMs` and the bound they were judged against (`ref operator-trust` §2.4)
- [x] BE the verified run/Archive artifact-byte path — D291/D292 serve diagnostic-index-authorized bytes and D306 mounts the same run collection in Logs and Receipt; only the broader generic resource-status/gallery family remains open
- [x] BOTH the DCR3 cross-date search authority + transport — strict `GET /api/v1/search` query/page contracts and typed client over the measured current separations corpus
- [x] FE the DCR4 cross-date search surface — the Top Bar defaults to the durable Separations corpus and retains an explicit served-day scope
- [x] BE the DCR5 operator xlsx export — a dedicated command verifies and persists exact attachment evidence for a DCR3 snapshot or Activity range; the D164 retention sink remains distinct
- [x] D289 amendment retires automatic rerun comparison — attempts remain separately inspectable with their own ordinary facts and no synthesized diff
- [ ] fold one logical item's runs into one queue row with separately selectable attempt numbers; the current queue projection still emits one top-level row per run
> 2026-09-03 | D289 amendment | comparison registry, endpoint and Receipt panel removed; no replacement comparison is planned
<!-- /roadmap-status -->

**What the deferral is.** The remaining legacy affordances the rebuild does not surface. DCR3–DCR5
now serve strict **search runs across dates**, its Separations Top Bar surface and an evidenced XLSX
for an exact search snapshot or Activity range. Verified diagnostic screenshots can now be opened
from a run's Logs or Receipt and from frozen Archive evidence; the broader generic gallery family
remains unbuilt. The 2026-09-03 D289 amendment retired automatic comparison; each attempt keeps its
own ordinary facts and the operator compares attempts directly. The requested one-item-row attempt
presentation remains unbuilt over the current one-row-per-run queue projection.

**The decision that deferred them.** No single one — they were named OUT of the 2i operator-surface
tail (D168–D180, rounds 38–44) as the tail was scoped, and each has a reason of its own recorded
where its capability lives. `legacy-route-search`'s disposition says it plainly: the search family
closes **as the migrations produce the run corpus a search surface must be shaped by.** D164 built
the xlsx writer as a `xlsx-retention` SINK for the artifact pipeline and left it uncomposed in
production, so what is missing is an operator-facing export, not a writer.

**Its trigger: the Phase-3 cross-cutting closure**, and the shaping constraint is the interesting
half. These three are listed under `{#cross-cutting}` — "where legacy is still ahead" — and every
one of them is deliberately shaped **against a real run corpus** rather than invented in planning.
A search surface built today would be filtered against two workflows' worth of runs. The field-level
rerun diff was later built under D289 and then retired by its 2026-09-03 amendment because the product should present
each attempt's facts without interpreting differences between attempts.
**The operator fired the scheduling trigger on 2026-08-28 through D282.** The implementation must
measure and test the corpus that now exists rather than author ranking from fixture intuition; the
artifact route, search and export rows remain open until their proofs land; the rerun-diff row is
retired.

**Built today.** Diagnostic bundles are content-addressed with a durable attachment index and
per-field redaction applied AT capture; D291/D292 serve verified run and Archive bytes, D306 adds
explicit per-run browser screenshots and exposes the same evidence in Logs and Receipt, the
Activity report has a second authority behind it and a served CSV (D236/D240), and DCR3–DCR5 add
the strict corpus search, surface and evidenced XLSX. The remaining absence is the broader generic
status/gallery family; the 2026-09-03 D289 amendment removed the automatic receipt-comparison feature.

**Not built.** The broader generic status/gallery family remains. Run-bound and Archive screenshot
evidence does not wait on it.
