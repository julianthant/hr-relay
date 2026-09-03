# Status — Phase 3c workflow migration — 2026-09-02 (HEAD b1b36349)

> **D319 scope amendment, 2026-09-02:** this snapshot predates the operator's verified-admission
> decision. Phase 3c now finishes the authoring foundation and accepts only Person Lookup and
> Separations. Item 7 under Next is superseded: I-9 and every other named workflow remain
> unnumbered candidate evidence until the operator approves a complete admission packet. The
> current executable plan is the coordinator board, not the old migration sequence in this snapshot.

_Plan source: `docs/roadmap/roadmap.md` and `docs/rebuild/03c-migrate-the-remaining-workflows.md`.
Verified against: `master..HEAD`, the Phase 3c coordinator reports, current source/test artifacts,
`npm run cli -- phase`, the R1 full-gate record, and a read-only worktree audit._

## 1 · Complete

| Item | Evidence | Since |
|---|---|---|
| Phase 3c is the active runtime phase and the risk/reuse order is fixed | `npm run cli -- phase` → `active: 3-workflow-migration`; doc 03c order table | before this audit |
| Person Lookup and Separations public compatibility targets are frozen | `tests/unit/workflow-recipe-equivalence.test.ts`; commits `2e563240`, `6d30d75a` | R1 |
| A bounded transitional compiler derives the existing graph, descriptor/module stores and build-manifest products without a second runtime | `src/base/workflow-recipe.ts`; commit `ebfde1c6` | R1 |
| Person Lookup and Separations descriptors/modules are compiler-backed | `src/workflows/person-lookup/{descriptor,module}.ts`; `src/workflows/separations/{descriptor,module}.ts`; commits `ebfde1c6`, `d4204106` | R1 |
| Registry-derived generic bootstrap/start, timeline/detail and Explorer conformance is green for both converted workflows | `tests/unit/workflow-recipe-conformance.test.ts`; commits `246daab2`, `4555341f` | R1 |
| The bounded compiler passed integrated typecheck, lint, 393-file/4,853-test coverage, manifest, roadmap and 287-case parity gates | `docs/coordinator/phase-3c-migration/reports/r1-workflow-recipe.md`; merge `a40276b6` | R1 |
| Order 1 workflow-specific intake is complete without claiming implementation | `docs/migrations/person-lookup.md`; `docs/migrations/i9-lookup.md`; `docs/coordinator/phase-3c-migration/reports/r2-order1-intake.md`; merge `b1b36349` | R2 |
| Phase-owned R1/R2 worker/supervisor worktrees and branches were removed after verification | R1/R2 reports; current `git worktree list --porcelain` and `git branch -vv` contain no `feature/03c-r1-*` or `feature/03c-r2-*` | R1/R2 close |

## 2 · Drift — where the as-built differs from the plan

| Plan said | Reality | Kind | Consequence |
|---|---|---|---|
| `workflow.ts`, `WorkflowDefinition`, `defineWorkflow`, `compileWorkflow` are the one authoring seam | The landed transition still uses `src/base/workflow-recipe.ts`, `WorkflowRecipe`, `defineWorkflowRecipe` and `compileWorkflowRecipe` | done-differently | D317 rename/deletion is the first remaining 3c-A seam; aliases would leave two vocabularies |
| Entries explicitly cover `task`, `parallel`, `delegate`, `gate`, `transaction` | The compiler directly authors reads but still adapts gate/transaction fragments and has no direct parallel/delegate entry | not-done-but-ticked in the stale plan | D315 and independent parallel retry are not complete |
| A reuse-only workflow has exactly four authored workflow-specific artifacts | Person Lookup and Separations retain authored `descriptor.ts`, `module.ts` and Separations node/step adapters | not done | The four-artifact guard and final deletion acceptance remain |
| Whole-step omission and restart-from-start are available | Current behavior remains D307 omission plus existing checkpoint replay; D313/D314 are unbuilt | not done | 3c-B remains blocked |
| Both acceptance workflows carry the full T1 pair | Person Lookup has no canonical structural/live pair; Separations does | not done | D318 resolves the read-only proof contract; its `live-read` implementation and Person Lookup evidence remain open |
| The authoring path is teachable from one guide and discoverable task catalog | `docs/guides/workflow-authoring.md` and `.agents/skill-library/workflow-authoring/REFERENCE.md` do not exist; `ref stores` is a dated prose catalog | not done | Another agent would still need repository archaeology |
| Writable runs may reserve worktrees within the shared budget | Eight unrelated `feature/test-*` auxiliary worktrees are registered; one has untracked `node_modules` | blocked by external capacity | Re-audit before R3 dispatch and let the owning test program close its own rows; do not sweep them from Phase 3c |

## 3 · Next

1. Re-audit worktree capacity; begin writable R3 work only after the separate test-suite program releases enough slots.
2. Rename the transitional authoring API/files to D317 workflow terminology, update the task-store catalog for capability/effect/input/output discovery, and leave no recipe compatibility alias.
3. Enforce the four-artifact boundary and replace fragment adapters with the direct closed entry algebra, including parallel/delegate join, failure and independent-retry behavior.
4. Implement D313 whole-step omission and complete pre-start replacement-value admission in the run modal.
5. Implement D314 checkpoint resume/restart-from-start and D318's transaction-free `live-read` T1b arm while mutation tests prove completed external writes cannot execute twice and authority comparison proves zero write deltas.
6. Finish Person Lookup and Separations final conversion/deletion, Person Lookup T1, the author guide/agent reference and all integrated gates; then run the exact worktree sweep.
7. Run 3c-B acceptance for Person Lookup and Separations, reconcile Phase 3, run the integrated
   gates and worktree sweep, then stop. Select and verify a future candidate separately before
   assigning Phase 4.

## 4 · Needs you

None. The operator selected option A on 2026-09-02; D318 ratifies a distinct `live-read` T1b arm
for zero-transaction graphs while preserving D209's transaction-preview meaning. Implementation and
live proof remain work, but the contract decision no longer blocks them.
