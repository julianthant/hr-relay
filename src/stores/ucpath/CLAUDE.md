# UCPath store

The UCPath store exposes typed tasks through `driver-declaration.ts`, while raw Playwright access
stays beneath `driver/`. `driver/person-org-operation.ts` owns the Person Organizational Summary
navigation, search, result-grid, drill-in, assignment selection, and observed-subject checks.
Locator recipes live only in `driver/ui-registry.ts` and require matching fixture plus live-read-only
evidence before runtime use. The registry now holds **two** screen families: Person Organizational
Summary (2026-08-02) and the SS Smart HR **receipt** surface (2026-08-04). They share nothing but
the system id — different route, different frame model, different anchor style — so a guard that
means "Person Org" must say so rather than quantifying over the whole registry.

## Lessons learned

- **2026-08-12: the Person Org DETAIL page already carried the whole job summary — the port was
  throwing eleven twelfths of it away.** `extractDetail` read every *Employment Instances* row's
  twelve cells and then called `selectPreferredAssignmentDetails` to keep ONE. Separations chunk 3
  needed all of them, and the answer was not a second page visit or a second extraction: it was to
  return the raw cells and let each consumer parse them with its own strictness. `searchPersonOrg`
  keeps its exact derivation (which refuses a blank department, because a CANDIDATE without one is
  unusable); `readJobSummary` gives that same cell an `{state:"absent", reason}` arm, because a
  SEPARATION's identity check does not use the department and refusing there would fail a run over a
  cell it never reads. Widening `search-person-org`'s own output instead would have moved a schema
  hash shipped run records bind (D110/D114/D82) — which is why D194's convention says a new contract
  beside the old one, not a wider old one.
- **2026-08-12: the detail page renders "First Last" and Kuali renders "Last, First".** Live:
  `Drose Clauckia` / `Dreitho Cramia` against `Clauckia, Drose` / `Cramia, Dreitho`. The ported
  `classifyNameSimilarity` compares token MULTISETS and answers `same` for both, which is right —
  and is the reason the identity gate does not lean on the tier. The `T002173685` incident's own pair
  (`Hernandez, Jose Santos` vs `Santos Hernandez`) also classifies `same`, because the alignment
  tolerates extra tokens on the longer side. A tier-triggered wrong-person control would not have
  fired on the case it exists for.
- **2026-08-12: legacy's Job Summary page is a DIFFERENT page, and this store deliberately does not
  port it.** `WF_JOB_SUMMARY.GBL` carries the same per-employment facts across two LAZILY rendered
  tabs (`Work Location`, `Job Information`) with a frozen left column that has to be zipped back on
  by row count — three race-prone mechanisms for facts Person Org renders as one grid on one visit
  with anchors this store already live-verified. The one fact only legacy's page has is the
  effective-dated history per empl record ("what was this job on the separation date"), which is the
  termination-filing chunk's problem and a second page visit either way.

- **2026-08-04: A UCPath `T…` is not proof of success, and the receipt page is not where you'd
  guess.** The `receipt` completion arm reads SS Smart HR's transaction detail
  (`UC_EXTENSIONS.UC_SS_TBH.GBL`) — **not** the submit, and **not** the Smart HR Transaction Status
  dashboard, which has no Transaction ID column at all. Read the number and the approval status as a
  PAIR: a **Denied** transaction carries a perfectly well-formed `T…` (live `T002204014`; 300 Denied
  and 300 Pending rows existed on the day of the probe), so legacy's `/^T\d{6,}$/` test stamps a
  refused write as a successful receipt. Five more live facts, each of which breaks a plausible
  assumption: (1) the **bare** component URL is not a deep link and the URL is identical whether you
  are on the detail or back on the search form, so URL is never state evidence — the keyed
  `?Action=U&UC_TRANSACT_ID=T…` form *is* addressable and survives reload; (2) an **unknown** id
  renders the ordinary search form with no error, no banner, and no marker, so "the page loaded"
  proves nothing — assert the field resolved AND equals the requested id; (3) there is **no
  role+label anchor** (both values are bare spans with no label association), so the anchors are
  PeopleSoft `RECORD_FIELD` ids, the exact opposite of Kuali's role+exact-name rule; (4) that route
  renders **no iframe at all**, so legacy's `getContentFrame(page)` funnel resolves to nothing and
  the scope is `page`; (5) EID **discovery** is not a proof path — the grid caps at 100 rendered
  rows out of a server maximum of 300 (a count of exactly 300 means *truncated*), orders by the
  search key rather than recency, exposes no submitted-at column, and auto-drills to the detail when
  exactly one row matches. Carry the `T…` you fenced; search only in recovery. Doc 09 §13.6 owns the
  contract; the probe never created a transaction.

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
  (blob `e331e8a12523f3e824f89d7e151d02bbcdf54269`). The landing predicate keeps every legacy
  exclusion — the `ucpathdiscovery/disco` page, the SSO/Duo hosts, and PeopleSoft's classic-PIA
  `?cmd=login` / `?cmd=expire` landings, which sit on the SAME host as a real page and would
  otherwise read as success. **Superseded in part the same day — see the next two entries: that
  predicate was renamed `isUcpathPostSsoLanding` and is no longer a proof of anything.** Legacy's
  `waitForTimeout` settles and Duo poll loop did NOT come across: Duo Autopilot clears the ceremony,
  so the honest wait is a bounded `waitForURL` that fails loud by step.
- **2026-08-03: the ported landing predicate matched the PUBLIC portal, and the whole login was
  skipped behind it.** A cold live smoke reported success in ~3s having never reached
  `a5.ucsd.edu`. `isAuthenticatedUcpathAppUrl` was a host-substring test, and UC serves the public
  UCPath portal from inside that substring, so `already-authenticated` returned on an
  unauthenticated page — and that early return also skipped the SSO-form check. Three live findings
  fixed it: (1) the authenticated application is a PeopleSoft servlet route (`/psc/` or `/psp/`), so
  the old predicate is renamed `isUcpathPostSsoLanding` and is now only a WAIT target; (2) the proof
  is `PS_TOKEN` — PeopleSoft's single-signon cookie, absent on the signon page — plus the absence of
  both the TritON form and PeopleSoft's own `input#userid`/`input#pwd` signon form; and (3) the
  recipe is built by `defineVerifiedLoginRecipe`, so that proof runs on every return path.
- **2026-08-03: campus discovery moved, and the portal click resolves before the hop chain does.**
  Legacy's `ucpathdiscovery/disco` path no longer exists: UC serves "Select your UC location to log
  in" from the PeopleSoft host ROOT (`https://ucphrprdpub.universityofcalifornia.edu/`), which has no
  distinguishing path at all — so discovery is detected by its "University of California, San Diego"
  LINK, not by a URL. And `click()` resolves before the SAML chain finishes, so reading `page.url()`
  straight after it observes the page being left; `awaitLoginGate` waits for discovery, the SSO form,
  or the application, and reports WHICH. Live hop chain from cold (2026-08-03, ~17.4s to
  authenticated): `ucpath.ucsd.edu` → `ucphrprdpub…` (discovery) → `idpproxy-ucpath…` → `a5.ucsd.edu`
  → `api-*.duosecurity.com` → `a5.ucsd.edu` → `idpproxy-ucpath…` → `ucphrprdpub…`. The SSO chain
  returns to the portal, not to PeopleSoft, so the login's last hop navigates to the configured entry
  route before it can prove anything.
