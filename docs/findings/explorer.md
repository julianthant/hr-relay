# Workflow Explorer — wire gaps (non-normative)

Recorded 2026-08-14 while porting the operator's rebuild-demo explorer
(`hr-automation@1bffbd658db34ce84a08e69484db3a40b3658d6e`,
`src/dashboard/components/dev/rebuild-demo/DemoExplorer.tsx` + `demo-explorer-wire.ts`) onto the
served `/api/v1/explorer` projection. Every record was an element the demo drew that this wire could
not power. See `README.md` for the standing rules.

Owning doc for every record below: **ref operator-trust §5.2 / §5.7 / §5.9**
(`reference/operator-trust.md`).

## Three open records (2026-08-21) plus five settled 2026-08-19

Five records were dispositioned 2026-08-14 and deleted per the ledger rule (landed in the owning
doc): the run overlay, the `1 file` header count, lanes, the `Version registry` action, and the
delegation child row are all covered by ref operator-trust §5.7's exclusions and its 2026-08-14 presentation
as-built delta.

**What the 2026-08-19 sweep missed.** `docs/plans/2026-08-21-03a-fidelity-3-standing-surfaces.md`
§3 (ledger 3) re-audited the Explorer against the demo live and found three real gaps the
"ZERO open records" heading was papering over. All three are booked below.

## `skippedInDryRun` has no per-node signal

**Recorded:** 2026-08-21 · **Status:** OPEN — no producer (re-verified 2026-08-21:
`ExplorerNodeWire.shape` in `src/domain/dashboard/explorer.ts` has no per-node
`skippedInDryRun`/equivalent field) · **Owning doc:** ref operator-trust §5.2

**Symptom.** The demo marks a node above the dry-run boundary that a rehearsal skips anyway with a
`Chip tone="danger"` reading "a dry run skips this" (`skippedAboveBoundary`,
`demo-explorer-wire.ts:185-190`); this tree draws nothing for that case on a non-transaction node.

**Ledger row:** EX77.

**What closes it:** a per-node `skippedInDryRun` boolean derived the same way
`dryRunPosture`/`dryRunBoundaryNodeId` already are (`explorer-model.ts`), projected onto
`ExplorerNodeWire.shape`.

---

## A field's `when` condition has no per-field line

**Recorded:** 2026-08-21 · **Status:** OPEN — no producer (re-verified 2026-08-21:
`ExplorerContractFieldWire` carries no per-field `when`) · **Owning doc:** ref operator-trust §5.9

**Symptom.** The demo prints a micro-line `only when {row.when}` under a conditional field's name
(`DemoExplorer.tsx:846-848`); the rebuild's field table has no such line, because the field's own
condition never reaches the wire — only the NODE's `when` does (D228).

**Ledger row:** EX113.

**What closes it:** widening `ExplorerContractFieldWire` with the field-level `when`, the same
declared-condition shape D228 gave the node.

---

## No minor/presentation version exists anywhere in the tree

**Recorded:** 2026-08-21 · **Status:** OPEN — no producer, cross-cutting (re-verified 2026-08-21:
`grep -rn minorVersion src/domain` → 0 hits) · **Owning doc:** ref workflow-model, ref dashboard-surfaces §10.2

**Symptom.** Every descriptor version in this tree is a bare major integer, so every place the demo
would print a two-part tag (`v7.2`) prints `v1`-shaped output instead. This is not an Explorer-only
gap — it is why the Explorer's own `Version registry` table (rendered in `archive.tsx`, reachable
once F4 wires the action, ref operator-trust §5.7) and the Archive's version chips both read one
number short. Named here because ledger 3's roll-up (item 19) raised it while auditing the
Explorer, and because the Explorer is the surface whose whole job is describing a workflow's exact
shape.

**Ledger rows this explains, elsewhere:** AR125, AR195, AR206, AR230 (all `unserved: no minor
version`).

**What closes it:** a minor/presentation version component on the descriptor identity, threaded
through `descriptorVersion`'s every consumer — a change to the version MODEL itself, not to any one
surface.

The remaining three landed 2026-08-19 and are deleted per the same rule:

| Record | Landed as | Owning doc |
| --- | --- | --- |
| **Field-level contract rows** — `Field · System · Recorded` | **D227** — `contractSchemaLeaves` walks each contract boundary schema into its dotted leaf paths, the panel is a field table, and `Recorded` carries the field's declared PROVENANCE (never a run's value) with a reachable `unknown` arm | ref operator-trust §5.9 |
| **A node's `when` condition, in words** | **D228** — the `when` is a DECLARED condition, not a closure. `evaluateNodeCondition` applies it and `describeNodeCondition` renders it, so the sentence IS the rule. The authored `whenLabel` this record proposed is refused precisely because it would be a second description | ref workflow-model §3.3 |
| **The descriptor's prose** — a graph summary and a node purpose | **D229** — `summary` and `nodePurposes` on the descriptor, exhaustive when declared, projected into both ⓘs, with `explorer-prose-declared` making the wire's `absent` arm unreachable for a registered workflow | ref operator-trust §5.9 |

D186's EDIT half (ref operator-trust §5.3) remains DEFERRED by explicit disposition and is not a record here.
