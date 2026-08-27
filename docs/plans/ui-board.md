# Board — UI fidelity (runs UI-1 → UI-2) — curated by the coordinator, read first by every supervisor
_Ceiling ~400 lines. Every line carries a sha, a path, or a sheet item — a fact without provenance is a claim and does not go here._

## Facts every run needs
- Integration branch `integration/03b` · UI-1 merged at `a3683bf3` (`--no-ff`) · master `301ee1d7` (do not move; Phase 3b's business)
- Gate (D191): `npm run typecheck && npm run lint && HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:coverage` (318 files / 3,476 tests at `a3683bf3`) · `npm run test:parity` (218 assert; a moved reference is ONLY re-frozen deliberately and attributed, exactly like `docs/plans/2026-08-27-ui-fidelity-refreeze-attribution.md`) · `npm run roadmap:check` · `npm run build:manifest` after ANY edit under `src/base/**` / `src/domain/**` (UI units normally touch neither)
- Design authority: the rebuild-demo, legacy repo at `1ec1d870`, `/Users/julianhein/Projects/hr-automation/src/dashboard/components/dev/rebuild-demo/` — READ-ONLY; port by copying with provenance (legacy hash + path in a comment), never import (root `CLAUDE.md` §Cross-repo). Demo served at `http://localhost:5173/?view=rebuild-demo` from the legacy checkout; the current at `http://localhost:5174/?day=<date>`
- Ruling (D281, ref dashboard-surfaces §10): the demo rules everything it covers; what it does not cover is ruled once in D281 — never re-book a `ruled:` row as a finding
- Frontend work goes through `/ui`; parity via `playwright-cli` headless; the operator's eye is the acceptance bar (memory `frontend-detail-fidelity`)
- Ledgers to cross-check before booking anything as new: `docs/plans/2026-08-27-ui-fidelity-audit.md` (112 rows, classes exact/state-only/ruled/fix-now/takeover/new-in-current), `docs/plans/2026-08-21-03a-fidelity-1-shell-queue-start.md` (A-rows), `-2-run-detail.md`, `-3-standing-surfaces.md` (SE-rows), `docs/rebuild/reference/dashboard-surfaces.md` §10 (D272–D276, D281)
- Backend problems are recorded in `docs/findings/<category>.md`, never fixed in a frontend unit (memory `findings-ledger-policy`) — U9 is the one deliberate exception (a backend unit, in this run because it gates U10)
- Traps (dated): a worktree needs `npm ci` + `.env`/`.auth` symlinks from the root + `HRAUTO_LEGACY_REPO` (2026-08-27) · `test:coverage` under load ≥ ~20 times out 1–2 child-spawning files at random — read counts, re-run when `uptime` < 20 (2026-08-27) · Chromium's UA `:focus-visible` ring moves parity references when focus moves — `outline-none` on the focused frame (UI-1 U4a, `src/dashboard/CLAUDE.md` lesson) · the root's vite on 5174 serves the ROOT's code; a worktree's tree is seen via `npm run web -- --port 5175` from the worktree, with the served labels still coming from the root's BFF (2026-08-27)

## Decisions ratified (one line each → sheet + item + owning doc)
- 2026-08-27 `docs/decisions/2026-08-27-ui-fidelity-new-elements.md` 1–7 + `docs/decisions/2026-08-27-ui-1-receive.md` 8–12, all recommended → **D281** (ref dashboard-surfaces §10; changelog round 98)
- 2026-08-27 receive item 12 re-asked → B: UI-2 runs 08-27 before R2 under a date stop rule (`docs/handoffs/2026-08-27-run-ui-2-residue.md` §Guard / §Date stop rule)
- Standing (do not re-open): D272–D276 (ref dashboard-surfaces §10) · D275.1 the two catalog toolbar buttons · D276.4 the `Banner` primitive is not reverted (D281.7 gives the storage band its own full-bleed arm instead) · D177 the generated selector catalog · D187 parity references need a browser

## Unit ledger
| Unit | Run | Status | Merge sha | Gate line | Review | Notes |
|---|---|---|---|---|---|---|
| U1a/U1b | UI-1 | merged | audit `1257bda0` (no code) | — | skipped (no code) | 112 rows; screenshots `docs/plans/ui-fidelity-audit/` |
| U2 + U4a | UI-1 | merged | `cae84969` (feature/ui-u2) | green in worktree | Standards 2 · Spec 4 low · ui-review 1 medium (focus) + 3 low → U4a `5dc014f9`…`d6c40b82` | four takeovers on one `TakeoverFrame`, full-bleed; 40 refs re-frozen `f621884a` |
| U3 + U4b | UI-1 | merged | `f1deafb8` (feature/ui-u3) | green in worktree | Standards 2 medium · Spec 1 HIGH (onbase/i9 notes re-authored → ported verbatim `a656c75c`) · Tests 1 medium · ui-review 1 medium + 5 low → U4b | six fix-now rows; 44 + 1 refs re-frozen; 8 settings refs re-frozen as the merge composite |
| U5a/U5b | UI-1 | merged | `3dd748a9` `5457ac27` `6e43c43c` `ffc8c1b6` `f7036efb` | — | doc-reviewer 1 medium → fixed U5b | the 7-item sheet; ledger dispositions A65, A179, SE1, SE40, SE43–45, SE47 |
| UI-1 → integration/03b | — | merged | **`a3683bf3`** | coordinator gate on the integrated root: see `docs/plans/2026-08-27-ui-runs.md` §Run log | — | supervisor token figure not reported |

## Residue (named, owned)
- UF-FU-1 intake + UI catalog hand-roll the takeover wrapper → **U7**
- UF-FU-2 storage band inset over full-bleed takeovers → **U6** (D281.7)
- Ledger 1 Region A counts do not sum (133+34+11+8 ≠ 179; 46 non-exact ≠ 34+2+10) → **U8**
- G1 Activity refuses (`activity-read-failed`) on 2026-08-27 — `docs/findings/activity.md`, status `recorded` → **U9**; Activity's populated body unaudited (UF-AC-4) → **U10**
- G2 run-open centre/right column not re-derived (0 rows that day; covered by the `-2-run-detail` ledger) → parked, owner doc 04 §"Carried in from Phase 3a" (D279)

## Questions for the operator (the coordinator turns these into a sheet)
- UI-1's supervisor token figure (for the run log) — asked in `docs/decisions/2026-08-27-ui-1-receive.md` item 12's note
