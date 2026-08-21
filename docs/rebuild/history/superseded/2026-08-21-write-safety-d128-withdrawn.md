# `reference/write-safety.md` — the D128 "what is required before this criterion can be met" block (withdrawn)

> **Withdrawn the same day it was written, by D135 (2026-08-04), and superseded.**
> `reference/write-safety.md` §3.4 records what actually happened: the write LANDS on the operator's
> own documents, the two causes were defects in this repository's driver, and the propagation window
> was measured. Kept verbatim; never cite as normative.

This block was the D128 conclusion — *"a target document at a workflow step that OWNS the field
being written, named by the operator … until then Phase 2's write half is BLOCKED"* — struck through
in place when D135 replaced it. Folding §3's as-built into one numbered section (cohesion plan R9
item 1) left no home for a struck-through block whose successor sits three paragraphs above it, so
it moves here whole.

---

### ~~What is required before this criterion can be met~~ — MET 2026-08-04 (D135)

**This block described the D128 conclusion, which D135 withdrew the same day; it is kept for the
record and is no longer in force.** It read: *"A target document at a workflow step that OWNS the
field being written, named by the operator. … Until then Phase 2's write half is BLOCKED, and doc
07's rule stands: write-heavy workflow migration may not begin."*

D128 was wrong about the target. Kuali's own `ActionPage` query reports step `Task 1 - Kristina &
TES` with `sectionSettings: edit` for the section holding `Timekeeper Name:*`, and the two things
actually hiding the write were defects in THIS repository's driver: a Kuali text gadget debounces
into the document model (~700 ms) and the run fenced and clicked inside that window, and `commit`
returned at REQUEST time so the verifier's `page.reload()` cancelled the in-flight save. Both are
fixed and both are proven on the wire per run. The controlled commit landed on doc **4489** and the
propagation window was measured over four write/restore cycles on doc **4490**, which is what moved
`recoveryAbsence` from `operator-only` to `stabilized`. The measured numbers are in
§Phase-2 controlled-commit as-built above. **Write-heavy workflow migration is no longer blocked by
this criterion** (each workflow still owes its own §3.2 controlled-commit proof).

---
