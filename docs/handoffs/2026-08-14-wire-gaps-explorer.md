# Handoff — explorer wire gaps

**Date:** 2026-08-14
**Paused at:** frontend port complete and committed (`793e2a5`); eight gaps recorded, none implemented.

## Task summary

The Workflow Explorer is now the demo's three-panel surface over `/api/v1/explorer`,
read-only per D186 (the EDIT half is REASSIGNED out of scope — do not build it). Eight demo
elements are recorded as unserved; several of them (run picker, per-node run state, recorded
values, provenance lines) are excluded by doc 12 §5.7's first exclusion, so they are
*ratification questions* — the plans currently say NOT to build them. Read each record's
framing carefully: this session's first job is to sort the eight into "doc says no (leave,
or re-ratify)" vs "genuine wire gap to implement".

## The brief

- **Read first:** `docs/findings/explorer.md` (8 records) and doc 12 §5.3/§5.7.
- One extra note from the porting session: doc 12 §5.7's as-built paragraph now
  under-describes the shipped surface (presentation only, no contract change) — an as-built
  delta there is warranted; decision-id only if behavior contracts change.

## Current state

- Branch: `master`. Tree shared with other active sessions.
- Frontend in place: `src/dashboard/surfaces/explorer.tsx` + updated
  `tests/unit/dashboard/explorer-client.test.ts` (18 pass).
- Version display reads `v1` — the wire has no minor version; that is one of the records.

## Verification before resuming

```bash
git log --oneline -5
npm run typecheck && npm run lint && npm run test:coverage
curl -s localhost:3938/api/v1/explorer | head -c 1500
```

## Done means

Each record dispositioned (implemented / deliberately excluded with the doc cite); any doc
12 amendments ratified with doc 04 pointers; gates green; findings flipped; no push; NO edit
affordances anywhere (D186).
