# Handoff — archive-surface wire gaps

**Date:** 2026-08-14
**Paused at:** frontend port complete and committed (`1a716ab`); ten gaps recorded, none implemented.

## Task summary

The Archive surface is now a 1:1 port of the demo's `DemoArchive.tsx` over `/api/v1/archive`.
Ten demo elements are recorded as unserved. NOTE: not all ten are backend work — at least one
(Export) is a *feature not in the plans* and needs an operator decision or a ratified plan
entry before anyone builds it; treat those records as "decide first", the rest as
projection/wire work.

## The brief

- **Read first:** `docs/findings/archive.md` — ten records (instance filter, dry-run/test
  hazard icons, detail tabs Logs/Data/People, per-step durations, attempts list, write-ledger
  action+confirmation, versions-view columns, bump change record, Export).
- D179 (doc 03) owns the archive model — archived records are DATA, immutable in SQL; any new
  field on the archived record is a schema-version question, read forward per D133, never
  back-filled. Apply stays clickable while blockers exist (client-side disable is forbidden).

## Current state

- Branch: `master`. Tree shared with other active sessions.
- Frontend in place: `src/dashboard/surfaces/archive.tsx` (provenance to `hr-automation@1bffbd65`).
- The archive is currently EMPTY in live data — build fixtures/tests accordingly; a sweep
  must be run to see real rows on screen.

## Working mode (operator's standing dispatch policy)

You are the ORCHESTRATOR — do not do everything inline and do not hand the whole task to
one mega-subagent. Decompose into NARROW sequential briefs and dispatch each as a subagent:
**Opus or Sonnet only, high effort, ~300k tokens max per subagent.** You keep for yourself:
doc reads, design judgment, gate runs, verification after each return, small fixes, and the
findings/doc bookkeeping. Sequential-on-master; verify each subagent's commits and a clean
tree before dispatching the next. Never push.

## Verification before resuming

```bash
git log --oneline -5
npm run typecheck && npm run lint && npm run test:coverage
curl -s localhost:3938/api/v1/archive | head -c 1500
```

## Done means

Per record: decide-first items get an operator/plan disposition recorded; wire items get
projection + schema + tests + on-screen verification; findings records flipped, README
count updated, gates green, no push.
