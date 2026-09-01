# Board — R-DDM current-workflow `/demo`

**Integration branch:** task worktree branch from post-R-DCT integration
**Board owner:** R-DDM supervisor at close
**Write rule:** only the R-DDM supervisor may update this file, once, while closing the run
**Last verified:** 2026-08-28; dependency-held

## Facts every run needs
- Main board: `docs/plans/dashboard-completion-board.md`; plan: `docs/plans/2026-08-28-dashboard-completion-runs.md` §DDM1–DDM6.
- Operator direction: add a `/demo` page for scenario runs of workflows currently present; this instance exposes only Kuali separation.
- Route truth: `/demo` is a real pathname in the supported dashboard runtime. Scenario content derives from registered workflow/executable/durable-result authority and never imports tests into production.
- Dependency: do not dispatch until R-DCT is merged, because both runs own the entry/routing seam.

## Unit ledger
| Unit | Status | Merge SHA | Gate evidence | Review | Notes |
|---|---|---|---|---|---|
| DDM1 | dependency-held | — | — | required | needs R-DCT merged |
| DDM2 | dependency-held | — | — | required | needs DDM1 |
| DDM3 | dependency-held | — | — | required | needs DDM2 |
| DDM4 | dependency-held | — | — | required | needs DDM3 |
| DDM5 | dependency-held | — | — | required | needs DDM3–DDM4 |
| DDM6 | dependency-held | — | — | required | needs DDM1–DDM5 |

## Questions for the operator
- None. “Kuali separation” is resolved from the registered current Kuali separation workflow/scenario authority; the implementation must pin the exact included ids before drawing the page.
