# R6 brief — Playwright parity, performance, smoke, Duo, and generated checks

## Assignment

Invoke `/supervise` and complete units u31–u36 from the kickoff base. Own browser parity, performance, smoke/Duo, and generated-check test surfaces. This is frontend/browser test work, so use `/ui` and the repository's `playwright-cli` rule for interactive verification. The coordinator board is read-only.

**Base:** kickoff commit on `feature/test-suite-rationalization`
**Run branch:** `feature/test-r6-parity-checks` in its Codex worktree
**Report:** `docs/coordinator/test-suite-rationalization/reports/r6-parity-checks.md`
**Writable evidence:** `docs/coordinator/test-suite-rationalization/artifacts/r6/u31-parity.md` through `u36-review.md`

## In scope

- `tests/parity/**`, `playwright.parity.config.ts`, `tests/perf/**`, smoke-target tests/scripts, `duo-autopilot/**` test/check surfaces, and generator/check entry-point behavior.
- Exact parity references, viewport/theme matrices, accessibility/pixel/wire risks, runner cost, performance benchmark failure capability, offline/live classification, truthful names/triggers.
- Record any cross-family `package.json` script change for R7; do not edit `package.json` in this Wave-1 branch because R1 owns adjacent project wiring in parallel.

## Out of scope

- Dashboard product changes; unit/scenario/architecture tests; deliberate parity refresh without a real changed expectation; live Duo/HR login; threshold/allowance weakening; board edits.

## Required method and evidence

1. Inventory all 17 specs/287 cases and reference families; map each matrix dimension to a distinct risk or mark equivalence with proof.
2. For every consolidation, preserve the retained browser assertion's red capability by a temporary production/reference mutation or equivalent controlled negative. Inspect retained screenshots; green metadata alone is insufficient.
3. Keep pixel count strictness, semantic/a11y pairing, seeded-versus-fixture adapter independence, and ephemeral servers unless an operator decision changes them.
4. Audit performance benchmarks for statistically/operationally meaningful failure, stable fixture shape, warmup and environment assumptions. Record runtime before/after.
5. Classify smoke, Duo, and generated checks as offline, local integration, or live; ensure names/scripts/triggers do not imply stronger proof than they provide.
6. Independent review of final diff, process/browser cleanup, exact before/after counts/references/runtime.

## Exit gate

Focused red/green, full `npm run test:parity`, relevant perf/smoke/generated checks that are safe offline, typecheck, lint, manifest/roadmap/diff checks; no orphan server/browser; clean worktree and committed report. Do not merge or edit the board. Return `NEEDS COORDINATOR` for any baseline/threshold/product-truth choice.
