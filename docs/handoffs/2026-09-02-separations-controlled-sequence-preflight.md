# Handoff — separations controlled-sequence preflight

**Date:** 2026-09-02
**Paused at:** implementation is authorized, but §9.36 needs a controlled-test protocol decision
before building a path that could finalize a deleted filing. No new live run or write approval.
**Cleanup owner:** resuming standalone task or coordinator.
**Remove when:** the implementation/contract gap and fresh-admission requirements are preserved in
the authorized run's owning documents/report, git/gates are reverified, and no remaining action
depends on this brief. Older coordinator handoffs were not consumed or removed.

## Task summary

The operator answered “1A, 2A” to establishing an exclusive window and reviewing each real write
individually, then **“yes”** to implementing and verifying the execution/deduplication fixes. The
operator also answered **“do recommended”** to TDD through the real sequencer and real
run/gate/receipt composition with fake external systems; those two test boundaries are confirmed.
None of these answers pre-approves a real write or authorizes a new live target. Migration §9.36
records a further isolated diagnostic: the planned post-filing sweep deletes the filing that Kuali
would then cite. No execution code or tests changed; a protocol amendment is pending.

## Plan and shared state

- Owners: `docs/rebuild/03b-finish-separations.md`; `docs/migrations/separations.md` §§9.35–9.36;
  `docs/rebuild/reference/write-safety.md`; D287 in phase 03b.
- Coordination workspace: `docs/coordinator/separations-completion/`; read `project-profile.md`,
  `run-plan.md`, `briefs/r1.md`, and `board.md` for provenance, not fresh runtime facts.
- Board last-touch commit `1bbd1005` remains stale: it still describes 4537-era source contention
  and the retired three-person-secret ingress. Board is coordinator-owned and was not edited.

## Current state

- Repository: `/Users/julianhein/Projects/hr-automation-rebuild`.
- Branch: `feature/03b-live-close`, created from clean `master`
  `769e23c9de93006d009af21ab653b861cc484ecd`; only one worktree, this checkout.
- No implementation changes. This pause adds documentation only; inspect the committed diff from
  the base rather than assuming a later task has not moved the branch. No push or merge performed.
- Dashboard was stopped for gates, then restored using `npm run dashboard`: BFF 3938 and Vite 5174,
  both HTTP 200 in the original preflight. The design pass temporarily stopped that exact launcher
  (PID 80987) for its own full gate and restarted `npm run dashboard` afterward; prior PIDs/session
  1073 are historical, not current process authority. Reverify listeners and their launcher before
  any stop. No workflow worker was started; `playwright-cli list` was empty at preflight.
- Read-only authority check: healthy generation 2012, current verified-compatible backup with gap
  0; global write-intent/attempt/outbox counts 0/0/0. The named backup is
  `authority-g2012-20260902072555540-5f183b6a-d4dc-4a32-a13f-8c4279fbb7d4.sqlite.manifest.json`.

## Resume boundary

1. Resolve the pending **protocol** decision; implementation and the two test boundaries are
   already authorized. The recommendation awaiting an answer is: prove deletion on a separately
   approved disposable transaction and preserve 4589's actual filing through Kuali finalization.
   §9.36 contains the exact reproducible diagnostic and limits of its proof. Do not infer a new
   target, amend D287 before this decision, weaken gates, forge keys, erase state, or use omissions
   to manufacture transaction evidence.
2. Read §9.35: ordinary composed and UCPath chunk graphs each have one identity gate and sweep
   before filing. D307 omits both UCPath transactions together. The sequencer permanently reuses
   an observed-present or committed person-level sweep key before probing again, including for
   a fresh item. This conflicts with the planned post-filing deletion witness.
3. After the protocol decision, implementation and gates, re-observe operator-named doc 4589 and
   rehearse on the exact fixed source. The historic run `ca6a5462-4e52-43b7-ac85-f9bdb7fd30cf` / trace
   `sp-155454-ca6a`, attempt 1, receipt `0fa49971-bd6a-5a80-8c23-6392614d46c7`, is **not current
   source admission**. §9.35 records both differing fingerprints. Its continued live availability
   was not checked. Do not silently replace the gone 4537 registry entry or rewrite `.env`.
4. Preserve the individual real-write approval boundary, UNKNOWN stop, frozen canonical input and
   source requirements. No controlled write, new gate, or new run exists from this preflight.

## Gate evidence and verification before resuming

At base `769e23c9`: typecheck, lint, coverage, and manifest check passed. Coverage statements
85.26%, branches 76.34%, functions 89.13%, lines 87.20%. Roadmap check failed because generated
`docs/roadmap/index.html` was stale **before** these documentation edits. No parity run this turn.
`git diff --check` passed separately after the chained command stopped at roadmap.

At `1008aebd`, the isolated sequencer diagnostic exited 0 with the unsafe state reproduced:
filing `committed`/present → sweep `committed`/filing absent → finalization `committed`/Kuali cites
the absent filing. This is not an end-to-end gate/receipt or live-selector proof. Read-only live
authority counts stayed 0/0/0. No test file or execution source changed during the design pass.
A second exact command in §9.36 asserted that Kuali may not cite a deleted filing and exited 1
with that assertion failure. Preserve this red safety expectation through the protocol decision.

The documentation pass re-ran typecheck and lint (both 0) with the dashboard stopped.
`test:coverage` exited 1: 387/388 files, 4,794/4,795 tests passed. Existing singleton-contention test
`tests/unit/storage-restore-drill.test.ts:676` lacked its expected `SNAPSHOT active` subprocess line;
one winner and fifteen refusals were present. Focused rerun
`npx vitest run tests/unit/storage-restore-drill.test.ts -t 'admits exactly one singleton' --reporter=dot`
passed (1 passed, 19 skipped). This does not erase the full-run failure; no cause was diagnosed and
no tests changed. Roadmap freshness remains the earlier open failure.

```bash
git status --short --branch
git rev-parse HEAD
git log --oneline 769e23c9..HEAD
git diff --stat 769e23c9..HEAD
git worktree list
git diff --check
lsof -nP -iTCP:3938 -iTCP:5174 -sTCP:LISTEN
playwright-cli list
npm run cli -- storage doctor --json
sqlite3 -readonly .tracker-rebuild/state.db "SELECT 'write_intents', count(*) FROM write_intents UNION ALL SELECT 'write_attempts', count(*) FROM write_attempts UNION ALL SELECT 'durable_outbox', count(*) FROM durable_outbox;"
```

Before another full coverage gate, quiesce the dashboard through its owning launcher (the suite
needs the real ports). Tests require lint. Resolve the pending protocol decision before implementing
the exceptional sequence. No supervisor/subagents were dispatched or authorized this turn.

## Suggested skills

- `hr-manage` for runtime admission, actual runs and individual gate handling.
- `codebase-design` / `tdd` for the authorized implementation and regression proof; the sequencer
  and run/gate/receipt composition seams are already confirmed, so do not ask again for those.
- `supervise` only if explicitly requested; do not turn this pause into ambient dispatch.

## Paste-ready resume prompt

Read `docs/handoffs/2026-09-02-separations-controlled-sequence-preflight.md`, phase 03b and migration
§§9.35–9.36; verify git, runtime and authority state first. Implementation and the sequencer plus
run/gate/receipt test boundaries are approved, but resolve the protocol decision about preserving
the real filing before building the exceptional sequence; the coordinator board is stale and no
real-write gate is pre-approved.
