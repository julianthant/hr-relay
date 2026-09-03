# R7 brief — cross-family reorganization, consequential review, authorities, and final proof

**Coordination UUID:** `f24df892-5171-48f4-97ff-4e91490f8622`
**Parent coordinator:** task `01a064e2-c3cf-7422-90c7-1dce60d194e5` / host `local`
**Canonical title:** `Supervisor · test-suite-rationalization · Cf24df892 · R07 · final integration review`
**Profile/workspace:** `/Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/test-suite-rationalization-f24df892-coordinator/docs/coordinator/test-suite-rationalization/project-profile.md` · `/Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/test-suite-rationalization-f24df892-coordinator/docs/coordinator/test-suite-rationalization`
**Board:** `docs/coordinator/test-suite-rationalization/board.md` — read only; coordinator is sole writer
**Worktree allowance:** one slot total, consumed by the supervisor worktree; use read-only workers or sequential supervisor-owned implementation

## Assignment

Invoke `/supervise` and complete units u37–u42 only after R1–R6 are integrated and their reports are accepted. Reconcile the entire estate, land cross-family taxonomy/config/script/doc changes, and produce the final proof packet. The coordinator board remains read-only.

**Run branch:** `feature/test-r7-integration-review` from the coordinator-recorded fully integrated R1–R6 reservation base; never merge into the coordinator branch
**Report:** `docs/coordinator/test-suite-rationalization/reports/r7-integration-review.md`
**Writable evidence:** `docs/coordinator/test-suite-rationalization/artifacts/r7/u37-reconciliation.md` through `u42-final-gates.md`

## In scope

- All accepted R1–R6 reports/artifacts and the integrated test/config diff.
- Cross-family duplicate resolution, final test taxonomy and path organization, filenames/titles, Vitest/Playwright/project/package/static/generated wiring.
- Root `AGENTS.md` + `CLAUDE.md`, `tests/scenario/AGENTS.md` + `CLAUDE.md`, `docs/rebuild/reference/guards-and-tests.md`, `docs/rebuild/guard-inventory.json`, decisions pointer plus the owning cross-repo contract, applicable phase/roadmap/generated authorities.

## Out of scope

- New product features; live HR runs/writes; hiding failures through threshold/exclusion/baseline changes; board edits; merging into the coordinator branch; deleting unrelated pre-existing worktrees/branches.

## Required method and evidence

1. Reconcile every baseline test into retain/delete/move/merge with one unique purpose and evidence. No missing/unowned rows.
2. Spot-check deletions/consolidations with red-capable mutations across every family. Resolve contradictory supervisor claims conservatively.
3. Inventory every test added since kickoff. Make test types and owning workflow/capability visible in paths; make filenames predict behavior and titles state behavior/refusal. Preserve path-sensitive guards/manifests/imports. Add executable topology enforcement so future tests are collected exactly once at their declared layer.
4. Configure lint, typecheck, Vitest projects, coverage, architecture, parity, performance, smoke, Duo, manifest and roadmap checks exactly once at their intended trigger. Finished gates must not read the legacy checkout. One streaming default reporter must identify project/suite, file, and full behavior/refusal title while work runs; long or genuinely multi-stage harnesses must expose stable named phases, and failures must name the exact operation with actionable non-secret context. Do not add per-assertion chatter to short units, duplicate reporter output, or reduce parallelism/isolation.
5. Ratify the operator's self-contained-gates and risk-based-retention decisions in the owning contract and decisions index in the same logical commit. Update instruction twins byte-identically.
6. Run final gates from clean isolated state with no legacy override and while 3938/5174 remain owned by the legitimate dashboard. Record coverage/suite/test/runtime deltas, labeled-reporter overhead against a comparable compact run, and worker/browser/process cleanup. Capture representative labeled green progress plus one controlled intentional red per runner family proving the project/file/test/phase is clear; capture expected diagnostics in assertions and never globally suppress real failures.

## Exit gate

`npm run typecheck`; `npm run lint`; `npm run test:coverage`; `npm run test:architecture`; `npm run test:parity`; `npm run build:manifest:check`; `npm run roadmap:check`; `git diff --check`; twin hashes; exact file/case/line/coverage/runtime deltas; representative green-progress and controlled-red output proof for each runner family. Independent consequential review passes. Run worktree clean, worker branches cleaned, exact report committed. Do not edit the board or merge into `feature/test-suite-rationalization`; coordinator performs final integration and project-worktree cleanup.
