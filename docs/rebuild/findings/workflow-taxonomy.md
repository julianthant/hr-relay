# Workflow taxonomy findings

Records about how workflows, compositions and chunk harnesses are modeled and presented
(rail, picker, counts, run labels).

## Chunk workflows render as sibling workflows of the Separation composition

**Recorded:** 2026-08-14 · **Status:** RESOLVED 2026-08-14 — ratified as **D219** (ref workflow-model §1.2.1
owns the module `role`; ref dashboard-surfaces §Shell owns the presentation) and implemented the same day
(`c7486f6` module roles + registry validation + guard arm, `a631231` bootstrap/explorer wires,
`b42f46f`/`0d64441` rail/picker/explorer nesting). The parity re-freeze this forces is sequenced
into `docs/handoffs/2026-08-14-parity-refreeze.md`, which recorded D219's isolated expected
diffs (three fixtures: `explorer-graph`, `explorer-transaction`, `start-run`). _(That re-freeze
landed as `bd1d4b6`; the handoff briefs were removed 2026-08-18 and live in git history.)_

**The design's answers to the open questions below:** no phase-doc conflict (no current Phase 3 exit criterion names
rail presence; chunks stay registered and start through the start-plan lane), and the composition's
badge counts composition runs ONLY — historical harness runs stay under the harness's own nested
entry, because a badge that disagrees with its own panel is D81's divergence class.

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

- Does hiding chunks from the rail conflict with any phase doc's exit criterion that requires a
  chunk to be operator-startable from the product surface?
- Should the composition's badge count include historical chunk-harness runs from the
  proving days, or only composition runs?

## `kuali-timekeeper-annotation` sits in the rail as a main workflow, but is a proving workflow

**Recorded:** 2026-08-14 · **Status:** RESOLVED 2026-08-19 — closed in two halves, both
ratified and implemented · **Owning docs:** ref workflow-model §1.2.1, ref dashboard-surfaces §Shell

The disposition this record asked for was *"a third role arm served on the wire and dropped by
the rail"*, and that is what landed — twice, because the first pass answered only the rail.

- **D220 (2026-08-14, `0e62aab`)** added `{ kind: "proving" }` to the module role union (no
  `of`: there is nothing for it to be a step of), declared it on the kuali-timekeeper module,
  and made `buildWorkflowRailGroups` drop every `chunk-harness` and `proving` entry plus any
  category thereby emptied.
- **D241 (2026-08-19)** closed the half D220 left: the workflow was still headed under
  **Operations** in the Run Modal's picker and the Explorer, beside daily HR work, which is
  what the operator was actually looking at (*"a crash test dummy is not a workflow … maybe it
  belongs in a different category, perhaps in test"*). The ONE grouping rule now reads the
  module's ROLE for these entries, not their `category`: a `proving` workflow groups under
  **`Test equipment`**, appended last, on every surface that lists one. It is lifted out of the
  category pass rather than added beside it, so it can never appear twice; the group drops when
  nothing proving is served. The picker's auto-pick set narrowed to `standalone` + `composition`
  on the same argument. No id list anywhere — the fact is the module's declared role, exactly as
  this record required.

The workflow stays REGISTERED and startable, from its own panel and from the picker's
`Test equipment` group: a standing safe re-proof of the write machinery nobody can run is not a
standing proof.

## Workflow short code

**Recorded:** 2026-08-14 · **Status:** RESOLVED 2026-08-19 — ratified as **D242** and
implemented the same day · **Owning docs:** ref workflow-model §1.1.1 (the code), ref dashboard-surfaces §10.2 (the frozen
archive field and the surfaces)

**This record's central claim was wrong, and finding that out is what shaped the fix.** It said
*"no short code exists anywhere in the rebuild — not on the descriptor, not on the wire."* Both
halves were false: `WorkflowDescriptor.code` has existed since Phase 1 and
`WorkflowBootstrapPrimitiveSchema.code` has served it since 1g-spine. It was invisible because
its ONLY consumer was `deriveTraceId`, which composes `<code>-<HHMMSS>-<runId4>` — so the code
was already stamped on every run row, span, note line and ledger entry this program has written,
including `pl-000619-4ebf` in the project CLAUDE.md.

So D242 is a UNIFICATION, not a new field. Minting a display code beside the trace code would
have given one workflow two short names, and an operator reading `sd-141203-9a1c` in a log and
`sep v1` in the archive would have had nothing telling them the two name the same thing —
`explain run <traceId>` (ref operator-trust §2.5) is a real lookup path. What landed:

- `WorkflowCodeSchema` is the ONE definition, bound by the descriptor factory, the bootstrap
  wire and the explorer wire; widened from exactly-two alphanumerics to 2–4 lowercase LETTERS.
- Uniqueness is refused at the composition root (`auditWorkflowCodes`), the one place the whole
  registry is in scope.
- The archive FREEZES it at generation 3 beside the label, read-forward per D133.
- Consumed by the archive index row (`<code> v<N>`), the archived detail header, the version
  registry, the Activity per-workflow table and the Activity CSV (its own column).

Every existing code was KEPT (`pl`, `sp`, `sd`, `si`, `st`, `sf`, `sk`, `kt`) — see D242's row
in ref decisions for why renaming would cost more than it buys.
