/**
 * The New Kronos semantic UI registry — the closed set of screens, elements,
 * page states and observations the New Kronos driver may resolve.
 *
 * Sixteen elements across two screens, and not one more: this registry serves
 * the separations timecard READ, and an element nobody uses is an element
 * nobody verifies. Nothing here can click anything that mutates UKG — there is
 * no `external-commit` element in this store at all, which is the structural
 * half of "chunk 1 is read-only".
 *
 * Every element is a legacy PORT with exact provenance (legacy commit, path,
 * key, source line, blob) plus its own live read-only re-verification on
 * **2026-08-12** (D150: a selector checked against the live system beats one
 * diffed against legacy's copy of it). Four ports narrow deliberately, and each
 * narrowing is a safety fix rather than transcription:
 *
 *  - `timecard.payPeriodTriggerButton()` is a NAME-REGEX plus `.first()` in
 *    legacy. Live it matches **two** nodes — the icon-only trigger AND
 *    `#_timeFrame`, which is itself a button — so `.first()` was masking a real
 *    ambiguity. The port anchors on `button.select-timeframe-button`, counted
 *    live at exactly one.
 *  - `goToMenu.goToButtonOnPage()` chains `#goToDropdownButton` `.or()` a
 *    `.quick-find-content`-scoped name match. Live, `#goToDropdownButton`
 *    resolves to exactly one node in whichever context hosts the panel; the
 *    `.or()` arm exists only to survive a miss, and a miss here must be loud.
 *    `goToMenu.goToButtonInFrame()` is the SAME control in the other context,
 *    so it binds to the same canonical id rather than minting a second one.
 *  - `goToMenu.timecardItem()` is a four-deep `.or()` across
 *    frame/page × option/menuitem. Live, the menu renders `role=option` inside
 *    the panel's own context only, and the exact-name match counts one.
 *  - `search.firstResultSlat()` / `search.resultEmployeeId()` collapse into one
 *    element: the live slat carries `aria-label="Name <name> ID <eid>"`, so the
 *    row IS the identity. `search.resultEmployeeId()`'s `getByText(eid)` is not
 *    ported at all — a bare EID text match can hit the search box's own echo.
 *
 * NOT published as elements, on purpose: the timecard GRID and the timecard's
 * employee-name combobox. Legacy reaches the grid through `page.evaluate` with
 * no selector key at all, and the name combobox has no legacy key; both are
 * driver-internal and documented in the store's CLAUDE.md and the migration
 * doc's mapping appendix. Publishing a registry element with no ported row
 * would be a fabricated provenance, which the `semantic-ui-registry` guard
 * exists to prevent.
 */
import { z } from "zod";
import { deepFreeze } from "../../../domain/immutability.js";
import {
  BrowserSystemIdSchema,
  DateOnlySchema,
  ElementIdSchema,
  ObservationIdSchema,
  PageStateIdSchema,
  ScenarioIdSchema,
  ScreenIdSchema,
} from "../../../domain/ids.js";
import {
  UiEffectSchema,
  UiEvidenceReferenceSchema,
  UiPortMapRowReferenceSchema,
  UiRoleSchema,
  UiSensitivitySchema,
  UiVerificationEvidenceManifestSchema,
  UiVerificationScenarioSchema,
  UiVerificationSchema,
} from "../../../domain/ui/contracts.js";
import {
  NEW_KRONOS_EMPLOYEE_SEARCH_SCREEN,
  NEW_KRONOS_NO_RESULTS_SENTINEL,
  NEW_KRONOS_SEARCH_CLOSE_BUTTON,
  NEW_KRONOS_SEARCH_GO_TO_BUTTON,
  NEW_KRONOS_SEARCH_GO_TO_TIMECARD_OPTION,
  NEW_KRONOS_SEARCH_NO_RESULTS,
  NEW_KRONOS_SEARCH_NO_RESULTS_TEXT,
  NEW_KRONOS_SEARCH_OPEN_BUTTON,
  NEW_KRONOS_SEARCH_QUERY_FIELD,
  NEW_KRONOS_SEARCH_QUERY_LABEL,
  NEW_KRONOS_SEARCH_RESULTS_READY,
  NEW_KRONOS_SEARCH_RESULT_CHECKBOX,
  NEW_KRONOS_SEARCH_RESULT_SLAT,
  NEW_KRONOS_SEARCH_SUBMIT_BUTTON,
  NEW_KRONOS_TIMECARD_DISPLAYED_EID,
  NEW_KRONOS_TIMECARD_EMPLOYEE_ID,
  NEW_KRONOS_TIMECARD_PERIOD_LABEL,
  NEW_KRONOS_TIMECARD_PERIOD_TRIGGER,
  NEW_KRONOS_TIMECARD_RANGE_APPLIED,
  NEW_KRONOS_TIMECARD_RANGE_APPLY_BUTTON,
  NEW_KRONOS_TIMECARD_RANGE_END_FIELD,
  NEW_KRONOS_TIMECARD_RANGE_START_FIELD,
  NEW_KRONOS_TIMECARD_READY,
  NEW_KRONOS_TIMECARD_SCREEN,
  NEW_KRONOS_TIMECARD_SELECT_RANGE_BUTTON,
} from "../../../domain/ui/new-kronos-timecard.js";
import { PREFLIGHT_SCENARIO_MANIFESTS } from "../../../domain/trust/preflight-scenarios.js";

const LEGACY_COMMIT = "793abe1f8265f3213ffe8a80d6cfd9860a32a1dc";
const NEW_KRONOS_SELECTOR_BLOB = "4143290c85acf70d0730ad4c1c97b243bbd74208";
const FIXTURE_EVIDENCE = "evidence/ui/new-kronos/timecard.fixture.json";
const LIVE_EVIDENCE = "evidence/ui/new-kronos/timecard.live.json";
const SEARCH_SCENARIO = "ui/new-kronos-employee-search";
const TIMECARD_SCENARIO = "ui/new-kronos-timecard-read";

const VERIFIED_AT = "2026-08-12";

const GitBlobSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const LegacySelectorProvenanceSchema = z.strictObject({
  commit: z.literal(LEGACY_COMMIT),
  path: z.literal("src/systems/new-kronos/selectors.ts"),
  key: z.string().regex(/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*\(\)$/u),
  sourceLine: z.number().int().positive(),
  blob: GitBlobSchema,
  /** A silent narrowing is indistinguishable from a transcription error. */
  narrowedFromLegacy: z.string().min(1).optional(),
});

/**
 * WFD renders its search panel either inside `iframe[name^="portal-frame-"]` or
 * top-level, depending on how the page was reached — both were observed live on
 * 2026-08-12 minutes apart. `search-panel` means "resolve in whichever context
 * currently hosts the panel"; `page` means top-level only. The context is part
 * of the RECIPE because it is part of the identity: the same accessible name in
 * the wrong context is a different control.
 */
export const NewKronosLocatorContextSchema = z.enum(["search-panel", "page"]);

/**
 * Four recipe kinds, all anchored on something structural. There is no
 * substring match, no `.or()` chain, and no `.first()` on an ambiguous set:
 * every recipe below was counted live and resolves to exactly one node.
 */
export const NewKronosLocatorRecipeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("role-exact-name"),
    context: NewKronosLocatorContextSchema,
    role: z.enum(["textbox", "button", "checkbox", "option", "menuitemradio"]),
    name: z.string().min(1),
    exact: z.literal(true),
  }),
  z.strictObject({
    kind: z.literal("dom-id"),
    context: NewKronosLocatorContextSchema,
    /** The literal element id, e.g. `goToDropdownButton`. */
    domId: z.string().regex(/^[A-Za-z_][\w-]*$/u),
  }),
  z.strictObject({
    kind: z.literal("css"),
    context: NewKronosLocatorContextSchema,
    /** A single class/tag selector — never a comma-joined union. */
    selector: z.string().min(1).refine((value) => !value.includes(","), "css recipe may not union selectors"),
  }),
  z.strictObject({
    kind: z.literal("exact-text"),
    context: NewKronosLocatorContextSchema,
    text: z.string().min(1),
  }),
]);
export type NewKronosLocatorRecipe = z.infer<typeof NewKronosLocatorRecipeSchema>;

export const NewKronosStateEvidenceRuleSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("element"), element: ElementIdSchema }),
  /** `…/timekeeping#/timecard` — the route the Go To option lands on. */
  z.strictObject({ kind: z.literal("route"), path: z.string().min(1) }),
  /** The period label parses as an explicit `M/D/YYYY - M/D/YYYY` window. */
  z.strictObject({ kind: z.literal("parsed-range-label"), element: ElementIdSchema }),
]);

export const NewKronosObservationRecipeSchema = z.strictObject({
  kind: z.literal("element-text"),
  element: ElementIdSchema,
  /** WFD pads header text; every read trims. */
  trim: z.literal(true),
  valueType: z.enum(["eid", "text"]),
});

const ScreenDefinitionSchema = z.strictObject({
  id: ScreenIdSchema,
  system: BrowserSystemIdSchema,
  label: z.string().min(1),
  searchTerms: z.array(z.string().min(1)).min(1),
  sensitivity: UiSensitivitySchema,
  verification: UiVerificationSchema,
});

const ElementDefinitionSchema = z.strictObject({
  id: ElementIdSchema,
  system: BrowserSystemIdSchema,
  screen: ScreenIdSchema,
  label: z.string().min(1),
  searchTerms: z.array(z.string().min(1)).min(1),
  role: UiRoleSchema,
  effect: UiEffectSchema,
  sensitivity: UiSensitivitySchema,
  locator: NewKronosLocatorRecipeSchema,
  requiredStates: z.array(PageStateIdSchema),
  verification: UiVerificationSchema,
  provenance: LegacySelectorProvenanceSchema,
  supersedes: z.array(ElementIdSchema),
});

const PageStateDefinitionSchema = z.strictObject({
  id: PageStateIdSchema,
  system: BrowserSystemIdSchema,
  screen: ScreenIdSchema,
  label: z.string().min(1),
  searchTerms: z.array(z.string().min(1)).min(1),
  sensitivity: UiSensitivitySchema,
  evidence: z.array(NewKronosStateEvidenceRuleSchema).min(1),
  timeoutMs: z.number().int().positive(),
  verification: UiVerificationSchema,
});

const ObservationDefinitionSchema = z.strictObject({
  id: ObservationIdSchema,
  system: BrowserSystemIdSchema,
  screen: ScreenIdSchema,
  label: z.string().min(1),
  searchTerms: z.array(z.string().min(1)).min(1),
  sensitivity: UiSensitivitySchema,
  valueType: z.enum(["eid", "text"]),
  read: NewKronosObservationRecipeSchema,
  authoritativeFor: z.array(z.enum(["subject", "completion", "page-state"])).min(1),
  verification: UiVerificationSchema,
});

export const NewKronosUiRegistrySchema = z.strictObject({
  system: z.literal("new-kronos"),
  screens: z.array(ScreenDefinitionSchema).min(1),
  elements: z.array(ElementDefinitionSchema).min(1),
  states: z.array(PageStateDefinitionSchema).min(1),
  observations: z.array(ObservationDefinitionSchema).min(1),
  scenarios: z.array(UiVerificationScenarioSchema).min(1),
});
export type NewKronosUiRegistry = z.infer<typeof NewKronosUiRegistrySchema>;

export const NewKronosUiRegistryPortBindingSchema = z.strictObject({
  system: z.literal("new-kronos"),
  legacyKey: z.string().min(1),
  disposition: z.literal("ported"),
  semanticKind: z.literal("element"),
  canonicalId: ElementIdSchema,
  evidence: z.strictObject({
    verifiedAt: DateOnlySchema,
    fixtureEvidenceRef: UiEvidenceReferenceSchema,
    liveReadOnlyEvidenceRef: UiEvidenceReferenceSchema,
  }),
});

const NewKronosUiEvidenceBindingInputSchema = z.strictObject({
  evidenceByRef: z.record(UiEvidenceReferenceSchema, UiVerificationEvidenceManifestSchema),
  portBindings: z.array(NewKronosUiRegistryPortBindingSchema),
});

/** The WFD application host and the timecard route, both live-verified 2026-08-12. */
export const NEW_KRONOS_APP_HOST = "ucsd-sso.prd.mykronos.com";
export const NEW_KRONOS_TIMECARD_ROUTE = "/timekeeping#/timecard";
/** The iframe whose name suffix is session-scoped; only the PREFIX is stable. */
export const NEW_KRONOS_PORTAL_FRAME_SELECTOR = 'iframe[name^="portal-frame-"]';

function verification(scenario: string, legacyKey: string) {
  return {
    verifiedAt: DateOnlySchema.parse(VERIFIED_AT),
    fixtureEvidenceRef: FIXTURE_EVIDENCE,
    liveReadOnlyEvidenceRef: LIVE_EVIDENCE,
    scenarios: [ScenarioIdSchema.parse(scenario)],
    portMapRows: [{ system: "new-kronos" as const, legacyKey }],
  };
}

function provenance(key: string, sourceLine: number, narrowedFromLegacy?: string) {
  return {
    commit: LEGACY_COMMIT,
    path: "src/systems/new-kronos/selectors.ts" as const,
    key,
    sourceLine,
    blob: NEW_KRONOS_SELECTOR_BLOB,
    ...(narrowedFromLegacy === undefined ? {} : { narrowedFromLegacy }),
  };
}

export const NEW_KRONOS_UI_REGISTRY = deepFreeze(NewKronosUiRegistrySchema.parse({
  system: "new-kronos",
  screens: [
    {
      id: NEW_KRONOS_EMPLOYEE_SEARCH_SCREEN,
      system: "new-kronos",
      label: "New Kronos Employee Search panel",
      searchTerms: ["new kronos employee search panel screen"],
      sensitivity: "hr",
      verification: verification(SEARCH_SCENARIO, "navbar.employeeSearchButton()"),
    },
    {
      id: NEW_KRONOS_TIMECARD_SCREEN,
      system: "new-kronos",
      label: "New Kronos employee timecard",
      searchTerms: ["new kronos employee timecard screen"],
      sensitivity: "hr",
      verification: verification(TIMECARD_SCENARIO, "timecard.loadedEmployeeId()"),
    },
  ],
  elements: [
    {
      id: NEW_KRONOS_SEARCH_OPEN_BUTTON,
      system: "new-kronos",
      screen: NEW_KRONOS_EMPLOYEE_SEARCH_SCREEN,
      label: "Employee Search navbar button",
      searchTerms: ["new kronos employee search navbar button"],
      role: "button",
      effect: "navigate",
      sensitivity: "restricted",
      locator: { kind: "role-exact-name", context: "page", role: "button", name: "Employee Search", exact: true },
      requiredStates: [],
      verification: verification(SEARCH_SCENARIO, "navbar.employeeSearchButton()"),
      provenance: provenance("navbar.employeeSearchButton()", 48,
        "legacy takes .first() on the role match; the live navbar renders exactly one, so the port refuses a count other than one"),
      supersedes: [],
    },
    {
      id: NEW_KRONOS_SEARCH_QUERY_FIELD,
      system: "new-kronos",
      screen: NEW_KRONOS_EMPLOYEE_SEARCH_SCREEN,
      label: "Employee search query field",
      searchTerms: ["new kronos employee search query field"],
      role: "field",
      effect: "prepare",
      sensitivity: "hr",
      locator: {
        kind: "role-exact-name",
        context: "search-panel",
        role: "textbox",
        name: NEW_KRONOS_SEARCH_QUERY_LABEL,
        exact: true,
      },
      requiredStates: [],
      verification: verification(SEARCH_SCENARIO, "search.searchInput()"),
      provenance: provenance("search.searchInput()", 69),
      supersedes: [],
    },
    {
      id: NEW_KRONOS_SEARCH_SUBMIT_BUTTON,
      system: "new-kronos",
      screen: NEW_KRONOS_EMPLOYEE_SEARCH_SCREEN,
      label: "Employee search submit button",
      searchTerms: ["new kronos employee search submit button"],
      role: "button",
      effect: "navigate",
      sensitivity: "restricted",
      locator: { kind: "role-exact-name", context: "search-panel", role: "button", name: "Search", exact: true },
      requiredStates: [],
      verification: verification(SEARCH_SCENARIO, "search.searchSubmitButton()"),
      provenance: provenance("search.searchSubmitButton()", 76),
      supersedes: [],
    },
    {
      id: NEW_KRONOS_SEARCH_NO_RESULTS_TEXT,
      system: "new-kronos",
      screen: NEW_KRONOS_EMPLOYEE_SEARCH_SCREEN,
      label: "Employee search no-results sentinel",
      searchTerms: ["new kronos employee search no results sentinel"],
      role: "display",
      effect: "observe",
      sensitivity: "restricted",
      locator: { kind: "exact-text", context: "search-panel", text: NEW_KRONOS_NO_RESULTS_SENTINEL },
      requiredStates: [NEW_KRONOS_SEARCH_NO_RESULTS],
      verification: verification(SEARCH_SCENARIO, "search.noResultsText()"),
      provenance: provenance("search.noResultsText()", 83),
      supersedes: [],
    },
    {
      id: NEW_KRONOS_SEARCH_RESULT_SLAT,
      system: "new-kronos",
      screen: NEW_KRONOS_EMPLOYEE_SEARCH_SCREEN,
      label: "Employee search result row",
      searchTerms: ["new kronos employee search result row slat"],
      role: "row",
      effect: "observe",
      sensitivity: "hr",
      locator: { kind: "css", context: "search-panel", selector: "[role='menuitemradio']" },
      requiredStates: [NEW_KRONOS_SEARCH_RESULTS_READY],
      verification: verification(SEARCH_SCENARIO, "search.firstResultSlat()"),
      provenance: provenance("search.firstResultSlat()", 119,
        "legacy takes .first(); this port reads EVERY slat because the row itself carries \"Name <name> ID <eid>\" (its aria-label live 2026-08-12; the interpolated text of its krn-slats-tabular-data card live 2026-08-27, the aria-label being a feature-toggle-gated binding that was absent), which is the whole candidate list D194 requires. The row renders in stages and is read only once that text is interpolated (§9.28). search.resultEmployeeId()'s getByText(eid) is deliberately NOT ported — a bare EID text match can hit the search box's own echo of the query"),
      supersedes: [],
    },
    {
      id: NEW_KRONOS_SEARCH_RESULT_CHECKBOX,
      system: "new-kronos",
      screen: NEW_KRONOS_EMPLOYEE_SEARCH_SCREEN,
      label: "Employee search result Select Item checkbox",
      searchTerms: ["new kronos employee search select item checkbox"],
      role: "field",
      effect: "prepare",
      sensitivity: "restricted",
      locator: { kind: "role-exact-name", context: "search-panel", role: "checkbox", name: "Select Item", exact: true },
      requiredStates: [NEW_KRONOS_SEARCH_RESULTS_READY],
      verification: verification(SEARCH_SCENARIO, "search.firstResultCheckbox()"),
      provenance: provenance("search.firstResultCheckbox()", 96),
      supersedes: [],
    },
    {
      id: NEW_KRONOS_SEARCH_CLOSE_BUTTON,
      system: "new-kronos",
      screen: NEW_KRONOS_EMPLOYEE_SEARCH_SCREEN,
      label: "Employee Search close button",
      searchTerms: ["new kronos employee search close button"],
      role: "button",
      effect: "navigate",
      sensitivity: "restricted",
      locator: {
        kind: "role-exact-name",
        context: "search-panel",
        role: "button",
        name: "Employee Search Close",
        exact: true,
      },
      requiredStates: [],
      verification: verification(SEARCH_SCENARIO, "search.closeButton()"),
      provenance: provenance("search.closeButton()", 135),
      supersedes: [],
    },
    {
      id: NEW_KRONOS_SEARCH_GO_TO_BUTTON,
      system: "new-kronos",
      screen: NEW_KRONOS_EMPLOYEE_SEARCH_SCREEN,
      label: "Employee search Go To dropdown button",
      searchTerms: ["new kronos employee search go to dropdown button"],
      role: "button",
      effect: "navigate",
      sensitivity: "restricted",
      locator: { kind: "dom-id", context: "search-panel", domId: "goToDropdownButton" },
      requiredStates: [NEW_KRONOS_SEARCH_RESULTS_READY],
      verification: verification(SEARCH_SCENARIO, "goToMenu.goToButtonOnPage()"),
      provenance: provenance("goToMenu.goToButtonOnPage()", 157,
        "legacy chains #goToDropdownButton .or(.quick-find-content role=button /go to/i) .first(), and mints a SECOND key goToMenu.goToButtonInFrame() (:169) for the same control in the other context; the live id resolves to exactly one node in whichever context hosts the panel, so the fallback arm and the duplicate key are both dropped and the driver refuses a count other than one"),
      supersedes: [],
    },
    {
      id: NEW_KRONOS_SEARCH_GO_TO_TIMECARD_OPTION,
      system: "new-kronos",
      screen: NEW_KRONOS_EMPLOYEE_SEARCH_SCREEN,
      label: "Go To menu Timecard option",
      searchTerms: ["new kronos go to menu timecard option"],
      role: "button",
      effect: "navigate",
      sensitivity: "restricted",
      locator: { kind: "role-exact-name", context: "search-panel", role: "option", name: "Timecard", exact: true },
      requiredStates: [NEW_KRONOS_SEARCH_RESULTS_READY],
      verification: verification(SEARCH_SCENARIO, "goToMenu.timecardItem()"),
      provenance: provenance("goToMenu.timecardItem()", 192,
        "legacy unions frame/page x option/menuitem behind an anchored regex; live the menu renders role=option in the panel's own context only, with the COMPLETE option list Timecard/Schedule/People/Reports, and the exact-name match counts exactly one"),
      supersedes: [],
    },
    {
      id: NEW_KRONOS_TIMECARD_EMPLOYEE_ID,
      system: "new-kronos",
      screen: NEW_KRONOS_TIMECARD_SCREEN,
      label: "Timecard displayed employee id",
      searchTerms: ["new kronos timecard displayed employee id header"],
      role: "display",
      effect: "observe",
      sensitivity: "restricted",
      locator: { kind: "css", context: "page", selector: ".emp-nav-id" },
      requiredStates: [NEW_KRONOS_TIMECARD_READY],
      verification: verification(TIMECARD_SCENARIO, "timecard.loadedEmployeeId()"),
      provenance: provenance("timecard.loadedEmployeeId()", 231,
        "legacy takes .first(); the live timecard renders exactly one .emp-nav-id and this is the wrong-person control (S37), so a second match must refuse rather than pick"),
      supersedes: [],
    },
    {
      id: NEW_KRONOS_TIMECARD_PERIOD_TRIGGER,
      system: "new-kronos",
      screen: NEW_KRONOS_TIMECARD_SCREEN,
      label: "Timecard pay-period trigger button",
      searchTerms: ["new kronos timecard pay period trigger button"],
      role: "button",
      effect: "navigate",
      sensitivity: "restricted",
      locator: { kind: "css", context: "page", selector: "button.select-timeframe-button" },
      requiredStates: [NEW_KRONOS_TIMECARD_READY],
      verification: verification(TIMECARD_SCENARIO, "timecard.payPeriodTriggerButton()"),
      provenance: provenance("timecard.payPeriodTriggerButton()", 239,
        "legacy matches role=button by the name regex /Pay Period|Schedule Period|^\\d+\\/\\d+\\/\\d+/ and takes .first(); live that matches TWO nodes — the icon-only trigger and #_timeFrame, which is itself a button — so .first() was masking an ambiguity. The port anchors on the trigger's own class, counted live at exactly one"),
      supersedes: [],
    },
    {
      id: NEW_KRONOS_TIMECARD_PERIOD_LABEL,
      system: "new-kronos",
      screen: NEW_KRONOS_TIMECARD_SCREEN,
      label: "Timecard active-period label",
      searchTerms: ["new kronos timecard active period label"],
      role: "display",
      effect: "observe",
      sensitivity: "restricted",
      locator: { kind: "dom-id", context: "page", domId: "_timeFrame" },
      requiredStates: [NEW_KRONOS_TIMECARD_READY],
      verification: verification(TIMECARD_SCENARIO, "timecard.payPeriodLabel()"),
      provenance: provenance("timecard.payPeriodLabel()", 259,
        "legacy unions #_timeFrame with .selected-timeframe and takes .first(); live they are the SAME node, so the union is dropped for the id"),
      supersedes: [],
    },
    {
      id: NEW_KRONOS_TIMECARD_SELECT_RANGE_BUTTON,
      system: "new-kronos",
      screen: NEW_KRONOS_TIMECARD_SCREEN,
      label: "Timecard Select range button",
      searchTerms: ["new kronos timecard select range button"],
      role: "button",
      effect: "navigate",
      sensitivity: "restricted",
      locator: { kind: "role-exact-name", context: "page", role: "button", name: "Select range", exact: true },
      requiredStates: [NEW_KRONOS_TIMECARD_READY],
      verification: verification(TIMECARD_SCENARIO, "timecard.selectRangeButton()"),
      provenance: provenance("timecard.selectRangeButton()", 273),
      supersedes: [],
    },
    {
      id: NEW_KRONOS_TIMECARD_RANGE_START_FIELD,
      system: "new-kronos",
      screen: NEW_KRONOS_TIMECARD_SCREEN,
      label: "Timecard custom-range start date field",
      searchTerms: ["new kronos timecard range start date field"],
      role: "field",
      effect: "prepare",
      sensitivity: "restricted",
      locator: { kind: "dom-id", context: "page", domId: "startDateTimeInput" },
      requiredStates: [NEW_KRONOS_TIMECARD_READY],
      verification: verification(TIMECARD_SCENARIO, "timecard.startDateInput()"),
      provenance: provenance("timecard.startDateInput()", 283),
      supersedes: [],
    },
    {
      id: NEW_KRONOS_TIMECARD_RANGE_END_FIELD,
      system: "new-kronos",
      screen: NEW_KRONOS_TIMECARD_SCREEN,
      label: "Timecard custom-range end date field",
      searchTerms: ["new kronos timecard range end date field"],
      role: "field",
      effect: "prepare",
      sensitivity: "restricted",
      locator: { kind: "dom-id", context: "page", domId: "endDateTimeInput" },
      requiredStates: [NEW_KRONOS_TIMECARD_READY],
      verification: verification(TIMECARD_SCENARIO, "timecard.endDateInput()"),
      provenance: provenance("timecard.endDateInput()", 291),
      supersedes: [],
    },
    {
      id: NEW_KRONOS_TIMECARD_RANGE_APPLY_BUTTON,
      system: "new-kronos",
      screen: NEW_KRONOS_TIMECARD_SCREEN,
      label: "Timecard custom-range Apply button",
      searchTerms: ["new kronos timecard range apply button"],
      role: "button",
      effect: "navigate",
      sensitivity: "restricted",
      locator: { kind: "role-exact-name", context: "page", role: "button", name: "Apply", exact: true },
      requiredStates: [NEW_KRONOS_TIMECARD_READY],
      verification: verification(TIMECARD_SCENARIO, "timecard.applyButton()"),
      provenance: provenance("timecard.applyButton()", 330),
      supersedes: [],
    },
  ],
  states: [
    {
      id: NEW_KRONOS_SEARCH_RESULTS_READY,
      system: "new-kronos",
      screen: NEW_KRONOS_EMPLOYEE_SEARCH_SCREEN,
      label: "Employee search rendered at least one result row",
      searchTerms: ["new kronos employee search results ready state"],
      sensitivity: "hr",
      evidence: [{ kind: "element", element: NEW_KRONOS_SEARCH_RESULT_SLAT }],
      // The genuine no-results sentinel surfaced in 548ms live; 15s is a
      // generous bound on a slow grid, and elapsing it is `no-signal`, which
      // is its own outcome and never "not found" (S35).
      timeoutMs: 15_000,
      verification: verification(SEARCH_SCENARIO, "search.firstResultSlat()"),
    },
    {
      id: NEW_KRONOS_SEARCH_NO_RESULTS,
      system: "new-kronos",
      screen: NEW_KRONOS_EMPLOYEE_SEARCH_SCREEN,
      label: "Employee search rendered WFD's own no-results sentinel",
      searchTerms: ["new kronos employee search no results state"],
      sensitivity: "restricted",
      evidence: [{ kind: "element", element: NEW_KRONOS_SEARCH_NO_RESULTS_TEXT }],
      timeoutMs: 15_000,
      verification: verification(SEARCH_SCENARIO, "search.noResultsText()"),
    },
    {
      id: NEW_KRONOS_TIMECARD_READY,
      system: "new-kronos",
      screen: NEW_KRONOS_TIMECARD_SCREEN,
      label: "Timecard loaded and identifiable",
      searchTerms: ["new kronos timecard ready state"],
      sensitivity: "restricted",
      evidence: [
        { kind: "route", path: NEW_KRONOS_TIMECARD_ROUTE },
        { kind: "element", element: NEW_KRONOS_TIMECARD_EMPLOYEE_ID },
      ],
      // Go To -> Timecard measured 6.2s live on a warm session; 45s covers a
      // cold one without ever standing in for a failed navigation.
      timeoutMs: 45_000,
      verification: verification(TIMECARD_SCENARIO, "timecard.loadedEmployeeId()"),
    },
    {
      id: NEW_KRONOS_TIMECARD_RANGE_APPLIED,
      system: "new-kronos",
      screen: NEW_KRONOS_TIMECARD_SCREEN,
      label: "Timecard showing an explicit custom date range",
      searchTerms: ["new kronos timecard range applied state"],
      sensitivity: "restricted",
      // The label must PARSE as a window, not merely differ from before: that
      // is what turns S40 into a value comparison instead of a change check.
      evidence: [{ kind: "parsed-range-label", element: NEW_KRONOS_TIMECARD_PERIOD_LABEL }],
      // Apply -> grid repaint measured 6.1s live.
      timeoutMs: 45_000,
      verification: verification(TIMECARD_SCENARIO, "timecard.payPeriodLabel()"),
    },
  ],
  observations: [
    {
      id: NEW_KRONOS_TIMECARD_DISPLAYED_EID,
      system: "new-kronos",
      screen: NEW_KRONOS_TIMECARD_SCREEN,
      label: "Displayed timecard employee id",
      searchTerms: ["authoritative new kronos timecard displayed employee id"],
      sensitivity: "restricted",
      valueType: "eid",
      read: { kind: "element-text", element: NEW_KRONOS_TIMECARD_EMPLOYEE_ID, trim: true, valueType: "eid" },
      authoritativeFor: ["subject"],
      verification: verification(TIMECARD_SCENARIO, "timecard.loadedEmployeeId()"),
    },
  ],
  scenarios: [
    {
      id: SEARCH_SCENARIO,
      kind: "ui-verification",
      title: "New Kronos employee search resolves candidates in either render context",
      system: "new-kronos",
      semanticIds: [
        NEW_KRONOS_SEARCH_OPEN_BUTTON,
        NEW_KRONOS_SEARCH_QUERY_FIELD,
        NEW_KRONOS_SEARCH_SUBMIT_BUTTON,
        NEW_KRONOS_SEARCH_NO_RESULTS_TEXT,
        NEW_KRONOS_SEARCH_RESULT_SLAT,
        NEW_KRONOS_SEARCH_RESULT_CHECKBOX,
        NEW_KRONOS_SEARCH_CLOSE_BUTTON,
        NEW_KRONOS_SEARCH_GO_TO_BUTTON,
        NEW_KRONOS_SEARCH_GO_TO_TIMECARD_OPTION,
        NEW_KRONOS_EMPLOYEE_SEARCH_SCREEN,
        NEW_KRONOS_SEARCH_RESULTS_READY,
        NEW_KRONOS_SEARCH_NO_RESULTS,
      ],
      fixtureEvidenceRef: FIXTURE_EVIDENCE,
      liveReadOnlyEvidenceRef: LIVE_EVIDENCE,
      assertions: ["recipe-resolves", "exactly-one-visible"],
    },
    {
      id: TIMECARD_SCENARIO,
      kind: "ui-verification",
      title: "The New Kronos timecard proves its own subject and its applied window",
      system: "new-kronos",
      semanticIds: [
        NEW_KRONOS_TIMECARD_EMPLOYEE_ID,
        NEW_KRONOS_TIMECARD_PERIOD_TRIGGER,
        NEW_KRONOS_TIMECARD_PERIOD_LABEL,
        NEW_KRONOS_TIMECARD_SELECT_RANGE_BUTTON,
        NEW_KRONOS_TIMECARD_RANGE_START_FIELD,
        NEW_KRONOS_TIMECARD_RANGE_END_FIELD,
        NEW_KRONOS_TIMECARD_RANGE_APPLY_BUTTON,
        NEW_KRONOS_TIMECARD_SCREEN,
        NEW_KRONOS_TIMECARD_READY,
        NEW_KRONOS_TIMECARD_RANGE_APPLIED,
        NEW_KRONOS_TIMECARD_DISPLAYED_EID,
      ],
      fixtureEvidenceRef: FIXTURE_EVIDENCE,
      liveReadOnlyEvidenceRef: LIVE_EVIDENCE,
      assertions: ["recipe-resolves", "exactly-one-visible"],
    },
  ],
}));

export function auditNewKronosUiRegistry(
  registryInput: unknown = NEW_KRONOS_UI_REGISTRY,
): readonly string[] {
  const result = NewKronosUiRegistrySchema.safeParse(registryInput);
  if (!result.success) return result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  const registry = result.data;
  const issues: string[] = [];
  const allIds = [
    ...registry.screens.map(({ id }) => id),
    ...registry.elements.map(({ id }) => id),
    ...registry.states.map(({ id }) => id),
    ...registry.observations.map(({ id }) => id),
  ];
  if (new Set(allIds).size !== allIds.length) {
    issues.push("New Kronos semantic UI ids must be globally unique");
  }
  const searchTerms = [...registry.screens, ...registry.elements, ...registry.states, ...registry.observations]
    .flatMap((fact) => fact.searchTerms.map((term) => term.trim().toLowerCase()));
  if (new Set(searchTerms).size !== searchTerms.length) {
    issues.push("New Kronos search terms must resolve to one canonical id");
  }
  const screens = new Set(registry.screens.map(({ id }) => id));
  const elements = new Map(registry.elements.map((element) => [element.id, element]));
  const states = new Map(registry.states.map((state) => [state.id, state]));
  const scenarios = new Set(registry.scenarios.map(({ id }) => id));
  const facts = [...registry.screens, ...registry.elements, ...registry.states, ...registry.observations];
  for (const fact of facts) {
    if (fact.system !== "new-kronos") issues.push(`${fact.id} crosses a system boundary`);
    for (const scenario of fact.verification.scenarios) {
      if (!scenarios.has(scenario)) issues.push(`${fact.id} references unknown verification scenario ${scenario}`);
    }
  }
  for (const fact of [...registry.elements, ...registry.states, ...registry.observations]) {
    if (!screens.has(fact.screen)) issues.push(`${fact.id} references an unknown New Kronos screen`);
  }
  for (const element of registry.elements) {
    for (const state of element.requiredStates) {
      const stateDefinition = states.get(state);
      if (stateDefinition === undefined) issues.push(`${element.id} references unknown state ${state}`);
      else if (stateDefinition.screen !== element.screen) issues.push(`${element.id} required state crosses screens`);
    }
    // Chunk 1 is structurally read-only: this store has no way to mutate UKG,
    // and a future write slice must add the element deliberately, not inherit
    // the capability from a registry that already allowed it.
    if (element.effect === "external-commit") {
      issues.push(`${element.id} may not claim the external-commit effect in a read-only store`);
    }
  }
  for (const state of registry.states) {
    for (const evidence of state.evidence) {
      if (evidence.kind !== "route" && !elements.has(evidence.element)) {
        issues.push(`${state.id} references unknown evidence element ${evidence.element}`);
      }
    }
  }
  for (const observation of registry.observations) {
    if (!elements.has(observation.read.element)) {
      issues.push(`${observation.id} reads an unknown New Kronos element`);
    }
  }
  const subjectObservations = registry.observations.filter(({ authoritativeFor }) =>
    authoritativeFor.includes("subject"));
  if (subjectObservations.length !== 1) {
    issues.push("New Kronos must expose exactly one subject-authoritative observation for the timecard read");
  }
  const globalScenarioIds = [
    ...PREFLIGHT_SCENARIO_MANIFESTS.map(({ id }) => ScenarioIdSchema.parse(id)),
    ...registry.scenarios.map(({ id }) => id),
  ];
  if (new Set(globalScenarioIds).size !== globalScenarioIds.length) {
    issues.push("New Kronos UI scenario ids must be globally unique");
  }
  const semanticIds = new Set(allIds);
  const referencedScenarios = new Set(facts.flatMap(({ verification: value }) => value.scenarios));
  for (const scenario of registry.scenarios) {
    for (const id of scenario.semanticIds) {
      if (!semanticIds.has(id)) issues.push(`${scenario.id} references unknown New Kronos semantic id ${id}`);
    }
    if (!referencedScenarios.has(scenario.id)) {
      issues.push(`New Kronos verification scenario ${scenario.id} is vacuous`);
    }
  }
  return issues;
}

function portRowKey(row: z.infer<typeof UiPortMapRowReferenceSchema>): string {
  return `${row.system}:${row.legacyKey}`;
}

export function auditNewKronosUiEvidenceBindings(input: unknown): readonly string[] {
  const parsed = NewKronosUiEvidenceBindingInputSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  const { evidenceByRef, portBindings } = parsed.data;
  const issues: string[] = [];
  const facts = [
    ...NEW_KRONOS_UI_REGISTRY.screens.map((fact) => ({ ...fact, screen: fact.id })),
    ...NEW_KRONOS_UI_REGISTRY.elements,
    ...NEW_KRONOS_UI_REGISTRY.states,
    ...NEW_KRONOS_UI_REGISTRY.observations,
  ];
  const factsById = new Map(facts.map((fact) => [fact.id, fact]));
  const bindingsByRow = new Map(portBindings.map((binding) => [
    portRowKey({ system: binding.system, legacyKey: binding.legacyKey }),
    binding,
  ]));
  for (const fact of facts) {
    const expectedRows = fact.verification.portMapRows.map(portRowKey);
    for (const row of fact.verification.portMapRows) {
      if (!bindingsByRow.has(portRowKey(row))) {
        issues.push(`${fact.id} references unknown New Kronos port-map row ${portRowKey(row)}`);
      }
    }
    const evidenceRefs = [
      [fact.verification.fixtureEvidenceRef, "deterministic-fixture"],
      [fact.verification.liveReadOnlyEvidenceRef, "live-read-only"],
    ] as const;
    for (const [ref, evidenceKind] of evidenceRefs) {
      const manifest = evidenceByRef[ref];
      if (manifest === undefined) {
        issues.push(`${fact.id} is missing New Kronos evidence manifest ${ref}`);
        continue;
      }
      if (manifest.evidenceKind !== evidenceKind) issues.push(`${fact.id} ${ref} has the wrong evidence kind`);
      if (manifest.system !== "new-kronos") issues.push(`${fact.id} ${ref} crosses systems`);
      if (manifest.externalWriteAttempted !== false) issues.push(`${fact.id} ${ref} claims an external write`);
      if (manifest.verifiedAt !== fact.verification.verifiedAt) {
        issues.push(`${fact.id} ${ref} verification date drifted`);
      }
      if (!manifest.screens.includes(fact.screen)) issues.push(`${fact.id} ${ref} omits screen ${fact.screen}`);
      const assertions = manifest.assertions.filter(({ semanticId }) => semanticId === fact.id);
      if (assertions.length !== 1) issues.push(`${fact.id} ${ref} must have exactly one evidence assertion`);
      for (const assertion of assertions) {
        if (assertion.screen !== fact.screen) issues.push(`${fact.id} ${ref} assertion screen drifted`);
        if (!fact.verification.scenarios.includes(assertion.scenarioId)) {
          issues.push(`${fact.id} ${ref} assertion scenario drifted`);
        }
        if (JSON.stringify(assertion.portMapRows.map(portRowKey)) !== JSON.stringify(expectedRows)) {
          issues.push(`${fact.id} ${ref} assertion port-map rows drifted`);
        }
      }
    }
  }
  for (const [ref, manifest] of Object.entries(evidenceByRef)) {
    for (const assertion of manifest.assertions) {
      if (!factsById.has(assertion.semanticId)) {
        issues.push(`${ref} asserts unknown New Kronos semantic id ${assertion.semanticId}`);
      }
    }
  }
  for (const element of NEW_KRONOS_UI_REGISTRY.elements) {
    const binding = bindingsByRow.get(portRowKey({ system: "new-kronos", legacyKey: element.provenance.key }));
    if (binding === undefined || binding.canonicalId !== element.id) {
      issues.push(`${element.id} does not resolve to its exact New Kronos ported row`);
      continue;
    }
    if (binding.evidence.verifiedAt !== element.verification.verifiedAt
      || binding.evidence.fixtureEvidenceRef !== element.verification.fixtureEvidenceRef
      || binding.evidence.liveReadOnlyEvidenceRef !== element.verification.liveReadOnlyEvidenceRef) {
      issues.push(`${element.id} New Kronos port-map evidence drifted`);
    }
  }
  return issues;
}
