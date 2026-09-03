# Run plan - Phase 3c authoring and acceptance - 2026-09-02

**Coordination UUID:** `57c2dec9-138e-4578-b5da-389ad9b4007a` · `C57c2dec9`
**Coordinator owner/channel:** Claude Code session `571dd99a-cd47-4529-adfe-a4bc7569c29a`
**Integration checkout:** `/Users/julianhein/Projects/hr-automation-rebuild` · `feature/03c-workflow-migration`

| Run | Theme | Units | Worker roles | Base | Integration order | Parallel-ready | Needs first | Exit evidence |
|---|---|---|---|---|---|---|---|---|
| R1 | D311 workflow recipe/compiler | u01–u06 | supervisor + native Luna/Terra tree | `414d77b8` | 1 | yes, with R2 only | — | equivalence/conformance green, obsolete path deleted, full gates, report |
| R2 | Order 1 workflow-specific intake | u10–u12 | supervisor + read-only Scout/Analyst as needed | `414d77b8` | 2 | yes, with R1 only | — | two migration docs, verified reuse/provenance/live map, no compiler-dependent code |
| R3 | D312–D318 authoring/runtime foundation (3c-A finish) — `Supervisor · phase-3c-migration · C57c2dec9 · R03 · authoring runtime foundation` | u15–u19 | Claude supervisor + `sup-opus` default / `sup-sonnet` trivial-only / `sup-scout` / `sup-analyst` | `cb9a1476` (integrated R1+R2+D317+D318+session panel) | 3 | no | — | workflow-only API, discoverable task catalog, four-artifact guard, closed entry algebra, whole-step admission, two recovery modes, D318 `live-read` arm + Person Lookup T1 pair, guide and final equivalence/deletion proof |
| R4 | 3c-B Person Lookup + Separations acceptance and Phase 3 close | u110–u113 | supervisor + native Luna/Terra tree | integrated R3 | 4 | no | R3 + explicit operator start | both acceptance workflows verified through generic surfaces and canonical T1; Phase 3 authorities reconciled; integrated gates and worktree sweep green |

**Active scope (operator, D319, 2026-09-02):** finish 3c-A in R3 without changing its brief. R4 is
the only possible next run, but it remains held until the operator explicitly starts 3c-B. No third
workflow is admitted. The old migration sequence is withdrawn before dispatch.

## Superseded pre-D319 run sequence

These rows preserve the earlier planning record; they are not runnable work and have no phase
assignment. A candidate returns only after the operator approves its complete D319 admission packet.

| Former run | Candidate evidence | Former units | Disposition |
|---|---|---|---|
| R4 | Search/Match + I-9 Lookup | u20-u24 | withdrawn before dispatch; Search/Match moved to Phase 3 acceptance, I-9 remains unnumbered |
| R5 | downloads | u30-u35 | withdrawn before dispatch |
| R6 | OCR pipeline | u40-u44 | withdrawn before dispatch |
| R7 | oath signature + emergency contact | u50-u54 | withdrawn before dispatch |
| R8 | I-9 check | u60-u64 | withdrawn before dispatch |
| R9 | work-study + Kronos pay rule | u70-u74 | withdrawn before dispatch |
| R10 | oath upload + OnBase | u80-u84 | withdrawn before dispatch |
| R11 | onboarding | u90-u94 | withdrawn before dispatch |
| R12 | cross-cutting closure | u100-u105 | withdrawn before dispatch; open capabilities remain a program backlog |

## Supervisor wave ledger

| Run | Task id / corrections | Host id | Project id | Launch title/time | Worktree/branch | Report | Status | Last cursor |
|---|---|---|---|---|---|---|---|---|
| R1 | setup client `client-new-thread:c1cc491a-c7e5-4dea-a20d-d8ad03a19528` → canonical `01a0644f-936c-7d72-8fbc-12a04b527b3e` | `local` | `e23dea50-674d-4a39-ad94-49fcff726de8` | `Phase 3c R1 — Workflow Recipe Compiler` / 2026-09-02 15:48 PDT | removed; branch removed | `reports/r1-workflow-recipe.md` | CLOSED: verified tip `31c3f9a5`, merge `a40276b6`/master containment `29186a31`, worktree/path/ref absent, reservation released, exact task archived | `ad4befac-fbcb-4e31-be1a-0a893e4558b7:124` |
| R2 | setup client `client-new-thread:cde8bb1e-1a7b-498f-b36a-a3fefe4457b1` → canonical `01a0644f-936c-7d72-8fbc-128e5f1b1a47` | `local` | `e23dea50-674d-4a39-ad94-49fcff726de8` | `Phase 3c R2 — Order 1 Migration Intake` / 2026-09-02 15:48 PDT | removed; branch removed | `reports/r2-order1-intake.md` | CLOSED: verified tip `ed9ee5ac`, merge `b1b36349`/master containment `29186a31`, worktree/path/ref absent, reservation released, exact task archived; T1 decision preserved | `c6ef543f-98f6-45fa-83a2-844ba655e479:78` |
| R3 | Claude Code local session `e266c808-2757-4057-838e-f540b7be6756` (short `e266c808`; `claude --bg` return value) | `local` (Claude Code `claude --bg`) | coordination `57c2dec9-138e-4578-b5da-389ad9b4007a` | `Supervisor · phase-3c-migration · C57c2dec9 · R03 · authoring runtime foundation` / 2026-09-02 17:43 PDT | `/Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/phase-3c-migration-c57c2dec9-r03-authoring-runtime`; `feature/phase-3c-migration-c57c2dec9-r03-authoring-runtime` | not written (session died first) | RETURNED PARTIAL / OVER CAP: 26 supervisor commits `8a931cc6..c1bdcf68` (u15–u18 + Person Lookup T1 pair + four harness `workflow.ts` conversions + grouping proof); session hit its context limit at 20:16 PDT mid review-fix with no report/handoff; coordinator safety-committed the ten in-flight files as `0566b181` (lint green, typecheck red on 5 test call sites) and ran `claude stop e266c808` at 20:21 PDT. Worktree/branch RETAINED for R3b; reservation still consumed. Not integrated. | none |
| R3b | Claude Code local session `7dee2c47-6aa6-45d2-924a-055be7523e30` (short `7dee2c47`) | `local` (Claude Code `claude --bg`) | coordination `57c2dec9-138e-4578-b5da-389ad9b4007a` | `Supervisor · phase-3c-migration · C57c2dec9 · R3b · stabilize` / 2026-09-02 20:23 PDT | same worktree/branch as R3, base `0566b181` | `reports/r3-authoring-runtime.md` | ACTIVE on the retained R3 worktree (reservation carried over; budget still 4/4 with three unrelated `feature/test-*` worktrees) | none |
| R4 | not briefed | — | — | — | fresh worktree after R3 closes and operator starts 3c-B | `reports/r4-phase-3-acceptance.md` | held for operator after R3 | none |

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

### u15 — workflow-only API, discoverable task catalog and strict four-artifact guard
- Scope: replace the transitional recipe vocabulary with D317's `workflow.ts` / `defineWorkflow` / `WorkflowDefinition` / `compileWorkflow` API without aliases; make the task-store catalog searchable by system, capability, effect, inputs and outputs; enforce D312's exact workflow-specific artifact budget for reuse-only workflows.
- Acceptance: no recipe-named compatibility API remains; a conforming fixture stays at workflow definition + structural scenario + live/dry-run declaration + migration record; forbidden manual glue and workflow-keyed generic dashboard adapters fail red-capable guards.
- Dependency: integrated R1 compiler and R2 intake.
- Role: supervisor-owned architecture judgment with Terra guard/test seam.
- Mode: R3 only.
- Artifact: R3 branch and `reports/r3-authoring-runtime.md`.
- Review: architecture, correctness, test quality.

### u16 — closed workflow entry algebra
- Scope: compile stable-id `task | parallel | delegate | gate | transaction` entries into existing runtime nodes; explicit join/failure, child-run and authority policies.
- Acceptance: registry-wide conformance covers every entry kind; compiler never infers consequential control semantics; failed parallel leaves retry independently.
- Dependency: u15 and integrated R1.
- Role: supervisor main hard seam with Terra support.
- Mode: R3 only.
- Artifact: R3 branch.
- Review: correctness, concurrency/recovery, write safety.

### u17 — whole-step omission admission
- Scope: implement D313 at the workflow definition, start-plan, run-modal wire/UI and executor seams; all replacement values are complete and schema-valid before start; omitted tuple runs no entries; mandatory verification is a separate selected entry.
- Acceptance: missing/invalid values refuse before plan/effects, no worker mid-run prompt exists, operator-asserted provenance survives retry/fan-out, and D307 remains only as historical pre-conversion evidence.
- Dependency: u16.
- Role: supervisor cross-layer judgment plus Terra backend/UI seams; `/ui` required for visible work.
- Mode: R3 only; avoid the external session-panel seam.
- Artifact: R3 branch.
- Review: correctness, security/write safety, UI/a11y, silent failures.

### u18 — two recovery modes without repeat writes, plus the D318 `live-read` T1b arm
- Scope: implement D314 Resume from checkpoints and Restart from start as next attempts of the same logical item, preserving canonical input/omissions and durable transaction proof; implement D318's `live-read` T1b declaration/runner arm (`ref guards-and-tests` §10.4) for transaction-free graphs with exact zero-delta write-authority assertions.
- Acceptance: restart reruns reads/computes, never re-enters prepare/commit for completed writes, probes unfinished intents first, rejects fresh-fact/write-proof mismatch, and keeps unknown writes on evidence-resolution paths only; `live-read` refuses a transaction-bearing graph, `dry-run-preview` refuses a transaction-free graph, and D209's `no-transaction-node` refusal is unchanged.
- Dependency: u16.
- Role: supervisor main hard seam with Terra recovery tests/UI support; `/ui` required for visible work.
- Mode: R3 only; avoid the external session-panel seam.
- Artifact: R3 branch.
- Review: recovery correctness, idempotency, write safety, UI/a11y.

### u19 — D316/D317 final equivalence, guide and deletion acceptance
- Scope: reconcile Person Lookup and Separations to D312–D317, expose tuple groups in generic surfaces, delete superseded authoring machinery, write `docs/guides/workflow-authoring.md` plus the concise paired root rules and one internal agent reference, and regenerate manifests/docs.
- Acceptance: public descriptor/module/wire equivalence; one-workflow grouping/options mutation proof; exact four-artifact reuse fixture; Person Lookup's canonical T1 pair at `tests/scenario/workflows/person-lookup/` with its `live-read` T1b executed live and recorded; the finished guide authors both acceptance workflows without an undocumented escape hatch; full profile gates green; clean branch/report and no worker/worktree residue.
- Dependency: u15–u18.
- Role: supervisor integration and consequential review.
- Mode: R3 only.
- Artifact: `reports/r3-authoring-runtime.md`.
- Review: deletion test, architecture, correctness, write safety, docs.

### u110 - accept Person Lookup
- Scope: verify the final compiled workflow, Search + Match run-modal behavior, grouped timeline/Explorer projection and canonical structural plus D318 live-read T1 pair.
- Acceptance: no workflow-specific dashboard glue and no unresolved acceptance failure.
- Dependency: integrated R3.
- Review: correctness, UI/accessibility and proof quality.

### u111 - accept Separations
- Scope: verify final compiled workflow options, omission admission, grouped timeline/Explorer projection, screenshots/logs/receipts and recovery behavior.
- Acceptance: Phase 3c acceptance passes without claiming Phase 3b's still-open controlled-live write proof.
- Dependency: integrated R3.
- Review: correctness, write safety, UI/accessibility and proof quality.

### u112 - reconcile Phase 3 authorities
- Scope: reconcile doc 03c, roadmap, D319, capability ownership and author guidance to the verified R3/R4 result.
- Acceptance: every non-admitted workflow is visibly unnumbered and no old R4-R12 execution promise remains active.
- Dependency: u110-u111.
- Review: plan/spec cohesion.

### u113 - integrated close and sweep
- Scope: run the profile's integrated gates, merge verified work, sweep owned worktrees/branches/tasks and close the board.
- Acceptance: green gates, clean integration tree and no owned residue; no remote push.
- Dependency: u112.
- Review: final proof.

## Decisions gating runs

- `decisions/2026-09-02-read-only-t1-live-proof.md` item 1 → answered A, ratified as D318 at `cb9a1476`; implementation is u18/u19 (R3) and the Order 1 live halves are R4.
- D319 admits no workflow after Person Lookup and Separations. Candidate-specific writes, selectors,
  probes and UI capabilities are not run gates until their candidate is selected, verified and
  approved as a new numbered phase.

## Date or external gates

- Live canary availability is rechecked on the day of each dry run; gone/unknown/consumed blocks before browser start.
- Session-panel behavior is already integrated at `49dc1529`; any R3 UI work preserves it and uses `/ui` plus the parity lane.

## Residue carried in

- Phase 3b R4e/R4f controlled proof remains owned by `docs/coordinator/separations-completion/` and does not block read-only Phase 3c R1/R2.
