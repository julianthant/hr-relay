# Handoff — dashboard projection: cross-process span ingest (JSONL tailer)

**Date:** 2026-08-14
**Paused at:** diagnosis complete and recorded; no implementation started (by operator decision — the diagnosing session was frontend-scoped).

## Task summary

Runs enqueued after the dashboard boots serve an EMPTY timeline (plus empty pipeline chips
and dataFacts) because the BFF folds only its own span events and a one-shot boot replay —
the worker is a separate OS process and its task spans never reach the projection. This is
the daily-use defect behind "the run detail is missing the timeline". The fix is an
offset-aware JSONL tailer in the dashboard process replacing the in-process `onEvent` hook,
which is also what doc 03 §2.3's "one projector" model actually implies cross-process.

## The brief

- **Full diagnosis (read first):** `docs/findings/dashboard-projection.md` — root cause with
  file:line cites, decisive pid-boundary evidence, blast radius, fix shape, rejected
  alternatives, and the regression test that fails today.
- This is a plan-and-ratify task, not just a patch: doc 03 §2.3 needs an as-built amendment
  stating the projector consumes the stream FROM DISK, cross-process, and a decision id
  (next free D2xx — check `docs/rebuild/04-reconciliation.md` for the current tail; D211+
  were in use, verify before minting). Decision text lands in doc 03, pointer in doc 04,
  same commit.

## Current state

- Branch: `master` (work lands here; no worktree needed)
- The tree is SHARED with other active sessions — never revert or "fix" files outside scope.
- Findings status in the ledger: `diagnosed`. Flip to `triaged`/delete the record once the
  fix + doc amendment land.

## Verification before resuming

```bash
git log --oneline -5
npm run typecheck && npm run lint && npm run test:coverage
# reproduce (dashboard must have been running BEFORE a run was enqueued):
# start a run, then: curl -s localhost:3938/api/v1/runs/<runId> | grep -o '"events":\[\]'
```

## Done means

- The regression test from the findings file exists and passes (span pair appended to JSONL
  without `apply()` → `timeline.events` non-empty; BFF's own line on disk → no
  duplicate-fold degrade).
- The `onEvent` hook is REMOVED (one ingest path), fail-loud on unparsable tailed lines.
- Doc 03 §2.3 amended + doc 04 pointer, same commit. Gates green. No push.

## Pointers

- `CLAUDE.md` (root) — fail-loud doctrine, gate commands, doc-ratification rule.
- `docs/rebuild/03-tracker-dashboard.md` §2.3 (owning doc).
- Key files: `src/server/dashboard/compose.ts:307-326`, `src/infra/events/jsonl-streams.ts`,
  `src/server/dashboard/queries/run-detail.ts:221-236`, `src/server/dashboard/run-queue-projection.ts`.
