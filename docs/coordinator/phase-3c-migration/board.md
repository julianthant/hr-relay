# Board — Phase 3c workflow migration

**Project profile:** `project-profile.md`
**Coordination UUID:** `57c2dec9-138e-4578-b5da-389ad9b4007a` · `C57c2dec9`
**Work key:** `phase-3c-migration`
**Coordinator title:** `Coordinate · phase-3c-migration · C57c2dec9 · workflow migration`
**Coordinator session:** Claude Code `571dd99a-cd47-4529-adfe-a4bc7569c29a`
**Coordinator checkout:** `/Users/julianhein/Projects/hr-automation-rebuild` · `feature/03c-workflow-migration`
**Integration target:** `feature/03c-workflow-migration`, recreated from local `master` at `1867c78b6ff9f2ffc891e94aa1394bd7ff3bb642`; tip `cb9a1476` carries the D318 ratification
**Board owner:** coordinator
**Write rule:** coordinator only; supervisors and workers read only
**Last verified:** 2026-09-02 17:40 PDT at `cb9a1476`

## Facts every run needs

- Local `master` merged `feature/03b-live-close` with `--no-ff` at `414d77b8`; no remote push occurred.
- Phase 3b's R4e/R4f controlled-live proof remains open and is not a Phase 3c completion claim.
- D311's compiler seam is the plan-owned prerequisite to orders 1–7 and 9. Person Lookup and Separations are its exact equivalence fixtures.
- The operator ratified D312–D316 at `1273c360` and D317 at `dee89c72`: exact four-artifact workflow authoring; complete pre-start whole-step omission values; checkpoint resume plus restart-from-start without repeated completed writes; explicit `task | parallel | delegate | gate | transaction` entries; hard Person Lookup + Separations deletion acceptance; and `workflow.ts` / `defineWorkflow` / `WorkflowDefinition` terminology with no recipe compatibility alias.
- Orders retain the risk/reuse sequence 1, 2, 3, 4, 5, 6, 7, 9. No later order begins implementation before its declared predecessor is integrated unless the plan marks the work cross-cutting and the paths/authority are disjoint.
- The phase owns thirteen remaining workflow migrations, the reconciled 46 open / 19 replaced / 6 native / 7 retired capability baseline at `1867c78b`, generic workflow/dashboard conformance, per-workflow T1, and T2/T3 only for genuinely new UI behavior.
- D318 (`cb9a1476`) resolves read-only T1: a transaction-free graph proves T1b through the explicit `live-read` arm with `dryRun=false` and exact zero write-authority deltas; D209 is unchanged. `ref guards-and-tests` §10.4 is primary.
- Live reads and dry runs are pre-authorized. Every actual external write still needs an exact operator-approved target/disposition.
- The operator's session-panel work is integrated at `49dc1529` within master merge `29186a31`; preserve it as existing behavior.

## Decisions ratified

- 2026-09-02 18:1x PDT · operator instruction in coordinator session `571dd99a` ("okay just do phase 3c A here") → this coordination's active scope is the **3c-A exit gate only** (R3). R4–R12 stay planned and briefable but are NOT dispatched under this instruction; the final `master --no-ff` merge and Phase 3c close wait for a later operator instruction. Owner: this board + `run-plan.md`.

- 2026-09-02 · sheet `decisions/2026-09-02-read-only-t1-live-proof.md` item 1 → **A** (live execution manifest with `dry-run-preview` / `live-read` arms) → D318 in `docs/rebuild/reference/decisions.md`, normative text in `ref guards-and-tests` §10.4, at `cb9a1476`.

## Unit ledger

| Unit | Run | Status | Integration evidence | Gate evidence | Review | Notes |
|---|---|---|---|---|---|---|
| u01–u06 | R1 | closed 2026-09-02 | branch tip `31c3f9a5`; merge `a40276b6`, contained by master merge `29186a31`; supervisor worktree/branch removed; exact task `01a0644f-936c-7d72-8fbc-12a04b527b3e` archived | typecheck/lint, 393 files/4,853 coverage tests, parity 287/287, manifest/roadmap/diff/twins PASS | complete; six findings resolved | bounded D311 compiler complete; D312–D317 successor remains R3 |
| u10–u12 | R2 | closed 2026-09-02 | branch tip `ed9ee5ac`; merge `b1b36349`, contained by master merge `29186a31`; supervisor worktree/branch removed; exact task `01a0644f-936c-7d72-8fbc-128e5f1b1a47` archived | typecheck, lint, roadmap freshness, diff check PASS; three focused re-reviews Count 0 | complete | Order 1 intake/live provenance complete; read-only T1 decision and fresh I-9 canary remain explicit residue |
| u15–u19 | R3 | dispatched 2026-09-02 (see run plan wave ledger) | base `cb9a1476`; worktree `.hr-rebuild-worktrees/phase-3c-migration-c57c2dec9-r03-authoring-runtime`, branch `feature/phase-3c-migration-c57c2dec9-r03-authoring-runtime`; allowance 1 (one auxiliary slot free beside three unrelated `feature/test-*` worktrees) | pending | required | D312–D318 terminology/API, discoverable tasks, strict artifact guard, entry algebra, whole-step admission, recovery modes, `live-read` + Person Lookup T1, guide and final deletion acceptance |
| u20–u24 | R4 | blocked on R3 | — | — | required | Order 1 implementation and proof; decision 1 is ratified (D318) |
| u30–u35 | R5 | planned | — | — | required | Order 2 downloads + viewer |
| u40–u44 | R6 | planned | — | — | required | Order 3 OCR pipeline + Review capability |
| u50–u54 | R7 | planned | — | — | required | Order 4 OCR fan-out/light writes |
| u60–u64 | R8 | planned | — | — | required | Order 5 I-9 check + workbook projection/export |
| u70–u74 | R9 | planned | — | — | required | Order 6 work-study + Kronos pay rule |
| u80–u84 | R10 | planned | — | — | required | Order 7 oath upload + OnBase |
| u90–u94 | R11 | planned | — | — | required | Order 9 onboarding |
| u100–u105 | R12 | planned | — | — | required | remaining cross-cutting capability closure and zero-open audit |

## Residue

- Separations R4e/R4f controlled-live proof → `docs/coordinator/separations-completion/`; preserved, not absorbed into this board.
- Repository worktree capacity → unrelated test-suite R1/R6/coordinator worktrees remain externally owned; Phase 3c reserves only one R3 supervisor slot and creates no worker worktree while capacity is full.
- ServiceNow and OnBase live probes → R9 unless a target becomes available earlier; absence blocks rebuild-ready rather than permitting a substitute.
- Actual write canaries for R6, R8, R9 and R10 → operator decision after each supervisor returns an exact packet.

## Questions for the operator

- None open. The read-only T1 sheet is answered (A → D318).

## Progress

Steps — 2/14 complete (active scope ends after R3 + RECONCILE-3cA; later runs held by operator instruction)
- [x] R1 — D311 workflow recipe/compiler
- [x] R2 — Order 1 workflow-specific intake
- [>] R3 — D312–D317 authoring/runtime foundation
- [ ] R4 — Order 1 implementation
- [ ] R5 — Order 2 downloads
- [ ] R6 — OCR
- [ ] R7 — oath/emergency
- [ ] R8 — I-9 check
- [ ] R9 — work-study/Kronos
- [ ] R10 — oath upload/OnBase
- [ ] R11 — onboarding
- [ ] R12 — cross-cutting closure
- [ ] RECONCILE — canonical Phase 3c authorities
- [ ] CLOSE — integrated gates, cleanup, and final board
