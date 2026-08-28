# Board — R-DCF dashboard fidelity closure

**Integration branch:** this task's Codex worktree branch from `f89301df`
**Board owner:** R-DCF supervisor at close
**Write rule:** only the R-DCF supervisor may update this file, once, while closing the run
**Last verified:** 2026-08-28 at `2bbfe588`

## Facts every run needs
- Main board: `docs/plans/dashboard-completion-board.md`; plan: `docs/plans/2026-08-28-dashboard-completion-runs.md` §DCF1–DCF6.
- Scope: Phase 4 C1–C4 only. C5/C6, OCR Review, People, capture→workflow, settings, search/reporting and artifact routes are out.
- Use `/ui` and `playwright-cli`; demo authority is legacy commit `1ec1d870`, read-only.
- Close gate and serialization command are on the main board.

## Unit ledger
| Unit | Status | Merge SHA | Gate evidence | Review | Notes |
|---|---|---|---|---|---|
| DCF1 | complete | `c1507786` | Mounted provenance disclosure and single-owner rail proof; focused suite green | clean after fix | Removed Workflow-only disclosure is non-vacuously covered. |
| DCF2 | complete | `f7c5ca65` | Source guards plus rendered toast-floor geometry at 1440/2000; focused suite green | clean after fix | A81/A82 and A168–A170 closed without class-order coupling. |
| DCF3 | complete | resident; proof `2f8d8e1d` | Seven resident rows verified; Input/Plan/Result continuity references and focus restoration green | clean | C69 remains truthful unit proof because the fixture has no stale-envelope conflict path. |
| DCF4 | complete | `d474f526` | AR39 widths and AR59 removal focused proof green | clean | Surviving exceptions retain their D275/D179/D223 owners. |
| DCF5 | complete | `029eaba1` | 13 production `PanelHeader` sites expose level-two headings; accessibility proof green | clean | Kit specimens remain intentionally unlevelled. |
| DCF6 | complete | `0996dbbb`; fix `2bbfe588` | 80 semantic ref updates + 12 new state triplets; parity update/assert 239/239 | unconditional approval | C1–C4 ledgers closed; P1 attribution has zero unattributed states. |

## Residue
- No C1–C4 implementation residue remains.
- Phase 4 C5/C6 remain explicitly outside R-DCF; criterion 11 stays open for them.
- C69 has unit proof only: the parity fixture cannot truthfully serve the stale-envelope conflict path.

## Close proof
- `npm run typecheck` — green.
- `npm run lint` — green, zero warnings.
- Locked `npm run test:coverage` with one worker — 320/320 files and 3490/3490 tests; 84.64% statements, 74.90% branches, 87.73% functions, 86.65% lines.
- Locked `npm run test:parity` — 239/239 passed in assert mode; no existing PNG/meta churn.
- `npm run roadmap:check` — generated roadmap is fresh.
- Unit worktrees and DCF feature branches swept; unrelated DCC/DCR worktrees were not touched.
