import { z } from "zod";
import { deepFreeze } from "../../../../rules/validation/immutability.js";
import {
  BrowserSystemIdSchema,
  DateOnlySchema,
  ElementIdSchema,
  ObservationIdSchema,
  PageStateIdSchema,
  ScenarioIdSchema,
  ScreenIdSchema,
} from "../../../../rules/identity/ids.js";
import {
  UiEffectSchema,
  UiRoleSchema,
  UiSensitivitySchema,
  UiEvidenceReferenceSchema,
  UiPortMapRowReferenceSchema,
  UiVerificationEvidenceManifestSchema,
  UiVerificationScenarioSchema,
  UiVerificationSchema,
} from "../../../../models/ui/contracts.js";
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
} from "../../../../models/ui/ucpath-person-org.js";
import {
  UCPATH_SMART_HR_CONTINUE_BUTTON,
  UCPATH_SMART_HR_CREATE_TRANSACTION_BUTTON,
  UCPATH_SMART_HR_DELETE_SELECTED_BUTTON,
  UCPATH_SMART_HR_DETAILS_EID_INPUT,
  UCPATH_SMART_HR_DETAILS_READY,
  UCPATH_SMART_HR_DETAILS_SCREEN,
  UCPATH_SMART_HR_INFORMATION_READY,
  UCPATH_SMART_HR_INFORMATION_SCREEN,
  UCPATH_SMART_HR_INITIATOR_COMMENTS_FIELD,
  UCPATH_SMART_HR_LAST_DATE_WORKED_INPUT,
  UCPATH_SMART_HR_OVERRIDE_LDW_CHECKBOX,
  UCPATH_SMART_HR_REASON_CODE_SELECT,
  UCPATH_SMART_HR_SAVE_AND_SUBMIT_BUTTON,
  UCPATH_SMART_HR_SETUP_READY,
  UCPATH_SMART_HR_SETUP_SCREEN,
  UCPATH_SMART_HR_TEMPLATE_INPUT,
  UCPATH_SMART_HR_TERMINATION_STAGED,
  UCPATH_SMART_HR_TRANSACTION_COMMENTS_FIELD,
  UCPATH_SMART_HR_TRANSACTION_DATE_INPUT,
  UCPATH_SS_SMART_HR_SEARCH_BUTTON,
  UCPATH_SS_SMART_HR_SEARCH_EID_INPUT,
  UCPATH_SS_SMART_HR_SEARCH_READY,
  UCPATH_SS_SMART_HR_SEARCH_SCREEN,
} from "../../../../models/ui/ucpath-smart-hr-termination.js";
import {
  UCPATH_SS_SMART_HR_APPROVAL_STATUS,
  UCPATH_SS_SMART_HR_APPROVAL_STATUS_DISPLAY,
  UCPATH_SS_SMART_HR_RECEIPT_DISPLAY,
  UCPATH_SS_SMART_HR_TRANSACTION_READY,
  UCPATH_SS_SMART_HR_TRANSACTION_RECEIPT,
  UCPATH_SS_SMART_HR_TRANSACTION_SCREEN,
} from "../../../../models/ui/ucpath-ss-smart-hr.js";
import { PREFLIGHT_SCENARIO_MANIFESTS } from "../../../../models/trust/preflight-scenarios.js";

const FIXTURE_EVIDENCE = "tests/support/fixtures/ui/ucpath/person-org.fixture.json";
const LIVE_EVIDENCE = "tests/support/fixtures/ui/ucpath/person-org.live.json";
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


const SS_SMART_HR_FIXTURE_EVIDENCE = "tests/support/fixtures/ui/ucpath/ss-smart-hr.fixture.json";
const SS_SMART_HR_LIVE_EVIDENCE = "tests/support/fixtures/ui/ucpath/ss-smart-hr.live.json";
const RECEIPT_SCENARIO = "ui/ucpath-ss-smart-hr-transaction-receipt";
const RECEIPT_PORT_KEY = "ssSmartHRTransactions.transactionResultRow()";
const APPROVAL_STATUS_PORT_KEY = "ssSmartHRTransactions.approvalStatusSelect()";


const SMART_HR_FIXTURE_EVIDENCE = "tests/support/fixtures/ui/ucpath/smart-hr-termination.fixture.json";
const SMART_HR_LIVE_EVIDENCE = "tests/support/fixtures/ui/ucpath/smart-hr-termination.live.json";
const WIZARD_SCENARIO = "ui/ucpath-smart-hr-termination-wizard";
const SWEEP_SCENARIO = "ui/ucpath-smart-hr-pending-sweep";
const SS_SEARCH_SCENARIO = "ui/ucpath-ss-smart-hr-search";
const TEMPLATE_PORT_KEY = "smartHR.templateInput()";
const TRANSACTION_DATE_PORT_KEY = "smartHR.effectiveDateInput()";
const CREATE_TRANSACTION_PORT_KEY = "smartHR.createTransactionButton()";
const REASON_CODE_PORT_KEY = "smartHR.reasonCodeSelect()";
const CONTINUE_PORT_KEY = "smartHR.continueButton()";
const SAVE_SUBMIT_PORT_KEY = "smartHR.saveAndSubmitButton()";
const DELETE_SELECTED_PORT_KEY = "smartHR.deleteSelectedTransactionsButton()";
const OVERRIDE_LDW_PORT_KEY = "termination.overrideLastDateWorkedCheckbox()";
const LAST_DATE_WORKED_PORT_KEY = "termination.lastDateWorkedInput()";
const INITIATOR_COMMENTS_PORT_KEY = "comments.commentsTextarea()";
const TRANSACTION_COMMENTS_PORT_KEY = "comments.initiatorCommentsTextarea()";
// One source key binds two distinct controls; retain contextual binding.
const SS_EMPLID_PORT_KEY = "ssSmartHRTransactions.emplIdInput()";
const SS_SEARCH_BUTTON_PORT_KEY = "ssSmartHRTransactions.searchButton()";

const SelectorKeySchema = z.string().regex(/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*\(\)$/);
const UiPortContextSchema = z.enum([
  "search-results-view-toggle",
  "employment-instances-view-toggle",
  // The shared Empl ID source key binds Page B and the SS Smart HR search; scope each control separately.
  "smart-hr-wizard-details",
  "ss-smart-hr-search",
]);

const LocatorRecipeSchema = z.discriminatedUnion("kind", [
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

const StateEvidenceRuleSchema = z.strictObject({
  kind: z.literal("visible"),
  element: ElementIdSchema,
});

const ObservationRecipeSchema = z.strictObject({
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
  selectorKey: SelectorKeySchema,
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
  selectorKey: SelectorKeySchema,
});

const UiRegistrySchema = z.strictObject({
  system: BrowserSystemIdSchema,
  root: DriverRootRecipeSchema,
  screens: z.array(ScreenDefinitionSchema).min(1),
  elements: z.array(ElementDefinitionSchema).min(1),
  states: z.array(PageStateDefinitionSchema).min(1),
  observations: z.array(ObservationDefinitionSchema).min(1),
  scenarios: z.array(UiVerificationScenarioSchema).min(1),
});

const UiRegistryPortBindingSchema = z.union([
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




function receiptVerification(legacyKey: string) {
  return {
    verifiedAt: DateOnlySchema.parse("2026-08-04"),
    fixtureEvidenceRef: SS_SMART_HR_FIXTURE_EVIDENCE,
    liveReadOnlyEvidenceRef: SS_SMART_HR_LIVE_EVIDENCE,
    scenarios: [ScenarioIdSchema.parse(RECEIPT_SCENARIO)],
    portMapRows: [{ system: "ucpath" as const, legacyKey }],
  };
}


function terminationVerification(scenario: string, legacyKey: string) {
  return {
    verifiedAt: DateOnlySchema.parse("2026-08-14"),
    fixtureEvidenceRef: SMART_HR_FIXTURE_EVIDENCE,
    liveReadOnlyEvidenceRef: SMART_HR_LIVE_EVIDENCE,
    scenarios: [ScenarioIdSchema.parse(scenario)],
    portMapRows: [{ system: "ucpath" as const, legacyKey }],
  };
}

export const UCPATH_UI_REGISTRY = deepFreeze(UiRegistrySchema.parse({
  system: "ucpath",
  root: {
    kind: "content-frame",
    selector: "#main_target_win0",
    verification: verification(SEARCH_SCENARIO, "getContentFrame()"),
    selectorKey: "getContentFrame()",
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
    {
      id: UCPATH_SS_SMART_HR_TRANSACTION_SCREEN,
      system: "ucpath",
      label: "SS Smart HR transaction detail",
      searchTerms: ["ucpath ss smart hr transaction detail screen"],
      sensitivity: "restricted",
      verification: receiptVerification(RECEIPT_PORT_KEY),
    },
    {
      id: UCPATH_SMART_HR_SETUP_SCREEN,
      system: "ucpath",
      label: "Smart HR transaction setup",
      searchTerms: ["ucpath smart hr wizard setup screen"],
      sensitivity: "restricted",
      verification: terminationVerification(WIZARD_SCENARIO, TEMPLATE_PORT_KEY),
    },
    {
      id: UCPATH_SMART_HR_DETAILS_SCREEN,
      system: "ucpath",
      label: "Smart HR transaction details",
      searchTerms: ["ucpath smart hr wizard details screen"],
      sensitivity: "restricted",
      verification: terminationVerification(WIZARD_SCENARIO, REASON_CODE_PORT_KEY),
    },
    {
      id: UCPATH_SMART_HR_INFORMATION_SCREEN,
      system: "ucpath",
      label: "Smart HR transaction information",
      searchTerms: ["ucpath smart hr wizard information screen"],
      sensitivity: "restricted",
      verification: terminationVerification(WIZARD_SCENARIO, SAVE_SUBMIT_PORT_KEY),
    },
    {
      id: UCPATH_SS_SMART_HR_SEARCH_SCREEN,
      system: "ucpath",
      label: "SS Smart HR transaction search",
      searchTerms: ["ucpath ss smart hr transaction search screen"],
      sensitivity: "restricted",
      verification: terminationVerification(SS_SEARCH_SCENARIO, SS_SEARCH_BUTTON_PORT_KEY),
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
      // The hidden "Step Label" span is part of the accessible name, so match by structure.
      locator: { kind: "css", selector: "[role=\"link\"][steplabel=\"Person Organizational Summary\"]" },
      requiredStates: [],
      verification: verification(SEARCH_SCENARIO, NAVIGATION_PORT_KEY),
      selectorKey: NAVIGATION_PORT_KEY,
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
      // PeopleSoft appends begins with to the accessible name; bind the stable field ID.
      locator: { kind: "css", selector: "#UC_ORG_SUM_VW_EMPLID" },
      requiredStates: [UCPATH_PERSON_ORG_SEARCH_READY],
      verification: verification(SEARCH_SCENARIO, INPUT_PORT_KEY),
      selectorKey: INPUT_PORT_KEY,
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
      selectorKey: LAST_NAME_PORT_KEY,
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
      // The Name field accessible name includes its search operator; bind its stable structure.
      locator: { kind: "css", selector: "#UC_ORG_SUM_VW_NAME_DISPLAY" },
      requiredStates: [UCPATH_PERSON_ORG_SEARCH_READY],
      verification: verification(SEARCH_SCENARIO, GIVEN_NAME_PORT_KEY),
      selectorKey: GIVEN_NAME_PORT_KEY,
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
      selectorKey: SEARCH_BUTTON_PORT_KEY,
      supersedes: [],
    },
    {
      id: UCPATH_PERSON_ORG_NO_RESULTS_STATUS,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_SEARCH_SCREEN,
      // PeopleSoft's criteria banner describes the search, not a resolved person.
      label: "Person Org search criteria banner",
      searchTerms: ["ucpath person org search criteria result count banner"],
      role: "status",
      effect: "observe",
      sensitivity: "hr",
      valueType: "text",
      scope: "content-frame",
      locator: { kind: "css", selector: "#PTS_CRITTEXT_DISP" },
      requiredStates: [UCPATH_PERSON_ORG_NO_RESULTS],
      verification: verification(RESULTS_SCENARIO, NO_RESULTS_PORT_KEY),
      selectorKey: NO_RESULTS_PORT_KEY,
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
      selectorKey: RESULTS_GRID_PORT_KEY,
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
      selectorKey: VIEW_ALL_PORT_KEY,
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
      selectorKey: DRILL_IN_PORT_KEY,
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
      selectorKey: DISPLAY_PORT_KEY,
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

      locator: { kind: "css", selector: "#PERSON_NAME_NAME" },
      requiredStates: [UCPATH_PERSON_ORG_DETAIL_READY],
      verification: verification(DISPLAY_SCENARIO, NAME_DISPLAY_PORT_KEY),
      selectorKey: NAME_DISPLAY_PORT_KEY,
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
      // Scope assignments to the exact grid; a body-wide scan could turn extraction loss into an empty answer.
      locator: { kind: "css", selector: "table[id^=\"tdgbrPER_ASGN_EMP_VW$\"]" },
      requiredStates: [UCPATH_PERSON_ORG_DETAIL_READY],
      verification: verification(DISPLAY_SCENARIO, ASSIGNMENTS_GRID_PORT_KEY),
      selectorKey: ASSIGNMENTS_GRID_PORT_KEY,
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
      selectorKey: VIEW_ALL_PORT_KEY,
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
      selectorKey: RETURN_PORT_KEY,
      supersedes: [],
    },
    {
      id: UCPATH_SS_SMART_HR_RECEIPT_DISPLAY,
      system: "ucpath",
      screen: UCPATH_SS_SMART_HR_TRANSACTION_SCREEN,
      label: "SS Smart HR transaction receipt display",
      searchTerms: ["ucpath ss smart hr transaction id receipt display"],
      role: "display",
      effect: "observe",
      sensitivity: "restricted",
      valueType: "text",
      // SS Smart HR renders top-level without a content iframe.
      scope: "page",
      // The receipt is a bare span without a role/name anchor; use its record-field ID.
      locator: { kind: "css", selector: "#UC_SS_TRANSACT_UC_TRANSACT_ID" },
      requiredStates: [UCPATH_SS_SMART_HR_TRANSACTION_READY],
      verification: receiptVerification(RECEIPT_PORT_KEY),
      selectorKey: RECEIPT_PORT_KEY,
      supersedes: [],
    },
    {
      id: UCPATH_SS_SMART_HR_APPROVAL_STATUS_DISPLAY,
      system: "ucpath",
      screen: UCPATH_SS_SMART_HR_TRANSACTION_SCREEN,
      label: "SS Smart HR transaction approval status display",
      searchTerms: ["ucpath ss smart hr transaction approval status display"],
      role: "display",
      effect: "observe",
      sensitivity: "restricted",
      valueType: "text",
      scope: "page",

      locator: { kind: "css", selector: "#UC_SS_TRANSACT_APPR_STATUS" },
      requiredStates: [UCPATH_SS_SMART_HR_TRANSACTION_READY],
      verification: receiptVerification(APPROVAL_STATUS_PORT_KEY),
      selectorKey: APPROVAL_STATUS_PORT_KEY,
      supersedes: [],
    },
    {
      id: UCPATH_SMART_HR_TEMPLATE_INPUT,
      system: "ucpath",
      screen: UCPATH_SMART_HR_SETUP_SCREEN,
      label: "Smart HR template input",
      searchTerms: ["ucpath smart hr template input"],
      role: "field",
      effect: "prepare",
      sensitivity: "restricted",
      valueType: "text",
      scope: "page",

      locator: { kind: "css", selector: "#HR_TBH_WRK_TBH_TMPL_ID" },
      requiredStates: [UCPATH_SMART_HR_SETUP_READY],
      verification: terminationVerification(WIZARD_SCENARIO, TEMPLATE_PORT_KEY),
      selectorKey: TEMPLATE_PORT_KEY,
      supersedes: [],
    },
    {
      id: UCPATH_SMART_HR_TRANSACTION_DATE_INPUT,
      system: "ucpath",
      screen: UCPATH_SMART_HR_SETUP_SCREEN,
      label: "Smart HR transaction date input",
      searchTerms: ["ucpath smart hr transaction date input"],
      role: "field",
      effect: "prepare",
      sensitivity: "restricted",
      valueType: "text",
      scope: "page",

      locator: { kind: "css", selector: "#UC_HR_TBH_WRK_TRANSACTION_DATE" },
      requiredStates: [UCPATH_SMART_HR_SETUP_READY],
      verification: terminationVerification(WIZARD_SCENARIO, TRANSACTION_DATE_PORT_KEY),
      selectorKey: TRANSACTION_DATE_PORT_KEY,
      supersedes: [],
    },
    {
      id: UCPATH_SMART_HR_CREATE_TRANSACTION_BUTTON,
      system: "ucpath",
      screen: UCPATH_SMART_HR_SETUP_SCREEN,
      label: "Smart HR Create Transaction button",
      searchTerms: ["ucpath smart hr create transaction button"],
      role: "button",
      effect: "navigate",
      sensitivity: "restricted",
      valueType: "none",
      scope: "page",
      // Create Transaction opens an unsaved wizard; it creates no durable transaction.
      locator: { kind: "css", selector: "#HR_TBH_WRK_TBH_ADD" },
      requiredStates: [UCPATH_SMART_HR_SETUP_READY],
      verification: terminationVerification(WIZARD_SCENARIO, CREATE_TRANSACTION_PORT_KEY),
      selectorKey: CREATE_TRANSACTION_PORT_KEY,
      supersedes: [],
    },
    {
      id: UCPATH_SMART_HR_DELETE_SELECTED_BUTTON,
      system: "ucpath",
      screen: UCPATH_SMART_HR_SETUP_SCREEN,
      label: "Delete Selected Transactions button",
      searchTerms: ["ucpath smart hr delete selected transactions button"],
      role: "button",
      effect: "external-commit",
      sensitivity: "restricted",
      valueType: "none",
      scope: "page",

      locator: { kind: "css", selector: "#HR_TBH_WRK_DELETE_BTN" },
      requiredStates: [UCPATH_SMART_HR_SETUP_READY],
      verification: terminationVerification(SWEEP_SCENARIO, DELETE_SELECTED_PORT_KEY),
      selectorKey: DELETE_SELECTED_PORT_KEY,
      supersedes: [],
    },
    {
      id: UCPATH_SMART_HR_DETAILS_EID_INPUT,
      system: "ucpath",
      screen: UCPATH_SMART_HR_DETAILS_SCREEN,
      label: "Smart HR wizard employee-id input",
      searchTerms: ["ucpath smart hr wizard empl id input"],
      role: "field",
      effect: "prepare",
      sensitivity: "restricted",
      valueType: "eid",
      scope: "page",
      // Blurring Empl ID triggers UCPath lookup; no terminable job renders no resolved-person anchor.
      locator: { kind: "css", selector: "#HR_TBH_WRK_EMPLID_PROMPT2" },
      requiredStates: [UCPATH_SMART_HR_DETAILS_READY],
      verification: terminationVerification(WIZARD_SCENARIO, SS_EMPLID_PORT_KEY),
      portContext: "smart-hr-wizard-details",
      selectorKey: SS_EMPLID_PORT_KEY,
      supersedes: [],
    },
    {
      id: UCPATH_SMART_HR_REASON_CODE_SELECT,
      system: "ucpath",
      screen: UCPATH_SMART_HR_DETAILS_SCREEN,
      label: "Smart HR Action Reason select",
      searchTerms: ["ucpath smart hr action reason select"],
      role: "field",
      effect: "prepare",
      sensitivity: "restricted",
      valueType: "text",
      scope: "page",
      // Dropdown values are reason codes and option text is the label; verify both before staging.
      locator: { kind: "css", selector: "#HR_TBH_WRK_ACTION_REASON" },
      requiredStates: [UCPATH_SMART_HR_DETAILS_READY],
      verification: terminationVerification(WIZARD_SCENARIO, REASON_CODE_PORT_KEY),
      selectorKey: REASON_CODE_PORT_KEY,
      supersedes: [],
    },
    {
      id: UCPATH_SMART_HR_CONTINUE_BUTTON,
      system: "ucpath",
      screen: UCPATH_SMART_HR_DETAILS_SCREEN,
      label: "Smart HR Continue button",
      searchTerms: ["ucpath smart hr wizard continue button"],
      role: "button",
      effect: "navigate",
      sensitivity: "restricted",
      valueType: "none",
      scope: "page",
      locator: { kind: "css", selector: "#HR_TBH_WRK_TBH_NEXT" },
      requiredStates: [UCPATH_SMART_HR_DETAILS_READY],
      verification: terminationVerification(WIZARD_SCENARIO, CONTINUE_PORT_KEY),
      selectorKey: CONTINUE_PORT_KEY,
      supersedes: [],
    },
    {
      id: UCPATH_SMART_HR_OVERRIDE_LDW_CHECKBOX,
      system: "ucpath",
      screen: UCPATH_SMART_HR_INFORMATION_SCREEN,
      label: "Override Last Date Worked checkbox",
      searchTerms: ["ucpath smart hr override last date worked checkbox"],
      role: "field",
      effect: "prepare",
      sensitivity: "restricted",
      valueType: "text",
      scope: "page",
      // The editable form includes a hidden input with the same ID; constrain the override to a checkbox.
      locator: {
        kind: "css",
        selector: "input[type=\"checkbox\"][id^=\"HR_TBH_SCR_WRK_TBH_CHK2$\"]",
      },
      requiredStates: [UCPATH_SMART_HR_INFORMATION_READY],
      verification: terminationVerification(WIZARD_SCENARIO, OVERRIDE_LDW_PORT_KEY),
      selectorKey: OVERRIDE_LDW_PORT_KEY,
      supersedes: [],
    },
    {
      id: UCPATH_SMART_HR_LAST_DATE_WORKED_INPUT,
      system: "ucpath",
      screen: UCPATH_SMART_HR_INFORMATION_SCREEN,
      label: "Last Date Worked input",
      searchTerms: ["ucpath smart hr last date worked input"],
      role: "field",
      effect: "prepare",
      sensitivity: "restricted",
      valueType: "text",
      scope: "page",
      // Require the editable input so a read-only transaction cannot masquerade as a staging page.
      locator: { kind: "css", selector: "input[id^=\"HR_TBH_SCR_WRK_TBH_DATE$\"]" },
      requiredStates: [UCPATH_SMART_HR_INFORMATION_READY],
      verification: terminationVerification(WIZARD_SCENARIO, LAST_DATE_WORKED_PORT_KEY),
      selectorKey: LAST_DATE_WORKED_PORT_KEY,
      supersedes: [],
    },
    {
      id: UCPATH_SMART_HR_INITIATOR_COMMENTS_FIELD,
      system: "ucpath",
      screen: UCPATH_SMART_HR_INFORMATION_SCREEN,
      label: "Smart HR initiator comments",
      searchTerms: ["ucpath smart hr initiator comments textarea"],
      role: "field",
      effect: "prepare",
      sensitivity: "restricted",
      valueType: "text",
      scope: "page",
      locator: { kind: "css", selector: "#HR_TBH_WRK_DESCRLONG_NOTES" },
      requiredStates: [UCPATH_SMART_HR_INFORMATION_READY],
      verification: terminationVerification(WIZARD_SCENARIO, INITIATOR_COMMENTS_PORT_KEY),
      selectorKey: INITIATOR_COMMENTS_PORT_KEY,
      supersedes: [],
    },
    {
      id: UCPATH_SMART_HR_TRANSACTION_COMMENTS_FIELD,
      system: "ucpath",
      screen: UCPATH_SMART_HR_INFORMATION_SCREEN,
      label: "Smart HR transaction comments",
      searchTerms: ["ucpath smart hr transaction comments textarea"],
      role: "field",
      effect: "prepare",
      sensitivity: "restricted",
      valueType: "text",
      scope: "page",
      locator: { kind: "css", selector: "#UC_SS_TRANSACT_COMMENTS" },
      requiredStates: [UCPATH_SMART_HR_INFORMATION_READY],
      verification: terminationVerification(WIZARD_SCENARIO, TRANSACTION_COMMENTS_PORT_KEY),
      selectorKey: TRANSACTION_COMMENTS_PORT_KEY,
      supersedes: [],
    },
    {
      id: UCPATH_SMART_HR_SAVE_AND_SUBMIT_BUTTON,
      system: "ucpath",
      screen: UCPATH_SMART_HR_INFORMATION_SCREEN,
      label: "Save and Submit button",
      searchTerms: ["ucpath smart hr save and submit button"],
      role: "button",
      effect: "external-commit",
      sensitivity: "restricted",
      valueType: "none",
      scope: "page",

      locator: { kind: "css", selector: "#HR_TBH_WRK_TBH_SAVE" },
      requiredStates: [UCPATH_SMART_HR_INFORMATION_READY],
      verification: terminationVerification(WIZARD_SCENARIO, SAVE_SUBMIT_PORT_KEY),
      selectorKey: SAVE_SUBMIT_PORT_KEY,
      supersedes: [],
    },
    {
      id: UCPATH_SS_SMART_HR_SEARCH_EID_INPUT,
      system: "ucpath",
      screen: UCPATH_SS_SMART_HR_SEARCH_SCREEN,
      label: "SS Smart HR employee-id filter",
      searchTerms: ["ucpath ss smart hr empl id filter input"],
      role: "field",
      effect: "prepare",
      sensitivity: "restricted",
      valueType: "eid",
      scope: "page",
      // PeopleSoft folds the search operator into the Empl ID accessible name; use its stable structural ID.
      locator: { kind: "css", selector: "#UC_SS_TBH_DVW_EMPLID" },
      requiredStates: [UCPATH_SS_SMART_HR_SEARCH_READY],
      verification: terminationVerification(SS_SEARCH_SCENARIO, SS_EMPLID_PORT_KEY),
      portContext: "ss-smart-hr-search",
      selectorKey: SS_EMPLID_PORT_KEY,
      supersedes: [],
    },
    {
      id: UCPATH_SS_SMART_HR_SEARCH_BUTTON,
      system: "ucpath",
      screen: UCPATH_SS_SMART_HR_SEARCH_SCREEN,
      label: "SS Smart HR Search button",
      searchTerms: ["ucpath ss smart hr execute search button"],
      role: "button",
      effect: "navigate",
      sensitivity: "restricted",
      valueType: "none",
      scope: "page",
      locator: { kind: "css", selector: "#PTS_CFG_CL_WRK_PTS_SRCH_BTN" },
      requiredStates: [UCPATH_SS_SMART_HR_SEARCH_READY],
      verification: terminationVerification(SS_SEARCH_SCENARIO, SS_SEARCH_BUTTON_PORT_KEY),
      selectorKey: SS_SEARCH_BUTTON_PORT_KEY,
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
    {
      id: UCPATH_SS_SMART_HR_TRANSACTION_READY,
      system: "ucpath",
      screen: UCPATH_SS_SMART_HR_TRANSACTION_SCREEN,
      label: "SS Smart HR transaction detail ready",
      searchTerms: ["ucpath ss smart hr transaction detail ready state"],
      sensitivity: "restricted",
      // Unknown transaction IDs render the ordinary search page; require number and status detail anchors.
      evidence: [
        { kind: "visible", element: UCPATH_SS_SMART_HR_RECEIPT_DISPLAY },
        { kind: "visible", element: UCPATH_SS_SMART_HR_APPROVAL_STATUS_DISPLAY },
      ],

      timeoutMs: 30_000,
      verification: receiptVerification(RECEIPT_PORT_KEY),
    },
    {
      id: UCPATH_SMART_HR_SETUP_READY,
      system: "ucpath",
      screen: UCPATH_SMART_HR_SETUP_SCREEN,
      label: "Smart HR setup ready",
      searchTerms: ["ucpath smart hr wizard setup ready state"],
      sensitivity: "restricted",
      evidence: [{ kind: "visible", element: UCPATH_SMART_HR_TEMPLATE_INPUT }],
      timeoutMs: 30_000,
      verification: terminationVerification(WIZARD_SCENARIO, TEMPLATE_PORT_KEY),
    },
    {
      id: UCPATH_SMART_HR_DETAILS_READY,
      system: "ucpath",
      screen: UCPATH_SMART_HR_DETAILS_SCREEN,
      label: "Smart HR details ready",
      searchTerms: ["ucpath smart hr wizard details ready state"],
      sensitivity: "restricted",
      evidence: [{ kind: "visible", element: UCPATH_SMART_HR_DETAILS_EID_INPUT }],
      timeoutMs: 45_000,
      verification: terminationVerification(WIZARD_SCENARIO, SS_EMPLID_PORT_KEY),
    },
    {
      id: UCPATH_SMART_HR_INFORMATION_READY,
      system: "ucpath",
      screen: UCPATH_SMART_HR_INFORMATION_SCREEN,
      label: "Smart HR information ready",
      searchTerms: ["ucpath smart hr wizard information ready state"],
      sensitivity: "restricted",
      evidence: [{ kind: "visible", element: UCPATH_SMART_HR_SAVE_AND_SUBMIT_BUTTON }],
      timeoutMs: 60_000,
      verification: terminationVerification(WIZARD_SCENARIO, SAVE_SUBMIT_PORT_KEY),
    },
    {
      // Fence against the Last Date Worked input; it exists only on the editable staged transaction.
      id: UCPATH_SMART_HR_TERMINATION_STAGED,
      system: "ucpath",
      screen: UCPATH_SMART_HR_INFORMATION_SCREEN,
      label: "Smart HR termination staged",
      searchTerms: ["ucpath smart hr termination staged fence state"],
      sensitivity: "restricted",
      evidence: [{ kind: "visible", element: UCPATH_SMART_HR_LAST_DATE_WORKED_INPUT }],
      timeoutMs: 60_000,
      verification: terminationVerification(WIZARD_SCENARIO, LAST_DATE_WORKED_PORT_KEY),
    },
    {
      id: UCPATH_SS_SMART_HR_SEARCH_READY,
      system: "ucpath",
      screen: UCPATH_SS_SMART_HR_SEARCH_SCREEN,
      label: "SS Smart HR search ready",
      searchTerms: ["ucpath ss smart hr search ready state"],
      sensitivity: "restricted",
      evidence: [{ kind: "visible", element: UCPATH_SS_SMART_HR_SEARCH_EID_INPUT }],
      timeoutMs: 30_000,
      verification: terminationVerification(SS_SEARCH_SCENARIO, SS_EMPLID_PORT_KEY),
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
    {
      id: UCPATH_SS_SMART_HR_TRANSACTION_RECEIPT,
      system: "ucpath",
      screen: UCPATH_SS_SMART_HR_TRANSACTION_SCREEN,
      label: "UCPath Smart HR transaction receipt",
      searchTerms: ["authoritative ucpath smart hr transaction receipt number"],
      sensitivity: "restricted",
      valueType: "text",
      read: { kind: "element-text", element: UCPATH_SS_SMART_HR_RECEIPT_DISPLAY, valueType: "text" },
      // Approval-strip text is not subject proof; this observation reports completion only.
      authoritativeFor: ["completion"],
      verification: receiptVerification(RECEIPT_PORT_KEY),
    },
    {
      id: UCPATH_SS_SMART_HR_APPROVAL_STATUS,
      system: "ucpath",
      screen: UCPATH_SS_SMART_HR_TRANSACTION_SCREEN,
      label: "UCPath Smart HR transaction approval status",
      searchTerms: ["authoritative ucpath smart hr transaction approval status"],
      sensitivity: "restricted",
      valueType: "text",
      read: {
        kind: "element-text",
        element: UCPATH_SS_SMART_HR_APPROVAL_STATUS_DISPLAY,
        valueType: "text",
      },
      // Denied and pushed-back transactions also have T IDs; verify status alongside the number.
      authoritativeFor: ["completion"],
      verification: receiptVerification(APPROVAL_STATUS_PORT_KEY),
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
    {
      id: RECEIPT_SCENARIO,
      kind: "ui-verification",
      title: "A UCPath Smart HR transaction exposes an exact receipt AND its approval status",
      system: "ucpath",
      semanticIds: [
        UCPATH_SS_SMART_HR_RECEIPT_DISPLAY,
        UCPATH_SS_SMART_HR_APPROVAL_STATUS_DISPLAY,
        UCPATH_SS_SMART_HR_TRANSACTION_READY,
        UCPATH_SS_SMART_HR_TRANSACTION_RECEIPT,
        UCPATH_SS_SMART_HR_APPROVAL_STATUS,
      ],
      fixtureEvidenceRef: SS_SMART_HR_FIXTURE_EVIDENCE,
      liveReadOnlyEvidenceRef: SS_SMART_HR_LIVE_EVIDENCE,
      assertions: ["recipe-resolves", "exactly-one-visible"],
    },
    {
      id: WIZARD_SCENARIO,
      kind: "ui-verification",
      title: "UCPath Smart HR termination wizard resolves across all three pages",
      system: "ucpath",
      semanticIds: [
        UCPATH_SMART_HR_SETUP_SCREEN,
        UCPATH_SMART_HR_DETAILS_SCREEN,
        UCPATH_SMART_HR_INFORMATION_SCREEN,
        UCPATH_SMART_HR_TEMPLATE_INPUT,
        UCPATH_SMART_HR_TRANSACTION_DATE_INPUT,
        UCPATH_SMART_HR_CREATE_TRANSACTION_BUTTON,
        UCPATH_SMART_HR_DETAILS_EID_INPUT,
        UCPATH_SMART_HR_REASON_CODE_SELECT,
        UCPATH_SMART_HR_CONTINUE_BUTTON,
        UCPATH_SMART_HR_OVERRIDE_LDW_CHECKBOX,
        UCPATH_SMART_HR_LAST_DATE_WORKED_INPUT,
        UCPATH_SMART_HR_INITIATOR_COMMENTS_FIELD,
        UCPATH_SMART_HR_TRANSACTION_COMMENTS_FIELD,
        UCPATH_SMART_HR_SAVE_AND_SUBMIT_BUTTON,
        UCPATH_SMART_HR_SETUP_READY,
        UCPATH_SMART_HR_DETAILS_READY,
        UCPATH_SMART_HR_INFORMATION_READY,
        UCPATH_SMART_HR_TERMINATION_STAGED,
      ],
      fixtureEvidenceRef: SMART_HR_FIXTURE_EVIDENCE,
      liveReadOnlyEvidenceRef: SMART_HR_LIVE_EVIDENCE,
      assertions: ["recipe-resolves", "exactly-one-visible"],
    },
    {
      id: SWEEP_SCENARIO,
      kind: "ui-verification",
      title: "UCPath Transactions in Progress delete control resolves",
      system: "ucpath",
      semanticIds: [UCPATH_SMART_HR_DELETE_SELECTED_BUTTON],
      fixtureEvidenceRef: SMART_HR_FIXTURE_EVIDENCE,
      liveReadOnlyEvidenceRef: SMART_HR_LIVE_EVIDENCE,
      assertions: ["exactly-one-visible"],
    },
    {
      id: SS_SEARCH_SCENARIO,
      kind: "ui-verification",
      title: "UCPath SS Smart HR transaction search filter resolves",
      system: "ucpath",
      semanticIds: [
        UCPATH_SS_SMART_HR_SEARCH_SCREEN,
        UCPATH_SS_SMART_HR_SEARCH_EID_INPUT,
        UCPATH_SS_SMART_HR_SEARCH_BUTTON,
        UCPATH_SS_SMART_HR_SEARCH_READY,
      ],
      fixtureEvidenceRef: SMART_HR_FIXTURE_EVIDENCE,
      liveReadOnlyEvidenceRef: SMART_HR_LIVE_EVIDENCE,
      assertions: ["recipe-resolves", "exactly-one-visible"],
    },
  ],
}));


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

  const rootBinding = bindingsByRow.get(portRowKey({ system: "ucpath", legacyKey: UCPATH_UI_REGISTRY.root.selectorKey }));
  if (!rootBinding || rootBinding.disposition !== "driver-internal") {
    issues.push("UCPath driver root must resolve to its driver-internal port-map row");
  }
  for (const element of UCPATH_UI_REGISTRY.elements) {
    const binding = bindingsByRow.get(portRowKey({ system: element.system, legacyKey: element.selectorKey }));
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
