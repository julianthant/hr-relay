# Board — Phase 3b (finish separations) — curated by the coordinator, read first by every supervisor
_Ceiling ~400 lines. Every line carries a sha, a path, or a sheet item — a fact without provenance is a claim and does not go here. Supervisors append their rows at close; the coordinator prunes._

## Facts every run needs
- Run order (re-cut 2026-08-27): **R1 = date-independent seams (u18, u11–u14) — runnable today** · R2 = the 08-28 canary (u1–u5) · R3 = discharge + A8 · R4 = 09/02 parallel. `docs/plans/2026-08-27-03b-runs.md`
- Integration branch `integration/03b` · base `8e322e8a` (master after the 03a close merge `8e322e8a`) · master position `8e322e8a` — **do not move master**; the root checkout stays on `integration/03b` for the whole run
- Gate (D191): `npm run typecheck && npm run lint && HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:coverage` (310 files / 3,392 tests at base) · `npm run test:parity` (218 assert) · `npm run roadmap:check` · `npm run build:manifest` after ANY edit under a descriptor's import closure (`src/base/**`, most of `src/domain/**`)
- Plan SSOT: `docs/rebuild/03b-finish-separations.md` (exit table lines ~798–808, **8 of 9** met; row 5 controlled commits is the phase's remaining gate) · the migration record `docs/migrations/separations.md` (§9.19 canary mapping, §9.27 parallel proof at lines 5927–6053; the next live section is **§9.28**)
- Pre-authorized (root `CLAUDE.md` §"Live verification"): live UCPath / Kuali / Kronos access, Duo Autopilot, selector snapshots, `dryRun=true` workflow runs — never ask. **A `dryRun=false` controlled commit is NOT pre-authorized**: it happens only on the named canary, only with the operator at the keyboard approving the ALWAYS-GATE in the ceremony, one commit at a time.
- The canary: **Kuali doc 4537** (named 2026-08-19, mapped live §9.19; LDW `08/28/2026`, so S7 admits it on Pacific calendar day **2026-08-28**; `transactionNumber` EMPTY). Order: ② UCPath filing → ① the sweep on the row ② creates (also the only honest witness for `clear-pending`'s COMMITTED arm — re-run ① immediately after ②; doc 03b line ~736, operator's call) → ③ Kuali finalization.
- Second parallel subject: **doc 4495** (LDW `09/02/2026`) becomes past-dated on **2026-09-02**; until then the two-full-chain parallel variant is not runnable (§9.27 §1). **4502** is the past-dated full-chain practice subject already used.
- After an UNKNOWN submit: stop, never re-run (`hr-manage` rule). Retry only real failures.
- Traps (dated 2026-08-27, memory `worktree-agent-traps`): fresh worktrees need `npm ci` + `.auth`/`.env` links + `HRAUTO_LEGACY_REPO`; laptop sleep kills background agents; grep pipelines mask exit codes — read counts; a background agent once `git checkout`ed master in the ROOT — never check out in root.
- Runtime `npm run cli -- phase` = `completedThrough: 2j, active: 3-workflow-migration` (`src/core/runtime-composition.ts:158`, pinned by `tests/unit/runtime-composition.test.ts:26/34/150`); phase 3 is ONE runtime phase — no edit until 3d closes. Advancing it arms `legacy-capability-disposition`.

## Decisions ratified (one line each → sheet + item + owning doc)
- 2026-08-27 sheet `docs/decisions/2026-08-27-03a-close-decisions.md` — 1 B (master ← integration/03a-final `--no-ff`, `8e322e8a`) · 2 A → D277 (jsdom per file; ref guards-and-tests §10.9) · 3 A (keep `src/dashboard/AGENTS.md` for Codex; `src/dashboard/CLAUDE.md`) · 4 A → D278 (live capture takes the intake column; ref dashboard-surfaces §D274 item 7) · 5 A (R1 = the 08-28 canary) · row 10 → D279 (03a closes 10/10; residue carried to doc 04 §"Carried in from Phase 3a")
- 2026-08-27 sheet item 5 A → the canary runs on 08-28 as **R2** (was R1; re-cut after the date-gate hold)
- Standing from 03b (do not re-open): D207 stabilized window · D211/D261 descriptor · D215 `would-prepare` · D217 Kuali wire shapes (provisional until ③) · D265/D266 workflow tree · D218–D222/D243/D244 platform fixes

## Unit ledger
| Unit | Run | Status | Merge sha | Gate line | Review | Notes |
|---|---|---|---|---|---|---|
| u1–u5 | R2 | held | — | — | — | first cut ran them as R1 on 08-27; supervisor held on the date gate, nothing dispatched (`b9126e6d`) |
| u18 | R1 | merged | `c8b7530e` (direct on integration/03b, root) | roadmap:check fresh; docs-only, no code gate | skipped — no code | dryRun=true full chain on 4502: run `fd415e49-54bb-4ccd-bec4-ad1cba94a4f6` / trace `sp-053429-fd41`, terminal `done` at `clear-pending` (`already-present` off a `live-probe`, D215 preview terminal), 299.7 s claimed→terminal, gate via real `POST /api/v1/commands`; authority write rows 0/0/0 (write_intents · write_attempts · durable_outbox); §9.27 addendum |

## Residue (named, owned)
- **R2 pre-flight residue from u18 (`c8b7530e`, 2026-08-27):** (a) the root `.tracker-rebuild/state.db` at `36135120` would not open — `user_version` 16 carrying `dry_run_scenario_results` (migration 18) without `worker_pools` (17) → `table dry_run_scenario_results already exists` unwinding `composeDashboardRuntime`; stale local db, not a tree defect; archived to `.tracker-rebuild/stale-schema16-2026-08-27/`, fresh v18 authority built — R2's u1 should expect it and budget for it; (b) a BFF+vite pair from the deregistered worktree `.hr-rebuild-worktrees/fidelity-standing` (no `.git`, absent from `git worktree list`) held 3938/5174 since 08-26 writing to its own db — stopped; the directory is still on disk (worktree-sweep leftover); (c) `npm run cli -- worker <id>` now requires `--pool-index`; the `hr-manage` skill §1 line omits it; (d) the fresh db rehydrated 50 `runs_view` rows from on-disk span JSONL with write tables at 0; `storage doctor` marks 56 pre-v18 backup manifests `INVALID`.
- sep-2 S2 refusal live (a non-RRSS doc must appear in the Action List) — external, parked on doc 03b line ~317
- 03a fidelity carry-in C1–C6 — doc 04 §"Carried in from Phase 3a" (D279), not 03b work

## Questions for the operator (the coordinator turns these into a sheet)
- (none open)
