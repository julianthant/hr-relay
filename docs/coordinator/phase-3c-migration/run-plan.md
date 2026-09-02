# Run plan — Phase 3c workflow migration — 2026-09-02

| Run | Theme | Units | Worker roles | Base | Integration order | Parallel-ready | Needs first | Exit evidence |
|---|---|---|---|---|---|---|---|---|
| R1 | D311 workflow recipe/compiler | u01–u06 | supervisor + native Luna/Terra tree | `414d77b8` | 1 | yes, with R2 only | — | equivalence/conformance green, obsolete path deleted, full gates, report |
| R2 | Order 1 workflow-specific intake | u10–u12 | supervisor + read-only Scout/Analyst as needed | `414d77b8` | 2 | yes, with R1 only | — | two migration docs, verified reuse/provenance/live map, no compiler-dependent code |
| R3 | D312–D316 authoring/runtime foundation | u15–u19 | supervisor + native Luna/Terra tree | integrated R1+R2 | 3 | no | R1, R2 | four-artifact guard, closed entry algebra, whole-step admission, two recovery modes, final equivalence/deletion proof |
| R4 | Order 1 Search/Match modes + I-9 lookup | u20–u24 | supervisor + native Luna/Terra tree | integrated R3 | 4 | no | R3 | recipes/store/tasks, mode capability, T1/T2/T3, live dry runs, capability closure |
| R5 | Order 2 download workflows | u30–u35 | supervisor + native Luna/Terra tree | integrated R4 | 5 | no | R4 | three workflows, stores, immutable bytes route/viewer, T1/T2/T3/live proof |
| R6 | Order 3 OCR pipeline | u40–u44 | supervisor + native Luna/Terra tree | integrated R5 | 6 | no | R5 | OCR recipe, Review capability, T1/T2/T3/live proof |
| R7 | Order 4 oath signature + emergency contact | u50–u54 | supervisor + native Luna/Terra tree | integrated R6 | 7 | no | R6 + exact write targets | fan-out/gates, controlled proof, T1/T2/T3, closure |
| R8 | Order 5 I-9 check | u60–u64 | supervisor + native Luna/Terra tree | integrated R7 | 8 | no | R7 | coordinator/join, workbook projector/export, T1/T2/T3/live proof |
| R9 | Order 6 work-study + Kronos pay rule | u70–u74 | supervisor + native Luna/Terra tree | integrated R8 | 9 | no | R8 + exact write targets | write tasks/recipes, EID audit, controlled proofs, T1/T2/T3 |
| R10 | Order 7 oath upload + OnBase | u80–u84 | supervisor + native Luna/Terra tree | integrated R9 | 10 | no | R9 + completion probe targets | stores, receipt/proof arms, controlled proofs, T1/T2/T3 |
| R11 | Order 9 onboarding | u90–u94 | supervisor + native Luna/Terra tree | integrated R10 | 11 | no | R10 + exact hire canary | no-EID probe, roster ingest, controlled proof, T1/T2/T3 |
| R12 | cross-cutting closure + phase proof | u100–u105 | supervisor + native Luna/Terra tree | integrated R11 | 12 | no | R11 | cross-cutting capabilities disposed, zero-open capability audit, full integrated gates |

## Supervisor wave ledger

| Run | Task id / corrections | Host id | Project id | Launch title/time | Worktree/branch | Report | Status | Last cursor |
|---|---|---|---|---|---|---|---|---|
| R1 | setup client `client-new-thread:c1cc491a-c7e5-4dea-a20d-d8ad03a19528` → canonical `01a0644f-936c-7d72-8fbc-12a04b527b3e` | `local` | `e23dea50-674d-4a39-ad94-49fcff726de8` | `Phase 3c R1 — Workflow Recipe Compiler` / 2026-09-02 15:48 PDT | `/Users/julianhein/.codex/worktrees/359c/hr-automation-rebuild`; `feature/03c-r1-workflow-recipe` | `reports/r1-workflow-recipe.md` | authority reconciled at `7c1a43c6`; focused typecheck/lint/36 tests green; cleaning three worker worktrees before full gates | `ad4befac-fbcb-4e31-be1a-0a893e4558b7:74` |
| R2 | setup client `client-new-thread:cde8bb1e-1a7b-498f-b36a-a3fefe4457b1` → canonical `01a0644f-936c-7d72-8fbc-128e5f1b1a47` | `local` | `e23dea50-674d-4a39-ad94-49fcff726de8` | `Phase 3c R2 — Order 1 Migration Intake` / 2026-09-02 15:48 PDT | `/Users/julianhein/.codex/worktrees/28d9/hr-automation-rebuild`; `feature/03c-r2-order1-intake` | `reports/r2-order1-intake.md` | D312–D316 amendments committed `e1a55921`; three focused reviews running | `c6ef543f-98f6-45fa-83a2-844ba655e479:56` |
| R3 | not dispatched | — | `e23dea50-674d-4a39-ad94-49fcff726de8` | `Phase 3c R3 — Authoring Runtime Foundation` / pending | fresh worktree; `feature/03c-r3-authoring-runtime` | `reports/r3-authoring-runtime.md` | briefed; blocked on verified integration of R1+R2 | none |
| R4–R12 | not briefed | — | — | — | fresh worktree per run | unique report per run | blocked/planned | none |

## Units

### u01 — public-equivalence characterization
- Scope: current descriptor/module/registry/wire behavior for person lookup and separations.
- Acceptance: red-capable equivalence fixtures that pin public behavior without freezing implementation trivia.
- Dependency: none.
- Role: supervisor-owned judgment with Terra test seams.
- Mode: R1 only.
- Artifact: `reports/r1-workflow-recipe.md`.
- Review: correctness and test-quality.

### u02 — recipe and compiler contracts
- Scope: `defineWorkflowRecipe`, ordered tuple groups, typed task/parallel/delegate/gate/transaction entries, typed reference dependency derivation, existing descriptor/module outputs.
- Acceptance: strict validation of duplicate tasks, unresolved references, cycles and unstable group keys; no second runtime or durable format; explicit consequential behavior rather than hidden compiler inference.
- Dependency: u01.
- Role: supervisor main seam.
- Mode: R1 only.
- Artifact: R1 branch.
- Review: architecture, correctness, silent failures.

### u03 — person-lookup conversion
- Scope: smallest recipe conversion and exact generic projection equivalence.
- Acceptance: old public behavior unchanged; order-0 T1 pair completed where compatible with R1.
- Dependency: u02.
- Role: Terra.
- Mode: R1 only.
- Artifact: R1 branch.
- Review: correctness/tests.

### u04 — separations conversion
- Scope: complete recipe conversion including the D307→D313 whole-step transition, pre-start validated supplied outputs, separate visible verification tasks, conditional D309 gate, transactions, receipts, screenshots/logs and write safety.
- Acceptance: existing public behavior remains equivalent except for the ratified whole-step semantics; checkpoint resume and restart-from-start preserve completed writes and receipts without re-execution.
- Dependency: u02, u03.
- Role: supervisor main hard seam with Terra support.
- Mode: R1 only.
- Artifact: R1 branch.
- Review: correctness, security/write safety, silent failures.

### u05 — generic projections and Explorer
- Scope: tuple groups to current run modal/timeline/detail/Explorer projections.
- Acceptance: registry-wide conformance against every registered recipe.
- Dependency: u02–u04.
- Role: Terra; `/ui` required for visible behavior.
- Mode: R1 only; avoid session-panel seam.
- Artifact: R1 branch.
- Review: UI correctness/accessibility plus contract parity.

### u06 — single-authority deletion and integrated proof
- Scope: remove superseded manual declarations and duplicate generic-dashboard tests; regenerate manifests/docs.
- Acceptance: no second authoring path remains; Person Lookup and Separations meet hard equivalence; grouping/run-option changes touch one recipe; a reuse-only workflow fits recipe + structural scenario + live/dry-run manifest + migration record; all profile gates green; clean branch and report.
- Dependency: u01–u05.
- Role: supervisor integration.
- Mode: R1 only.
- Artifact: `reports/r1-workflow-recipe.md`.
- Review: deletion test, repository standards, docs.

### u10 — Order 1 migration decisions
- Scope: workflow-specific §b deltas for person-lookup Search/Match and I-9 lookup.
- Acceptance: create `docs/migrations/person-lookup.md` and `docs/migrations/i9-lookup.md`; cite inherited policy and name only real unresolved `you:` lines.
- Dependency: none; do not assume unlanded compiler details.
- Role: supervisor/Analyst.
- Mode: parallel-safe with R1.
- Artifact: R2 branch plus `reports/r2-order1-intake.md`.
- Review: spec fidelity.

### u11 — reuse/provenance and live map
- Scope: classify REUSE/CUSTOMIZE/BUILD against ref stores; inspect legacy as frozen data; live-verify I-9 login/page-state/selectors read-only.
- Acceptance: exact source provenance, driver/task inventory, scenario matrix and fail-loud unknowns without secrets.
- Dependency: none.
- Role: Scout/Analyst under supervisor.
- Mode: parallel-safe with R1.
- Artifact: `research/r2-order1-reuse-map.md`.
- Review: evidence authority.

### u12 — R3-ready implementation brief facts
- Scope: precise seams, canary needs, T1 and mode T2/T3 cases, capability entries for the Order 1 run now numbered R4.
- Acceptance: report separates facts from operator choices and contains no compiler-dependent implementation.
- Dependency: u10, u11.
- Role: supervisor synthesis.
- Mode: parallel-safe with R1.
- Artifact: `reports/r2-order1-intake.md`.
- Review: completeness.

### u15 — strict four-artifact authoring guard
- Scope: enforce D312's exact workflow-specific artifact budget for reuse-only workflows, with generated descriptor/module/registry/projection outputs and no escape hatch.
- Acceptance: a conforming fixture stays at recipe + structural scenario + live/dry-run declaration + migration record; forbidden manual glue and workflow-keyed generic dashboard adapters fail red-capable guards.
- Dependency: integrated R1 compiler and R2 intake.
- Role: supervisor-owned architecture judgment with Terra guard/test seam.
- Mode: R3 only.
- Artifact: R3 branch and `reports/r3-authoring-runtime.md`.
- Review: architecture, correctness, test quality.

### u16 — closed recipe entry algebra
- Scope: compile stable-id `task | parallel | delegate | gate | transaction` entries into existing runtime nodes; explicit join/failure, child-run and authority policies.
- Acceptance: registry-wide conformance covers every entry kind; compiler never infers consequential control semantics; failed parallel leaves retry independently.
- Dependency: u15 and integrated R1.
- Role: supervisor main hard seam with Terra support.
- Mode: R3 only.
- Artifact: R3 branch.
- Review: correctness, concurrency/recovery, write safety.

### u17 — whole-step omission admission
- Scope: implement D313 at the recipe, start-plan, run-modal wire/UI and executor seams; all replacement values are complete and schema-valid before start; omitted tuple runs no entries; mandatory verification is a separate selected entry.
- Acceptance: missing/invalid values refuse before plan/effects, no worker mid-run prompt exists, operator-asserted provenance survives retry/fan-out, and D307 remains only as historical pre-conversion evidence.
- Dependency: u16.
- Role: supervisor cross-layer judgment plus Terra backend/UI seams; `/ui` required for visible work.
- Mode: R3 only; avoid the external session-panel seam.
- Artifact: R3 branch.
- Review: correctness, security/write safety, UI/a11y, silent failures.

### u18 — two recovery modes without repeat writes
- Scope: implement D314 Resume from checkpoints and Restart from start as next attempts of the same logical item, preserving canonical input/omissions and durable transaction proof.
- Acceptance: restart reruns reads/computes, never re-enters prepare/commit for completed writes, probes unfinished intents first, rejects fresh-fact/write-proof mismatch, and keeps unknown writes on evidence-resolution paths only.
- Dependency: u16.
- Role: supervisor main hard seam with Terra recovery tests/UI support; `/ui` required for visible work.
- Mode: R3 only; avoid the external session-panel seam.
- Artifact: R3 branch.
- Review: recovery correctness, idempotency, write safety, UI/a11y.

### u19 — D316 final equivalence and deletion acceptance
- Scope: reconcile Person Lookup and Separations to D312–D315, expose tuple groups in generic surfaces, delete superseded authoring machinery, regenerate manifests/docs.
- Acceptance: public descriptor/module/wire equivalence; one-recipe grouping/options mutation proof; exact four-artifact reuse fixture; full profile gates green; clean branch/report and no worker/worktree residue.
- Dependency: u15–u18.
- Role: supervisor integration and consequential review.
- Mode: R3 only.
- Artifact: `reports/r3-authoring-runtime.md`.
- Review: deletion test, architecture, correctness, write safety, docs.

## Decisions gating runs

- `decisions/2026-09-02-read-only-t1-live-proof.md` item 1 → R4.
- Actual external writes in R7/R9/R10/R11 require exact target, reversibility/disposition and stop condition; prepare a decision sheet only when the preceding intake returns concrete options.
- OnBase completion arm remains blocked without a real probe target; do not infer `unverifiableByPage`.

## Date or external gates

- Live canary availability is rechecked on the day of each dry run; gone/unknown/consumed blocks before browser start.
- The external session-panel branch must be received before any Phase 3c UI run touches the same files or parity states.

## Residue carried in

- Phase 3b R4e/R4f controlled proof remains owned by `docs/coordinator/separations-completion/` and does not block read-only Phase 3c R1/R2.
