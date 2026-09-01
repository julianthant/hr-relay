# Status — current-workflow dashboard completion — 2026-08-28 (HEAD `f17781e8`)

_Plan source: `docs/plans/2026-08-28-dashboard-completion-runs.md`, `docs/rebuild/03a-finish-the-dashboard.md`, `docs/rebuild/04-close-the-deferrals.md`. Verified against root and supervisor git ancestry/worktrees, run-branch gates, and `npm run cli -- phase` (`completedThrough: 2j`, active `3-workflow-migration`). No new root full gate was run for this report because the unintegrated branches are deliberately serialized for RAM._

The original 22-unit completion program is about **64% verified complete** (14 units) and about **73% including the two units in final repair/re-review**. After adding the operator-requested 12 units for complete mobile-capture retirement and `/demo`, the expanded 34-unit program is about **41% verified complete**, or **47% including those two near-complete units**. Units are not equal-sized, so these are scheduling measures, not engineering-hour percentages.

## 1 · Complete

| item | evidence | since |
|---|---|---|
| Demo-fidelity closure DCF1–DCF6 is integrated into the root branch | `d8554009`, merged by `e0cd4353`; supervisor gate: 320/320 files, 3490/3490 tests, 84.64% statements / 86.65% lines, parity 239/239 | 2026-08-28 |
| Control-plane DCC1–DCC5 is integrated on its run branch: settings authority/UI, preflight/doctor, and safe Explorer edit authority/UI | `codex/r-dcc-dashboard-control-plane` at `cdfc10f2`; integrated typecheck/lint and 162 focused tests passed | 2026-08-28 |
| Cross-date reporting search DCR3–DCR4 is integrated on its run branch | search authority merge `1a8cdc3a`; UI merge `f1f68440`; immutable DCR4 proof: 22 focused tests, 2 touch-geometry parity cases, 6 search parity cases, typecheck/lint | 2026-08-28 |
| Strict artifact-byte authority DCA1 is integrated on its run branch | `codex/r-dca-dashboard-artifacts` at `eda17b27`; focused DCA1 proof 41/41 | 2026-08-28 |
| Mobile-capture retirement and `/demo` have explicit dependency-safe run definitions | coordinator commit `f17781e8`; DCT1–DCT6 and DDM1–DDM6 in the run plan and dedicated boards/briefs | 2026-08-28 |

## 2 · Drift — where the as-built differs from the plan

| plan said | reality | kind | consequence |
|---|---|---|---|
| Main dashboard board is the current index | It still says DCF/DCC/DCR are merely `briefed` and is last verified at `f89301df`, while root is `f17781e8` and several run branches have advanced | stale-plan-text | Reconcile it only after each paused run closes; do not use its status cells as merge evidence now |
| DCC1–DCC6 form one closed control-plane run | DCC1–DCC5 are on the run branch; DCC6 repair `58880c78` is isolated and still needs immutable re-review and merge | blocked | One small closure/review unit remains before the run can integrate into root |
| DCR1 and DCR3–DCR6 close reporting | DCR3–DCR4 are merged; DCR5 is at `8c5568d0` after two post-review commits; DCR1 and DCR6 are authority-blocked | blocked | XLSX needs final immutable review/merge; two product-authority gaps need a scope decision |
| DCA1–DCA5 close artifact viewing | DCA1 is merged; DCA3 has six commits through `fc6581c6`; DCA2 and DCA4 have preserved uncommitted work; DCA5 has not started | blocked | Artifact gallery, run Captures, archive evidence and close-out remain |
| Completed supervisor work is part of the current app | Root `integration/03b` contains R-DCF only; DCC, DCR and DCA are not ancestors of root | not-done-but-ticked | Their features are not yet in the dashboard the operator launches from root |
| Activity can serve a distinct-people axis | No approved privacy-safe stable pseudonym authority exists; DCR1 correctly refuses to hash identifiers ad hoc | blocked | Activity keeps the truthful current axes until authority is designed or the row is deferred |
| Rerun detail can compare fields across receipts | Retry links exist, but prior-run identity, stable fact identity and classification-safe added/removed/changed semantics are unowned | blocked | DCR6 cannot ship without a new authority contract |
| Mobile capture remains a built/deferred product in canonical phase/reference/roadmap text | Operator has retired it completely, but code and canonical plans still contain the phone bundle, routes, session authority and future binding promises | stale-plan-text | R-DCT must remove implementation and active promises while preserving unrelated diagnostic/run evidence captures |
| A scenario gallery is available | No `/demo` route exists; R-DDM is dependency-held behind capture retirement | not-done-but-ticked | The Kuali separation scenario gallery is still wholly unbuilt |

## 3 · Next

1. **Close DCR5 XLSX sequentially:** immutable-review `8c5568d0`, merge it into the reporting run branch, and sweep only its unit worktree/branch.
2. **Close DCC6 sequentially:** re-review the repaired exact-command guard and stale-doc fix at `58880c78`, merge it, run the run-level gate, and close the control-plane board.
3. **Finish artifacts sequentially:** commit/review DCA2, DCA3 and DCA4 one at a time, then run DCA5 integration/guard/docs closure.
4. **Integrate the three closed run branches into `integration/03b`:** reconcile conflicts against the newer 4537/canary decisions and `f17781e8`; never merge their stale coordination copies over root.
5. **Run R-DCT:** remove mobile capture completely—phone/operator UI, Vite entry, routes/services/commands, session/outbox authority, handoff/bindings, tests/config and active plan/roadmap promises.
6. **Run R-DDM after R-DCT:** add a real `/demo` pathname whose sole registered instance is the current Kuali separation scenario set, with strict result/unavailable states and browser/parity proof.
7. **Close integration:** run typecheck, lint, serialized coverage, parity, roadmap check and worktree sweep; then reconcile the main dashboard board and canonical phase/reference documents.

## 4 · Needs you

| # | decision / approval | options | my recommendation | blocks |
|---|---|---|---|---|
| 1 | Should the two authority-heavy reporting items remain required for this dashboard completion? | **A. Build now:** design privacy-safe stable person pseudonyms for Activity and a classification-safe cross-receipt comparison contract. Adds two dedicated authority seams. **B. Defer:** ship current truthful Activity/search/XLSX and name both as later reporting work. | **A** — it matches “complete what we can with the current workflow,” but it is real authority work, not a UI patch. | DCR1 and DCR6 only; capture removal, artifacts and `/demo` can proceed either way |
