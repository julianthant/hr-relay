# Handoff — queue-row wire gaps (backend serves what the demo row shows)

**Date:** 2026-08-14
**Paused at:** frontend port complete and committed (`6deaeb4`); ten wire gaps recorded, none implemented.

## Task summary

The queue row frontend is now a 1:1 port of the demo's `DemoQueue.tsx` and already renders
every element the wire can power. Ten demo/doc-03 row elements remain dark because the
served projection lacks the field or command. This session implements the BACKEND half —
projection fields + wire schema + (where applicable) commands — and then simply lets the
existing frontend read them: the surface was built so that when a field lands, no frontend
rework is needed (e.g. `SERVED_ACTIONS` in `src/dashboard/app/dashboard-app.tsx` becomes a
read of the served array and every control goes live).

## The brief

- **Read first:** `docs/findings/queue-rows.md` — ten `##` records, each with symptom, demo
  element, missing wire field/command, and where it would come from. Highest-impact first:
  subline sentences (`liveMessage` served absent on every row), row actions (`actions[]`
  has no schema field and no projector), gate age on the status pill, subject-name titles.
- Doc 03 owns the row model (§1.2, §9 D6–D24) and §2.4 owns the command protocol. Anything
  needing a new durable field or decision gets doc ratification (doc 04 pointer, same commit).

## Current state

- Branch: `master`. Tree shared with other active sessions.
- Frontend files already in place: `src/dashboard/surfaces/queue.tsx` (ported row),
  `src/dashboard/surfaces/status.tsx` (StatusBadge takes `age`).
- Wire schema changes will drift parity references — coordinate with the parity handoff.

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
curl -s "localhost:3938/api/v1/dashboard?day=$(date +%F)" | head -c 2000   # current wire shape
```

## Done means

Each implemented record: projection + schema + tests green, frontend renders it live (check
on screen at 5174), findings record flipped to triaged/deleted, README table count updated.
Partial passes are fine — the file is the backlog; implement top-down by impact. No push.
