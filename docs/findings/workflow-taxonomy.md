# Workflow taxonomy findings

Records about how workflows, compositions and chunk harnesses are modeled and presented
(rail, picker, counts, run labels).

## Chunk workflows render as sibling workflows of the Separation composition

**Recorded:** 2026-08-14 · **Status:** recorded (design needed) · **Owning docs to consult:**
doc 03 (rail/queue), doc 02 (workflow model), doc 07 (migration order), doc 12 (operator trust)

## Symptom

The Workflow Panel's SEPARATIONS group lists five entries side by side: Separation
Documents (`separations-kuali-read`), Identity Check (`separations-identity-check`),
UCPath Termination (`separations-ucpath-termination`), Kuali Finalization
(`separations-kuali-finalization`), and Separation (`separations`, the composition).
The Run Modal picker shares the same grouping (`src/dashboard/surfaces/workflow-category.ts`,
consumed by `shell.tsx` and `run-start.tsx`).

Operator verdict: *"not all steps in the separation workflow is another workflow …
kuali finalization is a step in the separation workflow, not another workflow itself."*
The chunks should present as steps/members of Separation, not as peer workflows.

## Why this is backend-linked

The rail renders whatever the bootstrap wire serves: `WORKFLOW_MODULES`
(`src/control/workflow-registry.ts`) → bootstrap projection
(`src/domain/dashboard/bootstrap.ts`) → `FrontendBootstrapWireSchema` → rail groups by each
workflow's own `categoryId`. Nothing on the wire distinguishes a chunk (a per-chunk proving
harness from the separations migration, chunks 1–5) from a composition (`separations`,
chunk 6). The chunk descriptors even self-describe as harnesses — e.g.
`separations-kuali-finalization/descriptor.ts` says "This descriptor stays the proving
harness and declares `plan: not-composed`" — but that fact is not projected to the wire.

## What a fix likely involves (for the next session to design)

1. A descriptor-level, wire-served membership fact (e.g. "composed into `separations`" /
   a role field distinguishing `composition` / `chunk-harness` / standalone), ratified in
   the owning doc, not invented ad hoc — the chunks stay REGISTERED (each still owes/holds
   its own §3.2 proof and must stay independently runnable as harnesses).
2. Bootstrap wire schema change + rail/picker presentation: rail shows the composition only
   (or chunks nested/indented under it); decide whether chunk runs' counts roll up into the
   composition's `active │ all` badge and how the Run Modal treats chunk starts (hidden?
   behind an "advanced" affordance?).
3. Decide how run rows for chunk-workflow runs label themselves once the rail no longer
   names the chunk as a workflow.

## Open questions for the design

- Does hiding chunks from the rail conflict with any doc-07 exit criterion that requires a
  chunk to be operator-startable from the product surface?
- Should the composition's badge count include historical chunk-harness runs from the
  proving days, or only composition runs?
