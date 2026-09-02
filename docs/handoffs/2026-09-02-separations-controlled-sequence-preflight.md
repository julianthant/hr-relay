# Handoff — separations controlled-sequence preflight

**Date:** 2026-09-02
**Paused at:** before any new live run or real-write approval; implementation authority needed.
**Cleanup owner:** resuming standalone task or coordinator.
**Remove when:** the implementation/contract gap and fresh-admission requirements are preserved in
the authorized run's owning documents/report, git/gates are reverified, and no remaining action
depends on this brief. Older coordinator handoffs were not consumed or removed.

## Task summary

The operator answered “1A, 2A” to establishing an exclusive window and reviewing each real write
individually. That is not blanket gate approval or authorization to redesign write-safety. The
previous status report incorrectly presented approvals as the only remaining obstacle. Migration
§9.35 now records the source-backed correction; no implementation or live execution followed it.

## Plan and shared state

- Owners: `docs/rebuild/03b-finish-separations.md`; `docs/migrations/separations.md` §9.35;
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
  both HTTP 200. Tool session 1073; observed child PIDs 81066/81064 (reverify, never blindly kill).
  No workflow worker was started; `playwright-cli list` was empty.
- Read-only authority check: healthy generation 2012, current verified-compatible backup with gap
  0; global write-intent/attempt/outbox counts 0/0/0. The named backup is
  `authority-g2012-20260902072555540-5f183b6a-d4dc-4a32-a13f-8c4279fbb7d4.sqlite.manifest.json`.

## Resume boundary

1. Obtain authorization to reconcile/implement the missing controlled-execution path. Do not
   infer permission to amend D287, weaken gates, forge keys, erase durable state, or use omissions
   to manufacture transaction evidence.
2. Read §9.35: ordinary composed and UCPath chunk graphs each have one identity gate and sweep
   before filing. D307 omits both UCPath transactions together. The sequencer permanently reuses
   an observed-present or committed person-level sweep key before probing again, including for
   a fresh item. This conflicts with the planned post-filing deletion witness.
3. After authorized implementation and gates, re-observe operator-named doc 4589 and rehearse on
   the exact fixed source. The historic run `ca6a5462-4e52-43b7-ac85-f9bdb7fd30cf` / trace
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
needs the real ports). Tests require lint. Do not implement under this handoff alone: the pending
operator response defines scope. No supervisor/subagents were dispatched or authorized this turn.

## Suggested skills

- `hr-manage` for runtime admission, actual runs and individual gate handling.
- `codebase-design` / `tdd` for the contract seam and regression proof if implementation is approved;
  agree the seam before writing tests.
- `supervise` only if explicitly requested; do not turn this pause into ambient dispatch.

## Paste-ready resume prompt

Read `docs/handoffs/2026-09-02-separations-controlled-sequence-preflight.md`, phase 03b and migration
§9.35; verify git, runtime and authority state first. Resume at the implementation-authorization
boundary, treating `docs/coordinator/separations-completion/board.md` as stale, and do not start a
real-write run or consume any gate approval from the earlier “1A, 2A” selection.
