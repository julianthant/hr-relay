# Workflow Explorer — wire gaps (non-normative)

Recorded 2026-08-14 while porting the operator's rebuild-demo explorer
(`hr-automation@1bffbd658db34ce84a08e69484db3a40b3658d6e`,
`src/dashboard/components/dev/rebuild-demo/DemoExplorer.tsx` + `demo-explorer-wire.ts`) onto the
served `/api/v1/explorer` projection. Every record is an element the demo draws that this wire
cannot power. Nothing here was faked on the surface; see `README.md` for the standing rules.

Owning doc for every record below: **doc 12 §5.2 / §5.7** (`12-operator-trust-and-authoring.md`).

## The run overlay — the whole right half of the demo's graph panel

**Status:** recorded (DEFERRED BY PLAN, not a defect — logged so the gap is legible)

The demo lays a chosen run over the descriptor graph: a `Run` select in the panel toolbar listing
every run of that workflow in the corpus with its status, coverage (`5/7`) and clock; a `StatusPill`
+ trace id + `dry run` chip beside it; per-node state (`done` / `running` / `waiting on you` /
`failed` / `off this path` / `not reached`), duration, attempt count, recorded-value count,
`evidence captured`, `skippedBecause`, and a delegation `childNote`; a version-skew banner when the
run ran under a different descriptor version; and, in the node panel, the values that run actually
moved plus `replayed` / `corrected` / `staged` / `not read back` marks and the run's own key lines.

**Evidence.** `/api/v1/explorer` carries no run-scoped field at all
(`WorkflowExplorerWireSchema` = registry metadata only). Doc 12 §5.7's FIRST named exclusion says
this is deliberate: "the same graph carrying timings, attempts, checkpoint reuse, failures,
children, evidence and safe actions is NOT in this slice … joining the two projections is its own
work with its own wire".

**What a fix involves.** A second wire (or a documented join) over `run_records` + spans +
checkpoints keyed by `(workflowId, runId)`, and the presentation decision doc 12 §5.7 defers:
whether this is a second run view beside the run-detail timeline operators already use. The ported
surface keeps the toolbar slot the picker occupied (it carries the workflow identity band now), so
adding the overlay is an insert rather than a re-layout.

## Field-level contract rows — `Field · System · Recorded`

**Status:** recorded

The demo's node panel is a table of CONTRACT FIELDS: one row per field the node reads or writes
(`Wage · ucpath`, `Effective date · ucpath`, `Transaction number · ucpath`), banded by direction,
each carrying a `proof` line ("proved by read back from the job row after submit"), an `only when`
condition, and a pencil when the field is correctable at a checkpoint. `contractTotals` counts those
rows for the panel header (`9 reads · 4 writes · 1 file`).

**Evidence.** `ExplorerTaskWireSchema` projects a contract's schemas as HASHES
(`inputSchemaHash` / `outputSchemaHash`) and never as field lists. The only field-level facts served
are `freshness.byField`, `provenance.byField`, `node.details` (the run-row detail projections) and
`node.editableFields` — none of which is a read/write census, and none of which carries a per-field
system or proof.

**Consequence on the surface.** The ported table keeps the demo's three columns and its `Reads` /
`Writes` bands, but its rows are TASK ARMS (`ucpath/stage-termination · ucpath · checkpoint
in-memory-only`), and the header line counts arms rather than fields — with the graph's ⓘ saying so
in as many words, because a number that implies a field census nobody served is worse than no
number.

**What a fix involves.** Projecting each contract's zod shape into leaf paths + direction at build
time (`explorerWorkflowTasks` already walks every arm), plus a decision about depth for nested
objects and arrays. `evidence-classification.ts`'s leaf walk is the existing precedent for
"one array is one leaf".

## The descriptor's prose — a graph summary and a node purpose

**Status:** recorded

The demo's ⓘs open with the descriptor's own sentence about the workflow ("Searches Person Org by
EID/name …") and about each node (`node.purpose`).

**Evidence.** The wire serves `workflow.label` and `node.label` — two to four words each — and no
prose field. Doc 12 §5.7 is explicit that a closure is reported as its presence, but says nothing
about authored prose, which is data rather than code.

**What a fix involves.** A `summary` on the descriptor's presentation block and a `purpose` per
node, both authored, both projected. The ported ⓘ currently opens with the derivation instead ("this
graph is the as-built descriptor, read from … `descriptor.ts`"), which is true and useful but is not
the descriptor's own words.

## A node's `when` condition, in words

**Status:** recorded

The demo prints `runs when the CRM record has attached documents` under a conditional node, and names
each branch case in the connector (`→ Identity approval: the matched name is a different person`).

**Evidence.** `ExplorerNodeShapeWireSchema` serves `conditional: boolean` for a task node, and doc 12
§5.7 rules that the `when` closure itself stays source-only. Branch CASES do carry a `name`, so the
connector's control-edge half is served — but no registered workflow declares a branch or parallel
node today, so that arm has never rendered against real data.

**Consequence.** The surface prints `runs when the descriptor's own when() predicate holds`, which is
honest and says less than the demo's line.

**What a fix involves.** An authored `whenLabel` beside the predicate (the same shape D104's case
names already take), never a decompiled rendering of the closure.

## `1 file` — the artifact axis of the header count

**Status:** recorded

The demo's graph header counts files beside reads and writes (`6 nodes · 9 reads · 4 writes · 1
file`) because its corpus has workflows that produce documents.

**Evidence.** `artifacts: "content-addressed"` is served per task, so "this contract produces
artifacts" IS available — what is not available is a count of the artifacts a workflow produces,
which is a per-run fact anyway. The ported header omits the segment entirely rather than printing a
count of contracts as if it were a count of files.

## Lanes — the demo's `laneOf` section dividers

**Status:** recorded

The demo groups a graph's rows into named lanes (`DELEGATED BATCH`, `PER PERSON`, `MATCH MODE`) with
a divider and a `SectionLabel`, which is how it expresses "this stretch of the graph is one phase".

**Evidence.** No lane, phase or group field exists anywhere in `ExplorerNodeWireSchema`, and none
exists in the descriptor either — the concept is the demo wire's own. The ported graph is a flat
declaration-order list with the connector carrying the edges, which is the demo's presentation minus
the dividers.

**What a fix involves.** A descriptor-authored `phase` per node (presentation only, so it would sit
inside doc 12 §5.3's closed editable set once Phase B exists), or dropping the idea — 18 nodes read
fine without it.

## `Version registry` — the demo's page-header action

**Status:** recorded

The demo's explorer header carries a `Version registry` button beside the read-only badge, which
opens Settings' version table.

**Evidence.** No version-registry surface exists in this tree, and the archive's `Versions & bumps`
view is the nearest thing (a different takeover, reached from the Archive). The ported header keeps
the back button and the read-only badge and omits the action rather than wiring a button to a page
that does not exist.

## Delegation — `visibility` is served, the child's own row is not

**Status:** recorded

The demo's delegation node carries a `childNote` naming what the child run did (`6 answers returned
to the OCR run`) and links to the child's queue row.

**Evidence.** `child-run` shape facts (target, edge id, cardinality, await, join, onChildFailed,
cascadeCancel, afterChildRetry, visibility) are all served and all rendered; the child RUN is a
run-scoped fact and belongs to the same overlay gap as the first record above. No registered
workflow declares a `child-run` node today, so this arm has never rendered against real data either.
