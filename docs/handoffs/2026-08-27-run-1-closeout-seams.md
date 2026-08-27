# Handoff — Phase 3b run R1: the date-independent seams (u18, u11–u14)

**Date:** 2026-08-27 (written by the coordinator; runnable immediately)
**Paused at:** before execution — resume at u18

## Task summary
Phase 3b's only open exit row (5, controlled commits) is date-gated to 2026-08-28 — that is R2. Four 03b seams never depended on those commits and are done today as R1: a `dryRun=true` full-chain proof on the past-dated practice subject **4502** (proves the chain is green on `integration/03b` before tomorrow's real writes), the registry → `config/test-subjects.json` move (order-8, doc 03b line ~108), the two dashboard scenarios T1/T2 (sep-dash, lines ~592–593), and the cold-WFD first-search empty-identity-cell diagnosis (sep-1, line ~280, §9.20 item 7). No `dryRun=false` anywhere in this run.

## Plan
- Run plan: `docs/plans/2026-08-27-03b-runs.md` §R1 (unit specs u18, u11, u12, u13, u14 — verbatim)
- Board: `docs/plans/03b-board.md` — read FIRST; write your ledger rows back at close

## Current state (from git)
- Repo: `/Users/julianhein/Projects/hr-automation-rebuild`   Branch: `integration/03b`   Base: `b9126e6d` (the hold note; master `8e322e8a` is an ancestor)
- Worktrees: none · feature/*: none · `vitest.config.ts` carries an uncommitted formatting-only reflow that is not this run's — leave it or `git checkout -- vitest.config.ts` before dispatching; never commit it inside a unit

## Progress
- [ ] u18 dry-run proof on 4502 (root checkout, live, `hr-manage` + `hr-debug`) ← **resume here**
- [ ] u11 registry → config (`sup-opus`, worktree) · u12 sep-dash T1 (`sup-opus`, worktree, `tdd tests`) · u13 sep-dash T2 (`sup-opus`, worktree, `tdd tests`) — parallel, one message
- [ ] u14 cold-WFD diagnosis (`sup-fable`, root checkout after the three merges, `hr-debug`)

## Open questions / deferred decisions
- u14 may end in an honest "page-state fact" record instead of a fix — that is a valid `done`. A fallback selector is not.
- Anything discovered that belongs to the commits (②/①/③) is recorded on the board's Residue for R2 — not done here.

## Verification before resuming
```bash
cd /Users/julianhein/Projects/hr-automation-rebuild
git status --short --branch && git worktree list && git branch --list 'feature/*'
npm run typecheck && npm run lint
HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:coverage 2>&1 | tail -8
npm run roadmap:check
```

## Pointers
- Read first: root `CLAUDE.md` (§Live verification, §Fail loud, §Conventions), `docs/plans/03b-board.md`, `docs/rebuild/03b-finish-separations.md` lines ~101–110 (order-8), ~275–282 (sep-1), ~589–595 (sep-dash), `docs/migrations/separations.md` §9.20 item 7 and §9.27
- Worktree traps (memory + board): `npm ci` + `.auth`/`.env` links + `HRAUTO_LEGACY_REPO` per worktree; laptop sleep kills background agents; never `git checkout` in the root
- Related: `docs/handoffs/2026-08-27-r1-date-gate-hold.md` (why the first cut held), `docs/handoffs/2026-08-28-run-1-t1b-canary.md` (R2's brief)

## Suggested skills for the next session
- `/supervise` — you ARE the supervisor; the operator's prompt invokes it
- `/hr-manage`, `/hr-debug` for u18 and u14; `/tdd tests` for u12/u13; `/worktree-sweep` after the parallel batch
