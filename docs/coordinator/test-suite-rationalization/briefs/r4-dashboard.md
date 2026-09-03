# R4 brief — dashboard model/jsdom/component tests versus parity and T2

**Coordination UUID:** `f24df892-5171-48f4-97ff-4e91490f8622`
**Parent coordinator:** task `01a064e2-c3cf-7422-90c7-1dce60d194e5` / host `local`
**Canonical title:** `Supervisor · test-suite-rationalization · Cf24df892 · R04 · dashboard tests`
**Profile/workspace:** `/Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/test-suite-rationalization-f24df892-coordinator/docs/coordinator/test-suite-rationalization/project-profile.md` · `/Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/test-suite-rationalization-f24df892-coordinator/docs/coordinator/test-suite-rationalization`
**Board:** `docs/coordinator/test-suite-rationalization/board.md` — read only; coordinator is sole writer
**Worktree allowance:** one slot total, consumed by the supervisor worktree; use read-only workers or sequential supervisor-owned implementation

## Assignment

Invoke `/supervise` and complete units u19–u24 after R1/R6 are integrated. Own dashboard unit/jsdom tests and rationalize them against the already-audited parity lane and scenario T2 contract. This is frontend test work, so route implementation/verification through `/ui`. The board is read-only.

**Run branch:** `feature/test-r4-dashboard` from the coordinator-recorded reservation base; never merge into the coordinator branch
**Report:** `docs/coordinator/test-suite-rationalization/reports/r4-dashboard.md`
**Writable evidence:** `docs/coordinator/test-suite-rationalization/artifacts/r4/u19-inventory.md` through `u24-review.md`

## In scope

- `tests/unit/dashboard/**` and dashboard-owned root unit files; 21 dashboard jsdom files at intake.
- Pure `*-model.ts` logic, DOM event/focus/lifecycle wiring, component assertions, test fixtures/helpers, capability organization, filenames and test titles.
- Evidence-backed overlap with R6 parity and current/future T2 scenarios.

## Out of scope

- Production visual redesign; parity reference regeneration to hide a mismatch; scenario corpus edits; architecture ownership; final package/taxonomy docs; live HR systems.

## Required method and evidence

- Inventory each assertion as pure decision, DOM wiring, visual/layout, accessibility semantics, server/projection transition, or fixture duplication.
- Node/pure-model tests own decisions; jsdom owns presses/focus/lifecycle only; parity owns rendered pixel/a11y/browser behavior; T2 owns command/projection authority transitions. Move or delete only with exact retained owner.
- Every removed component assertion needs duplicate-equivalence or proof it cannot fail under a relevant production mutation. Do not replace behavior with snapshots of markup.
- Measure jsdom file count and runtime before/after. A faster test that loses focus/refusal/lifecycle risk is not a gain.
- Organize by owning capability and make filenames/titles state behavior and failure condition; update imports/config/path-sensitive references.
- Audit output while running the owned family: every case must surface project/suite, file, and full behavior/refusal title; multi-stage browser/DOM harnesses need stable named phases whose failures include actionable non-secret context. Capture expected diagnostics in assertions; do not globally suppress output.
- Independent review plus rendered/browser verification for any changed presentation-facing test seam.

## Exit gate

Focused red/green, dashboard unit project, affected T2/parity gates, typecheck, lint, architecture/generated/diff checks as applicable; representative labeled green progress and controlled actionable-red output; before/after inventory and exact report; clean worktree. Do not edit the board or merge the coordinator branch.
