# Board — R-DCA artifact reads and evidence viewers

**Integration branch:** task worktree branch from `e0cd4353`
**Board owner:** R-DCA supervisor at close
**Write rule:** only the R-DCA supervisor may update this file, once, while closing the run
**Last verified:** 2026-08-28 at `e0cd4353`; R-DCF dependency cleared

## Facts every run needs
- Main board: `docs/plans/dashboard-completion-board.md`; plan: `docs/plans/2026-08-28-dashboard-completion-runs.md` §DCA1–DCA5.
- R-DCF is merged into `integration/03b` at `e0cd4353`; use that exact commit as the run base.
- Scope: strict artifact bytes and viewers for authority already present. Phone production path, OCR Review and capture→workflow are out.

## Unit ledger
| Unit | Status | Merge SHA | Gate evidence | Review | Notes |
|---|---|---|---|---|---|
| DCA1 | briefed | — | — | required | R-DCF cleared at `e0cd4353` |
| DCA2 | briefed | — | — | required | needs DCA1 |
| DCA3 | briefed | — | — | required | needs DCA1 |
| DCA4 | briefed | — | — | required | needs DCA1; R-DCF cleared |
| DCA5 | briefed | — | — | required | needs DCA1–DCA4 |
