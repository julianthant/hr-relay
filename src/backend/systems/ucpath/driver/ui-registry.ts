import { z } from "zod";
import { deepFreeze } from "../../../../domain/immutability.js";
import {
  BrowserSystemIdSchema,
  DateOnlySchema,
  EidSchema,
  ElementIdSchema,
  ObservationIdSchema,
  PageStateIdSchema,
  ScenarioIdSchema,
  ScreenIdSchema,
} from "../../../../domain/ids.js";
import {
  UiEffectSchema,
  UiRoleSchema,
  UiSensitivitySchema,
  UiEvidenceReferenceSchema,
  UiPortMapRowReferenceSchema,
  UiVerificationEvidenceManifestSchema,
  UiVerificationScenarioSchema,
  UiVerificationSchema,
} from "../../../../domain/ui/contracts.js";
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
} from "../../../../domain/ui/ucpath-person-org.js";
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
} from "../../../../domain/ui/ucpath-smart-hr-termination.js";
import {
  UCPATH_SS_SMART_HR_APPROVAL_STATUS,
  UCPATH_SS_SMART_HR_APPROVAL_STATUS_DISPLAY,
  UCPATH_SS_SMART_HR_RECEIPT_DISPLAY,
  UCPATH_SS_SMART_HR_TRANSACTION_READY,
  UCPATH_SS_SMART_HR_TRANSACTION_RECEIPT,
  UCPATH_SS_SMART_HR_TRANSACTION_SCREEN,
} from "../../../../domain/ui/ucpath-ss-smart-hr.js";
import { PREFLIGHT_SCENARIO_MANIFESTS } from "../../../../domain/trust/preflight-scenarios.js";

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

/**
 * The SS Smart HR receipt surface (ref write-safety §13 OQ2). Its own evidence pair and
 * its own `verifiedAt` — the person-org family was verified 2026-08-02 and
 * must not inherit this probe's date, nor this family that one's.
 */
const SS_SMART_HR_FIXTURE_EVIDENCE = "evidence/ui/ucpath/ss-smart-hr.fixture.json";
const SS_SMART_HR_LIVE_EVIDENCE = "evidence/ui/ucpath/ss-smart-hr.live.json";
const RECEIPT_SCENARIO = "ui/ucpath-ss-smart-hr-transaction-receipt";
const RECEIPT_PORT_KEY = "ssSmartHRTransactions.transactionResultRow()";
const APPROVAL_STATUS_PORT_KEY = "ssSmartHRTransactions.approvalStatusSelect()";

/**
 * The Smart HR TERMINATION family (separations chunk 4, D206) — its own
 * evidence pair and its own `verifiedAt`, because the person-org family was
 * verified 2026-08-02 and the receipt family 2026-08-04, and a family must not
 * inherit another's date.
 *
 * Every count below was observed on **2026-08-14** against production, walking
 * a real `UC_VOL_TERM` wizard to Page C for an ACTIVE employee and then
 * abandoning it by navigation. Nothing was submitted.
 *
 * Two controls are deliberately NOT published. `smartHR.errorBanner()` matched
 * **zero** nodes on a clean Page B and Page C, and the manifest's contract is
 * exactly-one — an element nobody can prove resolves is not evidence. And
 * `smartHR.confirmationOkButton()` only exists AFTER `Save and Submit` is
 * clicked, which this program has not done and will not do outside §4f2's
 * operator-named canary. Both stay driver-internal until they can be observed
 * honestly.
 */
const SMART_HR_FIXTURE_EVIDENCE = "evidence/ui/ucpath/smart-hr-termination.fixture.json";
const SMART_HR_LIVE_EVIDENCE = "evidence/ui/ucpath/smart-hr-termination.live.json";
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
/** ONE legacy key, TWO live elements — see the contextual binding below. */
const SS_EMPLID_PORT_KEY = "ssSmartHRTransactions.emplIdInput()";
const SS_SEARCH_BUTTON_PORT_KEY = "ssSmartHRTransactions.searchButton()";

const GitBlobSchema = z.string().regex(/^[0-9a-f]{40}$/);
const LegacySelectorProvenanceSchema = z.strictObject({
  commit: z.literal(LEGACY_COMMIT),
  path: z.literal("src/systems/ucpath/selectors.ts"),
  key: z.string().regex(/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*\(\)$/),
  sourceLine: z.number().int().positive(),
  blob: GitBlobSchema,
  /**
   * When the rebuild does NOT copy the legacy recipe verbatim, the reason is
   * recorded here and reviewed — the same rule Kuali's registry carries. A
   * silent narrowing would be indistinguishable from a transcription error.
   */
  narrowedFromLegacy: z.string().min(1).optional(),
});
const UiPortContextSchema = z.enum([
  "search-results-view-toggle",
  "employment-instances-view-toggle",
  /**
   * `ssSmartHRTransactions.emplIdInput()` names TWO different live controls.
   * Legacy fills the Smart HR wizard's Page-B Empl ID with the SS Smart HR
   * SEARCH form's key (`legacy:src/workflows/separations/steps/ucpath-transaction.ts:126`),
   * and live they are `#HR_TBH_WRK_EMPLID_PROMPT2` and `#UC_SS_TBH_DVW_EMPLID`
   * respectively. The port row binds both by context rather than picking one
   * and calling the other a fallback.
   */
  "smart-hr-wizard-details",
  "ss-smart-hr-search",
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

function selectorProvenance(key: string, sourceLine: number, narrowedFromLegacy?: string) {
  return {
    commit: LEGACY_COMMIT,
    path: "src/systems/ucpath/selectors.ts" as const,
    key,
    sourceLine,
    blob: UCPATH_SELECTOR_BLOB,
    ...(narrowedFromLegacy === undefined ? {} : { narrowedFromLegacy }),
  };
}

/** The SS Smart HR receipt family's own verification stamp (2026-08-04). */
function receiptVerification(legacyKey: string) {
  return {
    verifiedAt: DateOnlySchema.parse("2026-08-04"),
    fixtureEvidenceRef: SS_SMART_HR_FIXTURE_EVIDENCE,
    liveReadOnlyEvidenceRef: SS_SMART_HR_LIVE_EVIDENCE,
    scenarios: [ScenarioIdSchema.parse(RECEIPT_SCENARIO)],
    portMapRows: [{ system: "ucpath" as const, legacyKey }],
  };
}

/** The Smart HR termination family's own verification stamp (2026-08-14). */
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
      /**
       * D213 — this is PeopleSoft's search-CRITERIA banner. It renders on every
       * result LIST page, stating the count and the criteria: live
       * `No matching values were found`, and live
       * `4 results   -   Last Name "Ezeunala"   Name "Chim…"` above a populated
       * grid. Only the first text means nobody matched, and the element id keeps
       * its shipped `no-results-status` name (durable catalogs and selector
       * provenance bind it) while the label stops claiming a fact the live page
       * disproves. `classifyPersonOrgSearchOutcome` owns the reading.
       */
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
      // `scope: "page"`, NOT `"content-frame"`. Reached by its keyed deep link
      // the SS Smart HR component renders with NO iframe at all — live
      // 2026-08-04 the page carried zero `<iframe>` elements and no
      // `#main_target_win0`. Legacy routes every UCPath read through
      // `getContentFrame(page)`, which on this route resolves to nothing.
      scope: "page",
      // PeopleSoft's own `RECORD_FIELD` id. There is NO role+name anchor to
      // use: the value renders as a bare `<span>` with no programmatic
      // relationship to its "Transaction ID" label, so the accessibility tree
      // exposes two adjacent unnamed generics. Verified live 2026-08-04
      // against three transactions spanning three templates and three
      // approval statuses (T002125030 HIR/Approved, T002204014 REH/Denied,
      // T002204964 XFR/Pending): `querySelectorAll` matched EXACTLY ONE node
      // each time. The only other `T…`-bearing leaf on the page is the
      // approval-strip `<td>` ("Transaction: T…, ID: …, Effdt: …, Unit: …"),
      // which is why legacy's body-text scrape is unsafe here.
      locator: { kind: "css", selector: "#UC_SS_TRANSACT_UC_TRANSACT_ID" },
      requiredStates: [UCPATH_SS_SMART_HR_TRANSACTION_READY],
      verification: receiptVerification(RECEIPT_PORT_KEY),
      provenance: selectorProvenance(
        RECEIPT_PORT_KEY,
        1379,
        "legacy's only transaction-id anchor on this page is the RESULTS-GRID row "
        + "(tr[id^=trPTS_CFG_CL_STD_RSL] filtered by id, .or(link named id)); the rebuild binds the "
        + "DETAIL page's display field instead, because the grid is capped at 100 rendered rows out "
        + "of a server-side maximum of 300 and its default order is by the search key, not recency — "
        + "so picking 'my' row out of a grid is a guess, while the keyed deep link is exact. The "
        + "legacy `.or()` link branch is dropped: no view of this page renders the id as a hyperlink",
      ),
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
      // Same shape and the same live proof as the receipt field: exactly one
      // node on each of the three probed transactions, rendering "Approved",
      // "Denied", and "Pending" respectively.
      locator: { kind: "css", selector: "#UC_SS_TRANSACT_APPR_STATUS" },
      requiredStates: [UCPATH_SS_SMART_HR_TRANSACTION_READY],
      verification: receiptVerification(APPROVAL_STATUS_PORT_KEY),
      provenance: selectorProvenance(
        APPROVAL_STATUS_PORT_KEY,
        1329,
        "legacy's key is the SEARCH FILTER combobox (#UC_SS_TBH_DVW_APPR_STATUS) whose option list "
        + "supplied the closed status vocabulary; the rebuild binds the DETAIL page's display span "
        + "(#UC_SS_TRANSACT_APPR_STATUS), which is the authoritative per-transaction value rather "
        + "than a query input",
      ),
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
      // Live 2026-08-14: exactly one node. Legacy's accessible-name recipe runs
      // inside `getContentFrame`, and this wizard renders ZERO iframes, so the
      // frame funnel resolves to nothing — the stable id is the port.
      locator: { kind: "css", selector: "#HR_TBH_WRK_TBH_TMPL_ID" },
      requiredStates: [UCPATH_SMART_HR_SETUP_READY],
      verification: terminationVerification(WIZARD_SCENARIO, TEMPLATE_PORT_KEY),
      provenance: selectorProvenance(
        TEMPLATE_PORT_KEY,
        59,
        "legacy scopes getByRole(textbox, { name: 'Select Template' }) to the PeopleSoft content "
        + "frame; the Smart HR wizard renders no iframe at all, so the frame-scoped recipe cannot "
        + "resolve and the live stable id is bound instead",
      ),
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
      // Live 2026-08-14: exactly one node, MM/DD/YYYY.
      locator: { kind: "css", selector: "#UC_HR_TBH_WRK_TRANSACTION_DATE" },
      requiredStates: [UCPATH_SMART_HR_SETUP_READY],
      verification: terminationVerification(WIZARD_SCENARIO, TRANSACTION_DATE_PORT_KEY),
      provenance: selectorProvenance(
        TRANSACTION_DATE_PORT_KEY,
        66,
        "legacy names this control 'Effective Date' and scopes it to the content frame; the live "
        + "wizard labels it Transaction Date and renders no iframe, so the stable id is bound and "
        + "the semantic id says transaction-date to stop it being confused with the JOB effective "
        + "date on the next page (#HR_TBH_WRK_JOB_EFFDT), which is a different field",
      ),
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
      // `effect: "navigate"` and NOT a commit: the 2026-08-13/14 live checks
      // proved Create Transaction persists nothing — the Transactions in
      // Progress grid is unchanged afterwards and Transaction ID reads "NEW".
      locator: { kind: "css", selector: "#HR_TBH_WRK_TBH_ADD" },
      requiredStates: [UCPATH_SMART_HR_SETUP_READY],
      verification: terminationVerification(WIZARD_SCENARIO, CREATE_TRANSACTION_PORT_KEY),
      provenance: selectorProvenance(
        CREATE_TRANSACTION_PORT_KEY,
        73,
        "same frame-scoping narrowing as the template input; live exactly one node",
      ),
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
      // The pending sweep's ONE external write. `input#HR_TBH_WRK_DELETE_BTN`
      // is a stable id legacy has no key for — legacy clicks it by accessible
      // name — and it was live-verified 2026-08-14 as exactly one node on the
      // same page that carries the template form.
      locator: { kind: "css", selector: "#HR_TBH_WRK_DELETE_BTN" },
      requiredStates: [UCPATH_SMART_HR_SETUP_READY],
      verification: terminationVerification(SWEEP_SCENARIO, DELETE_SELECTED_PORT_KEY),
      provenance: selectorProvenance(
        DELETE_SELECTED_PORT_KEY,
        148,
        "legacy matches the accessible name inside the content frame; live the control is an "
        + "<input> with the stable id #HR_TBH_WRK_DELETE_BTN on a frameless page",
      ),
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
      // Blur triggers UCPath's own lookup: 813 ms live for an ACTIVE employee.
      // An EID with no terminable employment record resolves NOTHING — see the
      // details-ready state and separations.md §9.8.
      locator: { kind: "css", selector: "#HR_TBH_WRK_EMPLID_PROMPT2" },
      requiredStates: [UCPATH_SMART_HR_DETAILS_READY],
      verification: terminationVerification(WIZARD_SCENARIO, SS_EMPLID_PORT_KEY),
      portContext: "smart-hr-wizard-details",
      provenance: selectorProvenance(
        SS_EMPLID_PORT_KEY,
        1307,
        "legacy fills the WIZARD's Empl ID with the SS Smart HR SEARCH form's key; live they are "
        + "two different controls (#HR_TBH_WRK_EMPLID_PROMPT2 here, #UC_SS_TBH_DVW_EMPLID on the "
        + "search form), so the one legacy row binds both by context",
      ),
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
      // A <select> whose options are `value=CODE, text=LABEL` (live: 18 for
      // UC_VOL_TERM, 26 for UC_INVOL_TERM, both captured whole in §9.8). The
      // driver resolves a reason by value OR label and refuses unless exactly
      // one matches.
      locator: { kind: "css", selector: "#HR_TBH_WRK_ACTION_REASON" },
      requiredStates: [UCPATH_SMART_HR_DETAILS_READY],
      verification: terminationVerification(WIZARD_SCENARIO, REASON_CODE_PORT_KEY),
      provenance: selectorProvenance(
        REASON_CODE_PORT_KEY,
        80,
        "legacy uses getByLabel('Reason Code') inside the content frame; the live control is "
        + "labelled Action Reason on a frameless page, so the stable id is bound",
      ),
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
      provenance: selectorProvenance(
        CONTINUE_PORT_KEY,
        86,
        "legacy's own comment already records the id (HR_TBH_WRK_TBH_NEXT) and its JS fallback "
        + "submits that exact action; the rebuild binds the id directly on a frameless page",
      ),
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
      // `input[type=checkbox]` is LOAD-BEARING, ported verbatim from legacy's
      // 2026-07-28 finding: the editable form renders a hidden `$chk$`
      // companion sharing the prefix, so a bare `id^=` matched 2 nodes and
      // every read threw a strict-mode violation. Live 2026-08-14: exactly one,
      // id `HR_TBH_SCR_WRK_TBH_CHK2$3`, and UCPath renders it ALREADY CHECKED.
      locator: {
        kind: "css",
        selector: "input[type=\"checkbox\"][id^=\"HR_TBH_SCR_WRK_TBH_CHK2$\"]",
      },
      requiredStates: [UCPATH_SMART_HR_INFORMATION_READY],
      verification: terminationVerification(WIZARD_SCENARIO, OVERRIDE_LDW_PORT_KEY),
      provenance: selectorProvenance(OVERRIDE_LDW_PORT_KEY, 314),
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
      // Deliberately input-specific so a read-only or reused transaction fails
      // closed instead of masquerading as an editable form (legacy's rule,
      // ported). Live 2026-08-14: exactly one, `HR_TBH_SCR_WRK_TBH_DATE$3`,
      // PRE-FILLED by UCPath with (transaction date − 1 day) — a default, not
      // the operator's answer, which is why prepare writes it and reads it back.
      locator: { kind: "css", selector: "input[id^=\"HR_TBH_SCR_WRK_TBH_DATE$\"]" },
      requiredStates: [UCPATH_SMART_HR_INFORMATION_READY],
      verification: terminationVerification(WIZARD_SCENARIO, LAST_DATE_WORKED_PORT_KEY),
      provenance: selectorProvenance(LAST_DATE_WORKED_PORT_KEY, 327),
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
      provenance: selectorProvenance(
        INITIATOR_COMMENTS_PORT_KEY,
        286,
        "legacy's two comment keys are named the OPPOSITE way round to the live labels: its "
        + "`commentsTextarea` is #HR_TBH_WRK_DESCRLONG_NOTES (live: Initiator Comments) and its "
        + "`initiatorCommentsTextarea` is #UC_SS_TRANSACT_COMMENTS (live: transaction comments). "
        + "The ids are bound verbatim and the semantic names follow the live labels",
      ),
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
      provenance: selectorProvenance(
        TRANSACTION_COMMENTS_PORT_KEY,
        293,
        "see the initiator-comments note: legacy's two comment key NAMES are swapped relative to "
        + "the live labels, so the ids are bound verbatim and the semantic names follow the page",
      ),
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
      // THE control that files a real termination. Verified live only by
      // RESOLUTION — exactly one node on a fully staged Page C — and never
      // clicked: the controlled real commit waits on §4f2's operator-named
      // canary. Legacy's `.first()` is dropped: the live page has exactly one.
      locator: { kind: "css", selector: "#HR_TBH_WRK_TBH_SAVE" },
      requiredStates: [UCPATH_SMART_HR_INFORMATION_READY],
      verification: terminationVerification(WIZARD_SCENARIO, SAVE_SUBMIT_PORT_KEY),
      provenance: selectorProvenance(
        SAVE_SUBMIT_PORT_KEY,
        121,
        "legacy takes .first() of an accessible-name match inside the content frame because the "
        + "name repeats at the bottom of every tab; the live frameless page carries exactly one "
        + "#HR_TBH_WRK_TBH_SAVE, so the ambiguity the .first() papered over does not exist",
      ),
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
      // The 2026-08-04 live probe already recorded WHY legacy's recipe fails
      // here (PeopleSoft folds the operator dropdown into the accessible name,
      // so it reads "Empl ID begins with"); that probe listed this key as a
      // rejected candidate with no home. It now has one.
      locator: { kind: "css", selector: "#UC_SS_TBH_DVW_EMPLID" },
      requiredStates: [UCPATH_SS_SMART_HR_SEARCH_READY],
      verification: terminationVerification(SS_SEARCH_SCENARIO, SS_EMPLID_PORT_KEY),
      portContext: "ss-smart-hr-search",
      provenance: selectorProvenance(
        SS_EMPLID_PORT_KEY,
        1307,
        "the exact accessible name matches zero live because PeopleSoft appends the operator "
        + "('Empl ID begins with'); the stable id is bound, and the same legacy key also binds the "
        + "WIZARD's Page-B Empl ID under a different context",
      ),
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
      provenance: selectorProvenance(
        SS_SEARCH_BUTTON_PORT_KEY,
        1357,
        "PeopleSoft reuses this button id across Find-an-Existing-Value forms, so the same "
        + "SELECTOR also backs ucpath.person-org.search-button on a different screen; the two are "
        + "distinct elements from distinct legacy keys and neither is a fallback for the other",
      ),
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
      // BOTH fields are required evidence, and that is the whole point of this
      // state. An unknown transaction id does not error on this route — UCPath
      // silently renders the ordinary Find-an-Existing-Value search form with
      // no message, no marker, and a URL identical to the one that worked
      // (live 2026-08-04, `T009999999`). "The page loaded" is therefore not
      // evidence of anything; the receipt field's presence is. Requiring the
      // status field alongside it also makes it impossible to reach a receipt
      // read without the outcome that qualifies it.
      evidence: [
        { kind: "visible", element: UCPATH_SS_SMART_HR_RECEIPT_DISPLAY },
        { kind: "visible", element: UCPATH_SS_SMART_HR_APPROVAL_STATUS_DISPLAY },
      ],
      // Live 2026-08-04: a cold keyed deep link rendered the detail in ~2s.
      // 30s is the same budget every other UCPath state carries.
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
      /**
       * The page the ref write-safety beat-⑤ fence binds to. Its evidence is the Last
       * Date Worked INPUT rather than the Save button, because the input only
       * renders on an editable transaction — a read-only or already-submitted
       * one shows the span instead — so this state cannot be satisfied by a
       * page that merely looks like the wizard.
       */
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
      // `completion` and nothing else. This is NOT a subject observation: the
      // detail page carries the person only inside the approval strip's
      // free text, so binding a subject from here would be a parse, not a read.
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
      // The second half of the receipt pair. A `T…` exists for Denied, Error,
      // and Pushed Back transactions exactly as it does for Approved ones, so
      // the number alone can never carry the completion claim.
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
