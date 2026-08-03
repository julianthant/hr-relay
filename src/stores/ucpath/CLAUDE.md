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
- **2026-08-03: The login recipe lives in `session.ts` and verifies its landing twice.** `session.ts`
  is a sanctioned raw-browser owner, so UCPath's flow (portal → "Log in to UCPath" → campus
  discovery → Shibboleth) sits there rather than in the factory. Ported from legacy
  `793abe1f8265f3213ffe8a80d6cfd9860a32a1dc` `src/infra/auth/login.ts`
  (blob `c8e6656de394b52aebd174e2a243c9464a1678e6`) and `src/infra/auth/sso-fields.ts`
  (blob `e331e8a12523f3e824f89d7e151d02bbcdf54269`). `isAuthenticatedUcpathAppUrl` keeps every legacy
  exclusion — the `ucpathdiscovery/disco` page, the SSO/Duo hosts, and PeopleSoft's classic-PIA
  `?cmd=login` / `?cmd=expire` landings, which sit on the SAME host as a real page and would
  otherwise read as success — and success additionally requires the SSO form to be gone. Legacy's
  `waitForTimeout` settles and Duo poll loop did NOT come across: Duo Autopilot clears the ceremony,
  so the honest wait is a bounded `waitForURL` that fails loud by step.
