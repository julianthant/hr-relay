# Handoff — activity-report wire gaps

**Date:** 2026-08-14
**Paused at:** frontend port complete and committed (`a2ff17f`); eight records, none implemented.

## Task summary

The Activity report is now the demo's surface over `/api/v1/reports/activity`, including two
live-defect fixes (Finished = done+partial; unregistered-category heading). Eight records
remain: six wire gaps (per-workflow status columns and the still-open "Who" column ranked
highest by the porting session) and two that are NOT gaps but doc questions — most notably
doc 13 §6.7's D180 paragraph says "no KPI-card row" while the shipped port has one; that
needs *ratification, not a fix* (the reasoned half of D180 — no chart runtime — is still
honoured; the port adds no chart library).

## The brief

- **Read first:** `docs/findings/activity.md` (8 records), then doc 13 §6.7 (D180) and the
  activity aggregate's server query under `src/server/dashboard/`.
- "Hours saved" needs a minutes source that does not exist — that is a data-model question
  (per-workflow estimate constants?) requiring a ratified decision, not a quick field.

## Current state

- Branch: `master`. Tree shared with other active sessions.
- Frontend in place: `src/dashboard/surfaces/activity.tsx` (provenance to `hr-automation@1bffbd65`);
  call site updated in `src/dashboard/app/dashboard-app.tsx`.

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
curl -s "localhost:3938/api/v1/reports/activity?from=2026-08-01&to=2026-08-14" | head -c 1500
```

## Done means

D180 tension ratified one way or the other (doc 13 + doc 04 pointer); implemented gaps
verified on screen; findings flipped; gates green; no push.
