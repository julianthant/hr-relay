# Workflow Explorer — wire gaps (non-normative)

Recorded 2026-08-14 while porting the operator's rebuild-demo explorer
(`hr-automation@1bffbd658db34ce84a08e69484db3a40b3658d6e`,
`src/dashboard/components/dev/rebuild-demo/DemoExplorer.tsx` + `demo-explorer-wire.ts`) onto the
served `/api/v1/explorer` projection. Every record was an element the demo drew that this wire could
not power. See `README.md` for the standing rules.

Owning doc for every record below: **ref operator-trust §5.2 / §5.7 / §5.9**
(`reference/operator-trust.md`).

## ZERO open records (2026-08-19)

Five records were dispositioned 2026-08-14 and deleted per the ledger rule (landed in the owning
doc): the run overlay, the `1 file` header count, lanes, the `Version registry` action, and the
delegation child row are all covered by ref operator-trust §5.7's exclusions and its 2026-08-14 presentation
as-built delta.

The remaining three landed 2026-08-19 and are deleted per the same rule:

| Record | Landed as | Owning doc |
| --- | --- | --- |
| **Field-level contract rows** — `Field · System · Recorded` | **D227** — `contractSchemaLeaves` walks each contract boundary schema into its dotted leaf paths, the panel is a field table, and `Recorded` carries the field's declared PROVENANCE (never a run's value) with a reachable `unknown` arm | ref operator-trust §5.9 |
| **A node's `when` condition, in words** | **D228** — the `when` is a DECLARED condition, not a closure. `evaluateNodeCondition` applies it and `describeNodeCondition` renders it, so the sentence IS the rule. The authored `whenLabel` this record proposed is refused precisely because it would be a second description | ref workflow-model §3.3 |
| **The descriptor's prose** — a graph summary and a node purpose | **D229** — `summary` and `nodePurposes` on the descriptor, exhaustive when declared, projected into both ⓘs, with `explorer-prose-declared` making the wire's `absent` arm unreachable for a registered workflow | ref operator-trust §5.9 |

D186's EDIT half (ref operator-trust §5.3) remains DEFERRED by explicit disposition and is not a record here.
