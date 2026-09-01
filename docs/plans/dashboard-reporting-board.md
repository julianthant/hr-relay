# Board — R-DCR dashboard reporting and search

**Integration branch:** `codex/r-dcr-authority-close`
**Board owner:** R-DCR supervisor at close
**Write rule:** only the R-DCR supervisor may update this file, once, while closing the run
**Last verified:** 2026-08-29 at implementation integration `3b36592b`

## Facts every run needs
- Main board: `docs/plans/dashboard-completion-board.md`; plan: `docs/plans/2026-08-28-dashboard-completion-runs.md` §DCR1 and §DCR3–DCR6.
- Scope: Activity axes, cross-date search, current-corpus XLSX and rerun comparison. Storage diagnosis belongs to R-DCC; artifact byte serving and later-workflow exports are out.
- D282 keeps `Unread`; D283 requires current-corpus evidence rather than invented future facets.
- Use `/ui` for frontend units; close gate and serialization command are on the main board.

## Unit ledger
| Unit | Status | Merge SHA | Gate evidence | Review | Notes |
|---|---|---|---|---|---|
| DCR1 | closed | `d9b467e5` | 3,831/3,831 full tests; 115/115 focused; parity 265/265 | zero findings after real-SQLite proof | D288 implemented; all seven current rows are lawfully unavailable, so no substitute backfill was written. |
| DCR3 | closed | `52fd7a47` | 3,831/3,831 full tests; parity 265/265 | zero findings | Strict bounded current-Separations search authority and transport received. |
| DCR4 | closed | `52fd7a47` | 3,831/3,831 full tests; parity 265/265 | zero findings after wide/narrow and keyboard review | Separations Top Bar search preserves explicit served-day scope. |
| DCR5 | closed | `3b36592b` | 3,831/3,831 full tests; D75 74/74; parity 265/265 | two independent D75 reviews, zero findings | Evidenced XLSX v2 is attributed by the server-derived solo request actor; v1 history remains explicitly unattributed. |
| DCR6 | closed | `8bc658d9` | 3,831/3,831 full tests; 115/115 focused; parity 265/265 | zero findings after selected-receipt/refusal fixes | D289 compares exact immutable retry receipts through the closed registry and withholds protected relations. |

## Residue
- Return future-workflow-only facets/exports to Phase 3c; do not infer them from separations.
- Artifact byte serving and screenshot retrieval remain open outside R-DCR.
- DCR1 remains honestly unavailable for the present seven-row corpus; future eligible canonical rows may append D288 evidence.
- Credential-derived multi-actor identity remains Phase 3d work; D75's solo-operator authority is complete.
- Final evidence: `docs/handoffs/2026-08-28-r-dcr-authority-close-report.md`; the required R-DCR/D75 worktree sweep completed with unrelated worktrees untouched.
