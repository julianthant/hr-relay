# R2a — full-gate reliability

**Verified: default full gate restored without weakening its checks.** Commit `5853ef804a59b59fa171bc03a2e005e905f57a22` (`test: bound isolated Vitest file concurrency`) changes only `vitest.config.ts` and root `AGENTS.md` / `CLAUDE.md`. The runtime is restored and the historical inspection link still renders. Protocol and controlled-write criteria remain open under their existing owners.

Date: 2026-09-02. Supervisor: `/root/sup_supervisor_separations_readiness`. Repository `/Users/julianhein/Projects/hr-automation-rebuild`, branch `feature/03b-live-close`; initial source `85d3b082`, final code source `5853ef80`. Exact brief `../briefs/r2a-gate-reliability.md`; existing primary-checkout runtime exception. Unit u16 is supervisor-owned; no children dispatched for this focused seam.

## Cause and repair

The default full coverage gate failed twice in R2 at the 30-second perf-fixture setup and ratchet test. Narrowing to those two files kept coverage instrumentation and all 12 cases passed in 16.87 s; the ratchet assertion took 12.419 s. The focused command still exited 1 for unchanged global coverage floors, expected for a two-file subset and not called an integrated pass.

The host exposes 11 CPUs and 18 GiB RAM. Installed Vitest 4.1.10 uses CPUs minus one by default here, allowing ten simultaneous isolated file forks. Running the complete identical corpus at four forks passed every test and coverage floor. The original default npm command then passed after the config change, with a process snapshot confirming four forks. This establishes a sufficient scheduling repair on the observed host; CPU versus memory versus disk pressure was not separately isolated, and four is not claimed as a universal performance optimum.

The patch sets `maxWorkers: Math.min(4, availableParallelism())`. Smaller hosts retain a cap no higher than their available CPU count. Both projects, file-level parallelism, isolated forks, in-test concurrency, every test/assertion, 30-second test/hook limits and all coverage policies remain unchanged. No fixture/scanner algorithm was rewritten and no config-mirroring test added: the unchanged full coverage command is the regression gate that failed twice before the patch.

Root instructions document the measured reason. A pre-existing root twin mismatch was repaired with coordinator authorization by preserving the D308 lesson already present in CLAUDE.md in both twins, without altering its semantics. The twins are byte-identical.

## Proof table

| Command / experiment | Result | Raw evidence under ignored `.screenshots/separations-2026-09-02/` |
|---|---|---|
| R2 default full coverage, serial baseline | exit 1; 386/388 files; 4,788 passed, 1 failed, 6 skipped / 4,795; 146.83 s | `r2-coverage-serial.log` |
| `npx vitest run --coverage --reporter=verbose tests/unit/server/dashboard-perf-fixture-shape.test.ts tests/unit/architecture/guard-manifest.test.ts` | all 2 files / 12 tests passed, 16.87 s; command exit 1 from unchanged whole-repository coverage floors | `r2a-focused-covered.log` |
| `npx vitest run --coverage --reporter=dot --maxWorkers=4 && npx tsx scripts/suite-size.ts` | exit 0; 388 files / 4,795 tests, no skips; 169.54 s | `r2a-full-four-workers.log` |
| `npm run typecheck` | exit 0 | `r2a-typecheck.log` |
| `npm run lint` | exit 0; zero warnings gate | `r2a-lint.log` |
| **`npm run test:coverage` after config change** | **exit 0; 388 files / 4,795 tests, no skips; 152.65 s; suite-size passed** | `r2a-default-coverage.log` |
| `npm run build:manifest:check` | exit 0, current | `r2a-manifest.log` |
| `npm run roadmap:check` | exit 0, fresh | `r2a-roadmap.log` |
| `git diff --check`; `cmp AGENTS.md CLAUDE.md` | both exit 0 | verified before code commit |
| Parity | not rerun for runner-only config; R2 assert-mode **287/287** remains applicable to unchanged UI | `r2-parity.log` |

Both full successful runs report statements **85.26%**, branches **76.34%**, functions **89.13%**, lines **87.20%** and meet the unchanged global/safety floors. The old serial failure is retained rather than replaced; fewer scheduled files can take more wall time while preserving each test's deadline, and a failed baseline with skipped cases is not equivalent work.

Sanitized diagnosis, hypotheses, commands, resource snapshots and immutable review patch: `../evidence/r2a/`. No test membership or coverage-policy diff exists; production source/tests/scripts/config directories have no R2a modifications.

## Review and integration

The supervisor applied `/debug` and the retained `/review` contract's relevant checks; `../evidence/r2a/review.md` records separate Standards, Spec, Correctness, Silent failures, Performance, Tests and Docs results (0 findings each). Security and Simplify were skipped because no security boundary or unnecessary abstraction changed. Independent worker review was skipped for this small gate-proven configuration seam; the supervisor owns its consequential scheduling review, and the coordinator independently inspected the exact diff before final acceptance. No authority/write path changed.

Only `vitest.config.ts`, `AGENTS.md`, `CLAUDE.md` were explicitly staged and committed. The staged index was empty before/after; the coordinator may commit canonical and coordination docs separately. Exact code commit verified in git: `5853ef80`, 3 files / 27 insertions. No push or master merge. During report close, the coordinator committed its canonical status/roadmap reconciliation separately as `9321fe2f`; that is the current shared HEAD and contains no source/test change after the green gate. The coordinator verified its roadmap/diff checks.

Read-only worktree-sweep inventory: one primary checkout on `feature/03b-live-close`, one feature branch, no worker branches/worktrees. Retain this branch; no merge/removal/prune required. Own code paths have no uncommitted diff. Shared tree still holds coordinator-owned documents and the R2/R2a artifacts for coordinator commits; this is explicitly not a claim that the entire shared checkout is clean.

Board mode: coordinated read-only at exact `docs/coordinator/separations-completion/board.md`. Intake and final working blob `0bbe2159c65a796e39bbcdf4d688c482d1aad816`; inherited committed blob `f2b9d7698e066cf9b50175898dd6f9b9ddfb6dd0`. Coordinator's predeclared dirty board was read only; no board write, staging or commit by supervisor. No scope conflict. Existing unresolved handoffs retained; no new nested-run handoff needed.

## Restored safe state

`npm run dashboard` remains running, launcher PID **50392**, BFF **50469**, Vite **50467**, exec session **46903**. Bootstrap and frontend/deep-link HTTP 200. Served separations fingerprint remains `955991960b7b388ac4f44e64badd0ce895288797e5eb327bc9d6c5f0ccb7c6f1`, matching the current manifest.

Storage doctor: healthy schema 29, generation **2021**, valid invariants, zero FK violations, quick-check ok; compatible current backup with generation gap **0**; spans reconciled **19/19**. Durable run count remains **19** and global write intent/attempt/outbox counts **0/0/0**. No new run, worker, retry, approval, target, registry/environment mutation or live write occurred. `../evidence/r2a/runtime-after.json` contains the sanitized proof.

The exact historical link again rendered run `ca6a5462-4e52-43b7-ac85-f9bdb7fd30cf`, receipt `0fa49971-bd6a-5a80-8c23-6392614d46c7`, partial outcome and `DRY_RUN_PREVIEW`:
`http://localhost:5174/?day=2026-09-01&run=ca6a5462-4e52-43b7-ac85-f9bdb7fd30cf`.

Owned `r2a-restore` browser closed; `playwright-cli list` reports no browsers. Existing session-card/history and Run data wording residue from R2 remains unchanged. No temporary source/test probes were introduced; resource snapshots remain explicitly named diagnostic evidence.

**Return to coordinator:** code repair committed and gates verified. Report/evidence remain unstaged for coordinator close-out. No R2a operator decision is needed. R2's protocol/target/restoration-or-retention decision and individual live-write approvals remain open; reliable tests do not discharge criterion 5.
