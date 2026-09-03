# R3 brief — D312–D318 authoring/runtime foundation (3c-A finish)

**Coordination UUID:** `57c2dec9-138e-4578-b5da-389ad9b4007a` · `C57c2dec9`
**Canonical title:** `Supervisor · phase-3c-migration · C57c2dec9 · R03 · authoring runtime foundation`
**Parent coordinator:** Claude Code session `571dd99a-cd47-4529-adfe-a4bc7569c29a` (the only allowed agent-to-agent channel)
**Base:** `feature/03c-workflow-migration` at `cb9a1476` (integrated R1 + R2 + D317 + D318 + session panel)
**Worktree / branch:** `/Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/phase-3c-migration-c57c2dec9-r03-authoring-runtime` · `feature/phase-3c-migration-c57c2dec9-r03-authoring-runtime`
**Worktree allowance:** 1 total slot, i.e. the run worktree only. Create no worker worktree; run every worker sequentially inside the run worktree on committed state.
**Units:** u15–u19 (run plan §Units)
**Report:** `docs/coordinator/phase-3c-migration/reports/r3-authoring-runtime.md` (relative to the run worktree; commit it on the run branch)
**Authority commits:** `1273c360` (D312–D316), `dee89c72` (D317), `cb9a1476` (D318 + status reconciliation)
**Plan authority:** `docs/rebuild/03c-migrate-the-remaining-workflows.md` §3c-A implementation run (units 2, 5–10), §3c-A documentation package, §3c-A exit gate; `ref workflow-model` §1.6; `ref guards-and-tests` §10.4/§10.11.

## Goal

Finish 3c-A exactly as doc 03c's "Next runnable supervisor scope" orders it, so 3c-B may start: (1) reconcile the task-store catalog and D317 final names/API; (2) enforce the four-artifact boundary and finish the direct entry algebra; (3) implement D313 omission admission; (4) implement D314 recovery and D318 `live-read`; (5) finish Person Lookup and Separations deletion/T1/guide acceptance; (6) run manifest, typecheck, lint, coverage, architecture, parity and workflow proofs; (7) leave a clean branch and the report. D319 changes no R3 implementation seam. Do not start a third workflow inside this run.

Begin from the base above; read `reports/r1-workflow-recipe.md`, `reports/r2-order1-intake.md`, `docs/status/2026-09-02-phase-3c-status.md` §2–3 and the carried residue before decomposing. Preserve the existing executor, durable formats, task/store boundaries, gates, receipts, write sequencer and public wire except where D313/D314/D318 explicitly amend behavior. Do not create a second runtime, an advanced graph-authoring escape hatch, a workflow-keyed generic dashboard adapter, a recipe compatibility alias or a silent fallback. Treat D307 as the pre-conversion as-built state and D313 as the compiled-workflow target.

## Seams (one unit each)

- **u15** — D317 workflow-only API (`workflow.ts` / `defineWorkflow` / `WorkflowDefinition` / `compileWorkflow` / `CompiledWorkflow`, no alias), task-store catalog discoverable by system/capability/effect/inputs/outputs (regenerate `ref stores`), strict four-artifact guard for reuse-only workflows.
- **u16** — closed explicit `task | parallel | delegate | gate | transaction` entry algebra compiled into existing node kinds; join/failure/child-run/authority policies explicit; failed parallel leaves retry independently; registry-wide conformance covers every kind.
- **u17** — D313 whole-step omission admission at definition, start-plan, run-modal wire/UI and executor: complete schema-valid replacement values before start, omitted group runs no entry, mandatory verifier is a separate selected entry, no mid-run prompt, operator-asserted provenance survives retry/fan-out. Visible work goes through `/ui` and the parity lane and preserves the session-panel behavior integrated at `49dc1529`.
- **u18** — D314 Resume from checkpoints and Restart from start as next attempts of the same logical item; a completed external write never re-enters prepare/commit (mutation proof); unfinished intents are probed first; fresh-fact mismatch refuses. Plus D318's `live-read` T1b arm: declaration + runner + exact zero deltas in `write_intents` / `write_attempts` / `durable_outbox`; `live-read` refuses a transaction-bearing graph, `dry-run-preview` refuses a transaction-free graph, D209 unchanged.
- **u19** — final Person Lookup and Separations conversion to `workflow.ts`; delete authored descriptor/module glue, fragment adapters, registry wiring and duplicate generic-dashboard tests; architecture guard against the retired path; Person Lookup canonical T1 pair at `tests/scenario/workflows/person-lookup/{structural.scenario.test.ts,dry-run.scenario.ts}` with its `live-read` half executed live (`npm run cli -- dry-run-scenario person-lookup --subject <label>`) and Separations' existing pair re-run; one grouping/options-only `workflow.ts` mutation proof; `docs/guides/workflow-authoring.md`, concise paired root `AGENTS.md`/`CLAUDE.md` rules (byte-identical twins, same commit) and `.agents/skill-library/workflow-authoring/REFERENCE.md`; `npm run build:manifest` and `npm run roadmap` regenerated and committed.

The supervisor owns the hard seams itself (u16 algebra core, u17/u18 authority and write-safety judgment, u19 deletion acceptance and consequential review) and splits only bounded supporting seams to workers.

## Rules

- Invoke `/supervise` in coordinated mode with the exact paths in the launch prompt. Worker roles: `sup-opus` (default for every small-to-medium seam), `sup-sonnet` (trivial-only: renames, regeneration, exact edits), `sup-scout` / `sup-analyst` (read-only). Never a generic agent, never a model override, never `sup-fable`. Run `python3 ~/.claude/skills/supervise/scripts/check-role-policy.py --platform claude --repo "$PWD"` before the first dispatch.
- Repository rules bind: root `AGENTS.md`/`CLAUDE.md` (fail-loud, no default exports, strict boundary schemas, manifest regeneration after any descriptor-closure edit, guard-inventory entries in the same commit as a new guard, twins byte-identical). Commit as you go by logical category with explicit paths; never `git add -A`; never push; never check out another branch in the run worktree or the root.
- Red-capable tests for every refusal and every no-repeat-write invariant. Run focused gates throughout, then the integrated gate: `npm run build:manifest`, `npm run typecheck && npm run lint`, `npm run test:coverage` (no concurrent compiler/linter; stop any dev dashboard first), `npm run test:parity`, `npm run build:manifest:check`, `npm run roadmap:check`, `git diff --check`, `cmp AGENTS.md CLAUDE.md`.
- Live reads and `dryRun=true` / `live-read` runs are pre-authorized; Duo Autopilot clears MFA; close every `playwright-cli` session. No actual external write is authorized. The run worktree carries a mode-600 copy of `.env` and symlinked `.auth` / `duo-autopilot/credentials`; export `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation` before guard runs.
- Never edit, stage or commit `board.md`; never merge into `feature/03c-workflow-migration` or `master`; never touch the three unrelated `feature/test-*` worktrees or any other worktree.
- If a question needs coordinator input (scope, product truth, rule conflict, live target), surface `NEEDS COORDINATOR` with the exact question, safe stopping state, authority checked, options and recommendation, and continue unaffected units.
- Scope-growth rule: if the run cannot finish all five units within budget, stop at a coherent integrated boundary (green focused gates, committed, clean tree), write the report as `partial` with exact remaining work, and run `/handoff` into `docs/coordinator/phase-3c-migration/handoffs/`. The coordinator resumes this same session; it does not start a second R3.

## Return

Commit the report at the report path on the run branch. It must contain: full coordination UUID and run id; bound worktree/branch and base SHA; per-unit outcome with commit SHAs; deletion inventory and before/after authored-artifact inventory for both acceptance workflows; every integrated gate command with its result line (counts, not exit codes); the live `live-read` and Separations T1b results with run ids and durable result rows; screenshots/parity evidence for visible behavior; review axes run and findings resolved; worker ledger with every worker's exact id and disposition; residue; `git status --short --branch` showing a clean tree. End every progress update and the final response with the exact footer:

```
Steps — n/8 complete
- [ ] u15 — workflow-only API, discoverable task catalog and strict four-artifact guard
- [ ] u16 — closed workflow entry algebra
- [ ] u17 — whole-step omission admission
- [ ] u18 — two recovery modes without repeat writes, plus the D318 live-read T1b arm
- [ ] u19 — D316/D317 final equivalence, guide and deletion acceptance
- [ ] VERIFY — every unit's commits, clean tree and gate checked by the supervisor
- [ ] INTEGRATE — integrated gate green on the run branch
- [ ] CLOSE — report committed; no worker worktree/branch residue
```
