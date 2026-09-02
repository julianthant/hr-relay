# R2 research — Order 1 reuse, provenance, and live map

**Date:** 2026-09-02  
**Run branch/base:** `feature/03c-r2-order1-intake` / `81c74fb0e4114891ee3d1261ff27268833a7536d`  
**Legacy evidence HEAD:** `9d19e4141d57617e2bf895e21e34a5bd8f15047c`  
**Mode:** read-only intake; no compiler-dependent implementation and no external write

## Authority result

Doc 03c §Order 1/§b and refs task-contract, stores, dashboard-surfaces, guards-and-tests and
operator-trust settle every product/policy answer. There are no `you:` lines. The remaining gaps are
implementation and dated-live evidence, so R3 must fail/block on them rather than ask the operator to
choose a fallback.

## Reuse classification

| Workflow/step | Class | Current rebuild evidence | R3 seam |
|---|---|---|---|
| Person Search | REUSE | `src/stores/ucpath/tasks/search-person-org.ts`; current `src/workflows/person-lookup/descriptor.ts` Order 0 graph | Preserve current public behavior as the `search` mode. |
| UCPath Job Summary | REUSE | `src/stores/ucpath/tasks/read-job-summary.ts`; `src/stores/ucpath/index.ts` | Bind the existing rich read wherever Order 1 needs that page; do not rescrape it. |
| Person Match | CUSTOMIZE | Semantic-ready `src/stores/ucpath/driver/`; no Match operation or descriptor mode exists | Add one typed HR Tasks Search/Match driver operation, strict task contract and pure result fold without minting a workflow id. |
| Existing person result fold | REUSE/CUSTOMIZE | `workflow:person-lookup/read-active-status` proves the sessionless mini-store pattern | Keep Search behavior; add a distinct pure Match result contract rather than overloading active status. |
| I-9 common auth/session | REUSE | common SSO/Duo and browser store contracts; `src/stores/i9/session.ts` exists | Compose an I-9-specific verified login recipe with two current content facts. |
| I-9 search page | BUILD | `src/stores/i9/index.ts` is unwired and has zero tasks | Rich fixed `search-employees` page-visit task; strict grid parsing and typed no-result/access-unknown arms. |
| I-9 summary page | BUILD | no rebuild contract/driver/task | Rich fixed `read-form-summary` page-visit task; historical/modern route plus populated audit evidence. |
| I-9 terminal result | BUILD | no rebuild workflow | Pure mini-store fold to signed/unsigned/historical/not-found/unable-to-access/error without blank/default substitution. |

## Frozen-source provenance

| Evidence | Source blob/commit | Facts eligible to port only after live verification |
|---|---|---|
| Person Match orchestration | legacy `src/workflows/person-lookup/match.ts` @ `a1191411148add3ea4b5c0e2fc970ae74d1f99b6` | Name/DOB/SSN parsing, unavailable-identifier marker, typed Match question. |
| Person outcome folds | legacy `src/workflows/person-lookup/outcome.ts` @ `ced00079295d61f36c621701114eba51e9964aab` | Found/no-match/ambiguous/unknown distinctions and pure interpretation candidates. |
| UCPath HR Tasks navigation | legacy `src/systems/ucpath/navigate.ts` @ `773b52873f3c59ccc2498a51d60ac5834b2608e1` | HR Tasks surface, main iframe, search fields, trigger and result-grid facts; selectors still require D150 live re-verification. |
| I-9 workflow/input | legacy `src/workflows/i9-lookup/{workflow,schema}.ts`; workflow @ `a6625306aa8ae8c59f1cf7db0dda8c7447eec8e2` | First/last name search, optional SSN, signer status vocabulary; delegated-only legacy policy is not automatically the rebuild policy. |
| I-9 login | legacy `src/systems/i9/login.ts` @ `03355d70c6515468ad7b329a0e84843f631ef27a` | UCOP launch → WAYF → UCSD SSO/Duo → Tracker application, training-modal path. |
| I-9 search/signer | legacy `src/systems/i9/{search,signer}.ts` @ `597db3bd5cbdfc15f542c094e1b16cdbeb3153e2` | Search grid shape, eligible/incomplete actions, direct summary navigation and typed outcome candidates. |
| I-9 selectors | legacy `src/systems/i9/selectors.ts` @ `5b5bd4d88fdeb9f8e2ffbf70ef6ed0aef9934cfc` | Locator candidates only; the 2026-09-02 results below are current proof. |

The rebuild never imports or calls these legacy paths. Every port cites the fixed legacy commit and
source path; live page state wins when it differs.

## Live verification record

Session `r2i9` was launched headless with the repository's Duo Autopilot through
`playwright-cli`, used only for reads, then closed. `playwright-cli list` returned no browsers.

| Surface | 2026-09-02 result |
|---|---|
| Login route | UCOP launch link → WAYF UC San Diego → UCSD SSO → Duo → `wwwe.i9complete.com` succeeded. |
| Post-login notification | Required Training Notification appeared; Dismiss then Yes reached Home Page. |
| Login content facts | Dashboard link present; `#divSearchOptions` count exactly 1. These are content facts, not a URL-only success predicate. |
| Search dialog | After closing the unrelated product-announcement overlay: named dialog, clear-filter link, Last Name, First Name, Social Security Number, Profile ID, Employee ID and exact Search button each resolved once. No create/save/commit control was used. |
| Source-pinned record | Search by the already-repository-pinned profile reference returned one 9-cell row with populated profile/I-9/action leaves, but the action is now incomplete Section 1/2. Access-restricted alert was not visible. |
| Summary/audit | The old direct summary reference now yields System Warning. Heading/audit-header/signed-row locators remain unverified at the migration date and require a new eligible canary. No person values are recorded here. |

## Fail-loud differences from legacy

1. Legacy `i9/search.ts` logs and skips a short/malformed result row. R3 must throw a named schema
   error with row/shape evidence; shrinking a result set can fabricate not-found.
2. Legacy `i9/signer.ts` catches an access-alert `count()` failure and returns zero. R3 must preserve
   `unknown/error`; a failed distinction check cannot become not-restricted/not-found.
3. Legacy workflow projection writes `signerName: result.signerName ?? ""`. R3 must retain a typed
   discriminated result; absence is an explicit state, never an empty-string fallback.

## R3 proof/canary inputs

| Need | Exact requirement |
|---|---|
| Person Search T1b | Current label(s) covering the truthful name/EID input arms the manifest claims; values resolved through ignored secrets; same-day availability. |
| Person Match T1b/T3 | Current HR Tasks record with name and DOB plus at least one usable disambiguator; mode-specific ceremony and subject title; no committed person values. |
| I-9 T1b | New current access-visible record with an eligible completed action, modern summary, rendered audit header and non-empty Signed Section 2 Created By; the old source-pinned candidate is ineligible. |
| Negative branches | Synthetic structural scenarios for no-match, ambiguity, malformed schema, transient/permanent failure, subject mismatch and unknown. Never search for a real person merely to manufacture a negative arm. |
| Capability close | `legacy-workflow-person-lookup` and `legacy-workflow-i9-lookup` stay open until native workflows, proofs and live records land. Correct the I-9 entry's derived “pure UCPath read” wording to I-9 system read at that boundary. |

## R3-ready facts, not choices

- One `person-lookup` identity exposes Search and Match modes; a second workflow id is forbidden.
- I-9 is its own new browser store and workflow; it does not reuse a UCPath page even though it
  reuses UCSD SSO credentials/ceremony.
- Both workflows owe T1. Only the new person mode interaction owes T2/T3; I-9 ordinary projections
  ride registry-wide recipe conformance.
- No Order 1 workflow writes. Any transaction, controlled-commit target, probe policy, write
  freshness budget or mutation capability would be scope drift.
