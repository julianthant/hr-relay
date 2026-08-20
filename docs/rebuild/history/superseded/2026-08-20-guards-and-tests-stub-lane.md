# The derived stub lane — a migration plan that was never ported (from `reference/guards-and-tests.md` §7)

_Folded out of `docs/rebuild/reference/guards-and-tests.md` on 2026-08-20 by the docs-cohesion rewrite
(unit `ref guards-and-tests`), after verifying it against the code. **The rebuild has no stub lane —
not partially, not at all.** `maybeWrapE2EStub`, `StepDataFn`, `stub-workflows.ts` and
`cloneWithScriptedSteps` exist only in the legacy repo (`legacy:src/core/e2e/stub-workflows.ts`,
gated by `HRAUTO_E2E_STUBS=1` at `legacy:src/core/workflow-loaders.ts:88`). In this tree
`HRAUTO_E2E_STUBS` appears in exactly one place — `src/domain/runtime-environment.ts`, as INVENTORY
metadata naming those legacy paths — and no `process.env.HRAUTO_E2E_STUBS` read exists in `src/` or
`tests/`. `defineTaskContract` does carry a mandatory `example` and self-validates it at seal time
(`src/domain/contracts/base.ts:474`), but no runtime module reads `.example` to substitute for a
task's output; it is contract self-check and fixture seed data only. So the classification is
SUPERSEDED (the lane was never ported), not TO-BUILD — the node map's own escape hatch, taken.
What replaces it: **every test that must RUN a workflow is a LIVE dry-run scenario**
(`reference/guards-and-tests.md` §10), which reads the real path against the real systems with
`dryRun=true` and proves durable absence rather than simulating a run that nothing real executed.
This file is the record of the plan as it stood._

## 7. Stub + live lanes on the new kernel

**Stub lane (`HRAUTO_E2E_STUBS=1`).** Today `maybeWrapE2EStub` clones a `RegisteredWorkflow`, sets
`systems: []`, and walks the real step list with a hand-written `StepDataFn` per workflow
(`stub-workflows.ts`), honoring file-based **hold gates** (park a run mid-step) and one-shot **fail
gates** (`E2EScriptedFailError` → terminal `failed` + Retry). Migration:

- **Minimal happy path becomes derived** (D3): the executor runs each descriptor's `nodes`, and each task's
  stub output is its contract's `example` (schema-parsed) instead of a hand-written `StepDataFn`. The
  hand-maintained per-workflow scripts disappear — the stub map is a descriptor projection
  (descriptor-coverage #(stub) covers it), so it can't drift from the real steps.
- **What `example` cannot express lives in the registered scenario corpus** (ref operator-trust): failure,
  cancel, subject mismatch, proof unknown, gate, delegation, retry, and parallel overlap are strict
  `ScenarioManifest`s with deterministic fixture drivers and timed control events. The existing
  file-based hold/fail-gate mechanism (`e2e-gates/`) remains an implementation primitive, not an
  unindexed parallel list. Ref execution-and-sessions §7's multi-worker scenario holds two workers simultaneously
  and asserts distinct worker ids plus span overlap (`maxConcurrentWorkers ≥ 2`).
- **Span-emitting workflows**: the stub daemon emits the same span/note events (ref dashboard-surfaces) a real run
  would, so native projection/BFF contracts and seeded dashboard fixtures are exercised without a
  browser. `oath-upload`-style real-handler-with-stubbed-legs cases port as test seams.

**Live lane (`tests/live/`, opt-in, never CI).** Ports as-is: real Chromium, real UCSD SSO, Duo
cleared hands-off by the enrolled WebAuthn credential (charter §9 — no phone step). Its safety
boundary is unchanged and is now *structural*: **`dryRun=true` = the submit task is not in the
   composition** (§3.1), so a live dry-run reads the real path and proves no commit span, fence,
   intent, or mutation call exists, with no possibility of an irreversible write — the write-safety contract (ref write-safety) only
ever engages on a real submit, which a dry-run composition doesn't contain. The dashboard headless
`playwright-cli` verification loop (root CLAUDE.md "Verifying dashboard changes") is unchanged: seed
a synthetic tracker dir → boot the real new-server dashboard → drive + assert on the a11y snapshot.
