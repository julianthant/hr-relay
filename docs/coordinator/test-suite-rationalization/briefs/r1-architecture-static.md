# R1 brief — architecture guards and static/type/lint gates

## Assignment

Invoke `/supervise` and complete units u01–u06 from the run plan. This run owns the architecture/static family and the operator's explicit self-contained-gates decision. The coordinator board is read-only.

**Base:** kickoff commit on `feature/test-suite-rationalization`
**Run branch:** `feature/test-r1-architecture-static` in its Codex worktree
**Report:** `docs/coordinator/test-suite-rationalization/reports/r1-architecture-static.md`
**Writable evidence:** only `docs/coordinator/test-suite-rationalization/artifacts/r1/` with one file per unit as named in the run plan
**Coordinator board:** `docs/coordinator/test-suite-rationalization/board.md` — never edit, stage, or commit

## In scope

- `tests/unit/architecture/**`, `docs/rebuild/guard-inventory.json`, `vitest.config.ts`, TypeScript/ESLint configuration, architecture/static-check helpers and fixtures.
- The current out-of-repo legacy checkout dependency in architecture collection. Read legacy only to understand/freeze exact reference facts; finished gates must require no legacy checkout or environment override.
- Guard duplication, cannot-fail guards, wrong-layer assertions, stale names/titles, guard-of-guard wiring, Vitest project duplication, and static/lint/type scope.
- Focused canonical-owner notes only when required to keep a changed guard honest. Defer cross-family package scripts and final broad authority prose to R7; record exact requested edits in u06.

## Out of scope

- Ordinary unit behavior outside architecture fixtures; dashboard/scenario/parity tests; production behavior changes; coverage/parity threshold weakening; live HR work; shared board edits.
- Deleting a unique `replacementRequired` invariant without equivalent executable replacement and owning-contract evidence.

## Required method and evidence

1. Inventory all 70 current architecture files and all manifest rows bidirectionally. For each, name invariant, owner, scan target, negative control, overlap, runtime, and truthful title.
2. Prove the external legacy dependency red before repair. Replace it with frozen in-repo facts/provenance where required; do not silently skip a cross-repo invariant. The final list and architecture command must pass when the legacy path is absent and `HRAUTO_LEGACY_REPO` is unset.
3. Prove each deletion/consolidation with duplicate-equivalence or negative mutation. Preserve the exact red output in the owning unit artifact; revert temporary mutations before commits.
4. Configure architecture as an exact named Vitest project if current authority still requires it, prevent duplicate collection, and pin project/script membership mechanically.
5. Audit actual ESLint and TypeScript inclusion/exclusion, not just package command strings. Add red-capable fixtures/checks for silent omissions when warranted.
6. Run independent consequential review on the final diff. Report every changed file, logical commit, before/after counts/runtime, retained/deleted/moved/merged table, and residue.

## Exit gate

- Focused red/green evidence for every change.
- `npm run typecheck`, `npm run lint`, self-contained architecture project/script, `npm run build:manifest:check`, `npm run roadmap:check`, `git diff --check`.
- No legacy override and no legacy checkout needed for collection or execution.
- Clean run worktree, logical commits, worker worktrees/branches cleaned, exact report committed. Do not merge into `feature/test-suite-rationalization`.
- If an invariant/threshold/product-truth choice remains, stop safely and return `NEEDS COORDINATOR` with options and recommendation.
