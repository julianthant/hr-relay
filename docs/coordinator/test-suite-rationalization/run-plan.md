# Run plan — test-suite rationalization — 2026-09-02

**Coordination UUID:** `f24df892-5171-48f4-97ff-4e91490f8622` (`Cf24df892`)
**Coordinator:** task `01a064e2-c3cf-7422-90c7-1dce60d194e5` / host `local` (continued from `01a064c1-e4ef-7bc0-bcd7-0329b5dfd357`); checkout `/Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/test-suite-rationalization-f24df892-coordinator`
**Current integration base:** `fce226ca` on `feature/test-suite-rationalization`
**Current capacity:** two supervisor worktrees while the unrelated Phase 3c worktree and this coordinator checkout occupy the other two auxiliary slots

| Run | Theme | Units | Worker roles | Base | Integration order | Parallel-ready | Needs first | Exit evidence |
|---|---|---|---|---|---:|---|---|---|
| R1 | Architecture guards and static/type/lint gates | u01–u06 | Scout/Analyst/Terra | kickoff commit | 1 | yes, Wave 1 with R6 | — | self-contained architecture gate, correct static project wiring, evidence/report |
| R6 | Playwright parity, performance, smoke, Duo, generated checks | u31–u36 | Scout/Analyst/Terra | kickoff commit | 2 | yes, Wave 1 with R1 | — | parity/check-family inventory, retained-risk evidence, focused gates/report |
| R2 | Core/domain/workflow/write/storage unit tests | u07–u12 | Scout/Analyst/Terra | `a638e8c3543199f9baa93e18113ec4eeb716bdb5` | 3 | yes, Wave 2A with R4 | R1, R6 cleared at `37c080bc` | audited non-server/non-dashboard unit family, focused and full-family gates/report |
| R4 | Dashboard model/jsdom/component tests versus parity/T2 | u19–u24 | Scout/Analyst/Terra | `a638e8c3543199f9baa93e18113ec4eeb716bdb5` | 4 | yes, Wave 2A with R2 | R1, R6 cleared at `37c080bc` | jsdom/pure-model split, overlap evidence, focused gates/report |
| R3a | Server/BFF/runtime tests and real-port hermeticity | u13, u14, u16 | Scout/Analyst/Terra | latest integrated R2+R4 base | 5 | yes, Wave 2B with R5a | R1, R6, R2, R4 integration | active-port reproduction/repair, isolated runtime evidence, focused gates/report |
| R5a | Scenario inventory, T1 structure, and T1b authority | u25, u26, u29 | Scout/Analyst/Terra | latest integrated R2+R4 base | 6 | yes, Wave 2B with R3a | R1, R6, R2, R4 integration | complete scenario inventory, T1/T1b truth, focused gates/report |
| R3b | Worker/session tests plus server-family consolidation/review | u15, u17, u18 | Scout/Analyst/Terra | after R2+R4+R3a | 7 | yes, Wave 3 with R5b | R2, R4, R3a | worker/lease audit, cross-layer consolidation, active-port full gate/report |
| R5b | Scenario walks, dashboard scenarios, layout/review | u27, u28, u30 | Scout/Analyst/Terra | after R2+R4+R5a | 8 | yes, Wave 3 with R3b | R2, R4, R5a | T2/T3/walk evidence, final scenario layout, gates/report |
| R7 | Cross-family reorganization, consequential review, authorities, close proof | u37–u42 | Analyst/Terra | after R1–R6 | 9 | no, serial final run | R1–R6 | canonical taxonomy, all authorities reconciled, every final gate + delta/runtime evidence |

## Supervisor wave ledger

| Run | Task id / corrections | Host id | Project id | Launch title/time | Worktree/branch | Report | Status | Last cursor |
|---|---|---|---|---|---|---|---|---|
| R1 | setup `client-new-thread:81effb1a-9f30-41f9-bbab-20f5426d6661` → reconciled exact task `01a0645c-1e13-7581-8a20-67314a86e195` from unique project/title/prompt/worktree/session match | `local` | `e23dea50-674d-4a39-ad94-49fcff726de8` | `R1 — architecture and static gates` / 2026-09-02 16:01 PDT | removed `/Users/julianhein/.codex/worktrees/eb84/hr-automation-rebuild`; deleted `feature/test-r1-architecture-static`; merged as `81e6f3c3` | `reports/r1-architecture-static.md` | closed; exact task archived | final received |
| R6 | setup `client-new-thread:038fb57d-1f1e-48f2-a16a-fb4f27dc896a` → reconciled exact task `01a0645c-1e18-7d70-9dfc-c7fb53fa0b66` from unique project/title/prompt/worktree/session match | `local` | `e23dea50-674d-4a39-ad94-49fcff726de8` | `R6 — parity performance and generated checks` / 2026-09-02 16:01 PDT | removed `/Users/julianhein/.codex/worktrees/b4ef/hr-automation-rebuild`; deleted `feature/test-r6-parity-checks`; merged as `9d87f512` | `reports/r6-parity-checks.md` | closed; exact task archived | final received |
| R2 | setup `client-new-thread:4dbea5c6-5359-40e1-8326-bcad7dd18cb9` → exact task `01a064e5-e38c-7e31-9f3c-90d108a186cd` from coordination/run/prompt/path match | `local` | `e23dea50-674d-4a39-ad94-49fcff726de8` | `Supervisor · test-suite-rationalization · Cf24df892 · R02 · core-domain units` / 2026-09-02 | removed `/Users/julianhein/.codex/worktrees/0b41/hr-automation-rebuild`; deleted `feature/test-r2-core-domain`; `4459949c` merged `--no-ff` as `3525acc3` | `reports/r2-core-domain.md` · family 82 files/1,156 cases; focused 5/5; type/lint/architecture/generated/diff PASS | closed; exact task archived | final received |
| R4 | setup `client-new-thread:f5dcfc06-a97d-4f88-8e3b-a10f43c7fd76` → exact task `01a064e5-e38c-7e31-9f3c-90b4c4c41b6f` from coordination/run/prompt/path match | `local` | `e23dea50-674d-4a39-ad94-49fcff726de8` | `Supervisor · test-suite-rationalization · Cf24df892 · R04 · dashboard tests` / 2026-09-02 | removed `/Users/julianhein/.codex/worktrees/c24a/hr-automation-rebuild`; deleted `feature/test-r4-dashboard`; `e9dbf53a` merged `--no-ff` as `fce226ca` | `reports/r4-dashboard.md` · dashboard 103 files/1,050 cases; focused 4 files/37 cases; T2/parity/coverage/static gates PASS | closed; exact task archived | final received |
| R3a | pending exact task on launch | `local` | `e23dea50-674d-4a39-ad94-49fcff726de8` | `Supervisor · test-suite-rationalization · Cf24df892 · R03a · server runtime` / pending | `feature/test-r3a-server-runtime` from reservation commit · allowance 1 | `reports/r3a-server-runtime.md` | reserved | none |
| R5a | pending exact task on launch | `local` | `e23dea50-674d-4a39-ad94-49fcff726de8` | `Supervisor · test-suite-rationalization · Cf24df892 · R05a · scenario authority` / pending | `feature/test-r5a-scenario-authority` from reservation commit · allowance 1 | `reports/r5a-scenario-authority.md` | reserved | none |
| R3b | — | — | — | — | `feature/test-r3b-worker-review` | `reports/r3b-worker-review.md` | planned | none |
| R5b | — | — | — | — | `feature/test-r5b-scenario-review` | `reports/r5b-scenario-review.md` | planned | none |
| R7 | — | — | — | — | `feature/test-r7-integration-review` | `reports/r7-integration-review.md` | planned | none |

## Units

### R1 — architecture guards and static/type/lint gates

- **u01 — Inventory every guard and static gate.** Scope: architecture tests/helpers/fixtures, guard inventory, TypeScript/ESLint/Vitest wiring. Acceptance: per-file contract, owner, negative control, overlap, cost, and truthfulness table at `artifacts/r1/u01-inventory.md`. Role: Scout/Analyst. Review: correctness + guard coverage.
- **u02 — Remove the legacy-checkout gate dependency.** Scope: architecture inputs that read outside this repo. Acceptance: required facts frozen in-repo with provenance; list, architecture, typecheck, lint work with no override and with the legacy checkout unavailable; evidence `artifacts/r1/u02-self-contained.md`. Role: Terra. Review: cross-repo safety + silent failures.
- **u03 — Correct Vitest project and architecture membership.** Scope: `vitest.config.ts`, architecture script semantics, duplicate project collection. Acceptance: named/addressable architecture project with exact bidirectional membership and no accidental duplicate coverage execution; evidence `artifacts/r1/u03-projects.md`. Role: Terra. Review: configuration + performance.
- **u04 — Audit TypeScript, ESLint, and generated/static check scope.** Scope: tsconfig, ESLint config/command, generator check entry points. Acceptance: every intended source/test/script is checked once at the correct layer; violating fixtures/commands prove exclusions cannot silently widen; evidence `artifacts/r1/u04-static-gates.md`. Role: Analyst/Terra. Review: silent failures.
- **u05 — Rationalize guard assertions and naming.** Scope: architecture files only. Acceptance: every retain/delete/move/merge row has unique invariant and red-capable/equivalence proof; filenames/titles state behavior/refusal; evidence `artifacts/r1/u05-changes.md`. Role: Terra. Review: correctness + tests.
- **u06 — Consequential R1 review and gate.** Scope: whole R1 diff. Acceptance: independent correctness, repository-standard, silent-failure, performance, test, docs, and security review; focused red/green plus architecture/type/lint/manifest/roadmap/diff gates; evidence `artifacts/r1/u06-review.md`. Role: Analyst/Terra reviewer.

### R2 — core/domain/workflow/write/storage unit tests

- **u07 — Domain/contracts/model units.** Primary SUTs under `src/base/**` and `src/domain/**`, excluding server/dashboard/runtime-worker ownership. Acceptance artifact `artifacts/r2/u07-domain.md`.
- **u08 — Workflow recipe/compiler/task units.** Primary SUTs under workflow authoring, descriptors, tasks, graphs, omissions, and provenance. Acceptance artifact `artifacts/r2/u08-workflows.md`.
- **u09 — Core planning/execution/commands/projections units.** Primary SUTs under `src/core/**`, excluding server/runtime process composition. Acceptance artifact `artifacts/r2/u09-core.md`.
- **u10 — Write authority/gates/receipts/fail-loud units.** Transactions, mutation capability, sequencer, identity/approval, receipts, refusal arms. Acceptance artifact `artifacts/r2/u10-write.md`.
- **u11 — Storage/migrations/recovery/outbox/events units.** Authority stores, SQLite/file stores, journal/recovery/dedupe/outbox/event behavior. Acceptance artifact `artifacts/r2/u11-storage.md`.
- **u12 — Cross-seam unit consolidation and review.** Resolve duplicate fixtures/assertions, wrong-layer cases, false names, and family gate; keep a before/after inventory and negative-control table at `artifacts/r2/u12-review.md`.

### R3 — server/BFF/runtime/worker tests and real-port hermeticity

- **u13 — Server/BFF route and wire tests.** Routes, request identity, schemas, SSE/download/error semantics. Acceptance artifact `artifacts/r3/u13-bff.md`.
- **u14 — Runtime/CLI/process composition tests.** Startup, shutdown, config admission, process edges, runtime ownership. Acceptance artifact `artifacts/r3/u14-runtime.md`.
- **u15 — Worker/session/lease/concurrency tests.** Worker pool, claims, sessions, Duo lease boundaries, teardown/soak. Acceptance artifact `artifacts/r3/u15-workers.md`.
- **u16 — Real-port hermeticity.** Reproduce the active-dashboard collision, move tests to ephemeral/owned ports and isolated state without weakening production isolation checks, and prove the full gate passes while 3938/5174 remain legitimately occupied. Evidence `artifacts/r3/u16-ports.md`.
- **u17 — Layering/duplication/naming consolidation.** Compare server tests against core units and scenarios; remove only proven equivalence, relocate wrong-layer files, update imports/config. Artifact `artifacts/r3/u17-consolidation.md`.
- **u18 — Consequential R3 review and gate.** Independent axes review, leak/orphan checks, focused negative controls, full active-port coverage run, type/lint/diff. Artifact `artifacts/r3/u18-review.md`.

### R4 — dashboard model/jsdom/component tests versus parity/T2

- **u19 — Inventory dashboard test claims.** All `tests/unit/dashboard/**` plus dashboard-owned root unit files; identify pure-model, DOM wiring, visual, T2, and parity claims. Artifact `artifacts/r4/u19-inventory.md`.
- **u20 — Pure model tests.** Keep decision/data transforms in Node without jsdom; consolidate duplicated cases and fixtures. Artifact `artifacts/r4/u20-models.md`.
- **u21 — jsdom interaction/focus/wiring tests.** Require DOM only for dispatch, focus, lifecycle, and accessibility semantics that pure models cannot prove. Artifact `artifacts/r4/u21-jsdom.md`.
- **u22 — Parity/T2 overlap equivalence.** Consume R6 evidence; remove unit/component visual assertions only when parity/T2 uniquely owns the same claim, and retain lower-layer failure logic. Artifact `artifacts/r4/u22-overlap.md`.
- **u23 — Placement and truthful names.** Organize by capability, move/update imports safely, rewrite filenames/titles to behavior + failure condition. Artifact `artifacts/r4/u23-layout.md`.
- **u24 — Consequential R4 review and gate.** Focused red controls, jsdom count/runtime before/after, type/lint/dashboard unit/scenario/parity checks as applicable. Artifact `artifacts/r4/u24-review.md`.

### R5 — entire scenario corpus and proof provenance

- **u25 — Corpus/provenance inventory.** Map all 18 offline files and two live manifests to kind, subject, unique risk, source of truth, and claimed evidence. Artifact `artifacts/r5/u25-inventory.md`.
- **u26 — T1 structural workflow walks.** Enforce one honest structural pair per workflow, real graph paths, refusal/idempotency branches, no world claims; audit ordinary graph scenarios for ownership. Artifact `artifacts/r5/u26-t1.md`.
- **u27 — Ordinary graph scenarios and integration walks.** Test slice-crossing joins only where cheaper units cannot, use realistic branches, remove cannot-fail/duplicate walks, preserve no-coverage-claim rule. Artifact `artifacts/r5/u27-walks.md`.
- **u28 — T2/T3 dashboard scenarios.** Distinguish projection/command authority from unit/parity; require both refusal arms; add/retain T3 only for unique run interaction claims. Artifact `artifacts/r5/u28-dashboard.md`.
- **u29 — T1b live manifests and coverage claims.** Audit manifest truth, unavailable/blocked states, exact no-write authority, live versus synthetic data, and stale coverage claims without running unauthorized live workflows. Artifact `artifacts/r5/u29-live.md`.
- **u30 — Scenario layout/naming/config review and gate.** Path-sensitive moves, imports/manifests/config/coverage guard updates, before/after corpus metrics, focused negative controls, type/lint/scenario/architecture gates. Artifact `artifacts/r5/u30-review.md`.

### R6 — Playwright parity, performance, smoke, Duo, generated checks

- **u31 — Parity inventory.** Map 17 specs/287 cases and every reference family to unique visual/a11y/wire risk, viewport/theme multiplication, and owner. Artifact `artifacts/r6/u31-parity.md`.
- **u32 — Parity equivalence and negative controls.** Prove which matrix cases are materially distinct, remove only equivalent coverage, preserve strict pixel/a11y/reference-pair authority; inspect screenshots for retained visual claims. Artifact `artifacts/r6/u32-equivalence.md`.
- **u33 — Performance checks.** Audit benchmark/test thresholds, fixture realism, warmup/noise, failure capability, and runtime cost. Artifact `artifacts/r6/u33-performance.md`.
- **u34 — Smoke and Duo checks.** Audit startup/document-number smoke, Duo extension/lease tests, generated or external-harness checks for correct offline/live classification and truthful triggers. Artifact `artifacts/r6/u34-smoke-duo.md`.
- **u35 — Runner/config/naming rationalization.** `playwright.parity.config.ts`, parity helpers/spec names, performance/smoke/generated entry points; no `package.json` edits in this parallel run—record script changes for R7. Artifact `artifacts/r6/u35-runner.md`.
- **u36 — Consequential R6 review and gate.** Independent axes review, exact before/after test/reference/runtime counts, parity full pass, relevant smoke/generated dry checks, type/lint/diff. Artifact `artifacts/r6/u36-review.md`.

### R7 — cross-family integration, reorganization, authorities, close proof

- **u37 — Reconcile every family inventory.** One before/after table with retain/delete/move/merge and unique purpose; no unowned deletion. Artifact `artifacts/r7/u37-reconciliation.md`.
- **u38 — Land final taxonomy/config/scripts.** Resolve cross-family duplicates and wrong-layer files; inventory every test added since kickoff; make paths, Vitest/Playwright projects, package scripts, lint/type/generated checks, and names truthful. Add executable topology enforcement so a future test is collected exactly once at its declared layer. Make one streaming default reporter show project/suite, file, and full behavior/refusal title while work runs; give long/genuinely multi-stage harnesses stable named phases without per-assertion chatter, duplicate output, or reduced parallelism. Artifact `artifacts/r7/u38-taxonomy.md`.
- **u39 — Consequential cross-family review.** Repository standards, originating objective, correctness, silent failures, performance, tests, docs, security, plus mutation/equivalence spot checks. Artifact `artifacts/r7/u39-review.md`.
- **u40 — Reconcile canonical test authorities.** Update paired root instructions, paired scenario instructions, guards-and-tests, guard inventory, and decision pointer/owning cross-repo contract for self-contained gates. Preserve byte-identical twins. Artifact `artifacts/r7/u40-authorities.md`.
- **u41 — Reconcile roadmap and generated authorities.** Update only truth that changed, regenerate roadmap/manifest as required, prove no stale docs/config. Artifact `artifacts/r7/u41-generated.md`.
- **u42 — Final proof and deltas.** From clean isolated state and no legacy override: typecheck, lint, coverage, architecture, parity, manifest, roadmap, diff; active-port hermeticity; coverage/suite/runtime deltas; report exact run-worker cleanup. Capture representative green output proving labels remain visible during execution and an intentional controlled red proving the exact failing project/file/test/phase is actionable without secret or unrelated noise. Measure labeled-reporter overhead against the comparable compact run and preserve the existing parallelism/isolation plus the ratified runtime targets. Artifact `artifacts/r7/u42-final-gates.md`.

## Decisions gating runs

- The 2026-09-02 eight-item test-policy gate is cleared by the operator's `all recommended` answer, decoded as `1 C · 2 B · 3 C · 4 C · 5 B · 6 B · 7 B · 8 B` and recorded on the board. R7/u40 must ratify the resulting normative contract and D191 change without recreating the operator-rejected Markdown question sheet.
- Wave 2 now runs as two capacity-safe pairs: integrate R2 then R4 from Wave 2A before branching Wave 2B's R3a and R5a from that latest base. The original integration order and unit ownership are unchanged.
- Any new guarantee weakening or unique-contract removal becomes a numbered operator decision before that unit proceeds.

## Date or external gates

- None. No live HR workflow is required. Local parity browser work is permitted; close every owned browser/server process.

## Residue carried in

- Prior 16-test real-port contention evidence → u16.
- Existing external legacy-checkout guard dependency → u02.
- Existing normative/project-layout drift between guards-and-tests §10.9 and current two-project Vitest config → u03/u38/u40.
- D91 branch-floor gap remains an explicit authority item, not an assumed threshold change → u04/u40.
