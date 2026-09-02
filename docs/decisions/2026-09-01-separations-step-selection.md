# Decisions — Separations step selection — 2026-09-01
_Answer positionally: `1 A, 2 C + "note"`, or `all recommended`. Unanswered items stay open._

> **Answered 2026-09-01 (operator):** "any step should be pickable and we will ask for custom input
> values that are required in the skipped steps." Ratified as D307 (`docs/rebuild/reference/decisions.md`;
> normative text in ref workflow-model §5.8, ref write-safety §3.1, ref dashboard-surfaces §9.1, ref
> operator-trust §2.3, `docs/migrations/separations.md` §4b/§4c/§4d amendments). Slice one landed the same
> day: Kronos timecard, UCPath transaction and Kuali finalization are omittable; the three read steps
> follow once the identity packet carries per-row origin marks. Items 1 and 2 below are closed.

**Why this sheet exists.** The Start Run wizard's Steps screen shows all six Separations steps
checked and disabled ("This workflow requires every node in this step."). That is not a defect in
the wizard: `src/services/start/step-selection.ts` marks a step selectable only when every node in
it carries the same top-level boolean input condition (`when: is-true/is-false` on an input field
declared as a typed-start boolean constant), and the Separations descriptor declares no `when`
anywhere by design (`src/workflows/separations/descriptor.ts` header "No branch, no `when`,
anywhere"). Three operator rulings own that state:

| Ruling | Date | What it says |
| --- | --- | --- |
| `docs/migrations/separations.md` §4b, Option C | 2026-08-12 | "if kronos is not available, the entire thing fails." No path files a termination without a read timecard; **"no run mode changes the graph at all."** A Kuali-dates-only arm is designed when a real case surfaces, as a §3.1 recomposition, never as a conditional branch. |
| §4c, Option A | 2026-08-12 | Post-write failure parks at Kuali finalization; resume re-enters only that node. "Resume does NOT inherit legacy's skip-everything semantics." |
| §4d, Option A | 2026-08-12 | ALWAYS-GATE: no preset, prefill, resume path or run mode can disable identity approval. Legacy's "Transactions only" preset and `lastDayWorked` prefill are pattern D7 and do not port. |
| D285 (ref dashboard-surfaces §9.1) | 2026-08-28 | "Separations shows its real steps locked because its descriptor deliberately declares no conditional graph." `tests/unit/start-step-selection.test.ts:34` pins it. |

The graph is one chain: Kronos dates feed the identity packet and both writes; the UCPath receipt
feeds Kuali finalization; the gate sits between the last read and the first fence. So "pick a
step" is a graph decision with write-safety consequences, not a UI toggle.

## 1 · Should any Separations step become pickable?

**Situation.** The wizard already supports selectable steps (Person Lookup's CRM Dates works). For
Separations, every candidate reopens one of the rulings above. Choosing A keeps the screen as
pictured but makes the lock explain itself; B and C change what a live separation run does.

**Options.**
- **A.** Keep every step locked; change the row copy from "This workflow requires every node in this
  step." to a sentence that names the reason (Separations runs every step; no run mode changes the
  graph, §4b/§4d) — costs a parity re-freeze (`test:parity:update`) and nothing else; the operator
  still cannot pick steps.
- **B.** Add conditional steps to the Separations descriptor itself (`when` on the step's nodes plus
  a boolean typed-start constant, the Person Lookup mechanism) — costs a new decision that amends
  §4b's "no run mode changes the graph" sentence and the descriptor header, a result-schema arm for
  each omitted step, receipt/Archive/queue projections for that arm, the build manifest, and the
  T1 proof; the descriptor stops being unconditional.
- **C.** Recompose instead of branching: register a second rail workflow from the same proven chunks
  (for example "Separations — file only", without the finalization step) — the mechanism §3.1 and
  §4b named; costs a second workflow folder, picker/Explorer entry, T1 structural scenario plus live
  dry-run manifest, and its own step folders; steps stay locked inside each composition.
- **D.** Defer: leave the screen as is until a real case (a document that needs a step omitted)
  surfaces — costs nothing now; §4b said the arm gets designed then.

**Recommendation.** A. The screenshot shows the ratified state; the honest fix is copy that says
why, unless a real case exists. If one does, answer item 2 and I design it under B (one step,
descriptor-local) or C (a Kronos-less arm, which §4b reserved for recomposition).

**Notes.** _(your notes here)_

## 2 · If pickable, which step(s)?

**Situation.** Only steps whose output nothing downstream consumes can be omitted without rewriting
consumers. Kuali finalization is consumed only by the result fold. Kronos dates are consumed by the
identity packet, the UCPath transaction and the finalization. The UCPath receipt is consumed by the
finalization. Kuali extraction, Identity check and Job summary are the ALWAYS-GATE's evidence.
Two builder facts bound the options: `when` exists only on task nodes
(`src/domain/workflow/graph.ts:85-98`); transaction nodes carry none (`graph.ts:181-201`), so a
conditional write step is a kernel change first. Legacy offered exactly two presets
(`legacy:src/workflows/separations/workflow.ts:334-347`): "transactions-only" skipped Kronos and
Job Summary, and "skip-ucpath-transaction" skipped the pending check and the UCPath write; both
were rejected above. Answer with one or more letters.

**Options.**
- **A.** Kuali finalization optional (`finalizeKuali`, default on): file the UCPath termination and
  leave the document for manual finalization — costs a `when` arm on transaction nodes in the graph
  type, executor and step-selection projection (write-path work, supervisor-owned), plus an explicit
  `finalization: omitted` result arm that the queue row, receipt and Archive must show, so a
  filed-but-unfinalized document is never a plain `done` (the class §4c Option C rejected).
- **B.** Kronos timecard optional (dates from the Kuali document alone) — the only step the builder
  can make conditional today, and the one §4b Option C rejected: costs a Kuali-only dates arm in
  the dates node, a packet that marks "no timecard read", and the comment builder's "per Kronos"
  wording; §4b said this is a recomposition, not a branch.
- **C.** UCPath transaction optional with an operator-typed transaction number (finalize only) —
  costs the same transaction-node `when` work as A plus reversing §4c: the ratified route is resume
  from a parked run, and a typed number that nothing verified is the S57/D7 shape; the identity gate
  would still run (§4d).
- **D.** None of the above (only meaningful with item 1 = A or D).

**Recommendation.** A only, and only if item 1 is B. B and C each contradict a ruling you made on
2026-08-12 for a wrong-person or unverified-write reason; I will not implement them without the
case that motivates it.

**Notes.** _(your notes here)_
