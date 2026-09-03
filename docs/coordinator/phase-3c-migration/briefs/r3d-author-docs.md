# R3d brief — 3c-A documentation package

**Coordination UUID:** `57c2dec9-138e-4578-b5da-389ad9b4007a` · `C57c2dec9`
**Canonical title:** `Supervisor · phase-3c-migration · C57c2dec9 · R3d · author docs`
**Parent coordinator:** Claude Code session `1c78d186-91c1-4728-9da4-29102181632d` (only allowed agent-to-agent channel)
**Worktree / branch:** `/Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/phase-3c-migration-c57c2dec9-r03-authoring-runtime` (retained path, name inherited from R3) · `feature/phase-3c-migration-c57c2dec9-r3d-author-docs` at `16e7e63b` (= integrated `feature/03c-workflow-migration` tip, R3c merged)
**Worktree allowance:** 1 (this worktree). No worker worktrees; u34 and u35 run sequentially or as two `sup-opus` dispatches in this checkout on disjoint files.
**Units:** u33, u34, u35, u36 (run plan §Units). **Out of scope:** u110–u113 (R4/3c-B), any code change beyond a doc-driven example fix, any new workflow, the Separations canary decision.
**Report:** `docs/coordinator/phase-3c-migration/reports/r3d-author-docs.md`
**Budget:** ~350k tokens. Docs-only run: one hard seam (u33, the guide) is yours; u34 and u35 are bounded `sup-opus` seams; u36 is one read-only `sup-analyst` proof plus your gate and report.

## Situation

After R3c the tree has exactly one authoring path (`workflow.ts` + `defineWorkflow`), the retired-path guard, and both acceptance workflows proven equivalent. Doc 03c §"3c-A documentation package" (lines ~274–290) names five documents; only the generated task-store catalog exists. The root `AGENTS.md`/`CLAUDE.md` D311–D317 paragraph still carries the transitional `b1b36349` sentence that R3c made false. `ref workflow-model` §1.6 is titled for D311/D317 but §5.6/§5.8 lack the D313/D318 text the root paragraph cites; `ref stores` has no catalog mention. Read `reports/r3c-deletion-acceptance.md` §Residue for R3d for the exact list R3c left. R3c also annotated D265 §1.2.2 rule 2 as superseded by D312 §1.6.1 item 5 (`ab04231c`) — keep it an annotation; the body rewrite is an open operator item, not yours. Five operator questions are batched in `decisions/2026-09-02-3c-a-close-questions.md`; none blocks this run — do not resolve them, and if the D314 wording answer (item 2) is relayed to you mid-run, apply it in u35.

## Do

1. **u33 (yours).** Write `docs/guides/workflow-authoring.md`. Required content (doc 03c table): find/reuse/build decision; complete `defineWorkflow` API examples; omissions; parallel/delegate/gate/transaction examples; testing and debugging; a minimal Person Lookup example and a complete Separations excerpt copied from the real `workflow.ts` at their SHA; a reuse-only example; a new-task example; the "what file do I change?" table matching doc 03c's routing table; what the compiler/runtime generate versus what an author never hand-maintains. Every snippet must be a real compiled shape — pin each excerpt with `// from src/workflows/<id>/workflow.ts @ <sha>` and prove it by a typecheck of an extracted fixture or by citing the exact lines. No escape hatch may appear.
2. **u34 (`sup-opus`).** Root `AGENTS.md`/`CLAUDE.md`: replace the D311–D317 convention paragraph with concise mandatory rules and a pointer to the guide; delete the `b1b36349` transitional sentence; twins byte-identical in the same commit. Write `.agents/skill-library/workflow-authoring/REFERENCE.md` as an internal checklist that points at guide/spec and adds no operator command and no policy of its own. A `.claude/skills/` helper only with `user-invocable: false`.
3. **u35 (`sup-opus`).** `ref workflow-model` §1.6 normative types/compiler products/invariants/refusals as built; §5.6 and §5.8 D313/D318 text; `ref stores` reconciled with the generated catalog; doc 03c 3c-A checklist boxes ticked only where R3c/R3d evidence proves them, each with its SHA. Run `npm run roadmap && npm run roadmap:check`.
4. **u36 (`sup-analyst`, read-only, then yours).** The analyst reads ONLY the guide + agent reference and reconstructs the authored artifact set for Person Lookup and Separations, listing every step the docs did not cover or that needed a legacy escape hatch (doc 03c L116). Fix each gap in u33–u35 and re-run the proof until zero. Then the integrated gate — `npm run typecheck && npm run lint`; `npm run test:coverage` alone (stop any dev dashboard first); `npm run test:parity`; `npm run build:manifest:check`; `npm run stores:catalog:check`; `npm run roadmap:check`; `git diff --check`; `cmp AGENTS.md CLAUDE.md` — read counts. Report: per-unit SHAs, the proof's gap list and fixes, gate lines, worker ledger, clean `git status --short --branch`, residue for R4.

## Rules

`/supervise` coordinated mode; roles `sup-opus` / `sup-sonnet` (trivial-only) / `sup-scout` / `sup-analyst`; run `python3 ~/.claude/skills/supervise/scripts/check-role-policy.py --platform claude --repo "$PWD"` first. Repository AGENTS.md/CLAUDE.md bind. Explicit-path staging, commit each green document immediately, never push, never `git add -A`, never check out another branch, never merge into `feature/03c-workflow-migration` or `master`, never write `board.md`, never touch the `feature/test-*` worktrees. Docs-only workers run `npm run roadmap:check` plus `npx vitest run tests/unit/architecture/roadmap-doc-binding.test.ts tests/unit/architecture/guard-manifest.test.ts`, not the full suite; the supervisor runs the full gate once at INTEGRATE. `NEEDS COORDINATOR` for any scope/product/rule question. If you approach budget, stop at a green committed boundary with a partial report and `/handoff` into `docs/coordinator/phase-3c-migration/handoffs/`.

## Footer (exact, every update and the final response)

```
Steps — n/7 complete
- [ ] u33 — practical author guide
- [ ] u34 — root rules and internal agent reference
- [ ] u35 — reference reconciliation
- [ ] u36 — guide-following proof, gates and report
- [ ] VERIFY — every unit's commits, clean tree and gate checked by the supervisor
- [ ] INTEGRATE — integrated gate green on the run branch
- [ ] CLOSE — report committed; no worker residue
```
