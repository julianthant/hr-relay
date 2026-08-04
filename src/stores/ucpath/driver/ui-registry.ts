import { z } from "zod";
import { deepFreeze } from "../../../domain/immutability.js";
import {
  BrowserSystemIdSchema,
  DateOnlySchema,
  EidSchema,
  ElementIdSchema,
  ObservationIdSchema,
  PageStateIdSchema,
  ScenarioIdSchema,
  ScreenIdSchema,
} from "../../../domain/ids.js";
import {
  UiEffectSchema,
  UiRoleSchema,
  UiSensitivitySchema,
  UiEvidenceReferenceSchema,
  UiPortMapRowReferenceSchema,
  UiVerificationEvidenceManifestSchema,
  UiVerificationScenarioSchema,
  UiVerificationSchema,
} from "../../../domain/ui/contracts.js";
import {
  UCPATH_PERSON_ORG_ASSIGNMENTS_GRID,
  UCPATH_PERSON_ORG_DETAIL_READY,
  UCPATH_PERSON_ORG_DETAIL_SCREEN,
  UCPATH_PERSON_ORG_DISPLAYED_EID,
  UCPATH_PERSON_ORG_DISPLAYED_NAME,
  UCPATH_PERSON_ORG_EID_DISPLAY,
  UCPATH_PERSON_ORG_EID_INPUT,
  UCPATH_PERSON_ORG_EMPLOYMENT_VIEW_TOGGLE,
  UCPATH_PERSON_ORG_GIVEN_NAME_INPUT,
  UCPATH_PERSON_ORG_LAST_NAME_INPUT,
  UCPATH_PERSON_ORG_NAME_DISPLAY,
  UCPATH_PERSON_ORG_NAVIGATION_LINK,
  UCPATH_PERSON_ORG_NO_RESULTS,
  UCPATH_PERSON_ORG_NO_RESULTS_STATUS,
  UCPATH_PERSON_ORG_RESULTS_GRID,
  UCPATH_PERSON_ORG_RESULTS_READY,
  UCPATH_PERSON_ORG_RESULTS_VIEW_TOGGLE,
  UCPATH_PERSON_ORG_RESULT_DRILL_IN,
  UCPATH_PERSON_ORG_RETURN_TO_SEARCH,
  UCPATH_PERSON_ORG_SEARCH_BUTTON,
  UCPATH_PERSON_ORG_SEARCH_READY,
  UCPATH_PERSON_ORG_SEARCH_SCREEN,
} from "../../../domain/ui/ucpath-person-org.js";
import { PREFLIGHT_SCENARIO_MANIFESTS } from "../../../domain/trust/preflight-scenarios.js";

const LEGACY_COMMIT = "793abe1f8265f3213ffe8a80d6cfd9860a32a1dc";
const UCPATH_SELECTOR_BLOB = "695d88fcc7a108f262b91b45eb1b9a276deaf427";
const FIXTURE_EVIDENCE = "evidence/ui/ucpath/person-org.fixture.json";
const LIVE_EVIDENCE = "evidence/ui/ucpath/person-org.live.json";
const SEARCH_SCENARIO = "ui/ucpath-person-org-search-eid-input";
const RESULTS_SCENARIO = "ui/ucpath-person-org-results-grid";
const DISPLAY_SCENARIO = "ui/ucpath-person-org-displayed-eid";
const NAVIGATION_PORT_KEY = "hrTasks.personOrgSummaryLink()";
const INPUT_PORT_KEY = "personOrgSummary.emplIdInput()";
const LAST_NAME_PORT_KEY = "personOrgSummary.lastNameInput()";
const GIVEN_NAME_PORT_KEY = "personOrgSummary.nameInput()";
const SEARCH_BUTTON_PORT_KEY = "personOrgSummary.searchButton()";
const NO_RESULTS_PORT_KEY = "personOrgSummary.noMatchingValuesText()";
const RESULTS_GRID_PORT_KEY = "personOrgSummary.resultsTable()";
const VIEW_ALL_PORT_KEY = "personOrgSummary.viewAllLink()";
const DRILL_IN_PORT_KEY = "personOrgSummary.drillInButton()";
const DISPLAY_PORT_KEY = "personOrgSummary.personIdValue()";
const NAME_DISPLAY_PORT_KEY = "personOrgSummary.personNameValue()";
const ASSIGNMENTS_GRID_PORT_KEY = "personOrgSummary.body()";
const RETURN_PORT_KEY = "personOrgSummary.returnToSearchButton()";

const GitBlobSchema = z.string().regex(/^[0-9a-f]{40}$/);
const LegacySelectorProvenanceSchema = z.strictObject({
  commit: z.literal(LEGACY_COMMIT),
  path: z.literal("src/systems/ucpath/selectors.ts"),
  key: z.string().regex(/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*\(\)$/),
  sourceLine: z.number().int().positive(),
  blob: GitBlobSchema,
});
const UiPortContextSchema = z.enum([
  "search-results-view-toggle",
  "employment-instances-view-toggle",
]);

export const LocatorRecipeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("role"),
    role: z.enum(["textbox", "link", "button"]),
    name: z.string().min(1),
    exact: z.boolean(),
  }),
  z.strictObject({ kind: z.literal("css"), selector: z.string().min(1) }),
  z.strictObject({
    kind: z.literal("view-toggle"),
    headerSelector: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("indexed-css"),
    selectorPrefix: z.string().min(1),
    selectorSuffix: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("css-fallback"),
    selectors: z.array(z.string().min(1)).min(2),
  }),
]);

export const StateEvidenceRuleSchema = z.strictObject({
  kind: z.literal("visible"),
  element: ElementIdSchema,
});

export const ObservationRecipeSchema = z.strictObject({
  kind: z.literal("element-text"),
  element: ElementIdSchema,
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
  valueType: z.enum(["eid", "text", "rows", "none"]),
  scope: z.enum(["page", "content-frame"]),
  locator: LocatorRecipeSchema,
  requiredStates: z.array(PageStateIdSchema),
  verification: UiVerificationSchema,
  provenance: LegacySelectorProvenanceSchema,
  portContext: UiPortContextSchema.optional(),
  supersedes: z.array(ElementIdSchema),
});

const PageStateDefinitionSchema = z.strictObject({
  id: PageStateIdSchema,
  system: BrowserSystemIdSchema,
  screen: ScreenIdSchema,
  label: z.string().min(1),
  searchTerms: z.array(z.string().min(1)).min(1),
  sensitivity: UiSensitivitySchema,
  evidence: z.array(StateEvidenceRuleSchema).min(1),
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
  read: ObservationRecipeSchema,
  authoritativeFor: z.array(z.enum(["subject", "completion", "page-state"])).min(1),
  verification: UiVerificationSchema,
});

const DriverRootRecipeSchema = z.strictObject({
  kind: z.literal("content-frame"),
  selector: z.literal("#main_target_win0"),
  verification: UiVerificationSchema,
  provenance: LegacySelectorProvenanceSchema,
});

export const UiRegistrySchema = z.strictObject({
  system: BrowserSystemIdSchema,
  root: DriverRootRecipeSchema,
  screens: z.array(ScreenDefinitionSchema).min(1),
  elements: z.array(ElementDefinitionSchema).min(1),
  states: z.array(PageStateDefinitionSchema).min(1),
  observations: z.array(ObservationDefinitionSchema).min(1),
  scenarios: z.array(UiVerificationScenarioSchema).min(1),
});

export const UiRegistryPortBindingSchema = z.union([
  z.strictObject({
    system: BrowserSystemIdSchema,
    legacyKey: z.string().min(1),
    disposition: z.literal("ported"),
    semanticKind: z.literal("element"),
    canonicalId: ElementIdSchema,
    evidence: z.strictObject({
      verifiedAt: DateOnlySchema,
      fixtureEvidenceRef: UiEvidenceReferenceSchema,
      liveReadOnlyEvidenceRef: UiEvidenceReferenceSchema,
    }),
  }),
  z.strictObject({
    system: BrowserSystemIdSchema,
    legacyKey: z.string().min(1),
    disposition: z.literal("ported"),
    semanticKind: z.literal("element"),
    canonicalBindings: z.array(z.strictObject({
      context: UiPortContextSchema,
      canonicalId: ElementIdSchema,
    })).min(2),
    evidence: z.strictObject({
      verifiedAt: DateOnlySchema,
      fixtureEvidenceRef: UiEvidenceReferenceSchema,
      liveReadOnlyEvidenceRef: UiEvidenceReferenceSchema,
    }),
  }),
  z.strictObject({
    system: BrowserSystemIdSchema,
    legacyKey: z.string().min(1),
    disposition: z.literal("driver-internal"),
    semanticKind: z.literal("driver-internal"),
  }),
]);

const UiEvidenceBindingInputSchema = z.strictObject({
  evidenceByRef: z.record(UiEvidenceReferenceSchema, UiVerificationEvidenceManifestSchema),
  portBindings: z.array(UiRegistryPortBindingSchema),
});

function verification(scenario: string, legacyKey: string) {
  return {
    verifiedAt: DateOnlySchema.parse("2026-08-02"),
    fixtureEvidenceRef: FIXTURE_EVIDENCE,
    liveReadOnlyEvidenceRef: LIVE_EVIDENCE,
    scenarios: [ScenarioIdSchema.parse(scenario)],
    portMapRows: [{ system: "ucpath" as const, legacyKey }],
  };
}

function selectorProvenance(key: string, sourceLine: number) {
  return {
    commit: LEGACY_COMMIT,
    path: "src/systems/ucpath/selectors.ts" as const,
    key,
    sourceLine,
    blob: UCPATH_SELECTOR_BLOB,
  };
}

export const UCPATH_UI_REGISTRY = deepFreeze(UiRegistrySchema.parse({
  system: "ucpath",
  root: {
    kind: "content-frame",
    selector: "#main_target_win0",
    verification: verification(SEARCH_SCENARIO, "getContentFrame()"),
    provenance: {
      commit: LEGACY_COMMIT,
      path: "src/systems/ucpath/selectors.ts",
      key: "getContentFrame()",
      sourceLine: 41,
      blob: UCPATH_SELECTOR_BLOB,
    },
  },
  screens: [
    {
      id: UCPATH_PERSON_ORG_SEARCH_SCREEN,
      system: "ucpath",
      label: "Person Organizational Summary search",
      searchTerms: ["ucpath person org search screen"],
      sensitivity: "hr",
      verification: verification(SEARCH_SCENARIO, INPUT_PORT_KEY),
    },
    {
      id: UCPATH_PERSON_ORG_DETAIL_SCREEN,
      system: "ucpath",
      label: "Person Organizational Summary detail",
      searchTerms: ["ucpath person org detail screen"],
      sensitivity: "hr",
      verification: verification(DISPLAY_SCENARIO, DISPLAY_PORT_KEY),
    },
  ],
  elements: [
    {
      id: UCPATH_PERSON_ORG_NAVIGATION_LINK,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_SEARCH_SCREEN,
      label: "Person Organizational Summary navigation link",
      searchTerms: ["ucpath person org navigation link"],
      role: "link",
      effect: "navigate",
      sensitivity: "hr",
      valueType: "none",
      scope: "page",
      // Legacy's exact accessible-name recipe (legacy 793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
      // src/systems/ucpath/selectors.ts:684) matches ZERO live: the step is a
      // `div[role=link]` whose label span ("Step Label") is visually suppressed
      // but still part of the computed name, so the page renders it as
      // "Step LabelPerson Organizational Summary". The structural anchor below
      // is PeopleSoft's own nav-collection attribute carrying the exact label.
      // verified 2026-08-04Z (2026-08-03 local) — matched exactly one element
      // live, and drove a real EID 10873698 read to its detail page. A miss
      // stays a loud `waitFor` failure; there is no second candidate to fall
      // back to.
      locator: { kind: "css", selector: "[role=\"link\"][steplabel=\"Person Organizational Summary\"]" },
      requiredStates: [],
      verification: verification(SEARCH_SCENARIO, NAVIGATION_PORT_KEY),
      provenance: selectorProvenance(NAVIGATION_PORT_KEY, 684),
      supersedes: [],
    },
    {
      id: UCPATH_PERSON_ORG_EID_INPUT,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_SEARCH_SCREEN,
      label: "Person Org EID input",
      searchTerms: ["person org eid input", "ucpath person org search eid"],
      role: "field",
      effect: "prepare",
      sensitivity: "hr",
      valueType: "eid",
      scope: "content-frame",
      // Legacy's exact accessible-name recipe now matches zero because PeopleSoft appends
      // "begins with". The exact stable id below matched once live on 2026-08-02.
      locator: { kind: "css", selector: "#UC_ORG_SUM_VW_EMPLID" },
      requiredStates: [UCPATH_PERSON_ORG_SEARCH_READY],
      verification: verification(SEARCH_SCENARIO, INPUT_PORT_KEY),
      provenance: selectorProvenance(INPUT_PORT_KEY, 908),
      supersedes: [],
    },
    {
      id: UCPATH_PERSON_ORG_LAST_NAME_INPUT,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_SEARCH_SCREEN,
      label: "Person Org last-name input",
      searchTerms: ["ucpath person org last name field"],
      role: "field",
      effect: "prepare",
      sensitivity: "hr",
      valueType: "text",
      scope: "content-frame",
      locator: { kind: "css", selector: "#UC_ORG_SUM_VW_PARTNER_LAST_NAME" },
      requiredStates: [UCPATH_PERSON_ORG_SEARCH_READY],
      verification: verification(SEARCH_SCENARIO, LAST_NAME_PORT_KEY),
      provenance: selectorProvenance(LAST_NAME_PORT_KEY, 915),
      supersedes: [],
    },
    {
      id: UCPATH_PERSON_ORG_GIVEN_NAME_INPUT,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_SEARCH_SCREEN,
      label: "Person Org given-name input",
      searchTerms: ["ucpath person org given name field"],
      role: "field",
      effect: "prepare",
      sensitivity: "hr",
      valueType: "text",
      scope: "content-frame",
      // The legacy exact "Name" accessible name also matches zero in the current render.
      locator: { kind: "css", selector: "#UC_ORG_SUM_VW_NAME_DISPLAY" },
      requiredStates: [UCPATH_PERSON_ORG_SEARCH_READY],
      verification: verification(SEARCH_SCENARIO, GIVEN_NAME_PORT_KEY),
      provenance: selectorProvenance(GIVEN_NAME_PORT_KEY, 923),
      supersedes: [],
    },
    {
      id: UCPATH_PERSON_ORG_SEARCH_BUTTON,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_SEARCH_SCREEN,
      label: "Person Org Search button",
      searchTerms: ["ucpath person org execute search"],
      role: "button",
      effect: "navigate",
      sensitivity: "hr",
      valueType: "none",
      scope: "content-frame",
      locator: { kind: "css", selector: "#PTS_CFG_CL_WRK_PTS_SRCH_BTN" },
      requiredStates: [UCPATH_PERSON_ORG_SEARCH_READY],
      verification: verification(SEARCH_SCENARIO, SEARCH_BUTTON_PORT_KEY),
      provenance: selectorProvenance(SEARCH_BUTTON_PORT_KEY, 939),
      supersedes: [],
    },
    {
      id: UCPATH_PERSON_ORG_NO_RESULTS_STATUS,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_SEARCH_SCREEN,
      label: "Person Org no-results status",
      searchTerms: ["ucpath person org positive no results marker"],
      role: "status",
      effect: "observe",
      sensitivity: "hr",
      valueType: "text",
      scope: "content-frame",
      locator: { kind: "css", selector: "#PTS_CRITTEXT_DISP" },
      requiredStates: [UCPATH_PERSON_ORG_NO_RESULTS],
      verification: verification(RESULTS_SCENARIO, NO_RESULTS_PORT_KEY),
      provenance: selectorProvenance(NO_RESULTS_PORT_KEY, 1028),
      supersedes: [],
    },
    {
      id: UCPATH_PERSON_ORG_RESULTS_GRID,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_SEARCH_SCREEN,
      label: "Person Org results grid",
      searchTerms: ["ucpath person org search results grid"],
      role: "grid",
      effect: "observe",
      sensitivity: "hr",
      valueType: "rows",
      scope: "content-frame",
      locator: { kind: "css", selector: "table[id=\"tdgbrPTS_CFG_CL_STD_RSL$0\"]" },
      requiredStates: [UCPATH_PERSON_ORG_RESULTS_READY],
      verification: verification(RESULTS_SCENARIO, RESULTS_GRID_PORT_KEY),
      provenance: selectorProvenance(RESULTS_GRID_PORT_KEY, 1042),
      supersedes: [],
    },
    {
      id: UCPATH_PERSON_ORG_RESULTS_VIEW_TOGGLE,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_SEARCH_SCREEN,
      label: "Person Org results View All toggle",
      searchTerms: ["ucpath person org results view all toggle"],
      role: "link",
      effect: "navigate",
      sensitivity: "hr",
      valueType: "text",
      scope: "content-frame",
      locator: {
        kind: "view-toggle",
        headerSelector: "[id=\"win0divPTS_CFG_CL_STD_RSLGP$0\"]",
      },
      requiredStates: [UCPATH_PERSON_ORG_RESULTS_READY],
      verification: verification(RESULTS_SCENARIO, VIEW_ALL_PORT_KEY),
      provenance: selectorProvenance(VIEW_ALL_PORT_KEY, 1035),
      portContext: "search-results-view-toggle",
      supersedes: [],
    },
    {
      id: UCPATH_PERSON_ORG_RESULT_DRILL_IN,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_SEARCH_SCREEN,
      label: "Person Org result drill-in control",
      searchTerms: ["ucpath person org result row drill in"],
      role: "button",
      effect: "navigate",
      sensitivity: "hr",
      valueType: "none",
      scope: "content-frame",
      locator: {
        kind: "indexed-css",
        selectorPrefix: "[id=\"PTS_CFG_CL_RSLT_PTS_DRILLIN$40$$IMG$",
        selectorSuffix: "\"]",
      },
      requiredStates: [UCPATH_PERSON_ORG_RESULTS_READY],
      verification: verification(RESULTS_SCENARIO, DRILL_IN_PORT_KEY),
      provenance: selectorProvenance(DRILL_IN_PORT_KEY, 1049),
      supersedes: [],
    },
    {
      id: UCPATH_PERSON_ORG_EID_DISPLAY,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_DETAIL_SCREEN,
      label: "Person Org displayed EID",
      searchTerms: ["person org displayed eid element"],
      role: "display",
      effect: "observe",
      sensitivity: "hr",
      valueType: "eid",
      scope: "content-frame",
      locator: { kind: "css", selector: "#PERSON_NPC_VW_EMPLID" },
      requiredStates: [UCPATH_PERSON_ORG_DETAIL_READY],
      verification: verification(DISPLAY_SCENARIO, DISPLAY_PORT_KEY),
      provenance: selectorProvenance(DISPLAY_PORT_KEY, 959),
      supersedes: [],
    },
    {
      id: UCPATH_PERSON_ORG_NAME_DISPLAY,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_DETAIL_SCREEN,
      label: "Person Org displayed name",
      searchTerms: ["ucpath person org authoritative displayed name"],
      role: "display",
      effect: "observe",
      sensitivity: "hr",
      valueType: "text",
      scope: "content-frame",
      // The unverified body scan is intentionally not ported. Current live detail pages expose
      // the name at this exact, fixture-pinned primary id.
      locator: { kind: "css", selector: "#PERSON_NAME_NAME" },
      requiredStates: [UCPATH_PERSON_ORG_DETAIL_READY],
      verification: verification(DISPLAY_SCENARIO, NAME_DISPLAY_PORT_KEY),
      provenance: selectorProvenance(NAME_DISPLAY_PORT_KEY, 977),
      supersedes: [],
    },
    {
      id: UCPATH_PERSON_ORG_ASSIGNMENTS_GRID,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_DETAIL_SCREEN,
      label: "Person Org assignments grid",
      searchTerms: ["ucpath person org employment assignments grid"],
      role: "grid",
      effect: "observe",
      sensitivity: "hr",
      valueType: "rows",
      scope: "content-frame",
      // Legacy scanned every table under body(); the rebuild narrows that proven operation to
      // the exact live assignment-grid id so extraction failure cannot look like an empty result.
      locator: { kind: "css", selector: "table[id^=\"tdgbrPER_ASGN_EMP_VW$\"]" },
      requiredStates: [UCPATH_PERSON_ORG_DETAIL_READY],
      verification: verification(DISPLAY_SCENARIO, ASSIGNMENTS_GRID_PORT_KEY),
      provenance: selectorProvenance(ASSIGNMENTS_GRID_PORT_KEY, 989),
      supersedes: [],
    },
    {
      id: UCPATH_PERSON_ORG_EMPLOYMENT_VIEW_TOGGLE,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_DETAIL_SCREEN,
      label: "Person Org Employment Instances View All toggle",
      searchTerms: ["ucpath person org employment instances view all toggle"],
      role: "link",
      effect: "navigate",
      sensitivity: "hr",
      valueType: "text",
      scope: "content-frame",
      locator: {
        kind: "view-toggle",
        headerSelector: "[id=\"win0div$ICField94GP$0\"]",
      },
      requiredStates: [UCPATH_PERSON_ORG_DETAIL_READY],
      verification: verification(DISPLAY_SCENARIO, VIEW_ALL_PORT_KEY),
      provenance: selectorProvenance(VIEW_ALL_PORT_KEY, 1035),
      portContext: "employment-instances-view-toggle",
      supersedes: [],
    },
    {
      id: UCPATH_PERSON_ORG_RETURN_TO_SEARCH,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_DETAIL_SCREEN,
      label: "Person Org Return to Search button",
      searchTerms: ["ucpath person org return to results"],
      role: "button",
      effect: "navigate",
      sensitivity: "hr",
      valueType: "none",
      scope: "content-frame",
      locator: { kind: "role", role: "button", name: "Return to Search", exact: true },
      requiredStates: [UCPATH_PERSON_ORG_DETAIL_READY],
      verification: verification(DISPLAY_SCENARIO, RETURN_PORT_KEY),
      provenance: selectorProvenance(RETURN_PORT_KEY, 1057),
      supersedes: [],
    },
  ],
  states: [
    {
      id: UCPATH_PERSON_ORG_SEARCH_READY,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_SEARCH_SCREEN,
      label: "Person Org search ready",
      searchTerms: ["person org search eid ready state"],
      sensitivity: "hr",
      evidence: [{ kind: "visible", element: UCPATH_PERSON_ORG_EID_INPUT }],
      timeoutMs: 30_000,
      verification: verification(SEARCH_SCENARIO, INPUT_PORT_KEY),
    },
    {
      id: UCPATH_PERSON_ORG_RESULTS_READY,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_SEARCH_SCREEN,
      label: "Person Org results ready",
      searchTerms: ["person org results grid ready state"],
      sensitivity: "hr",
      evidence: [{ kind: "visible", element: UCPATH_PERSON_ORG_RESULTS_GRID }],
      timeoutMs: 30_000,
      verification: verification(RESULTS_SCENARIO, RESULTS_GRID_PORT_KEY),
    },
    {
      id: UCPATH_PERSON_ORG_NO_RESULTS,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_SEARCH_SCREEN,
      label: "Person Org no results",
      searchTerms: ["person org positive no results state"],
      sensitivity: "hr",
      evidence: [{ kind: "visible", element: UCPATH_PERSON_ORG_NO_RESULTS_STATUS }],
      timeoutMs: 30_000,
      verification: verification(RESULTS_SCENARIO, NO_RESULTS_PORT_KEY),
    },
    {
      id: UCPATH_PERSON_ORG_DETAIL_READY,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_DETAIL_SCREEN,
      label: "Person Org detail ready",
      searchTerms: ["person org displayed eid ready state"],
      sensitivity: "hr",
      evidence: [
        { kind: "visible", element: UCPATH_PERSON_ORG_EID_DISPLAY },
        { kind: "visible", element: UCPATH_PERSON_ORG_ASSIGNMENTS_GRID },
      ],
      timeoutMs: 30_000,
      verification: verification(DISPLAY_SCENARIO, DISPLAY_PORT_KEY),
    },
  ],
  observations: [
    {
      id: UCPATH_PERSON_ORG_DISPLAYED_EID,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_DETAIL_SCREEN,
      label: "Displayed Person Org EID",
      searchTerms: ["authoritative person org displayed eid"],
      sensitivity: "hr",
      valueType: "eid",
      read: { kind: "element-text", element: UCPATH_PERSON_ORG_EID_DISPLAY, valueType: "eid" },
      authoritativeFor: ["subject", "page-state"],
      verification: verification(DISPLAY_SCENARIO, DISPLAY_PORT_KEY),
    },
    {
      id: UCPATH_PERSON_ORG_DISPLAYED_NAME,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_DETAIL_SCREEN,
      label: "Displayed Person Org name",
      searchTerms: ["authoritative person org displayed name"],
      sensitivity: "hr",
      valueType: "text",
      read: { kind: "element-text", element: UCPATH_PERSON_ORG_NAME_DISPLAY, valueType: "text" },
      authoritativeFor: ["subject"],
      verification: verification(DISPLAY_SCENARIO, NAME_DISPLAY_PORT_KEY),
    },
  ],
  scenarios: [
    {
      id: SEARCH_SCENARIO,
      kind: "ui-verification",
      title: "UCPath Person Org EID input resolves",
      system: "ucpath",
      semanticIds: [
        UCPATH_PERSON_ORG_NAVIGATION_LINK,
        UCPATH_PERSON_ORG_EID_INPUT,
        UCPATH_PERSON_ORG_LAST_NAME_INPUT,
        UCPATH_PERSON_ORG_GIVEN_NAME_INPUT,
        UCPATH_PERSON_ORG_SEARCH_BUTTON,
        UCPATH_PERSON_ORG_SEARCH_READY,
      ],
      fixtureEvidenceRef: FIXTURE_EVIDENCE,
      liveReadOnlyEvidenceRef: LIVE_EVIDENCE,
      assertions: ["exactly-one-visible", "accepts-canonical-eid", "recipe-resolves"],
    },
    {
      id: RESULTS_SCENARIO,
      kind: "ui-verification",
      title: "UCPath Person Org result outcomes are explicit",
      system: "ucpath",
      semanticIds: [
        UCPATH_PERSON_ORG_RESULTS_GRID,
        UCPATH_PERSON_ORG_RESULTS_VIEW_TOGGLE,
        UCPATH_PERSON_ORG_RESULT_DRILL_IN,
        UCPATH_PERSON_ORG_NO_RESULTS_STATUS,
        UCPATH_PERSON_ORG_RESULTS_READY,
        UCPATH_PERSON_ORG_NO_RESULTS,
      ],
      fixtureEvidenceRef: FIXTURE_EVIDENCE,
      liveReadOnlyEvidenceRef: LIVE_EVIDENCE,
      assertions: ["recipe-resolves", "exactly-one-visible"],
    },
    {
      id: DISPLAY_SCENARIO,
      kind: "ui-verification",
      title: "UCPath Person Org displayed EID is authoritative",
      system: "ucpath",
      semanticIds: [
        UCPATH_PERSON_ORG_EID_DISPLAY,
        UCPATH_PERSON_ORG_NAME_DISPLAY,
        UCPATH_PERSON_ORG_ASSIGNMENTS_GRID,
        UCPATH_PERSON_ORG_EMPLOYMENT_VIEW_TOGGLE,
        UCPATH_PERSON_ORG_RETURN_TO_SEARCH,
        UCPATH_PERSON_ORG_DISPLAYED_EID,
        UCPATH_PERSON_ORG_DISPLAYED_NAME,
        UCPATH_PERSON_ORG_DETAIL_READY,
      ],
      fixtureEvidenceRef: FIXTURE_EVIDENCE,
      liveReadOnlyEvidenceRef: LIVE_EVIDENCE,
      assertions: ["exactly-one-visible", "displayed-eid-equals-query", "recipe-resolves"],
    },
  ],
}));

export type UcpathUiRegistry = z.infer<typeof UiRegistrySchema>;

export function auditUcpathUiRegistry(registryInput: unknown = UCPATH_UI_REGISTRY): readonly string[] {
  const result = UiRegistrySchema.safeParse(registryInput);
  if (!result.success) return result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  const registry = result.data;
  const issues: string[] = [];
  const allIds = [
    ...registry.screens.map(({ id }) => id),
    ...registry.elements.map(({ id }) => id),
    ...registry.states.map(({ id }) => id),
    ...registry.observations.map(({ id }) => id),
  ];
  if (new Set(allIds).size !== allIds.length) issues.push("semantic UI ids must be globally unique");
  const terms = [...registry.screens, ...registry.elements, ...registry.states, ...registry.observations]
    .flatMap((definition) => definition.searchTerms.map((term) => term.trim().toLowerCase()));
  if (new Set(terms).size !== terms.length) issues.push("search terms must resolve to one canonical id");
  const screens = new Set(registry.screens.map(({ id }) => id));
  const elements = new Map(registry.elements.map((element) => [element.id, element]));
  const states = new Map(registry.states.map((state) => [state.id, state]));
  const scenarios = new Set(registry.scenarios.map(({ id }) => id));
  const definitions = [...registry.screens, ...registry.elements, ...registry.states, ...registry.observations];
  for (const definition of definitions) {
    if (definition.system !== registry.system) issues.push(`${definition.id} crosses a system boundary`);
    for (const scenario of definition.verification.scenarios) {
      if (!scenarios.has(scenario)) issues.push(`${definition.id} references unknown verification scenario ${scenario}`);
    }
  }
  for (const definition of [...registry.elements, ...registry.states, ...registry.observations]) {
    if (!screens.has(definition.screen)) issues.push(`${definition.id} references an unknown screen`);
  }
  for (const scenario of registry.root.verification.scenarios) {
    if (!scenarios.has(scenario)) issues.push(`driver root references unknown verification scenario ${scenario}`);
  }
  for (const element of registry.elements) {
    for (const state of element.requiredStates) {
      const stateDefinition = states.get(state);
      if (!stateDefinition) issues.push(`${element.id} references unknown state ${state}`);
      else if (stateDefinition.screen !== element.screen) issues.push(`${element.id} required state crosses screens`);
    }
    for (const superseded of element.supersedes) {
      if (!elements.has(superseded)) issues.push(`${element.id} supersedes unknown element ${superseded}`);
      if (superseded === element.id) issues.push(`${element.id} cannot supersede itself`);
    }
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visitSupersedes(id: string): void {
    if (visiting.has(id)) {
      issues.push(`supersedes cycle includes ${id}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const element = registry.elements.find((candidate) => candidate.id === id);
    for (const superseded of element?.supersedes ?? []) visitSupersedes(superseded);
    visiting.delete(id);
    visited.add(id);
  }
  for (const element of registry.elements) visitSupersedes(element.id);
  for (const state of registry.states) {
    for (const evidence of state.evidence) {
      const element = elements.get(evidence.element);
      if (!element) issues.push(`${state.id} references unknown evidence element ${evidence.element}`);
      else if (element.screen !== state.screen) issues.push(`${state.id} evidence crosses screens`);
    }
  }
  for (const observation of registry.observations) {
    const element = elements.get(observation.read.element);
    if (!element) issues.push(`${observation.id} reads an unknown element`);
    else if (element.screen !== observation.screen) issues.push(`${observation.id} reads across screens`);
  }
  const globalScenarioIds = [
    ...PREFLIGHT_SCENARIO_MANIFESTS.map(({ id }) => ScenarioIdSchema.parse(id)),
    ...registry.scenarios.map(({ id }) => id),
  ];
  if (new Set(globalScenarioIds).size !== globalScenarioIds.length) issues.push("UI scenario ids must be globally unique");
  const semanticIds = new Set(allIds);
  for (const scenario of registry.scenarios) {
    if (scenario.system !== registry.system) issues.push(`${scenario.id} crosses a system boundary`);
    for (const id of scenario.semanticIds) {
      if (!semanticIds.has(id)) issues.push(`${scenario.id} references unknown semantic id ${id}`);
    }
  }
  const referencedScenarios = new Set([
    ...registry.root.verification.scenarios,
    ...registry.screens.flatMap(({ verification: value }) => value.scenarios),
    ...registry.elements.flatMap(({ verification: value }) => value.scenarios),
    ...registry.states.flatMap(({ verification: value }) => value.scenarios),
    ...registry.observations.flatMap(({ verification: value }) => value.scenarios),
  ]);
  for (const scenario of registry.scenarios) {
    if (!referencedScenarios.has(scenario.id)) issues.push(`verification scenario ${scenario.id} is vacuous`);
  }
  return issues;
}

function portRowKey(row: z.infer<typeof UiPortMapRowReferenceSchema>): string {
  return `${row.system}:${row.legacyKey}`;
}

export function auditUcpathUiEvidenceBindings(input: unknown): readonly string[] {
  const parsed = UiEvidenceBindingInputSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  const { evidenceByRef, portBindings } = parsed.data;
  const issues: string[] = [];
  const facts = [
    ...UCPATH_UI_REGISTRY.screens.map((fact) => ({ ...fact, screen: fact.id })),
    ...UCPATH_UI_REGISTRY.elements,
    ...UCPATH_UI_REGISTRY.states,
    ...UCPATH_UI_REGISTRY.observations,
  ];
  const factsById = new Map(facts.map((fact) => [fact.id, fact]));
  const bindingsByRow = new Map(portBindings.map((binding) => [
    portRowKey({ system: binding.system, legacyKey: binding.legacyKey }),
    binding,
  ]));

  for (const fact of facts) {
    const expectedRows = fact.verification.portMapRows.map(portRowKey);
    for (const row of fact.verification.portMapRows) {
      if (!bindingsByRow.has(portRowKey(row))) issues.push(`${fact.id} references unknown port-map row ${portRowKey(row)}`);
    }
    const evidenceRefs = [
      [fact.verification.fixtureEvidenceRef, "deterministic-fixture"],
      [fact.verification.liveReadOnlyEvidenceRef, "live-read-only"],
    ] as const;
    for (const [ref, evidenceKind] of evidenceRefs) {
      const manifest = evidenceByRef[ref];
      if (!manifest) {
        issues.push(`${fact.id} is missing evidence manifest ${ref}`);
        continue;
      }
      if (manifest.evidenceKind !== evidenceKind) issues.push(`${fact.id} ${ref} has the wrong evidence kind`);
      if (manifest.system !== fact.system) issues.push(`${fact.id} ${ref} crosses systems`);
      if (manifest.verifiedAt !== fact.verification.verifiedAt) issues.push(`${fact.id} ${ref} verification date drifted`);
      if (!manifest.screens.includes(fact.screen)) issues.push(`${fact.id} ${ref} omits screen ${fact.screen}`);
      const assertions = manifest.assertions.filter(({ semanticId }) => semanticId === fact.id);
      if (assertions.length !== 1) issues.push(`${fact.id} ${ref} must have exactly one evidence assertion`);
      for (const assertion of assertions) {
        if (assertion.screen !== fact.screen) issues.push(`${fact.id} ${ref} assertion screen drifted`);
        if (!fact.verification.scenarios.includes(assertion.scenarioId)) {
          issues.push(`${fact.id} ${ref} assertion scenario drifted`);
        }
        const assertionRows = assertion.portMapRows.map(portRowKey);
        if (JSON.stringify(assertionRows) !== JSON.stringify(expectedRows)) {
          issues.push(`${fact.id} ${ref} assertion port-map rows drifted`);
        }
      }
    }
  }
  for (const [ref, manifest] of Object.entries(evidenceByRef)) {
    for (const assertion of manifest.assertions) {
      if (!factsById.has(assertion.semanticId)) issues.push(`${ref} asserts unknown semantic id ${assertion.semanticId}`);
    }
  }

  const rootBinding = bindingsByRow.get(portRowKey({ system: "ucpath", legacyKey: UCPATH_UI_REGISTRY.root.provenance.key }));
  if (!rootBinding || rootBinding.disposition !== "driver-internal") {
    issues.push("UCPath driver root must resolve to its driver-internal port-map row");
  }
  for (const element of UCPATH_UI_REGISTRY.elements) {
    const binding = bindingsByRow.get(portRowKey({ system: element.system, legacyKey: element.provenance.key }));
    const canonicalIds = binding?.disposition === "ported"
      ? "canonicalBindings" in binding
        ? binding.canonicalBindings.map(({ canonicalId }) => canonicalId)
        : [binding.canonicalId]
      : [];
    if (!binding || binding.disposition !== "ported" || !canonicalIds.includes(element.id)) {
      issues.push(`${element.id} does not resolve to its exact ported row`);
      continue;
    }
    if ("canonicalBindings" in binding) {
      const contextualBinding = binding.canonicalBindings.find(({ canonicalId }) => canonicalId === element.id);
      if (contextualBinding?.context !== element.portContext) {
        issues.push(`${element.id} contextual port binding drifted`);
      }
    } else if (element.portContext !== undefined) {
      issues.push(`${element.id} declares a context on a non-contextual port row`);
    }
    if (binding.evidence.verifiedAt !== element.verification.verifiedAt
      || binding.evidence.fixtureEvidenceRef !== element.verification.fixtureEvidenceRef
      || binding.evidence.liveReadOnlyEvidenceRef !== element.verification.liveReadOnlyEvidenceRef) {
      issues.push(`${element.id} port-map evidence drifted`);
    }
  }
  return issues;
}

export function parseUcpathRegistryEid(input: string) {
  return EidSchema.parse(input);
}
