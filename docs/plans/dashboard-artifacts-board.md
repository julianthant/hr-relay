# Board — R-DCA artifact reads and evidence viewers

**Integration branch:** future task worktree branch from the post-R-DCF integration commit
**Board owner:** R-DCA supervisor at close
**Write rule:** only the R-DCA supervisor may update this file, once, while closing the run
**Last verified:** 2026-08-28 at `f89301df`; run is dependency-held

## Facts every run needs
- Main board: `docs/plans/dashboard-completion-board.md`; plan: `docs/plans/2026-08-28-dashboard-completion-runs.md` §DCA1–DCA5.
- Do not brief or start until R-DCF is merged and its exact integration SHA replaces this board's base.
- Scope: strict artifact bytes and viewers for authority already present. Phone production path, OCR Review and capture→workflow are out.

## Unit ledger
| Unit | Status | Merge SHA | Gate evidence | Review | Notes |
|---|---|---|---|---|---|
| DCA1 | held | — | — | required | needs R-DCF |
| DCA2 | held | — | — | required | needs DCA1 |
| DCA3 | held | — | — | required | needs DCA1 |
| DCA4 | held | — | — | required | needs R-DCF + DCA1 |
| DCA5 | held | — | — | required | needs DCA1–DCA4 |
