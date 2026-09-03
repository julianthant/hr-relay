# R3c brief — deletion acceptance + guards

**Coordination UUID:** `57c2dec9-138e-4578-b5da-389ad9b4007a` · `C57c2dec9`
**Canonical title:** `Supervisor · phase-3c-migration · C57c2dec9 · R3c · deletion acceptance`
**Parent coordinator:** Claude Code session `1c78d186-91c1-4728-9da4-29102181632d` (successor of `571dd99a`; only allowed agent-to-agent channel)
**Worktree / branch:** `/Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/phase-3c-migration-c57c2dec9-r03-authoring-runtime` (path name inherited from R3) · `feature/phase-3c-migration-c57c2dec9-r3c-deletion-acceptance` at `c258677b` (= integrated `feature/03c-workflow-migration` tip)
**Worktree allowance:** 1 (this worktree). No worker worktrees; workers sequential here.
**Units:** u29, u30, u31, u32 (run plan §Units). **Out of scope:** u33–u36 (docs package — R3d), every order row, any new feature. Doc edits here are limited to what a deletion forces (stale references that would otherwise lie, root twins convention paragraph for `defineWorkflowStepNodeFactory`).
**Report:** `docs/coordinator/phase-3c-migration/reports/r3c-deletion-acceptance.md`
**Budget:** ~350k tokens. One hard seam (u29 deletion) is yours; u30 is one bounded `sup-opus` seam; u31 is yours; u32 is gates + report.

## Situation

The integrated tree at `c258677b` has the D317 `defineWorkflow` API, entry algebra, D313 omission, D314 recovery and D318 `live-read` built and gated green (`reports/r3-authoring-runtime.md`). Person Lookup and top-level Separations are `workflow.ts`-only. Doc 03c's 3c-A exit gate still requires: redundant authoring declarations deleted, a guard that fails if the retired path or an escape hatch returns, and the four-artifact budget proven. R3b's read-only inventory of what is left:

| Path | Kind |
|---|---|
| `src/workflows/separations/kronos-timecard/{node-ids,nodes,step,omission}.ts` | fragment factory beside `workflow.ts` |
| `src/workflows/separations/kuali-extraction/{node-ids,nodes,step}.ts` | fragment factory beside `workflow.ts` |
| `src/workflows/separations/kuali-finalization/{node-ids,nodes,step,omission}.ts` | fragment factory beside `workflow.ts` |
| `src/workflows/separations/ucpath-transaction/{node-ids,nodes,step,omission}.ts` | fragment factory beside `workflow.ts` |
| `src/workflows/separations/identity-check/{descriptor,module,node-ids,nodes,step}.ts` | hand-authored descriptor, no `workflow.ts` — unconverted |
| `src/workflows/separations/job-summary/{node-ids,nodes,step}.ts` | fragment factory, no `workflow.ts` — unconverted |
| `src/core/run-executor.ts:800,818` | no-op re-parse of a strict-parsed record (cleanup) |
| root `AGENTS.md`/`CLAUDE.md` D265-review paragraph (`defineWorkflowStepNodeFactory`) | convention that dies with the fragments |
| `docs/rebuild/03c-migrate-the-remaining-workflows.md` L73/L75/L105/L218–219; `ref workflow-model` L1009/L1011 | stale `workflow-recipe`/`defineWorkflowRecipe` references (L1104 forbidden-names clause stays) |

Verify that inventory yourself before deleting; it is a read, not a decision.

## Do

1. **u29 (yours).** Convert `identity-check` and `job-summary` to the compiled path (or fold them into the owning `workflow.ts` if D265's step-folder rule still needs the folder), then delete every fragment factory, `node-ids`, `step`, `omission`, hand-authored `descriptor`/`module` and registry wiring the compiled path supersedes. D265 folders stay as organization/audit structure. Preserve public descriptor/module/wire equivalence (the R1 equivalence fixtures must stay green unmodified except for identifiers that the deletion itself changes — state each). Produce a before/after authored-artifact inventory for Person Lookup and Separations; every file beyond D312's four must be justified as behavior-owned (a task, a driver, a schema) or deleted. Regenerate the build manifest and the store catalog when their closure changes. Fix the stale doc references the deletion makes false; keep the root twins byte-identical in the same commit.
2. **u30 (`sup-opus`, one dispatch).** One architecture guard under `tests/unit/architecture/` with its `docs/rebuild/guard-inventory.json` entry, red-capable against fixtures that (a) reintroduce `workflow-recipe`/`defineWorkflowRecipe`/`recipe.ts` names, (b) add a hand-authored `descriptor.ts`/`module.ts`/fragment factory beside a `workflow.ts`, (c) add a workflow-keyed generic dashboard adapter, (d) give a reuse-only workflow a fifth authored artifact. `guard-manifest.test.ts` must stay green.
3. **u31 (yours).** Re-run Person Lookup + Separations public equivalence and the grouping/options-only proof; execute Person Lookup's `live-read` T1b (`npm run cli -- dry-run-scenario person-lookup --subject <registry label>`) and record run id + durable result row; for Separations record the exact typed blocked arm from the registry (`finalization-canary` is `gone` since 2026-09-01 — do NOT choose a replacement; D284). No fabricated subject, no external write.
4. **u32 (yours).** Integrated gate — `npm run typecheck && npm run lint`; `npm run test:coverage` alone (stop any dev dashboard first, `pkill -INT -f scripts/dev-dashboard.ts`); `npm run test:parity` (refreeze only for a stated visible change, on a frozen tree); `npm run build:manifest:check`; `npm run stores:catalog:check`; `npm run roadmap:check`; `git diff --check`; `cmp AGENTS.md CLAUDE.md`. Read counts, not pipeline exit codes. Then the report: per-unit outcomes with SHAs, deletion inventory (before/after), guard fixtures and their red lines, equivalence/T1b evidence, review record, gate lines, worker ledger, residue for R3d, clean `git status --short --branch`.

## Rules

`/supervise` coordinated mode; roles `sup-opus` (default) / `sup-sonnet` (trivial-only) / `sup-scout` / `sup-analyst`; run `python3 ~/.claude/skills/supervise/scripts/check-role-policy.py --platform claude --repo "$PWD"` first. Repository AGENTS.md/CLAUDE.md bind (fail loud, strict schemas, no default exports, guard + inventory entry in one commit, manifest regeneration, twins). Explicit-path staging, commit as you go, never push, never `git add -A`, never check out another branch here or in the primary checkout, never merge into `feature/03c-workflow-migration` or `master`, never write `board.md`, never touch the three `feature/test-*` worktrees. Live reads and `live-read`/`dryRun=true` runs are pre-authorized (`.env` copy and auth links present; export `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation`; close every `playwright-cli` session). No external write. `NEEDS COORDINATOR` for any scope/product/rule question, with options and a recommendation. If you approach budget, stop at a green committed boundary with a partial report and `/handoff` into `docs/coordinator/phase-3c-migration/handoffs/`.

## Footer (exact, every update and the final response)

```
Steps — n/7 complete
- [ ] u29 — remaining old-authoring-path deletion
- [ ] u30 — retired-path and escape-hatch architecture guard
- [ ] u31 — equivalence, grouping proof and T1b states
- [ ] u32 — R3c gates and report
- [ ] VERIFY — every unit's commits, clean tree and gate checked by the supervisor
- [ ] INTEGRATE — integrated gate green on the run branch
- [ ] CLOSE — report committed; no worker residue
```
