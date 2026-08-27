# Handoff — Phase 3b run R2 (was R1 in the first cut): the 2026-08-28 controlled commits on canary 4537

**Date:** 2026-08-27 (written by the coordinator for a session on 2026-08-28)
**Paused at:** before execution — resume at u1 on Pacific 2026-08-28, after R1's receive (base = R1's exit sha on the board)

## Task summary
Phase 3b's exit table is 8 of 9; row 5 — controlled-commit evidence on the operator-approved target — is the only open row, and it was blocked on a DATE, not a defect: S7 admits Kuali doc **4537** on Pacific calendar day 2026-08-28. This run performs the three controlled commits in order ② UCPath filing → ① sweep → ③ Kuali finalization, records each from authority in `docs/migrations/separations.md` **§9.28**, and runs the T1b manifest live to record `met`. It confirms facts; it does not fix what it finds — differences from the recorded shapes are R2's input (u6–u8).

**These are REAL HR transactions.** `dryRun=false` only on 4537, only after the operator approves the ALWAYS-GATE in the ceremony, one commit at a time. An UNKNOWN submit stops the run: record it, never re-run. Everything else (login smoke, dry runs, selector snapshots, Duo) is pre-authorized — never ask.

## Plan
- Run plan: `docs/plans/2026-08-27-03b-runs.md` §R2 (units u1–u5, specs verbatim there; R1 = the date-independent seams that run on 08-27)
- Board: `docs/plans/03b-board.md` — read FIRST; write your ledger rows back at close

## Conditions for the whole run (analyst verdict 2026-08-27 — `docs/decisions/2026-08-27-r2-preflight-decisions.md`)
1. **No `reRead` ordinal after ②.** The item key excludes dryRun (`src/workflows/separations/descriptor.ts:840-842`), so u1's dry run seeds the checkpoints ②/①/③ replay; a new ordinal is a new item with no checkpoints and runs the whole read half live AFTER the filing.
2. **The tree is frozen between u1 and u4.** No commit under `src/stores/**`, `src/base/**`, `src/domain/**` until ③ lands — a moved `implFingerprint` stops checkpoints replaying (`src/core/run-executor.ts:680`). Anything you learn is recorded in §9.28, fixed in R3.
3. **③ falls back to `separations-kuali-finalization`** (no kronos node, `src/workflows/separations/kuali-finalization/descriptor.ts:331`) if the composed graph refuses in new-kronos after ②. Never retry the composed graph into a kronos wall. After ② only `timecard-search` (`always-rerun`) runs live again.
4. `dryRun=false` only on 4537, only with the operator at the keyboard approving the ALWAYS-GATE, one commit at a time. UNKNOWN submit → stop, record, never re-run.

## u1 pre-flight — do or expect, in order (from R1's u18 notes, `docs/migrations/separations.md` §9.27 addendum item 7 `:6121-6136` and `:6062-6063`, `:6138-6142`, `:6159-6167`)
| # | Step | Says so at |
|---|---|---|
| 1 | `lsof -nP -iTCP:3938 -iTCP:5174 -sTCP:LISTEN` — a BFF+vite pair from the deregistered worktree `.hr-rebuild-worktrees/fidelity-standing` held these ports on 08-26; also run UI-1 may have its own vite on 5175. Stop only what YOU can identify as foreign to the root; never a process you cannot attribute | `separations.md:6133-6136` |
| 2 | `uptime` — macOS indexing daemons push load to 69–167 and fail 12–16 test files on 30 s timeouts; gate only when load < ~20; read counts, not the first exit code | board §Facts |
| 3 | Full gate at base: typecheck · lint · `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:coverage` · `build:manifest` (must not diff) · `roadmap:check` | `docs/plans/03b-board.md` §Facts |
| 4 | Root `.tracker-rebuild/state.db` may still be the stale `user_version` 16 db (`dry_run_scenario_results` without `worker_pools`) → `composeDashboardRuntime` unwinds on "table … already exists". Archive it intact (`stale-schema16-<date>/`), let the runtime build fresh v18. Expect ~50 `runs_view` rows rehydrated from span JSONL with write tables at 0, and `storage doctor` marking 56 pre-v18 backup manifests `INVALID — schemaVersion` with the generation-1 backup `ok` | `separations.md:6121-6132` |
| 5 | `duo-autopilot/credentials/duo-webauthn.json` must be packaged in the ROOT checkout's extension dir (gitignored); `assertDuoAutopilotReady` proves it — verify, do not assume | `separations.md:6013-6020`, `:6159-6163` |
| 6 | Launch: ONE BFF on 3938 + ONE pool member `npm run cli -- worker separations-worker-1 --pool-index 1` (`--pool-index` is required; `hr-manage` §1 omits it — u19 fixes the skill) | `separations.md:6062-6063`; `src/server/worker/compose.ts:150,173-180` |
| 7 | Live login smoke (UCPath, Kuali, Kronos) via Duo Autopilot | root `CLAUDE.md` §Live verification |
| 8 | `date "+%Y-%m-%d %Z"` must read 2026-08-28 Pacific; 4537's LDW = separation date = `08/28/2026` → S7 admits on equality; the timecard window is `07/28/2026`–`09/28/2026`, zero-padded | `separations.md:4612-4613`; board §Facts |
| 9 | `dryRun=true` on 4537 — PREVIEW TERMINAL reached; `hr-debug` submit-free audit node by node; 0/0/0 write rows read from authority. This is the first composed live run on the post-u14 driver (u18/T1b predate `b87dc560`) | `docs/plans/2026-08-27-03b-runs.md` §R2 u1 |
| 10 | Closure at the end of the run: stop the worker (lock `releasedAt` set), stop the BFF, `playwright-cli close-all` for YOUR sessions; the BFF's `server.lock.json` keeps `releasedAt: null` under a dead pid — observed, left per D181 | `separations.md:6138-6142` |
| 11 | u5: T1b is already `met` (`0cc71a31…` on 4502, R1) — a second take on the same state root is attempt 2 and fails on the checkpoint count alone; record, do not re-run | `separations.md:6163-6167` |

## Current state (from git)
- Repo: `/Users/julianhein/Projects/hr-automation-rebuild`   Branch: `integration/03b`   Base: `87a38779` at the time of writing (R1 closed at `db3f76f6`; u21, if landed tonight, moves it — read the board's ledger row for u21)
- master: `8e322e8a` (03a closed, merged `--no-ff`) — do not move it
- Worktrees: `../hr-automation-rebuild-ui*` belong to run UI-1 (another session) — leave them · feature/ui-* are theirs · root tree: `vitest.config.ts` reflow pending the operator's sheet item 5
- Gate at `db3f76f6` (coordinator-run): typecheck · lint · 315 files / 3,456 tests · roadmap fresh · manifest unchanged

## Progress
- [ ] u21 (tonight, sheet item 1 A — its own short session; see the board's ledger for the sha)
- [ ] u1 pre-flight — the 11 steps above ← **resume here on 2026-08-28**
- [ ] u2 commit ② UCPath filing — operator at the gate
- [ ] u3 commit ① sweep + `clear-pending` COMMITTED-arm witness — ask the operator at the keyboard whether to re-run ① immediately after ②
- [ ] u4 commit ③ Kuali finalization — capture the real payload against the seven D217 shapes; table only, no fixes
- [ ] u5 T1b re-check (record R1's `met`, do not re-run) + doc 03b row 5 / line ~680 / status line + §9.28 close + board rows + roadmap

## Open questions / deferred decisions
- u3's re-run of ① immediately after ② is the operator's live call (doc 03b line ~736). Ask at the keyboard; do not defer it to a handoff.
- Anything that surprises you in ②/③ (a shape that differs, a window longer than D207) is RECORDED here and handed to R2 — not fixed in this run.

## Verification before resuming
```bash
cd /Users/julianhein/Projects/hr-automation-rebuild
git status --short --branch && git worktree list && git branch --list 'feature/*'
git log --oneline -1 && git merge-base --is-ancestor master HEAD && echo "master is an ancestor: ok"
npm run typecheck && npm run lint
HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:coverage 2>&1 | tail -8
npm run roadmap:check
date "+%Y-%m-%d %Z"   # must read 2026-08-28 Pacific before u2
```

## Pointers
- Read first: root `CLAUDE.md` (§Live verification, §Fail loud), `docs/plans/03b-board.md`, `docs/rebuild/03b-finish-separations.md` (lines ~19–30 the 7-step loop; ~254 the 4537 registry row; ~380–416 sep-4/sep-5 open lines; ~540–560 Track A; ~680 T1b; ~736 the operator call; ~798–815 exit table + the three confirmation obligations), `docs/migrations/separations.md` §9.19 (the canary mapping) and §9.27 (the last live section — §9.28 follows its shape)
- Skills: `hr-manage` (bring BFF + worker up, start runs, gate approvals, UNKNOWN-submit rule), `hr-debug` (dry-run audit node by node, selector repair), `playwright-cli`
- Related handoffs: `docs/handoffs/2026-08-27-phase-3a-final-closed.md` (how 03a closed), `docs/handoffs/2026-08-26-phase-3a-final-supervisor.md`

## Suggested skills for the next session
- `/catchup` first, then `/supervise` with the u1–u5 list — the operator's prompt names it
- `/hr-manage` for every live run; `/hr-debug` for the submit-free audit in u1
