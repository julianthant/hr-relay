# Handoff — run UI-2: the D281 residue (storage band, last two takeovers, ledger recount, G1, Activity audit)

**Date:** written 2026-08-27 for a paste on or after 2026-08-28, once Phase 3b R2 has closed · **Paused at:** before execution — resume at U9 (sequential first), U6/U7/U8 in parallel.

## Guard (zero cost, before any reading)
`grep -cE '^\| u[1-5] \| R2 \| merged' docs/plans/03b-board.md` — if it prints less than 5, R2 has not closed: reply "held: R2 not closed" and STOP. Also `git worktree list` must show the root only and `git branch --list 'feature/*'` nothing — else STOP and say what is there.

## Task summary
Run UI-2 (`docs/plans/2026-08-27-ui-runs.md` §UI-2) discharges what D281 and the UI-1 receive left named: U6 the storage band goes full-bleed (D281.7), U7 intake + UI catalog adopt `TakeoverFrame` (UF-FU-1), U8 recount ledger 1's Region A, U9 diagnose G1 on the root's state root (read-only; the projection's refusal is not softened), U10 audit Activity's populated body on a reconciled day. Five units, one theme. Unit specs (Goal/Scope/Acceptance/Tier/Mode/Review) are in the run plan — restate them verbatim in your briefs.

## Current state (from git, at write time)
- Repo `/Users/julianhein/Projects/hr-automation-rebuild` · branch `integration/03b` · UI-1 merged at `a3683bf3` (`--no-ff`); base for this run = R2's exit (whatever `integration/03b` is at when the guard passes — record the sha in your first commit message)
- Worktrees: root only · `feature/*`: none · parity 218 assert, references clean at `a3683bf3`
- Parallel units get `<repo>/.hr-rebuild-worktrees/<unit>` + `feature/<unit>` — each needs `npm ci`, `.env`/`.auth` symlinks from the root, `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation` for every gate (board §Traps)

## Order
1. U9 first, sequential — it reads the ROOT's `.tracker-rebuild/` read-only and decides U10's day; do not start U10 until U9's finding row says `diagnosed`.
2. U6 · U7 · U8 in parallel, own worktrees. U6 and U7 both re-freeze parity references — merge one, re-run `test:parity` on the merged tree, then merge the other and re-freeze any composite refs deliberately, attributed under `## Merge` in the attribution doc (the UI-1 pattern, `docs/plans/2026-08-27-ui-fidelity-refreeze-attribution.md` §Merge).
3. U10 last.

## Verification before resuming
```bash
git status --short --branch && git log --oneline -1 && git worktree list && git branch --list 'feature/*'
lsof -nP -iTCP:3938 -iTCP:5174 -sTCP:LISTEN; uptime      # the root's dashboard pair, if up, is the operator's — reuse, never restart
```

## Pointers
- Read first: `docs/plans/ui-board.md` (intake — trust its facts), `docs/plans/2026-08-27-ui-runs.md` §UI-2, `docs/rebuild/reference/dashboard-surfaces.md` §10 D281, `src/dashboard/CLAUDE.md` (UI-1's four dated lessons), `src/dashboard/DESIGN.md`
- Demo (READ-ONLY, legacy `1ec1d870`): `/Users/julianhein/Projects/hr-automation/src/dashboard/components/dev/rebuild-demo/`
- G1: `docs/findings/activity.md` (last section) · the refusal `src/server/dashboard/projectors/run-queue-projection.ts:887` · the 08-27 state-root rebuild: `docs/plans/03b-board.md` "R2 pre-flight residue"

## Suggested skills
- `/supervise` (this run) · `/ui` for U6/U7/U10 · `/worktree-sweep conflicts` for the U6/U7 parity composite · `/handoff` at close
