# Board - Phase 3c authoring and acceptance

**Project profile:** `project-profile.md`
**Coordination UUID:** `57c2dec9-138e-4578-b5da-389ad9b4007a` · `C57c2dec9`
**Work key:** `phase-3c-migration`
**Coordinator title:** `Coordinate · phase-3c-migration · C57c2dec9 · workflow migration`
**Coordinator session:** Claude Code `1c78d186-91c1-4728-9da4-29102181632d` (successor of `571dd99a-cd47-4529-adfe-a4bc7569c29a` since 2026-09-02 21:11 PDT)
**Coordinator checkout:** `/Users/julianhein/Projects/hr-automation-rebuild` · `feature/03c-workflow-migration`
**Integration target:** `feature/03c-workflow-migration`, recreated from local `master` at `1867c78b6ff9f2ffc891e94aa1394bd7ff3bb642`; D319 scope reset follows the R3 launch record at `956c77b8`
**Board owner:** coordinator
**Write rule:** coordinator only; supervisors and workers read only
**Last verified:** 2026-09-02 23:20 PDT at merge `16e7e63b` (R3c integrated; full gate re-run green by the coordinator)

## Facts every run needs

- Local `master` merged `feature/03b-live-close` with `--no-ff` at `414d77b8`; no remote push occurred.
- Phase 3b's R4e/R4f controlled-live proof remains open and is not a Phase 3c completion claim.
- D311's compiler seam is the plan-owned prerequisite to orders 1–7 and 9. Person Lookup and Separations are its exact equivalence fixtures.
- The operator ratified D312–D316 at `1273c360` and D317 at `dee89c72`: exact four-artifact workflow authoring; complete pre-start whole-step omission values; checkpoint resume plus restart-from-start without repeated completed writes; explicit `task | parallel | delegate | gate | transaction` entries; hard Person Lookup + Separations deletion acceptance; and `workflow.ts` / `defineWorkflow` / `WorkflowDefinition` terminology with no recipe compatibility alias.
- D319 narrows Phase 3 to the reusable workflow platform plus Person Lookup and Separations. No third workflow is authorized by this board.
- The former order 1-7/9 rows are unnumbered candidate evidence. Each requires an operator-approved admission packet before a new numbered phase or implementation run exists.
- The open capability register remains a program/cutover obligation under `workflow-admission-backlog`; it is not a Phase 3c exit count.
- D318 (`cb9a1476`) resolves read-only T1: a transaction-free graph proves T1b through the explicit `live-read` arm with `dryRun=false` and exact zero write-authority deltas; D209 is unchanged. `ref guards-and-tests` §10.4 is primary.
- Live reads and dry runs are pre-authorized. Every actual external write still needs an exact operator-approved target/disposition.
- The operator's session-panel work is integrated at `49dc1529` within master merge `29186a31`; preserve it as existing behavior.

## Decisions ratified

- 2026-09-02 20:20 PDT · operator correction ("you put too much into the supervisor. they should be handling workloads capped at 350k tokens") → every remaining run is re-sized to one hard seam + small units under ~350k; R3's residue becomes R3b/R3c/R3d. Owner: `run-plan.md` §Re-size; memory `supervisor-run-cap-350k`.
- 2026-09-02 18:1x PDT · operator instruction in coordinator session `571dd99a` ("okay just do phase 3c A here") → R3 is the **3c-A exit gate**. D319 later supersedes the old statement that R4-R12 remain Phase 3 work: after R3, only the 3c-B acceptance/closure run remains.

- 2026-09-02 · sheet `decisions/2026-09-02-read-only-t1-live-proof.md` item 1 → **A** (live execution manifest with `dry-run-preview` / `live-read` arms) → D318 in `docs/rebuild/reference/decisions.md`, normative text in `ref guards-and-tests` §10.4, at `cb9a1476`.

- 2026-09-02 · operator instruction in this Codex task (verify every workflow before adding it; Phase 3 contains only Person Lookup and Separations; "okay do that") → **D319**. R3 continues unchanged as 3c-A. One 3c-B acceptance/closure run follows. Former R4-R12 were never dispatched and are withdrawn, not deferred Phase 3 work. Owner: `ref workflow-model` §1.6.2, doc 03c and this board.

## Unit ledger

| Unit | Run | Status | Integration evidence | Gate evidence | Review | Notes |
|---|---|---|---|---|---|---|
| u01–u06 | R1 | closed 2026-09-02 | branch tip `31c3f9a5`; merge `a40276b6`, contained by master merge `29186a31`; supervisor worktree/branch removed; exact task `01a0644f-936c-7d72-8fbc-12a04b527b3e` archived | typecheck/lint, 393 files/4,853 coverage tests, parity 287/287, manifest/roadmap/diff/twins PASS | complete; six findings resolved | bounded D311 compiler complete; D312–D317 successor remains R3 |
| u10–u12 | R2 | closed 2026-09-02 | branch tip `ed9ee5ac`; merge `b1b36349`, contained by master merge `29186a31`; supervisor worktree/branch removed; exact task `01a0644f-936c-7d72-8fbc-128e5f1b1a47` archived | typecheck, lint, roadmap freshness, diff check PASS; three focused re-reviews Count 0 | complete | Order 1 intake/live provenance complete; read-only T1 decision and fresh I-9 canary remain explicit residue |
| u25–u28 | R3b | closed 2026-09-02 ~21:00 PDT | branch tip `915d9702`; merge `c258677b` into `feature/03c-workflow-migration`; branch ref deleted; worktree retained by plan for R3c (re-pointed to `feature/phase-3c-migration-c57c2dec9-r3c-deletion-acceptance` at `c258677b`); session `7dee2c47` stopped | coordinator re-ran on `c258677b`: typecheck 0 errors, lint clean, coverage 401 files / 4,921 tests (85.48/76.54/89.43/87.41), parity 287/287, manifest/roadmap/catalog current, diff --check clean, twins identical | Correctness 5 (worst low, 2 fixed), Silent failures 2 (1 fixed allowlist; 1 ruled judgement → D314 wording question), Tests 1 | report `reports/r3-authoring-runtime.md`; residue → R3c/R3d |
| u29–u32 | R3c | closed 2026-09-02 23:19 PDT | branch tip `c3b432ee` (10 commits `06eb7494..c3b432ee`); merge `16e7e63b` into `feature/03c-workflow-migration`; branch ref deleted (`show-ref` no longer resolves); worktree retained by plan and re-pointed to `feature/phase-3c-migration-c57c2dec9-r3d-author-docs` at `16e7e63b`; session `133425d0` stopped (lost predecessor `8dacde07` recorded) | coordinator re-ran on `16e7e63b`: typecheck 0 errors, lint clean, coverage 402 files / 4,941 tests (85.47/76.54/89.42/87.42), parity 287/287, manifest/catalog/roadmap current, `git diff --check` clean, twins identical | u30: sup-opus Correctness 4 (worst medium) + Tests 3, all 7 fixed `44f74d54`, fixtures mutation-verified; u29 supervisor-owned, proved by before/after public-shape probe + unmodified R1 equivalence fixtures | report `reports/r3c-deletion-acceptance.md`; `src/workflows/` = registry + eight `workflow.ts`; `workflow-authoring-budget` guard live; Person Lookup `live-read` T1b met (result `66ea3863…`, run `3bf3d260…`, 0/0/0); Separations typed blocked arm `c36b2b6b…` |
| u33–u36 | R3d | dispatched 2026-09-02 23:21 PDT (session `40fc084f`) | base `16e7e63b` | pending | required | author documentation package |
| u15–u19 | R3 | closed 2026-09-02 ~21:00 PDT via R3b | commits `8a931cc6..c1bdcf68` + safety `0566b181`, stabilized by R3b and integrated in merge `c258677b`; branch ref deleted; session `e266c808` stopped 20:21 PDT (context exhausted, over cap) | as R3b row | as R3b row | u15–u18 complete; u19 slice (Person Lookup T1 pair + live-read met, four harness conversions, grouping proof) complete; u19 remainder superseded by u29–u36 |
| u110–u113 | R4 | held for operator after R3 | — | — | required | 3c-B: accept Person Lookup and Separations, reconcile Phase 3 authorities, run integrated gates and sweep; do not dispatch without operator instruction |

### Superseded pre-D319 unit rows

The undispatched u20-u105 rows are retained in `run-plan.md` as audit history. They have no active
run, dependency order or phase assignment. Any one of those candidates can return only through the
D319 admission process and receives fresh units after operator approval.

## Residue

- D265 §1.2.2 rule 2 ("declared category with no folder fails") is annotated as superseded by D312 §1.6.1 item 5 (a step folder exists iff it carries a harness; `job-summary` has no folder) in `ab04231c`. Body rewrite vs annotation → operator sheet `decisions/2026-09-02-3c-a-close-questions.md` item 3.
- `src/server/dry-run-scenario/{compose,manifests}.ts` map each workflow id to its `dry-run.scenario.ts` (D318 T1b loader) — per-workflow glue outside the four-artifact budget, allowlisted in the u30 guard citing D318/§10.9. Derive-from-registry vs keep explicit map → sheet item 4.
- A first-attempt T1b manifest cannot match a re-run of an already-completed item in the same authority root (R3 and R3c both used a fresh root; row `0c8b2425…` failed `checkpoints` only). Whether §10.4 should pin/relax the attempt → sheet item 5.
- Foreign dev dashboard on 3938/5174 (a Codex session's) was stopped by `pkill -INT -f scripts/dev-dashboard.ts` before the R3c and coordinator coverage gates per the brief; that session restarts it. Recorded, not owned.
- Foreign commit `fc3de16d` (`docs/handoff: dashboard wiring remediation`, another session) sits on the integration branch beneath merge `16e7e63b`; docs-only, not this coordination's file, not read for task context.

- D314 wording (ref workflow-model): "another run" vs "another attempt" → sheet item 2; R3d u35 applies the answer if it arrives in time, else RECONCILE.
- Separations T1b: `finalization-canary` is `gone` (2026-09-01); R3c recorded the typed blocked arm (`c36b2b6b…`, `not-started` / `subject-unavailable`); the 3c-A exit gate names "both workflow T1b proofs green" → sheet item 1 (replacement canary or ruling).
- Separations R4e/R4f controlled-live proof → `docs/coordinator/separations-completion/`; preserved, not absorbed into this board.
- Repository worktree capacity → unrelated test-suite R1/R6/coordinator worktrees remain externally owned; Phase 3c reserves only one R3 supervisor slot and creates no worker worktree while capacity is full.
- ServiceNow, OnBase and other future probes remain candidate-admission evidence; they are not Phase 3 residue.
- Future write canaries are decided only inside an admitted workflow phase with an exact target packet.

## Questions for the operator

- Sheet `decisions/2026-09-02-3c-a-close-questions.md` (5 items: Separations canary/exit-gate ruling, D314 wording, D265 body text, T1b loader glue, T1b attempt pin). None blocks R3d; item 1 blocks the 3c-A exit claim.

## Progress

Steps - 4/8 complete
- [x] R1 — D311 workflow recipe/compiler
- [x] R2 — Order 1 workflow-specific intake
- [x] R3 — D312–D317 authoring/runtime foundation (closed via R3b merge `c258677b`; its u19 remainder continues as R3c/R3d, added 2026-09-02 21:20 PDT by the 350k re-size)
- [x] R3c — old-authoring-path deletion, retired-path guard, T1b states (merge `16e7e63b`; row closed 23:19 PDT)
- [>] R3d — 3c-A documentation package (dispatched on the retained worktree)
- [ ] R4 — 3c-B Person Lookup + Separations acceptance (operator-triggered)
- [ ] RECONCILE — canonical Phase 3 and D319 authorities
- [ ] CLOSE — integrated gates, worktree sweep and final board
