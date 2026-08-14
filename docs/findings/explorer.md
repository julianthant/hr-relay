# Workflow Explorer — wire gaps (non-normative)

Recorded 2026-08-14 while porting the operator's rebuild-demo explorer
(`hr-automation@1bffbd658db34ce84a08e69484db3a40b3658d6e`,
`src/dashboard/components/dev/rebuild-demo/DemoExplorer.tsx` + `demo-explorer-wire.ts`) onto the
served `/api/v1/explorer` projection. Every record is an element the demo draws that this wire
cannot power. Nothing here was faked on the surface; see `README.md` for the standing rules.

Owning doc for every record below: **doc 12 §5.2 / §5.7** (`12-operator-trust-and-authoring.md`).

Five records were dispositioned 2026-08-14 and deleted per the ledger rule (landed in the
owning doc): the run overlay, the `1 file` header count, lanes, the `Version registry`
action, and the delegation child row are all covered by doc 12 §5.7's exclusions and its
2026-08-14 presentation as-built delta. The three records below are the genuine open gaps.

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

