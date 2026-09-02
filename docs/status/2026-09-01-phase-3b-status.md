# Status — Phase 3b / separations — 2026-09-01 (HEAD 38786bb4)

> **Correction — 2026-09-02:** the “Next” sequence below described the plan without proving an
> executable path. Preflight at `769e23c9` found one identity gate followed by sweep → filing →
> finalization, not separately gated filing → sweep → finalization. The sweep's permanent
> person-level key also reuses an earlier no-op after a later filing. In addition, the current
> descriptor fingerprint differs from the 4589 rehearsal. See migration §9.35 and the dated
> [handoff](../handoffs/2026-09-02-separations-controlled-sequence-preflight.md). Approvals alone
> cannot complete Phase 3b; no controlled write was started.

_Plan source: `docs/rebuild/03b-finish-separations.md`, `docs/migrations/separations.md`,
`docs/roadmap/roadmap.md`. Verified against: `npm run cli -- phase`, current authority storage,
git/worktree state, the 4589 rehearsal record, `typecheck`, `lint`, build-manifest/roadmap checks,
and the separations structural/write-safety guard slice._

## 1 · Complete

| item | evidence | since |
|---|---|---|
| Questionnaire and graph are complete: nineteen nodes, four stores, one ALWAYS-GATE, three fenced transactions | `docs/rebuild/03b-finish-separations.md` §Phase summary; `src/workflows/separations/descriptor.ts`; current manifest check exit 0 | 2026-08-14 |
| Strict boundaries and the separations write-safety architecture are present | Current focused gate: 4 files / 55 tests passed, including `identity-gate-before-commit`, `write-safety-contract`, `descriptor-coverage`, and the structural scenario | 2026-09-01 recheck |
| The composed workflow has live submit-free proof across Kuali, UCPath, and New Kronos | Runs `7565a88d`, `e1b8ae3e`, `1e0b7cc2`; `docs/migrations/separations.md` §§9.17, 9.22, 9.24 | 2026-08-20 |
| A current controlled-write candidate was selected and rehearsed green | Document 4589 run `ca6a5462-4e52-43b7-ac85-f9bdb7fd30cf`, receipt `0fa49971-bd6a-5a80-8c23-6392614d46c7`, terminal dry-run preview, exact-run 0/0/0; §9.34 | 2026-09-01 |
| The green rehearsal remains source-compatible | Rehearsal contract fingerprint and current `separations` manifest fingerprint both `0e750f535bf9d1f94be1ce1de83469c698a7fa9d6c7f0768cd9dab62afe458f6` | 2026-09-01 recheck |
| No controlled write has accidentally occurred | Current authority database: global `write_intents=0`, `write_attempts=0`, `durable_outbox=0`; storage doctor reports healthy authority, reconciled 19/19 spans, current generation-2006 backup | 2026-09-01 recheck |
| Current lightweight gates are green | `typecheck` exit 0; `lint` exit 0; build manifest current; roadmap generated site fresh; focused separations slice 55/55 | 2026-09-01 |

## 2 · Drift — where the as-built differs from the plan

| plan said | reality | kind | consequence |
|---|---|---|---|
| Phase summary, seven-step table, Track A, roadmap, and operator-call nodes still say 4537 is gone, no replacement exists, and a rehearsal is owed | The exit-criteria row and migration §9.34 correctly record 4589 as the operator-selected, green rehearsal candidate | stale-plan-text | Reconcile all current-status surfaces before declaring 3b closed; do not repeat candidate selection or the rehearsal solely because older sections say to |
| `config/test-subjects.json` still contains only `finalization-canary` / 4537 with `gone` availability | The controlled sequence is now bound by durable run authority to document 4589 rather than the T1b registry row | done-differently | Close-out must state which authority owns the controlled candidate and retire/update stale registry prose without weakening D284's no-substitution rule |
| Criterion 2 says the full gate is green “at HEAD” | The last recorded full gate predates current HEAD. Current typecheck/lint, manifest, roadmap, and focused tests pass, but `test:coverage` was not rerun while the dashboard owns ports 3938/5174 and unrelated log-panel edits are present | claimed, unverified | A clean full gate remains part of final close-out, after the exclusive live window |
| Phase 3b is described as 8/9 and runtime still reports `completedThrough=2j`, `active=3-workflow-migration` | This matches the absence of controlled-write evidence: authority still has zero write intents and attempts | blocked | Phase/runtime status cannot advance until criterion 5 and close-out land |

## 3 · Next

1. Establish one exclusive controlled-write window: finish or isolate the unrelated dashboard edits, make the checkout clean, stop other users of ports 3938/5174 and the shared `.auth` profile, verify storage doctor/current backup again, and pin the exact source/config/canonical input used for 4589.
2. Execute controlled commit **② UCPath filing** against the frozen 4589 input. Present and obtain its own operator-visible ALWAYS-GATE approval; stop without retry if submission becomes UNKNOWN.
3. Immediately execute controlled commit **① UCPath pending sweep** against the pending row created by ②. Obtain its separate gate approval and preserve this as the only practical live witness for `clear-pending`'s committed arm.
4. Execute controlled commit **③ Kuali finalization**, using the real transaction number produced by ②, with its own gate approval. Do not re-read/recompose the subject after ② and do not change source or canonical input before ③ settles.
5. Capture the obligations only real commits can discharge: per-beat `probeToFenceMaxMs`; D207's write-specific 30-second stabilization window; D215's real `would-prepare` preview arm; the seven Kuali payload shapes including both date model values; UCPath confirmation rendering/search propagation; all three commit/probe/verify receipts and permanent-key evidence.
6. Close A8: add/update regression tests and knowledge records for every new live finding, reconcile the 03b summary/Track A/roadmap/migration record/registry authority, run `typecheck`, `lint`, `test:coverage`, `build:manifest:check`, `roadmap:check`, parity if changed surfaces require it, and `git diff --check`; then mark criterion 5, steps 5–7, and separations rebuild-ready.

## 4 · Needs you

| # | decision / approval | options | my recommendation | blocks |
|---|---|---|---|---|
| 1 | Provide an exclusive live window for the frozen 4589 sequence | **A.** Finish/pause the concurrent dashboard work, make the tree clean, and reserve the runtime/browser profile for the three-write sitting. **B.** Leave the current work active and defer Phase 3b. | **A** when you want 3b completed; concurrent source/profile use violates the controlled sequence's freeze | ② → ① → ③ |
| 2 | Approve or decline each real write when its ALWAYS-GATE appears | **A.** Review and approve ②, then ①, then ③ individually; each causes a real HR-system change. **B.** Decline any gate, leaving 3b at 8/9 with no false completion claim. | **A only after reviewing each live packet**; the order is already ratified by D287, but no write gate is pre-approved | criterion 5, A2–A5, A8, rebuild-ready |
