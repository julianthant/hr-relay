# Board — R-DCT mobile document capture retirement

**Integration branch:** task worktree branch from coordinator dispatch head
**Board owner:** R-DCT supervisor at close
**Write rule:** only the R-DCT supervisor may update this file, once, while closing the run
**Last verified:** 2026-08-28 at coordinator dispatch

## Facts every run needs
- Main board: `docs/plans/dashboard-completion-board.md`; plan: `docs/plans/2026-08-28-dashboard-completion-runs.md` §DCT1–DCT6.
- Operator direction: remove Capture Mode from the rebuild, its active plans and roadmap.
- Boundary: retire the mobile document-capture product only. Preserve diagnostic bundle screenshots, artifact evidence, receipt/run-detail capture records and other non-phone meanings of “capture.”
- This repository is not production, but durable schema/migration removal still requires explicit authority judgment and tests; do not leave orphaned tables or silently rewrite compatibility history.

## Unit ledger
| Unit | Status | Merge SHA | Gate evidence | Review | Notes |
|---|---|---|---|---|---|
| DCT1 | briefed | — | — | required | exact keep/delete inventory first |
| DCT2 | briefed | — | — | required | needs DCT1 |
| DCT3 | briefed | — | — | required | needs DCT1 |
| DCT4 | briefed | — | — | required | needs DCT1–DCT3 facts |
| DCT5 | briefed | — | — | required | needs DCT2–DCT4 |
| DCT6 | briefed | — | — | required | needs DCT1–DCT5 |

## Questions for the operator
- None. “Remove Capture Mode” is treated as full retirement of the mobile capture product, not deletion of generic evidence captures.
