# R7 u37 — whole-estate reconciliation

The immutable reconciliation inputs are the accepted R1–R6 reports and their exhaustive unit
artifacts. Those records classify every intake assertion; this final table reconciles their totals
and dispositions without replacing the per-assertion ledgers with a second hand-maintained list.

| Family / accepted owner | Intake → accepted result | Final disposition and unique purpose | Exhaustive evidence |
|---|---|---|---|
| Architecture / R1 | 70 files; 689 → 703 cases | Retain all 70 distinct static invariants; merge one duplicate script assertion into `guard-manifest`; add the three-case independent empty-project witness | `r1/u01-inventory.md`, `r1/u05-changes.md`, `r1/u06-review.md` |
| Core/domain/workflow/write/storage / R2 | 81 → 82 files; 1,151 → 1,156 cases | Retain all audited contracts; add five transaction-outcome projection cases. Apparent overlaps terminate at different seams/oracles | `r2/u07-domain.md` through `r2/u12-review.md` |
| Server/BFF/runtime / R3a | 49 files / 868 cases | Retain every HTTP/process boundary; repair only test composition so each runtime owns ephemeral ports | `r3/u13-bff.md`, `r3/u14-runtime.md`, `r3/u16-ports.md` |
| Worker/session / R3b | 10 focused files / 238 cases | Retain claim/session/lease/teardown risks; no same-risk/seam/oracle pair exists | `r3/u15-workers.md`, `r3/u17-consolidation.md`, `r3/u18-review.md` |
| Dashboard unit/jsdom / R4 | 104 → 103 owned files; 1,056 → 1,050 cases | Delete eight browser-geometry duplicates in two files; preserve two primitive semantics at the cheaper Node owner; retain 21 jsdom files / 258 interaction cases | `r4/u19-inventory.md` through `r4/u24-review.md` |
| Scenario authority / R5a | 8 → 7 workflow structural files; 81 → 81 cases | Merge the two person-lookup sources and move four workflow sources to one authoritative path per workflow; no assertion removed | `r5/u25-inventory.md`, `r5/u26-t1.md`, `r5/u29-live.md` |
| Scenario review / R5b | 17 files / 142 → 132 cases | Move four pure claims to unit owners, remove six exact unit duplicates, add one missing-answer unit refusal; retain capability, T1a, walk and 16 distinct T2 cases | `r5/u27-walks.md`, `r5/u28-dashboard.md`, `r5/u30-review.md` |
| Playwright / R6 | 17 specs / 287 → 281 cases; 228 → 222 triples | Remove six `run-receipt` matrix duplicates whose same rendered state/seam/oracle survives in `run-done`; retain differently named states after inspecting their distinct pixels/contracts | `r6/u31-parity.md` through `r6/u36-review.md` |
| Performance/smoke/Duo/generated / R6→R7 | Existing lanes retained | Convert the six accepted structural performance counters into failure-capable bounds; timings remain observational. Smoke, Duo, manifest and roadmap triggers remain distinct and self-contained | `r6/u33-performance.md` through `r6/u35-runner.md`; `r7/u38-taxonomy.md` |

Every deletion, move, merge, and addition above resolves to an accepted detailed ledger and a named
surviving owner. The final cross-family comparison found no further pair with the same failure mode,
seam, and oracle. In particular, architecture vs runtime, unit vs T2, T1a vs T1b, and unit/T2 vs
Playwright are intentionally different evidence boundaries, not duplicates.

No legacy checkout is a test input. No live HR workflow ran. No board row was edited.
