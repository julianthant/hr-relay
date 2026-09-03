# R3b brief — stabilize the R3 branch

**Coordination UUID:** `57c2dec9-138e-4578-b5da-389ad9b4007a` · `C57c2dec9`
**Canonical title:** `Supervisor · phase-3c-migration · C57c2dec9 · R3b · stabilize`
**Parent coordinator:** Claude Code session `571dd99a-cd47-4529-adfe-a4bc7569c29a` (only allowed agent-to-agent channel)
**Worktree / branch (continue, do not recreate):** `/Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/phase-3c-migration-c57c2dec9-r03-authoring-runtime` · `feature/phase-3c-migration-c57c2dec9-r03-authoring-runtime` at `0566b181`
**Worktree allowance:** 1 (this worktree). No worker worktrees; workers run sequentially here.
**Units:** u25, u26, u27, u28 (run plan §Units). **Out of scope:** u29–u36 and every order row.
**Report:** `docs/coordinator/phase-3c-migration/reports/r3-authoring-runtime.md`
**Budget:** this run is capped at ~350k tokens. It is a verification-and-finish run, not a feature run.

## Situation

The R3 supervisor (session `e266c808`) landed 26 commits `8a931cc6..c1bdcf68` (D317 API + generated task-store catalog, D315 entry algebra, D313 omission, D314 recovery, D318 `live-read`, Person Lookup canonical T1 pair with a met live-read result, four harness `workflow.ts` conversions, grouping/options proof) and then exhausted its context while applying review fixes. The coordinator safety-committed its ten in-flight files as `0566b181` (`wip(r3)`; read that commit message for the fix intents). At `0566b181`: `npm run lint` green, `cmp AGENTS.md CLAUDE.md` identical, `npm run typecheck` RED with 5 `TS2554` errors (tests still pass 3 of 4 arguments to the changed dry-run-scenario runtime signature). No full gate has ever run on this branch and no report exists.

## Do

1. u25 (yours): read `git show 0566b181`; finish or explicitly revert each fix intent (delegate node refuses `live-read`; manifest-keyed compile memoization; drift-before-fresh-fact ordering in the write sequencer; safe restart parsing; explicit arm switching; queued-span recovery; doc twins). Fix the five test call sites. Red-capable test per kept fix. Commit by category.
2. u26 (`sup-opus`, one seam per dispatch): run the focused suites for every R3 seam and `npm run build:manifest && npm run build:manifest:check`; report counts. Any red comes back to you; do not widen.
3. u27 (yours): the integrated gate — `npm run typecheck && npm run lint`; `npm run test:coverage` alone (stop any dev dashboard, `pkill -INT -f scripts/dev-dashboard.ts`); `npm run test:parity` (refreeze only with a stated visible-behavior reason, on a frozen tree); `npm run roadmap:check`; `git diff --check`; `cmp AGENTS.md CLAUDE.md`. Read counts, never pipeline exit codes.
4. u28 (yours): write and commit the report: per-unit table for u15–u18 and the u19 slice R3 completed, with SHAs; every gate line; worker ledger (exact ids); exact residue for R3c (deletion inventory still open — list the files you believe are leftover old-path/adapters; Separations T1b re-run blocked state) and R3d (guide, root rules, agent reference, ref stores/workflow-model reconciliation).

## Rules

`/supervise` coordinated mode; roles `sup-opus` (default) / `sup-sonnet` (trivial-only) / `sup-scout` / `sup-analyst`; run `python3 ~/.claude/skills/supervise/scripts/check-role-policy.py --platform claude --repo "$PWD"` first. Repository AGENTS.md/CLAUDE.md bind (fail loud, strict schemas, manifest regeneration, twins). Explicit-path staging, commit as you go, never push, never `git add -A`, never check out another branch here or in the primary checkout, never merge into `feature/03c-workflow-migration` or `master`, never write `board.md`, never touch the three `feature/test-*` worktrees. Live reads and `live-read`/`dryRun=true` runs are pre-authorized (`.env` copy and auth links are in place; export `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation`); no external write. Stop any dev dashboard before gates. If a question needs the coordinator, surface `NEEDS COORDINATOR` with options and a recommendation. If you approach budget, stop at a green committed boundary, write the report as partial, run `/handoff` into `docs/coordinator/phase-3c-migration/handoffs/`.

## Footer (exact, every update and the final response)

```
Steps — n/7 complete
- [ ] u25 — finish the in-flight review-fix set
- [ ] u26 — re-verify R3's committed seams
- [ ] u27 — integrated gate on the R3 branch
- [ ] u28 — R3 verification report
- [ ] VERIFY — every unit's commits, clean tree and gate checked by the supervisor
- [ ] INTEGRATE — integrated gate green on the run branch
- [ ] CLOSE — report committed; no worker residue
```
