# R1 supervisor report — bounded workflow recipe/compiler increment

**Date:** 2026-09-02  
**Branch:** `feature/03c-r1-workflow-recipe`  
**Final head:** `31c3f9a56bd9ddce29d5f2a8938143665379d963`  
**Execution start:** `81c74fb0e4114891ee3d1261ff27268833a7536d` (the brief's declared base, `414d77b810f713d5813c79035fd38064ba04e73c`, is its parent)  
**Amended authority:** `1273c3605a0ae6776a86db34f36077fae49ff50b`, reconciled by merge `7c1a43c6`

## Outcome

The bounded D311 compiler increment is complete and clean. One recipe/compiler now derives the existing descriptor, module requirements, stores, and generic projections for Person Lookup and Separations while preserving their public contracts. Registry-wide conformance, equivalence, architecture, coverage, and visual parity proofs pass.

This is **not** final D312–D316 acceptance. After the coordinator delivered the amended authority, the coordinator explicitly kept this run bounded: finish the compiler increment, report the new requirements as successor-run residue, and do not absorb the runtime/intake/recovery seams. The strict four-artifact end state and the expanded skip/recovery/entry-algebra contract therefore remain for R3 or another explicitly briefed successor.

No session-panel source or parity state was edited. No live HR workflow or write was run. Nothing was pushed or merged to the integration branch/master.

## Units and commits

| Unit | Result | Evidence |
| --- | --- | --- |
| u01 — characterize equivalence | Complete | `2e563240` adds the red-capable equivalence suite; merge `6d30d75a` lands it before conversions. |
| u02 — compiler + Person Lookup | Complete | `ebfde1c6` adds `defineWorkflowRecipe`, compiler validation/projections, build-manifest recognition, and converts Person Lookup. |
| u03 — Person Lookup T1 pair | Deliberately deferred | A canonical pair would also require registrations in `src/domain/workflow/scenario-execution.ts` and `src/server/dry-run-scenario/manifests.ts`. That expansion was outside the bounded acceptance authorized after D312–D316; no partial test artifact was retained. |
| u04 — Separations conversion | Complete | `d4204106` converts Separations and regenerates the build manifest. |
| u05 — registry/generic conformance | Complete | `246daab2` plus merge `ee8f1adb`; `4555341f` closes the projection typing proof. `WORKFLOW_RECIPES` is registry-derived rather than a second manual list. |
| u06 — deletion, review, gates | Complete for the bounded increment | `97829431` closes correctness findings; `1ee8987f` restores architecture boundaries; `31c3f9a5` records the reviewed parity re-freeze. |

## Landed design

- `src/base/workflow-recipe.ts` owns recipe definition and compilation. It validates nonempty and uniquely identified groups/tasks, exact recipe/descriptor identity, exact contract ownership, store identity, unresolved/repeated references, and cycles.
- Conditionality is inferred only from a task's `when`; authors cannot declare a contradictory flag.
- Omission-decorated groups preserve the exact D265 step-owner object rather than reducing ownership to a string.
- Compiler-owned descriptor/module/store/recipe fields cannot be overridden through extension data; extension data is applied first and protected keys are excluded by type.
- Module requirements use each workflow's exact store candidates. The compiler filters and verifies those candidates without introducing a global-store dependency into workflow modules.
- `src/base/flow.ts` carries the existing conditional operator-gate predicate through the compiler seam.
- `src/infra/build/workflow-build-manifest.ts` recognizes `compileWorkflowRecipe`; the generated manifest is current.
- Person Lookup and Separations descriptors/modules are compiler products while their served/runtime shapes remain equivalent.

## Deletion inventory

The bounded increment removed these redundant, hand-authored step-category exports; their task fragments remain the current adapter input until D312–D316's final entry algebra/deletion run:

- `IDENTITY_CHECK_STEP_NODES`
- `JOB_SUMMARY_STEP_NODES`
- `KRONOS_TIMECARD_STEP_NODES`
- `KUALI_EXTRACTION_STEP_NODES`
- `KUALI_FINALIZATION_STEP_NODES`
- `UCPATH_TRANSACTION_STEP_NODES`

It also removed descriptor-local manual `flow`/timeline assembly for Person Lookup and Separations, manual conditional flags, and independent recipe registry population. No generic UI test was deleted merely to reduce count: the new registry conformance suite proves the generic projection contract without duplicating the existing interaction/parity coverage.

## Independent review

Correctness review found three medium issues, all closed in `97829431`:

1. author-supplied conditionality could disagree with `when`;
2. fragment step ownership was discarded by compilation;
3. extension fields could override compiler-owned descriptor/module/store/recipe identity.

Test review found three gaps, all closed before final gates:

1. conformance population needed to derive from the workflow registry;
2. unresolved result references needed an explicit failing case;
3. wrong exact contracts and foreign-recipe identities needed explicit failing cases.

The final self-review found no unresolved correctness, security, performance, test, documentation, or visual-parity finding within the bounded increment.

## Gate evidence

| Gate | Final result |
| --- | --- |
| Focused recipe/equivalence/conformance/structural tests | PASS after red/green conversion and review fixes. |
| `npm run typecheck` | PASS. |
| `npm run lint -- --no-cache` | PASS, zero warnings. |
| `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:coverage` | PASS — 393 files, 4,853 tests; statements 85.40%, branches 76.42%, functions 89.40%, lines 87.34%; 182.33 s. Suite inventory: unit 305/111,082 lines, scenario 18/7,296, architecture 70/27,052. |
| `npm run test:parity:update` | PASS — 287 tests; deliberate reference update. |
| `npm run test:parity` | PASS — 287 tests in assert mode after the freeze. |
| `npm run build:manifest:check` | PASS — `generated-build-manifest.ts is current.` |
| `npm run roadmap:check` | PASS — `docs/roadmap/index.html is fresh.` |
| `git diff --check` | PASS. |
| `cmp -s AGENTS.md CLAUDE.md` | PASS. |
| Final `git status --short` | Empty. |

The first coverage attempt failed loud because the default sibling legacy path was absent; the final gate used the documented `HRAUTO_LEGACY_REPO` override above. An intermediate full run then exposed three architecture failures, which were fixed, plus a type-budget contention failure and one unrelated takeover UI flake; the focused rerun passed 42/42 with the type budget at 1.40 s, and the final full coverage run passed.

Parity initially reported identity drift after the compiler changed descriptor fingerprints. All 228 accessibility snapshots and 228 metadata records therefore received the new descriptor hash. Visual inspection of representative diffs localized the image changes to the rendered fingerprint footer; 43 affected PNGs were deliberately re-frozen, while 244 other visual cases continued to match. The subsequent assert run passed 287/287.

## D312–D316 successor residue

Authority commit `1273c360` was merged so the branch contains the current owning docs, but the following implementation work was intentionally not claimed here:

- Enforce the strict four-artifact workflow budget: recipe, structural scenario, live/dry-run manifest, and migration record. Delete the remaining hand-authored descriptor/module/node-fragment/registry/generic-dashboard authoring paths only when the direct recipe entry model replaces their adapter role.
- Replace fragment-adapter recipe tuples with explicit typed `task`, `parallel`, `delegate`, `gate`, and `transaction` entries. `src/base/workflow-recipe.ts` is the current transition point.
- Make skipping mean the whole step executes nothing. Declare operator-supplied outputs on the step, collect and validate them before start in the run modal/admission path, and keep write-sensitive verification as a separate visible task. Likely seams include `src/domain/workflow/step-omission.ts`, the recipe compiler, start services, and the dashboard start modal.
- Implement both recovery modes: checkpoint resume and restart-from-start as a new attempt of the same logical run. Restart must rerun reads/computation while preserving successful write checkpoints/receipts and never repeating successful writes. Likely seams include `src/core/run-executor.ts` and the checkpoint/recovery/command/start paths.
- Complete the Person Lookup T1 structural scenario/live dry-run pair together with its canonical scenario/manifests registrations; do not land a disconnected pair.
- Run the hard D316 acceptance only after Person Lookup and Separations prove equivalence, the redundant authoring path is actually deleted, one-recipe grouping/run options are proven, and the four-artifact guard is green.

## Coordination and cleanup

The supervisor did not author `board.md`. Board provenance observed during the run was:

- intake blob: `5c99b8538d9b33e89195cdf59dba1341deeb9d8d`;
- branch-embedded post-authority blob: `a34cc14c61560075b6e7d904e2972cafa4e39217`;
- current coordinator checkout blob at report time: `f1fae59e877c87e175871470431fa7ba15c381f6`.

All three temporary **workflow-recipe** worker worktrees and their `feature/03c-r1-u*` branches were removed after their commits were integrated. The supervisor branch ends clean at `31c3f9a56bd9ddce29d5f2a8938143665379d963`.

### Cleanup follow-up audit

After the initial report, the coordinator challenged the cleanup claim with six `feature/test-r1-*` targets. A read-only `/worktree-sweep` audit established that those targets belong to the separate `test-suite-rationalization` program, whose own board names `feature/test-suite-rationalization` as its integration target. None is contained in this report's `31c3f9a5` workflow-recipe head, and the top `feature/test-r1-architecture-static` branch is itself not yet contained in that separate integration target.

No challenged target was removed or mutated. In particular, `/Users/julianhein/.codex/worktrees/eb84-r1-u06-nonempty-project` retains substantive uncommitted work in `vitest.config.ts`, `tests/unit/architecture-project-empty-collection.test.ts`, and `docs/coordinator/test-suite-rationalization/artifacts/r1/u06-nonempty-project.md`; those bytes are absent from `feature/test-r1-architecture-static`. Deleting that worktree would lose work. The other challenged branches are likewise outside this R1's ownership and remain registered for their owning supervisor/coordinator to integrate and close.
