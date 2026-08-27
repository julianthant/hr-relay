# Handoff — run UI-1: bring the rebuild dashboard to 1:1 fidelity with the rebuild-demo

**Date:** 2026-08-27 (written by the coordinator; runnable immediately, in its own worktree)
**Paused at:** before execution — resume at U1

## Task summary
The operator compared the demo (`http://localhost:5173/?view=rebuild-demo`) with the current build (`http://localhost:5174/?day=2026-08-27`) and ruled: **the demo is the design authority for everything it covers** — alignment, spacing, sizes, vocabulary, colours, nav active states, and whether a page is a window-replacing takeover or a dialog. Settings and other pages currently open "like a modal" while the demo replaces the window; that is the headline fix. **Anything the current build has that the demo does not cover is neither built further nor removed — it becomes a numbered question for the operator ("where do you want this?") in a decision sheet.**

This run is separate from phase 3b's run plan (`docs/plans/2026-08-27-03b-runs.md`); it lands on its own branch and the coordinator merges it after R1 closes.

## Where things are
- Demo source (legacy repo, READ-ONLY, at `1ec1d870`): `/Users/julianhein/Projects/hr-automation/src/dashboard/components/dev/rebuild-demo/` — `DemoShell.tsx`, `DemoTopBarSurfaces.tsx`, `DemoSettings.tsx`, `demo-settings-wire.ts`, … Port by copying with provenance (legacy commit hash + path in a comment); never import or link it (root `CLAUDE.md` §Cross-repo).
- Current: the root checkout's dev server (vite 5174 over the BFF 3938) — VIEW only; never restart, stop, or rebuild it; never start a second BFF on 3938.
- The fidelity ledgers — cross-check before booking anything as new: `docs/plans/2026-08-21-03a-fidelity-1-shell-queue-start.md` (A-rows), `-2-run-detail.md`, `-3-standing-surfaces.md` (SE-rows), `docs/plans/2026-08-26-p1-refreeze-attribution.md` (the parity re-freeze pattern), `docs/rebuild/reference/dashboard-surfaces.md` §D271–D276 (ratified rulings — a `ruled:`/`unserved:` row is NOT a fix-now row).
- Already ruled or unserved — cite, do not re-fix: search placeholder (A10/D184) · stethoscope/flask/cluster order (A39/A60/A66) · sessions vocabulary (A118) · ping toast (A58/D138) · settings groups General/Display/Performance/Paths (SE14–SE17, Phase 4 row 8) · Environment & identity / System behaviour (SE37/SE39).
- Coordinator's eyeball candidates to confirm or refute live: nav tab `Dashboard` stays active on Settings (demo de-selects) · top bar ~25px taller than the demo · settings nav `Storage` vs page `Storage health` · `Backup stale` on the blue/info dot · the sessions bar's far-right `+` missing · no right column in the no-run-open state (verify the demo's own no-run state first).

## Branch / worktree (hard rule)
Phase 3b run R1 is live in ANOTHER session on the root checkout (`integration/03b`, dirty new-kronos files, a live Playwright probe). Never `git checkout`, commit, stash, or run a gate in the root; never stop a process you did not start (`lsof -nP -iTCP:<port>` first).
- `git -C /Users/julianhein/Projects/hr-automation-rebuild worktree add ../hr-automation-rebuild-ui -b feature/ui-fidelity integration/03b` — record the base sha in your first commit message. Set up: `npm ci`; symlink `.env` and `.auth` from the root; `export HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation` for every gate.
- Parallel workers get their own worktrees + `feature/ui-<unit>` off `feature/ui-fidelity`; you merge them `--no-ff` into `feature/ui-fidelity` in YOUR worktree and sweep them. You do NOT merge into `integration/03b`.
- Browser verification of your changes: `npm run web -- --port 5175` from your worktree (proxies `/api` to 3938, read-only viewing), or the parity lane (builds its own bundle). `playwright-cli` headless; `close` your sessions; the root's Chromium belongs to R1.

## Units
- **U1 — the live audit** (`sup-scout` for the mapping + `sup-opus` with the `ui` skill in critique mode for the judgment; `playwright-cli`). Same viewport for both (1440×900 and 2000-wide), every surface and state reachable on an empty day: shell (top bar, toolbar, queue column, centre, right column, sessions bar, no-run-open), Archive, Explorer, Activity, Settings + every section, notifications drawer, search, Start a run, Keyboard help, theme toggle. Per region: demo (element, bbox, tokens from snapshot + source) vs current, classed `exact` / `state-only` / `ruled` (cite) / `fix-now` / `takeover` / `new-in-current`. Output `docs/plans/2026-08-27-ui-fidelity-audit.md` + screenshot pairs under `docs/plans/ui-fidelity-audit/`. Acceptance: every row has one class; every `ruled` row cites its source. Review: skip (no code) — say so.
- **U2 — takeover conversions** (`sup-opus`, `ui` skill): every `takeover` row becomes a window-replacing container matching the demo's (`DemoShell.tsx`'s takeover switch; `DemoSettings.tsx:1074` `flex min-h-0 flex-1` + left nav), Back-to-dashboard where the demo has it, nav tab de-selected where the demo de-selects; provenance comments. Acceptance: `npm run typecheck && npm run lint && HRAUTO_LEGACY_REPO=… npm run test:coverage` green; `npm run test:parity` — changed references only via a DELIBERATE attributed re-freeze exactly like `docs/plans/2026-08-26-p1-refreeze-attribution.md` (zero unattributed). Review: `ui-review` + `review` Spec axis against the demo source and D271–D276.
- **U3 — alignment / spacing / vocabulary fixes** (`sup-opus`, `ui` skill): every `fix-now` row. Same acceptance and review as U2; split in two if the list exceeds ~8 rows.
- **U4 — review-fix round**: one fix unit per reviewed unit for every critical/high/medium; re-run gates.
- **U5 — docs + the operator's sheet** (`sup-sonnet`): ledger rows you changed (disposition + commit); a dated lesson in `src/dashboard/CLAUDE.md` if anything was non-obvious; the attribution addendum; and `docs/decisions/2026-08-27-ui-fidelity-new-elements.md` in the `decision-brief` shape — one numbered item per `new-in-current` row (Situation with a screenshot path; options e.g. A keep · B move to <demo location> · C remove · D defer, each with a cost; a Recommendation; a Notes field). Do NOT answer them.

## Verification before resuming
```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN; lsof -nP -iTCP:5174 -sTCP:LISTEN; lsof -nP -iTCP:3938 -sTCP:LISTEN   # all three should be up; start none in the root
git -C /Users/julianhein/Projects/hr-automation-rebuild worktree list
git -C /Users/julianhein/Projects/hr-automation-rebuild-ui status --short --branch   # after the worktree exists
```

## Pointers
- Read first: root `CLAUDE.md` (§Cross-repo, §Conventions, §Fail loud), `src/dashboard/CLAUDE.md` (pairing rule, lessons), `src/dashboard/DESIGN.md`, the ledgers above, `docs/decisions/2026-08-27-03a-close-decisions.md` (D278 rules the intake column — not this run's)
- Memory: `frontend-detail-fidelity` (1:1 to the demo, region by region, the operator's eye is the bar), `findings-ledger-policy` (unplanned frontend features are not built)

## Suggested skills for the next session
- `/supervise` — you ARE the supervisor; the operator's prompt invokes it
- `/ui` for every frontend unit; `/playwright-cli` for the audit; `/worktree-sweep` after the parallel batch; `/decision-brief` shape for U5's sheet
