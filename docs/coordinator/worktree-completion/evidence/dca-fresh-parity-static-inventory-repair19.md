# Repair19 — exact static a11y declaration inventory

Date: 2026-08-31  
Checkout: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`  
Branch/HEAD: `feature/dca4-archive-evidence` / `eda17b2708286e36542e1e18e9f8ef6a06cf3187`

## Finding and red gate

Independent Tests review found that `assertStaticRequiredA11yEvidence` proved every allowlisted name
appeared once but did not reject an additional `required-a11y-evidence` declaration. A typoed or new
runtime requirement could therefore escape the source inventory.

- Regression red, chunk `e2e778`, exit `1`: the real diagnostic spec was mutated with
  `unexpected.a11y.yml`; the focused D132 test failed because the old helper raised no exception.

## Smallest repair

- Extract every `requiredA11yEvidence(...)` call from each selected producer source.
- Refuse any call not composed solely of static `.a11y.yml` string literals.
- Compare the complete locale-independent sorted declaration list with the expected inventory.
- Preserve the existing per-name exactly-once assertions and add the unexpected-name mutation control.
- Extend the owning D132 lesson with the bidirectional inventory invariant.

No producer declaration, reporter, verifier runtime, schema, threshold, reference byte, product code,
browser behavior, or output path changed.

## Green proof

- Focused mutation gate, chunk `bd6c4a`, exit `0`: 1 selected test passed.
- Complete verifier + D132 focused gate, chunk `899610`, exit `0`: 2 files / 46 tests passed.
- Four-path `git diff --check`: exit `0`; index empty.

Final SHA-256 values before re-review:

- architecture inventory: `09599b603f11d929543348352a2dbe24f9dd038a370162b76da357320a54dc7d`
- D132 lesson: `7d8a2d50a9bc4f2d50b061caec905a500f3517c2459c45e7b68d2314e73fec8a`
- canonical-entry verifier: `d08157f683ba1ac2b22300f2fceabc24fe8d988f574b14e00780af89dad57b20`
- canonical-entry verifier test: `e836ab231f4e9083b4be698725a27a765f182648dec92a1a65c0647ef67fdd14`

Status: implementation and focused proof complete; Tests/Standards re-review and supervisor cross-axis
acceptance remain required before browser allocation.
