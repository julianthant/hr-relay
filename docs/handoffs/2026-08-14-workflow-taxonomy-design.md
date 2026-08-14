# Handoff — workflow taxonomy: chunks are steps of Separation, not siblings

**Date:** 2026-08-14
**Paused at:** problem recorded with open design questions; NO design decided, NO code written.

## Task summary

The Workflow Panel lists the five separations chunk workflows (kuali-read, identity-check,
ucpath-termination, kuali-finalization, kronos-timecard) as sibling workflows beside the
`separations` composition. Operator ruling: *"kuali finalization is a step in the separation
workflow, not another workflow itself"* — chunks must present as members of the composition.
This is a DESIGN-FIRST task: nothing on the wire currently distinguishes a chunk harness
from a composition, so the fix starts with a ratified descriptor-level membership fact, then
the bootstrap wire, then the rail/picker presentation.

## The brief

- **Read first:** `docs/findings/workflow-taxonomy.md` — symptom, why it is backend-linked,
  fix outline, and the open questions (count roll-ups, Run Modal treatment of chunk starts,
  run-row labels, any doc-07 exit criterion requiring chunk startability).
- Constraints that survive any design: chunks stay REGISTERED and independently runnable
  (each holds/owes its own §3.2 controlled-commit proof); the decision lands in its owning
  doc (likely doc 02 for the descriptor fact, doc 03 for presentation) with a doc 04 pointer
  in the same commit, and a fresh D2xx id (check doc 04's tail before minting).

## Current state

- Branch: `master`. Tree shared with other active sessions.
- Relevant surfaces if/when implementing: `src/control/workflow-registry.ts`,
  `src/domain/dashboard/bootstrap.ts`, `src/dashboard/surfaces/workflow-category.ts`,
  `src/dashboard/surfaces/shell.tsx` (`WorkflowEntryList`), `src/dashboard/surfaces/run-start.tsx`.
- A descriptor-model change moves `contractFingerprint`s → run `npm run build:manifest`
  and expect parity corpus drift (see the parity handoff; coordinate the re-freeze).

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
```

## Done means

Ratified decision in the owning doc + doc 04 pointer; wire serves the membership fact; rail
shows the composition per the decided presentation; picker/count behavior implemented per
the decision; guards/tests updated; gates green; findings record flipped to triaged/deleted.
