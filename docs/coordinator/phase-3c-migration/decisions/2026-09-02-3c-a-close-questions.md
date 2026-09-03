# Decision sheet — 3c-A close questions — 2026-09-02

**Coordination:** `57c2dec9-138e-4578-b5da-389ad9b4007a` · `C57c2dec9` · raised by R3b/R3c, batched by the coordinator after merge `16e7e63b`.
**Answer format:** `1 A, 2 B + note …`. None blocks R3d (docs). Item 1 blocks the 3c-A exit claim and therefore R4.

## 1. Separations T1b and the 3c-A exit gate

**Situation.** Doc 03c's exit gate (L292–300) requires "both workflow T1b proofs green". Person Lookup's `live-read` is met (`66ea3863…`). Separations' `dry-run-preview` needs the `finalization-canary` subject, which the registry marks `gone` since 2026-09-01; R3c recorded the typed blocked arm (`c36b2b6b…`, `not-started` / `subject-unavailable`). D284 forbids choosing a replacement without you.

- **A.** You supply a new closed Kuali document number for a fresh Separations canary (into ignored `.env` under the D300 key; registry row updated with a dated `available` observation). R4 re-runs the preview and 3c-A closes on the doc's own wording. Cost: you find and vet a live document; one registry commit; one live dry run.
- **B.** Rule that a recorded typed blocked arm satisfies "T1b green" for a workflow whose canary decayed, with the preview re-run owed at the next available canary (recorded in doc 03c and the exit gate). Cost: the exit gate wording changes; Separations' compiled path is proven by structural scenario + equivalence + the R3 dry-run history, not a fresh live preview.
- **C.** Hold 3c-A open until a canary appears naturally. Cost: Phase 3 does not close; R4 waits indefinitely.

**Recommendation:** A if a document is at hand this week; otherwise B with the owed re-run recorded. Not C.

## 2. D314 wording — "another run" vs "another attempt"

**Situation.** `ref workflow-model` says the restart guard forbids replaying checkpoints ANOTHER RUN produced. R3b's review noted a requeued restart run legitimately replays its own earlier-attempt reads, so "another run" is either wrong or needs "of a different logical item" qualified.

- **A.** "another attempt of a different logical item" — precise; matches the executor (`tests/unit/run-executor-restart.test.ts` pins the foreign-run arm). Cost: one sentence in ref workflow-model + decisions pointer, done in R3d u35.
- **B.** Keep "another run" and add a clarifying footnote. Cost: same edit, less precise.

**Recommendation:** A.

## 3. D265 §1.2.2 rule 2 — annotate or rewrite

**Situation.** Rule 2 ("a declared category with no folder fails") cannot survive D312: the composition's one `workflow.ts` authors every identity, and `job-summary` carries no harness, so its folder would be empty. R3c annotated the rule as superseded by D312 §1.6.1 item 5 (a step folder exists iff it carries a harness) in `ab04231c`; the `workflow-layout` guard already enforces the new reading.

- **A.** Leave the dated annotation (current state). Cost: a reader meets the old sentence first.
- **B.** Rewrite the rule body to the new reading, keeping the dated note as history. Cost: one R3d u35 edit.

**Recommendation:** B.

## 4. T1b loader glue outside the four-artifact budget

**Situation.** `src/server/dry-run-scenario/compose.ts` and `manifests.ts` map each workflow id to its `dry-run.scenario.ts`. A new workflow must edit both — two touched files beyond D312's four. The u30 guard allowlists them citing D318/§10.9.

- **A.** Keep the explicit map + allowlist (current). Cost: every future workflow touches two server files; the "four artifacts" claim carries an asterisk.
- **B.** Derive the loader from the registry (`workflowSourcePath` → sibling `tests/scenario/workflows/<id>/dry-run.scenario.ts`), delete the map and the allowlist entries. Cost: one bounded code unit (R4 or a later run); the CLI-only dynamic-import rule must stay intact.

**Recommendation:** B, scheduled into R4 as a small unit; not a 3c-A blocker.

## 5. T1b manifests and a re-run of a completed item

**Situation.** A `live-read` re-run of an item already completed in the same authority root is attempt 2; the manifest pins attempt-1 checkpoint rows, so only `checkpoints` fails (row `0c8b2425…`). R3 and R3c both used a fresh root.

- **A.** Keep the manifest attempt-exact and document "T1b runs on a fresh authority root" in ref guards-and-tests §10.4 and the guide. Cost: one doc sentence (R3d).
- **B.** Let the manifest express checkpoint expectations attempt-relatively. Cost: a runner change plus tests; weakens the exactness D318 chose.

**Recommendation:** A.

## Notes

_(your free-text field)_
