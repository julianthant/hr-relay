# Decisions — DCA full-parity authority — 2026-08-31

_Answer positionally: `1 A`, `1 D + "note"`, or `all recommended`. Unanswered items stay open._

## 1 · Resolve the asserted-parity authority conflict

**Situation.** The exact candidate now passes full coverage (338 files, 3996 tests), typecheck,
lint, roadmap freshness, manifest freshness, and 37/37 scoped Gallery/Archive/Receipt browser tests.
The complete asserted parity suite runs 271 tests but reports 42 a11y-reference drifts. Twenty are
the ratified D292 Receipt behavior: live details with missing/uncomposed capture availability fail
loud instead of hiding the section. The other twenty-two are a pre-existing mismatch between
committed current descriptor/task fingerprints and stored references; no candidate-changed file is
in those fingerprint closures. The current instruction forbids reference updates, while completion
also requires full parity green, so both cannot be satisfied honestly on this checkout.

**Options.**

- **A. Authorize one deliberate exact reference refresh after review.** Refresh only the affected
  asserted references through `npm run test:parity:update`, review every semantic/pixel/meta delta,
  then rerun full asserted parity with `PARITY_UPDATE` unset. This preserves current product and
  diagnostic behavior, but explicitly relaxes the no-reference-update constraint for the reviewed
  affected set.
- **B. Waive the full-parity-green prerequisite for this branch.** Keep every reference immutable
  and permit logical commits with the 42 failures recorded as integration debt. This preserves the
  no-update constraint but hands off a knowingly red required gate.
- **C. Authorize source reversion to the stored references.** Revert unrelated committed
  termination/task diagnostics and change D292 so missing live capture availability is hidden. This
  can preserve the old references, but removes ratified fail-loud behavior and unrelated current
  diagnostics; it is the highest product-correctness risk.
- **D. Keep both original constraints and stop uncommitted.** Preserve the reviewed dirty candidate
  and all evidence without committing until another authority reconciles the reference ancestry.
  This changes no product or reference bytes, but the requested completion cannot occur.

**Recommendation.** **A** — it is the only option that keeps the current ratified behavior and
restores the full asserted gate as a truthful check rather than weakening code or acceptance.

**Notes.** _(your notes here)_

## Answers (2026-08-31)

| # | Chosen | Note |
| --- | --- | --- |
| 1 | A | Authorized one deliberate exact reference refresh after review, followed by a full asserted rerun with update mode unset. |
