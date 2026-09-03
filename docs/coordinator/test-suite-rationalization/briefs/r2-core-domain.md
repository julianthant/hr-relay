# R2 brief — core/domain/workflow/write/storage unit tests

## Assignment

Invoke `/supervise` and complete units u07–u12 after R1 and R6 are integrated. Own every ordinary unit test whose primary subject is base/domain/core/workflow/write/storage/event behavior, regardless of its current filename location. The board is read-only.

**Run branch:** `feature/test-r2-core-domain` from the coordinator-declared post-R1/R6 base
**Report:** `docs/coordinator/test-suite-rationalization/reports/r2-core-domain.md`
**Writable evidence:** `docs/coordinator/test-suite-rationalization/artifacts/r2/u07-domain.md` through `u12-review.md`

## In scope

- Ordinary unit tests for `src/base/**`, `src/domain/**`, `src/core/**`, workflow recipes/descriptors/tasks, write safety/authority/gates/receipts, stores/migrations/recovery/outbox/events, plus shared fixtures they uniquely own.
- Current files in root `tests/unit/` or `tests/unit/{domain,events,infra,scripts,workflows}` when their primary SUT matches this run.
- Duplicate assertions across these seams, fake-context theater, tautologies, tests incapable of failing, overly integrated tests better placed in R3/R5, and false filenames/titles.

## Out of scope

- Architecture, dashboard, parity, scenario, or primary server/BFF/runtime/worker tests; product behavior changes; thresholds/exclusions; board and final canonical taxonomy docs.

## Required method and evidence

- Begin with an exact owned-file ledger so R3 ownership is unambiguous. A file whose primary SUT is server/runtime/worker is R3 residue, not an opportunistic edit.
- For every retained test: unique contract/risk, cheapest adequate layer, failure condition, negative-control/equivalent proof.
- For every delete/merge/move: retained owner, exact equivalence, red-capable mutation or cannot-fail proof, imports/config/path updates, and before/after runtime.
- Prefer production contract examples and shared fixture data over assertion-mirroring fixtures. A mock interaction is not behavior unless the interaction itself is the contract.
- Preserve write authority, fail-loud, provenance, receipt, recovery, ordering/idempotency, and concurrency risks.
- Audit output while running the owned family: every case must surface project/suite, file, and full behavior/refusal title; long or multi-stage harnesses need stable named phases whose failures include actionable non-secret context. Capture expected diagnostics in assertions; do not globally suppress output.
- Independent final review across correctness, silent failures, performance, tests, docs, security, and repository standards.

## Exit gate

Focused changed-family tests, the full ordinary-unit project, `npm run typecheck`, `npm run lint`, applicable architecture guards, manifest/roadmap checks, `git diff --check`; representative labeled green progress and controlled actionable-red output; clean worktree and exact report. Do not merge the coordinator branch or edit the board. Surface `NEEDS COORDINATOR` for any unique-risk deletion or guarantee tradeoff.
