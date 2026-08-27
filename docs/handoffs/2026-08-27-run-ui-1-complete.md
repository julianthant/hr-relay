# Handoff — run UI-1 complete: demo-fidelity audit, takeovers, fix-now rows, operator sheet

**Date:** 2026-08-27
**Paused at:** post-execution, all five units merged on `feature/ui-fidelity`; the full gate is green; awaiting the coordinator's merge into `integration/03b` (after phase 3b run R1 closes) and the operator's answers to the 7-item sheet.

## Task summary
Run UI-1 (brief: `docs/handoffs/2026-08-27-run-ui-1-fidelity.md`) brought `src/dashboard` to 1:1 fidelity with the legacy rebuild-demo where the demo covers a surface, under the operator's ruling that **the demo is the design authority for everything it covers, and anything it does not cover is neither built nor removed — it becomes a numbered operator question**. The run landed in its own worktree because phase 3b R1 was live on the root checkout; it never touched `integration/03b`. Every parity reference that moved was re-frozen deliberately and attributed (zero unattributed).

## Plan
- Run brief: `docs/handoffs/2026-08-27-run-ui-1-fidelity.md` (units U1–U5)
- Audit (the per-row plan): `docs/plans/2026-08-27-ui-fidelity-audit.md` — 112 rows: exact 43 · state-only 18 · ruled 36 · fix-now 6 · takeover 6 · new-in-current 3 (after U5b's reclass of UF-SH-10/11 to `ruled` per D275.1)
- Operator sheet (UNANSWERED): `docs/decisions/2026-08-27-ui-fidelity-new-elements.md` — 7 items

## Current state (from git, not memory)
- Repo: `/Users/julianhein/Projects/hr-automation-rebuild-ui` (worktree of the root)   Branch: `feature/ui-fidelity`   HEAD: `f7036efb`
- Base: `integration/03b` @ `2a164941` (the worktree was fast-forwarded to it before U1)
- Worktrees: only the root (`integration/03b`) and this one remain; `feature/ui-u2` / `feature/ui-u3` merged `--no-ff` and swept (`git worktree list` verified)
- Commits ahead of base: 27 (`git log --oneline 2a164941..HEAD`)
- Uncommitted: clean (`?? .auth` is the symlink to the root's `.auth`, deliberately untracked)

## Progress
- [x] U1a — scout map (scratchpad only, no commit) · U1b — audit doc `1257bda0` (no code; review skipped)
- [x] U5a — operator sheet items 1–5 `3dd748a9` (sup-sonnet; docs-only)
- [x] U2 — four takeovers full-bleed on one shared `TakeoverFrame` `ab67408f` · attributed re-freeze of 40 refs `f621884a` · lesson `718a7411`. Reviewed: Standards 2 judgement · Spec 4 low · Correctness 0 · Silent failures 0 · ui-review 1 medium (no focus move on enter) + 3 low
- [x] U4a — U2 fix round `5dc014f9`…`d6c40b82` (focus into the takeover + `tests/unit/dashboard/takeover-frame-focus.test.ts`; `outline-none` after the parity lane caught Chromium's UA `:focus-visible` ring moving 38 refs; provenance/header/comment trims; UF-FU-1 recorded). Re-reviewed: code-reviewer on the focus seam → 0
- [x] Merge `feature/ui-u2` → `cae84969` (clean)
- [x] U3 — six fix-now rows over four seams `e1c978f4` (UF-SET-2) · `7975e209` (UF-SET-9, `src/server`) · `6db7e75f` (UF-SET-22/25/26/31) · re-freeze of 44 refs `ddd0c1a6` · lessons `dc3c3f62`. Reviewed: Standards 2 medium (provenance line ranges) + 4 judgement · Spec 1 HIGH (demo-covered `onbase`/`i9` notes re-authored) + 1 low · Correctness 1 low · Silent failures 0 · Tests 1 medium + 1 low · ui-review 1 medium + 5 low
- [x] U4b — U3 fix round `a656c75c` (verbatim onbase/i9 port) · `a01c6bf0` (URL cells clip at the demo's `max-w-[260px] truncate`) · `b9efa850` · `be118696` · `26311c17` (1 ref). Re-reviewed: pr-test-analyzer 0 · doc-reviewer 1 medium (DESIGN.md "exactly one place") → fixed in U5b
- [x] Merge `feature/ui-u3` → `f1deafb8` — conflicts resolved via `/worktree-sweep conflicts`: attribution doc = both sides kept (U2 first); 8 `settings--*.png` = neither side, re-generated once from the merged tree (`PARITY_UPDATE=1 … -g settings`) and attributed under `## Merge`
- [x] U5b — audit landed-commits + reclass + UF-FU-2 `5457ac27` · sheet items 6–7 `6e43c43c` · ledger dispositions `ffc8c1b6` · DESIGN.md `f7036efb`
- [ ] Coordinator: merge `feature/ui-fidelity` into `integration/03b` `--no-ff` after R1 closes ← **next, not this run's**
- [ ] Operator: answer the 7-item sheet; ratify into `docs/rebuild/reference/dashboard-surfaces.md` §10 as a D-entry (next free was D280 at time of writing — not minted)

## Final gate (run in this worktree at HEAD `f7036efb`, `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation`)
| gate | result |
|---|---|
| `npm run typecheck` | pass (exit 0, silent) |
| `npm run lint` | pass (exit 0, `--max-warnings 0`) |
| `npm run test:coverage` | `Test Files 316 passed (316) · Tests 3468 passed (3468)` · Statements 83.39% · Lines 85.37% |
| `npm run test:parity` | `218 passed (3.0m)`, `git status tests/parity` empty |
| `npm run roadmap:check` | `docs/roadmap/index.html is fresh.` |

Parity attribution: `docs/plans/2026-08-27-ui-fidelity-refreeze-attribution.md` — U2 40 · U3 44 · U4b 1 · Merge 8 (composite of the settings refs both sides moved). No `.meta.json` moved anywhere; `.a11y.yml` moved only in U3/U4b (unpressed `Dashboard`, `Storage health`, notes).

## Open questions / deferred decisions
- The 7-item sheet (`docs/decisions/2026-08-27-ui-fidelity-new-elements.md`) — items 1–2 (Explorer / UI catalog toolbar buttons) are already ruled by D275 item 1 and kept as confirm-or-revisit; 3–5 are the settings copy the demo does not cover; 6 = the AUTHORED per-system notes/names for `new-kronos` / `old-kronos` / `sharepoint` (no demo counterpart; marked in `settings-model.ts`); 7 = UF-FU-2, the `StorageBanner`'s kept `mx-[--ds-shell-inset]` above an x=0 takeover (the demo's band is full-bleed; ours is the shared rounded `Banner`, D276.4 — matching it changes the queue view too).
- UF-FU-1 (audit "Follow-ups"): intake and the UI catalog still hand-roll the takeover wrapper (`Panel` + arrival) — unruled, so left inset; adopt `TakeoverFrame` once ruled.
- Audit gap G1: Activity's populated body is unaudited — the current's projection refuses on 2026-08-27 (`activity-read-failed`, run exists in the span stream but not in authority). Backend finding per `findings-ledger-policy`, not a frontend fix. G2: run-open centre/right column not re-derived (0 rows that day; covered by the `-2-run-detail` ledger).
- Ledger hygiene noticed, not fixed: `fidelity-1` Region A counts were already inconsistent (132+34+11+8 ≠ 178) before this run; U5b bumped both by 1 for the new A179 row only.
- Gate flakiness under load: with two worktrees running `test:coverage` concurrently plus the root's dashboards, 30 s per-test timeouts hit a different 1–2 of five child-spawning files each run (`guard-manifest`, `descriptor-coverage`, `runtime-environment-coverage`, `qr-code`, `flow-type-budget`); every run on a quiet machine was green. Not a defect of this branch.

## Verification before resuming
```bash
git -C /Users/julianhein/Projects/hr-automation-rebuild-ui status --short --branch     # feature/ui-fidelity, clean but ?? .auth
git -C /Users/julianhein/Projects/hr-automation-rebuild-ui log --oneline 2a164941..HEAD | wc -l   # 27
git -C /Users/julianhein/Projects/hr-automation-rebuild worktree list                   # root + -ui only
cd /Users/julianhein/Projects/hr-automation-rebuild-ui && export HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation && npm run typecheck && npm run lint && npm run test:coverage 2>&1 | tail -20 && npm run test:parity 2>&1 | tail -5 && npm run roadmap:check
```
Live check (view only, never restart anything): the root's vite on 5174 still runs the ROOT's code — to see this branch, `npm run web -- --port 5175` from the -ui worktree (proxies `/api` to the BFF on 3938; the served `Storage health` label will NOT show through the proxy because the BFF runs root code — it is pinned by `tests/unit/server/bff-flow.test.ts`).

## Pointers
- Read first: root `CLAUDE.md` (§Cross-repo, §Fail loud, §Conventions) · `src/dashboard/CLAUDE.md` (four new dated lessons from this run: takeover geometry, takeover focus + "no ring class ≠ paints no ring", the host-note ruling, the switcher arm) · `src/dashboard/DESIGN.md` (`dsText.micro` exception) · `docs/rebuild/reference/dashboard-surfaces.md` §10 (D272–D276)
- The run's artifacts: `docs/plans/2026-08-27-ui-fidelity-audit.md` (+ `docs/plans/ui-fidelity-audit/*.png`, `docs/plans/ui-fidelity-u2/*.png`) · `docs/decisions/2026-08-27-ui-fidelity-new-elements.md` · `docs/plans/2026-08-27-ui-fidelity-refreeze-attribution.md` · ledger dispositions in `docs/plans/2026-08-21-03a-fidelity-1-shell-queue-start.md` (A65, A179) and `-3-standing-surfaces.md` (SE1, SE40, SE43–45, SE47)
- Demo source (READ-ONLY, legacy `1ec1d870`): `/Users/julianhein/Projects/hr-automation/src/dashboard/components/dev/rebuild-demo/`
- Memory: `frontend-detail-fidelity`, `findings-ledger-policy`, `worktree-agent-traps`
- Related handoffs: `docs/handoffs/2026-08-27-run-ui-1-fidelity.md` (the brief this run executed)

## Suggested skills for the next session
- `/coordinator` — verify this return from git, merge `feature/ui-fidelity` into `integration/03b` after R1, and put the 7-item sheet in front of the operator
- `/decision-brief` — the sheet is already in that shape; collect `1 A, 2 B + note` and ratify into dashboard-surfaces §10
- `/supervise` — only if the operator's answers spawn work (UF-FU-1/UF-FU-2, sheet items 6–7)
