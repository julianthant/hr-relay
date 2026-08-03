# UCPath store

The UCPath store exposes typed tasks through `driver-declaration.ts`, while raw Playwright access
stays beneath `driver/`. `driver/person-org-operation.ts` owns the Person Organizational Summary
navigation, search, result-grid, drill-in, assignment selection, and observed-subject checks.
Locator recipes live only in `driver/ui-registry.ts` and require matching fixture plus live-read-only
evidence before runtime use.

## Lessons learned

- **2026-08-02: Person Org reads require positive page evidence and observed-subject binding.** The
  strict port is tied to legacy commit `793abe1f8265f3213ffe8a80d6cfd9860a32a1dc`, but it deliberately
  retires unsafe legacy fallbacks: it does not scan the body for a name, overwrite the displayed
  EID, turn extraction errors or missing grids into not-found, swallow field-clear failures, or turn
  drill failures into null. Current live PeopleSoft labels append “begins with,” so the old exact
  accessible-name recipes match zero; use the dual-evidenced stable IDs in the semantic registry.
- **2026-08-02: Person Org completeness is a View All state transition, not the currently rendered
  row count.** Before reading search results or Employment Instances, require exactly one
  context-scoped control. An enabled `View All` must be clicked and transition to `View N`; a
  disabled `View All` is the verified already-complete state. Missing, ambiguous, or unknown states
  fail loud. The generic legacy `viewAllLink()` row is split by two closed context bindings with
  unique canonical ids; sanitized counters remain evidence, not falsely attributed selector
  provenance. Returning from detail re-runs the result expansion because PeopleSoft may paginate it
  again, and assignment extraction spans every expanded `tdgbrPER_ASGN_EMP_VW$*` grid.
