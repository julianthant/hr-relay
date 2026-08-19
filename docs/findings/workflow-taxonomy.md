# Workflow taxonomy findings

Records about how workflows, compositions and chunk harnesses are modeled and presented
(rail, picker, counts, run labels).

## Chunk workflows render as sibling workflows of the Separation composition

**Recorded:** 2026-08-14 · **Status:** RESOLVED 2026-08-14 — ratified as **D219** (doc 02 §1.2.1
owns the module `role`; doc 03 §Shell owns the presentation) and implemented the same day
(`c7486f6` module roles + registry validation + guard arm, `a631231` bootstrap/explorer wires,
`b42f46f`/`0d64441` rail/picker/explorer nesting). The parity re-freeze this forces is sequenced
into `docs/handoffs/2026-08-14-parity-refreeze.md`, which recorded D219's isolated expected
diffs (three fixtures: `explorer-graph`, `explorer-transaction`, `start-run`). _(That re-freeze
landed as `bd1d4b6`; the handoff briefs were removed 2026-08-18 and live in git history.)_

**The design's answers to the open questions below:** no doc-07 conflict (no §3.2 criterion names
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

- Does hiding chunks from the rail conflict with any doc-07 exit criterion that requires a
  chunk to be operator-startable from the product surface?
- Should the composition's badge count include historical chunk-harness runs from the
  proving days, or only composition runs?

## `kuali-timekeeper-annotation` sits in the rail as a main workflow, but is a proving workflow

**Recorded:** 2026-08-14 · **Status:** triaged — ratified as **D220** the same day (doc 02
§1.2.1 gains the `proving` arm; doc 03 §Shell's rail amendment drops `chunk-harness` and
`proving` entries; implemented in `module-role.ts`, the kuali-timekeeper module, and
`buildWorkflowRailGroups`) · **Owning docs:** doc 02 §1.2.1, doc 03 §Shell

The rail now lists main workflows only (compositions + standalones; chunk harnesses are
dropped — operator call amending D219's first rail presentation, see `shell.tsx`
`buildWorkflowRailGroups`). That leaves `kuali-timekeeper-annotation` visible under
OPERATIONS, and the operator asked what it is for: it is the Phase-2 controlled-transaction
proof workflow (D135) — a kernel-proving surface, not daily HR work — but its served role is
`standalone`, which is what the rail keys on.

D219's role model has no arm for "proving workflow WITHOUT a composition" (`chunk-harness`
requires naming the composition it proves). Disposition needed: either a third role arm
(e.g. `proving-standalone`) served on the wire and dropped by the rail alongside harnesses,
or the operator keeps it visible deliberately. A rail-side hardcoded id list is not an
option — that is exactly the workflow-specific customization the role model exists to avoid.

## Workflow short code

**Recorded:** 2026-08-14 · **Status:** triaged 2026-08-14 — deferred to the workflow-taxonomy
question this file owns · moved here from [archive.md](archive.md) 2026-08-19 when that file was
cleared to zero (Track B5). It was always a taxonomy question wearing an archive record's
clothes: a short code is a descriptor PRESENTATION attribute several surfaces want, so it is
decided once here and then frozen into archived records like the label already is (D179 freezes
the label precisely so the archive never resolves a descriptor).

- **Symptom:** an archive list row reads `EID 10873698 · Person Lookup v1` where the demo reads
  `Tomás Rivera · pl v3.0`, and the version registry has no code column. At 800 rows the long
  label costs the name column real width. The Activity per-workflow table records the same need.
- **Demo element:** `run.workflowCode` on the row's name cell, in the sweep header's
  `bumpNameLabel`, and as the registry table's leading token.
- **Missing wire field:** no short code exists anywhere in the rebuild — not on the descriptor,
  not on the wire. `workflowId` (`separations-kuali-read`) is the only short-ish handle and it is
  not short.
- **Where it would come from:** a descriptor field, decided here alongside the rest of the
  taxonomy, then frozen into the archived record.
