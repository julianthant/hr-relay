
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
  UiEvidenceReferenceSchema,
  UiPortMapRowReferenceSchema,
  UiRoleSchema,
  UiSensitivitySchema,
  UiVerificationEvidenceManifestSchema,
  UiVerificationScenarioSchema,
  UiVerificationSchema,
} from "../../../../models/ui/contracts.js";
import {
  KUALI_ACTION_LIST_DOCUMENT_LINK,
  KUALI_ACTION_LIST_MATCHED_NUMBER,
  KUALI_ACTION_LIST_READY,
  KUALI_ACTION_LIST_SCREEN,
  KUALI_ACTION_LIST_SEARCH_GO_BUTTON,
  KUALI_ACTION_LIST_SEARCH_INPUT,
} from "../../../../models/ui/kuali-action-list.js";
import {
  KUALI_RRSS_DISPLAYED_EID,
  KUALI_RRSS_DOCUMENT_READY,
  KUALI_RRSS_DOCUMENT_SCREEN,
  KUALI_RRSS_EID_FIELD,
  KUALI_RRSS_SAVE_BUTTON,
  KUALI_RRSS_TIMEKEEPER_FIELD,
} from "../../../../models/ui/kuali-rrss-document.js";
import {
  KUALI_RRSS_DEPARTMENT_FIELD,
  KUALI_RRSS_DISPLAYED_FORM_TYPE,
  KUALI_RRSS_DISPLAYED_NUMBER,
  KUALI_RRSS_EMPLOYEE_NAME_FIELD,
  KUALI_RRSS_FINAL_PAY_STUDENT_RADIO,
  KUALI_RRSS_LAST_DAY_WORKED_FIELD,
  KUALI_RRSS_LOCATION_FIELD,
  KUALI_RRSS_PAYROLL_TITLE_CODE_FIELD,
  KUALI_RRSS_PAYROLL_TITLE_FIELD,
  KUALI_RRSS_REQUEST_ACKNOWLEDGED_CHECKBOX,
  KUALI_RRSS_SEPARATION_DATE_FIELD,
  KUALI_RRSS_SEPARATION_READY,
  KUALI_RRSS_SUBMITTED_TEMPLATE_CHECKBOX,
  KUALI_RRSS_TERMINATION_EFF_DATE_FIELD,
  KUALI_RRSS_TERMINATION_TYPE_FIELD,
  KUALI_RRSS_TIMEKEEPER_COMMENTS_FIELD,
  KUALI_RRSS_TRANSACTION_NUMBER_FIELD,
  KUALI_SEPARATION_FORM_TYPE,
} from "../../../../models/ui/kuali-separation-document.js";
import {
  KUALI_RRSS_DISPLAYED_TRANSACTION_NUMBER,
  KUALI_RRSS_FINALIZATION_STAGED,
} from "../../../../models/ui/kuali-separation-finalization.js";
import { PREFLIGHT_SCENARIO_MANIFESTS } from "../../../../models/trust/preflight-scenarios.js";

const FIXTURE_EVIDENCE = "docs/rebuild/evidence/selectors/kuali/rrss-document.fixture.json";
const LIVE_EVIDENCE = "docs/rebuild/evidence/selectors/kuali/rrss-document.live.json";
const IDENTITY_SCENARIO = "ui/kuali-rrss-document-identity";
const SHARED_FINALIZATION_CONTROLS_SCENARIO = "ui/kuali-rrss-shared-finalization-controls";

// Separate evidence manifests retain each surface's own verification timestamp.
const READ_FIXTURE_EVIDENCE = "docs/rebuild/evidence/selectors/kuali/separation-document.fixture.json";
const READ_LIVE_EVIDENCE = "docs/rebuild/evidence/selectors/kuali/separation-document.live.json";
const READ_SURFACE_SCENARIO = "ui/kuali-separation-document-read-surface";

// Structural finalization evidence is not proof that controls accept writes.
const FINALIZATION_SURFACE_SCENARIO = "ui/kuali-rrss-finalization-write-surface";


const ACTION_LIST_VERIFIED_AT = "2026-08-20";
const ACTION_LIST_FIXTURE_EVIDENCE = "docs/rebuild/evidence/selectors/kuali/action-list.fixture.json";
const ACTION_LIST_LIVE_EVIDENCE = "docs/rebuild/evidence/selectors/kuali/action-list.live.json";
const ACTION_LIST_SCENARIO = "ui/kuali-action-list-resolve-surface";

const EID_PORT_KEY = "separationForm.eid()";
const TIMEKEEPER_PORT_KEY = "timekeeperTasks.timekeeperName()";
const SAVE_PORT_KEY = "save.navbarSaveButton()";
const ACTION_LIST_SEARCH_PORT_KEY = "actionList.searchInput()";
const ACTION_LIST_GO_PORT_KEY = "actionList.searchGoButton()";
const ACTION_LIST_DOC_LINK_PORT_KEY = "actionList.docLink()";

const VERIFIED_AT = "2026-08-04";
const READ_VERIFIED_AT = "2026-08-14";

const SelectorKeySchema = z.string().regex(/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*\(\)$/u);

// Kuali DOM refs change on reload; exact accessible names avoid neighboring workflow-advancing controls.
const KualiLocatorRecipeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("role-exact-name"),
    role: z.enum(["textbox", "button", "combobox", "checkbox", "radio"]),
    name: z.string().min(1),
    exact: z.literal(true),
  }),
  // Kuali document search is substring-based; match the supplied number with an anchored accessible name.
  z.strictObject({
    kind: z.literal("role-anchored-value-name"),
    role: z.literal("link"),
    valueKind: z.literal("document-number"),
  }),
]);
export type KualiLocatorRecipe = z.infer<typeof KualiLocatorRecipeSchema>;

const KualiStateEvidenceRuleSchema = z.discriminatedUnion("kind", [
  /** `…/build/space/<space>/actions/<actionId>` — which redirects to `…/view`. */
  z.strictObject({ kind: z.literal("action-view-url"), space: z.string().regex(/^[0-9a-f]{24}$/u) }),

  z.strictObject({ kind: z.literal("action-list-url"), space: z.string().regex(/^[0-9a-f]{24}$/u) }),
  /** The level-1 heading is the document number; it is how we prove identity. */
  z.strictObject({ kind: z.literal("document-number-heading"), level: z.literal(1) }),
  // The document title names the form; identical text in app lists cannot prove an open form.
  z.strictObject({ kind: z.literal("document-title-form-name"), formName: z.string().min(1) }),
  z.strictObject({ kind: z.literal("element"), element: ElementIdSchema }),
]);

const KualiObservationRecipeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("input-value"),
    element: ElementIdSchema,
    // Kuali inputs may return whitespace-padded values.
    trim: z.literal(true),
    valueType: z.enum(["eid", "text"]),
  }),
  /** Read off the page, not off a form control — the document's own identity. */
  z.strictObject({
    kind: z.literal("document-number-heading"),
    level: z.literal(1),
    trim: z.literal(true),
    valueType: z.literal("document-number"),
  }),
  z.strictObject({
    kind: z.literal("document-title-form-name"),
    trim: z.literal(true),
    valueType: z.literal("form-type"),
  }),

  z.strictObject({
    kind: z.literal("action-list-matched-link-name"),
    element: ElementIdSchema,
    trim: z.literal(true),
    valueType: z.literal("document-number"),
  }),
]);

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
  locator: KualiLocatorRecipeSchema,
  requiredStates: z.array(PageStateIdSchema),
  verification: UiVerificationSchema,
  selectorKey: SelectorKeySchema,
  supersedes: z.array(ElementIdSchema),
});

const PageStateDefinitionSchema = z.strictObject({
  id: PageStateIdSchema,
  system: BrowserSystemIdSchema,
  screen: ScreenIdSchema,
  label: z.string().min(1),
  searchTerms: z.array(z.string().min(1)).min(1),
  sensitivity: UiSensitivitySchema,
  evidence: z.array(KualiStateEvidenceRuleSchema).min(1),
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
  valueType: z.enum(["eid", "text", "document-number", "form-type"]),
  read: KualiObservationRecipeSchema,
  authoritativeFor: z.array(z.enum(["subject", "completion", "page-state"])).min(1),
  verification: UiVerificationSchema,
});

const KualiUiRegistrySchema = z.strictObject({
  system: z.literal("kuali"),
  screens: z.array(ScreenDefinitionSchema).min(1),
  elements: z.array(ElementDefinitionSchema).min(1),
  states: z.array(PageStateDefinitionSchema).min(1),
  observations: z.array(ObservationDefinitionSchema).min(1),
  scenarios: z.array(UiVerificationScenarioSchema).min(1),
});

const KualiUiRegistryPortBindingSchema = z.strictObject({
  system: z.literal("kuali"),
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

const KualiUiEvidenceBindingInputSchema = z.strictObject({
  evidenceByRef: z.record(UiEvidenceReferenceSchema, UiVerificationEvidenceManifestSchema),
  portBindings: z.array(KualiUiRegistryPortBindingSchema),
});


export const KUALI_RRSS_SPACE_ID = "5e47518b90adda9474c14adb";

function verification(scenario: string, legacyKey: string) {
  return {
    verifiedAt: DateOnlySchema.parse(VERIFIED_AT),
    fixtureEvidenceRef: FIXTURE_EVIDENCE,
    liveReadOnlyEvidenceRef: LIVE_EVIDENCE,
    scenarios: [ScenarioIdSchema.parse(scenario)],
    portMapRows: [{ system: "kuali" as const, legacyKey }],
  };
}




function readVerification(legacyKey: string) {
  return {
    verifiedAt: DateOnlySchema.parse(READ_VERIFIED_AT),
    fixtureEvidenceRef: READ_FIXTURE_EVIDENCE,
    liveReadOnlyEvidenceRef: READ_LIVE_EVIDENCE,
    scenarios: [ScenarioIdSchema.parse(READ_SURFACE_SCENARIO)],
    portMapRows: [{ system: "kuali" as const, legacyKey }],
  };
}

/** The finalization write surface, against the read surface's evidence pair. */
function finalizationVerification(legacyKey: string) {
  return {
    verifiedAt: DateOnlySchema.parse(READ_VERIFIED_AT),
    fixtureEvidenceRef: READ_FIXTURE_EVIDENCE,
    liveReadOnlyEvidenceRef: READ_LIVE_EVIDENCE,
    scenarios: [ScenarioIdSchema.parse(FINALIZATION_SURFACE_SCENARIO)],
    portMapRows: [{ system: "kuali" as const, legacyKey }],
  };
}


function actionListVerification(legacyKey: string) {
  return {
    verifiedAt: DateOnlySchema.parse(ACTION_LIST_VERIFIED_AT),
    fixtureEvidenceRef: ACTION_LIST_FIXTURE_EVIDENCE,
    liveReadOnlyEvidenceRef: ACTION_LIST_LIVE_EVIDENCE,
    scenarios: [ScenarioIdSchema.parse(ACTION_LIST_SCENARIO)],
    portMapRows: [{ system: "kuali" as const, legacyKey }],
  };
}


function readElement(input: Readonly<{
  id: typeof KUALI_RRSS_EID_FIELD;
  label: string;
  searchTerms: readonly string[];
  role: "textbox" | "combobox" | "checkbox" | "radio";
  name: string;
  sensitivity: "public" | "hr" | "restricted";
  legacyKey: string;
}>) {
  return {
    id: input.id,
    system: "kuali" as const,
    screen: KUALI_RRSS_DOCUMENT_SCREEN,
    label: input.label,
    searchTerms: input.searchTerms,
    role: "field" as const,
    effect: "observe" as const,
    sensitivity: input.sensitivity,
    locator: { kind: "role-exact-name", role: input.role, name: input.name, exact: true },
    requiredStates: [KUALI_RRSS_SEPARATION_READY],
    verification: readVerification(input.legacyKey),
    selectorKey: input.legacyKey,
    supersedes: [],
  };
}

export const KUALI_UI_REGISTRY = deepFreeze(KualiUiRegistrySchema.parse({
  system: "kuali",
  screens: [
    {
      id: KUALI_RRSS_DOCUMENT_SCREEN,
      system: "kuali",
      label: "Kuali RRSS Separation Request Form document",
      searchTerms: ["kuali rrss separation request document screen"],
      sensitivity: "restricted",
      verification: verification(IDENTITY_SCENARIO, EID_PORT_KEY),
    },
    {
      id: KUALI_ACTION_LIST_SCREEN,
      system: "kuali",
      label: "Kuali Build Action List",
      searchTerms: ["kuali build action list screen"],
      sensitivity: "restricted",
      verification: actionListVerification(ACTION_LIST_SEARCH_PORT_KEY),
    },
  ],
  elements: [
    {
      id: KUALI_RRSS_EID_FIELD,
      system: "kuali",
      screen: KUALI_RRSS_DOCUMENT_SCREEN,
      label: "RRSS document EID field",
      searchTerms: ["kuali rrss document eid field"],
      role: "field",
      effect: "observe",
      sensitivity: "restricted",
      locator: { kind: "role-exact-name", role: "textbox", name: "EID*", exact: true },
      requiredStates: [KUALI_RRSS_DOCUMENT_READY],
      verification: verification(IDENTITY_SCENARIO, EID_PORT_KEY),
      selectorKey: EID_PORT_KEY,
      supersedes: [],
    },
    {
      id: KUALI_RRSS_TIMEKEEPER_FIELD,
      system: "kuali",
      screen: KUALI_RRSS_DOCUMENT_SCREEN,
      label: "RRSS document timekeeper name field",
      searchTerms: ["kuali rrss document timekeeper name field"],
      role: "field",
      effect: "prepare",
      sensitivity: "hr",
      locator: { kind: "role-exact-name", role: "textbox", name: "Timekeeper Name:*", exact: true },
      requiredStates: [KUALI_RRSS_DOCUMENT_READY, KUALI_RRSS_FINALIZATION_STAGED],
      verification: verification(SHARED_FINALIZATION_CONTROLS_SCENARIO, TIMEKEEPER_PORT_KEY),
      selectorKey: TIMEKEEPER_PORT_KEY,
      supersedes: [],
    },
    {
      id: KUALI_RRSS_SAVE_BUTTON,
      system: "kuali",
      screen: KUALI_RRSS_DOCUMENT_SCREEN,
      label: "RRSS document Save button",
      searchTerms: ["kuali rrss document save button external commit"],
      role: "button",
      effect: "external-commit",
      sensitivity: "restricted",
      locator: { kind: "role-exact-name", role: "button", name: "Save", exact: true },
      requiredStates: [KUALI_RRSS_FINALIZATION_STAGED],
      verification: verification(SHARED_FINALIZATION_CONTROLS_SCENARIO, SAVE_PORT_KEY),
      selectorKey: SAVE_PORT_KEY,
      supersedes: [],
    },

    {
      id: KUALI_ACTION_LIST_SEARCH_INPUT,
      system: "kuali",
      screen: KUALI_ACTION_LIST_SCREEN,
      label: "Action List search box",
      searchTerms: ["kuali action list search box filter document number"],
      role: "field",
      effect: "observe",
      sensitivity: "public",
      locator: { kind: "role-exact-name", role: "textbox", name: "Search", exact: true },
      requiredStates: [KUALI_ACTION_LIST_READY],
      verification: actionListVerification(ACTION_LIST_SEARCH_PORT_KEY),
      selectorKey: ACTION_LIST_SEARCH_PORT_KEY,
      supersedes: [],
    },
    {
      id: KUALI_ACTION_LIST_SEARCH_GO_BUTTON,
      system: "kuali",
      screen: KUALI_ACTION_LIST_SCREEN,
      label: "Action List search GO button",
      searchTerms: ["kuali action list search go submit button"],
      role: "button",
      effect: "observe",
      sensitivity: "public",
      locator: { kind: "role-exact-name", role: "button", name: "GO", exact: true },
      requiredStates: [KUALI_ACTION_LIST_READY],
      verification: actionListVerification(ACTION_LIST_GO_PORT_KEY),
      selectorKey: ACTION_LIST_GO_PORT_KEY,
      supersedes: [],
    },
    {
      id: KUALI_ACTION_LIST_DOCUMENT_LINK,
      system: "kuali",
      screen: KUALI_ACTION_LIST_SCREEN,
      label: "Action List document link for one document number",
      searchTerms: ["kuali action list document link exact anchored number"],
      role: "link",
      effect: "observe",
      sensitivity: "public",
      locator: { kind: "role-anchored-value-name", role: "link", valueKind: "document-number" },
      requiredStates: [KUALI_ACTION_LIST_READY],
      verification: actionListVerification(ACTION_LIST_DOC_LINK_PORT_KEY),
      selectorKey: ACTION_LIST_DOC_LINK_PORT_KEY,
      supersedes: [],
    },

    readElement({
      id: KUALI_RRSS_EMPLOYEE_NAME_FIELD,
      label: "RRSS document employee name field",
      searchTerms: ["kuali rrss document employee name field"],
      role: "textbox",
      name: "Employee Last Name, First Name*",
      sensitivity: "hr",
      legacyKey: "separationForm.employeeName()",
    }),
    readElement({
      id: KUALI_RRSS_LAST_DAY_WORKED_FIELD,
      label: "RRSS document last day worked field",
      searchTerms: ["kuali rrss document last day worked field"],
      role: "textbox",
      name: "Last Day Worked*",
      sensitivity: "hr",
      legacyKey: "separationForm.lastDayWorked()",
    }),
    readElement({
      id: KUALI_RRSS_SEPARATION_DATE_FIELD,
      label: "RRSS document separation date field",
      searchTerms: ["kuali rrss document separation date field"],
      role: "textbox",
      name: "Separation Date (Last day actively employed)*",
      sensitivity: "hr",
      legacyKey: "separationForm.separationDate()",

    }),
    readElement({
      id: KUALI_RRSS_TERMINATION_TYPE_FIELD,
      label: "RRSS document type of termination select",
      searchTerms: ["kuali rrss document type of termination select"],
      role: "combobox",
      name: "Type of Termination*",
      sensitivity: "hr",
      legacyKey: "separationForm.terminationType()",
    }),
    readElement({
      id: KUALI_RRSS_LOCATION_FIELD,
      label: "RRSS document location field",
      searchTerms: ["kuali rrss document location field"],
      role: "textbox",
      name: "Location*",
      sensitivity: "public",
      legacyKey: "separationForm.location()",

    }),
    readElement({
      id: KUALI_RRSS_REQUEST_ACKNOWLEDGED_CHECKBOX,
      label: "RRSS document request acknowledged checkbox",
      searchTerms: ["kuali rrss document request acknowledged checkbox"],
      role: "checkbox",
      name: "Request Acknowledged - In Progress",
      sensitivity: "public",
      legacyKey: "timekeeperTasks.requestAcknowledgedCheckbox()",
    }),
    readElement({
      id: KUALI_RRSS_TIMEKEEPER_COMMENTS_FIELD,
      label: "RRSS document timekeeper approver comments field",
      searchTerms: ["kuali rrss document timekeeper approver comments field"],
      role: "textbox",
      name: "Timekeeper/Approver Comments:",
      sensitivity: "hr",
      legacyKey: "timekeeperTasks.timekeeperComments()",
    }),
    readElement({
      id: KUALI_RRSS_TERMINATION_EFF_DATE_FIELD,
      label: "RRSS document termination effective date field",
      searchTerms: ["kuali rrss document termination effective date field"],
      role: "textbox",
      name: "Termination Effective Date*",
      sensitivity: "hr",
      legacyKey: "finalTransactions.terminationEffDate()",
    }),
    readElement({
      id: KUALI_RRSS_DEPARTMENT_FIELD,
      label: "RRSS document department select",
      searchTerms: ["kuali rrss document department select"],
      role: "combobox",
      name: "Department*",
      sensitivity: "public",
      legacyKey: "finalTransactions.department()",
    }),
    readElement({
      id: KUALI_RRSS_PAYROLL_TITLE_CODE_FIELD,
      label: "RRSS document payroll title code field",
      searchTerms: ["kuali rrss document payroll title code field"],
      role: "textbox",
      name: "Payroll Title Code*",
      sensitivity: "public",
      legacyKey: "finalTransactions.payrollTitleCode()",
    }),
    readElement({
      id: KUALI_RRSS_PAYROLL_TITLE_FIELD,
      label: "RRSS document payroll title field",
      searchTerms: ["kuali rrss document payroll title field"],
      role: "textbox",
      name: "Payroll Title*",
      sensitivity: "public",
      legacyKey: "finalTransactions.payrollTitle()",
    }),
    readElement({
      id: KUALI_RRSS_SUBMITTED_TEMPLATE_CHECKBOX,
      label: "RRSS document submitted termination template checkbox",
      searchTerms: ["kuali rrss document submitted termination template checkbox"],
      role: "checkbox",
      name: "Submitted Termination Template",
      sensitivity: "public",
      legacyKey: "transactionResults.submittedTemplateCheckbox()",
    }),
    readElement({
      id: KUALI_RRSS_TRANSACTION_NUMBER_FIELD,
      label: "RRSS document transaction number field",
      searchTerms: ["kuali rrss document transaction number field"],
      role: "textbox",
      name: "Transaction Number:*",
      sensitivity: "restricted",
      legacyKey: "transactionResults.transactionNumber()",
    }),
    readElement({
      id: KUALI_RRSS_FINAL_PAY_STUDENT_RADIO,
      label: "RRSS document does-not-need-final-pay student radio",
      searchTerms: ["kuali rrss document final pay student employee radio"],
      role: "radio",
      name: "Does not need Final Pay (student employee)",
      sensitivity: "public",
      legacyKey: "transactionResults.doesNotNeedFinalPayRadio()",
    }),
  ],
  states: [
    {
      id: KUALI_ACTION_LIST_READY,
      system: "kuali",
      screen: KUALI_ACTION_LIST_SCREEN,
      label: "Action List loaded and filterable",
      searchTerms: ["kuali action list ready state"],
      sensitivity: "restricted",

      evidence: [
        { kind: "action-list-url", space: KUALI_RRSS_SPACE_ID },
        { kind: "element", element: KUALI_ACTION_LIST_SEARCH_INPUT },
        { kind: "element", element: KUALI_ACTION_LIST_SEARCH_GO_BUTTON },
      ],

      timeoutMs: 30_000,
      verification: actionListVerification(ACTION_LIST_SEARCH_PORT_KEY),
    },
    {
      id: KUALI_RRSS_DOCUMENT_READY,
      system: "kuali",
      screen: KUALI_RRSS_DOCUMENT_SCREEN,
      label: "RRSS document loaded and identifiable",
      searchTerms: ["kuali rrss document ready state"],
      sensitivity: "restricted",
      evidence: [
        { kind: "action-view-url", space: KUALI_RRSS_SPACE_ID },
        { kind: "document-number-heading", level: 1 },
        { kind: "element", element: KUALI_RRSS_EID_FIELD },
      ],

      timeoutMs: 30_000,
      verification: verification(IDENTITY_SCENARIO, EID_PORT_KEY),
    },
    {
      id: KUALI_RRSS_SEPARATION_READY,
      system: "kuali",
      screen: KUALI_RRSS_DOCUMENT_SCREEN,
      label: "RRSS separation document loaded and proved to be a separation form",
      searchTerms: ["kuali rrss separation document ready state"],
      sensitivity: "restricted",

      evidence: [
        { kind: "action-view-url", space: KUALI_RRSS_SPACE_ID },
        { kind: "document-number-heading", level: 1 },
        { kind: "document-title-form-name", formName: KUALI_SEPARATION_FORM_TYPE },
        { kind: "element", element: KUALI_RRSS_EID_FIELD },
        { kind: "element", element: KUALI_RRSS_TERMINATION_TYPE_FIELD },
      ],
      // Kuali paints the document heading, title and controls in stages; readiness waits for all required facts.
      timeoutMs: 30_000,
      verification: readVerification("separationForm.employeeName()"),
    },
    {
      id: KUALI_RRSS_FINALIZATION_STAGED,
      system: "kuali",
      screen: KUALI_RRSS_DOCUMENT_SCREEN,
      label: "RRSS separation document with an unsaved staged finalization",
      searchTerms: ["kuali rrss document finalization staged state"],
      sensitivity: "restricted",

      evidence: [
        { kind: "action-view-url", space: KUALI_RRSS_SPACE_ID },
        { kind: "document-number-heading", level: 1 },
        { kind: "element", element: KUALI_RRSS_TERMINATION_EFF_DATE_FIELD },
        { kind: "element", element: KUALI_RRSS_DEPARTMENT_FIELD },
        { kind: "element", element: KUALI_RRSS_TRANSACTION_NUMBER_FIELD },
        { kind: "element", element: KUALI_RRSS_SUBMITTED_TEMPLATE_CHECKBOX },
        { kind: "element", element: KUALI_RRSS_FINAL_PAY_STUDENT_RADIO },
        { kind: "element", element: KUALI_RRSS_SAVE_BUTTON },
      ],
      timeoutMs: 30_000,
      verification: finalizationVerification("transactionResults.transactionNumber()"),
    },
  ],
  observations: [
    {
      id: KUALI_ACTION_LIST_MATCHED_NUMBER,
      system: "kuali",
      screen: KUALI_ACTION_LIST_SCREEN,
      label: "Action List matched document number",
      searchTerms: ["authoritative kuali action list matched document number"],
      sensitivity: "public",
      valueType: "document-number",
      read: {
        kind: "action-list-matched-link-name",
        element: KUALI_ACTION_LIST_DOCUMENT_LINK,
        trim: true,
        valueType: "document-number",
      },
      // Bind document identity to the matched link's anchored name, never the action ID being discovered.
      authoritativeFor: ["subject"],
      verification: actionListVerification(ACTION_LIST_DOC_LINK_PORT_KEY),
    },
    {
      id: KUALI_RRSS_DISPLAYED_EID,
      system: "kuali",
      screen: KUALI_RRSS_DOCUMENT_SCREEN,
      label: "Displayed RRSS document EID",
      searchTerms: ["authoritative kuali rrss displayed eid"],
      sensitivity: "restricted",
      valueType: "eid",
      read: { kind: "input-value", element: KUALI_RRSS_EID_FIELD, trim: true, valueType: "eid" },
      authoritativeFor: ["subject"],
      verification: verification(IDENTITY_SCENARIO, EID_PORT_KEY),
    },
    {
      id: KUALI_RRSS_DISPLAYED_NUMBER,
      system: "kuali",
      screen: KUALI_RRSS_DOCUMENT_SCREEN,
      label: "Displayed RRSS document number",
      searchTerms: ["authoritative kuali rrss displayed document number"],
      sensitivity: "public",
      valueType: "document-number",
      read: { kind: "document-number-heading", level: 1, trim: true, valueType: "document-number" },

      authoritativeFor: ["subject"],
      verification: readVerification("separationForm.employeeName()"),
    },
    {
      id: KUALI_RRSS_DISPLAYED_FORM_TYPE,
      system: "kuali",
      screen: KUALI_RRSS_DOCUMENT_SCREEN,
      label: "Displayed RRSS document form type",
      searchTerms: ["authoritative kuali rrss displayed form type"],
      sensitivity: "public",
      valueType: "form-type",
      read: { kind: "document-title-form-name", trim: true, valueType: "form-type" },
      /** S2's proof: it is what promotes `…ready` to `…separation-ready`. */
      authoritativeFor: ["page-state"],
      verification: readVerification("separationForm.terminationType()"),
    },
    {
      id: KUALI_RRSS_DISPLAYED_TRANSACTION_NUMBER,
      system: "kuali",
      screen: KUALI_RRSS_DOCUMENT_SCREEN,
      label: "Displayed RRSS document transaction number",
      searchTerms: ["authoritative kuali rrss displayed transaction number"],
      sensitivity: "hr",
      valueType: "text",
      read: {
        kind: "input-value",
        element: KUALI_RRSS_TRANSACTION_NUMBER_FIELD,
        trim: true,
        valueType: "text",
      },

      authoritativeFor: ["completion"],
      verification: finalizationVerification("transactionResults.transactionNumber()"),
    },
  ],
  scenarios: [
    {
      id: IDENTITY_SCENARIO,
      kind: "ui-verification",
      title: "A Kuali RRSS document exposes an authoritative exact EID",
      system: "kuali",
      semanticIds: [KUALI_RRSS_EID_FIELD, KUALI_RRSS_DOCUMENT_READY, KUALI_RRSS_DISPLAYED_EID],
      fixtureEvidenceRef: FIXTURE_EVIDENCE,
      liveReadOnlyEvidenceRef: LIVE_EVIDENCE,
      assertions: ["recipe-resolves", "exactly-one-visible"],
    },
    {
      id: SHARED_FINALIZATION_CONTROLS_SCENARIO,
      kind: "ui-verification",
      title: "The Kuali finalization controls resolve to exactly one timekeeper field and one Save",
      system: "kuali",
      semanticIds: [
        KUALI_RRSS_TIMEKEEPER_FIELD,
        KUALI_RRSS_SAVE_BUTTON,
      ],
      fixtureEvidenceRef: FIXTURE_EVIDENCE,
      liveReadOnlyEvidenceRef: LIVE_EVIDENCE,
      assertions: ["recipe-resolves", "exactly-one-visible"],
    },
    {
      id: READ_SURFACE_SCENARIO,
      kind: "ui-verification",
      title: "The Kuali separation-document read surface resolves to exactly one node per field",
      system: "kuali",
      semanticIds: [
        KUALI_RRSS_EMPLOYEE_NAME_FIELD,
        KUALI_RRSS_LAST_DAY_WORKED_FIELD,
        KUALI_RRSS_SEPARATION_DATE_FIELD,
        KUALI_RRSS_TERMINATION_TYPE_FIELD,
        KUALI_RRSS_LOCATION_FIELD,
        KUALI_RRSS_REQUEST_ACKNOWLEDGED_CHECKBOX,
        KUALI_RRSS_TIMEKEEPER_COMMENTS_FIELD,
        KUALI_RRSS_TERMINATION_EFF_DATE_FIELD,
        KUALI_RRSS_DEPARTMENT_FIELD,
        KUALI_RRSS_PAYROLL_TITLE_CODE_FIELD,
        KUALI_RRSS_PAYROLL_TITLE_FIELD,
        KUALI_RRSS_SUBMITTED_TEMPLATE_CHECKBOX,
        KUALI_RRSS_TRANSACTION_NUMBER_FIELD,
        KUALI_RRSS_FINAL_PAY_STUDENT_RADIO,
        KUALI_RRSS_SEPARATION_READY,
        KUALI_RRSS_DISPLAYED_NUMBER,
        KUALI_RRSS_DISPLAYED_FORM_TYPE,
      ],
      fixtureEvidenceRef: READ_FIXTURE_EVIDENCE,
      liveReadOnlyEvidenceRef: READ_LIVE_EVIDENCE,
      assertions: ["recipe-resolves", "exactly-one-visible", "exactly-one-editable"],
    },
    {
      id: FINALIZATION_SURFACE_SCENARIO,
      kind: "ui-verification",
      title: "The Kuali finalization write surface names one staged state and one completion read",
      system: "kuali",
      semanticIds: [KUALI_RRSS_FINALIZATION_STAGED, KUALI_RRSS_DISPLAYED_TRANSACTION_NUMBER],
      fixtureEvidenceRef: READ_FIXTURE_EVIDENCE,
      liveReadOnlyEvidenceRef: READ_LIVE_EVIDENCE,
      assertions: ["recipe-resolves"],
    },
    {
      id: ACTION_LIST_SCENARIO,
      kind: "ui-verification",
      title: "The Kuali Action List resolves one document number to exactly one action",
      system: "kuali",
      semanticIds: [
        KUALI_ACTION_LIST_SCREEN,
        KUALI_ACTION_LIST_SEARCH_INPUT,
        KUALI_ACTION_LIST_SEARCH_GO_BUTTON,
        KUALI_ACTION_LIST_DOCUMENT_LINK,
        KUALI_ACTION_LIST_READY,
        KUALI_ACTION_LIST_MATCHED_NUMBER,
      ],
      fixtureEvidenceRef: ACTION_LIST_FIXTURE_EVIDENCE,
      liveReadOnlyEvidenceRef: ACTION_LIST_LIVE_EVIDENCE,
      // Kuali publishes two links per document; require one distinct action ID, not one link.
      assertions: ["recipe-resolves"],
    },
  ],
}));

export function auditKualiUiRegistry(registryInput: unknown = KUALI_UI_REGISTRY): readonly string[] {
  const result = KualiUiRegistrySchema.safeParse(registryInput);
  if (!result.success) return result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  const registry = result.data;
  const issues: string[] = [];
  const allIds = [
    ...registry.screens.map(({ id }) => id),
    ...registry.elements.map(({ id }) => id),
    ...registry.states.map(({ id }) => id),
    ...registry.observations.map(({ id }) => id),
  ];
  if (new Set(allIds).size !== allIds.length) issues.push("Kuali semantic UI ids must be globally unique");
  const searchTerms = [...registry.screens, ...registry.elements, ...registry.states, ...registry.observations]
    .flatMap((fact) => fact.searchTerms.map((term) => term.trim().toLowerCase()));
  if (new Set(searchTerms).size !== searchTerms.length) issues.push("Kuali search terms must resolve to one canonical id");
  const screens = new Set(registry.screens.map(({ id }) => id));
  const elements = new Map(registry.elements.map((element) => [element.id, element]));
  const states = new Map(registry.states.map((state) => [state.id, state]));
  const scenarios = new Set(registry.scenarios.map(({ id }) => id));
  const facts = [...registry.screens, ...registry.elements, ...registry.states, ...registry.observations];
  for (const fact of facts) {
    if (fact.system !== "kuali") issues.push(`${fact.id} crosses a system boundary`);
    for (const scenario of fact.verification.scenarios) {
      if (!scenarios.has(scenario)) issues.push(`${fact.id} references unknown verification scenario ${scenario}`);
    }
  }
  for (const fact of [...registry.elements, ...registry.states, ...registry.observations]) {
    if (!screens.has(fact.screen)) issues.push(`${fact.id} references an unknown Kuali screen`);
  }
  for (const element of registry.elements) {
    for (const state of element.requiredStates) {
      const stateDefinition = states.get(state);
      if (stateDefinition === undefined) issues.push(`${element.id} references unknown state ${state}`);
      else if (stateDefinition.screen !== element.screen) issues.push(`${element.id} required state crosses screens`);
    }
    // The one element that can mutate the outside world must say so, and no
    // element that only observes may claim it.
    if (element.id === KUALI_RRSS_SAVE_BUTTON && element.effect !== "external-commit") {
      issues.push(`${element.id} must declare the external-commit effect`);
    }
    if (element.id !== KUALI_RRSS_SAVE_BUTTON && element.effect === "external-commit") {
      issues.push(`${element.id} may not claim the external-commit effect`);
    }
    // Kuali's Save neighbourhood is the whole reason this registry is exact.
    if (element.locator.kind === "role-exact-name"
      && element.locator.role === "button" && !element.locator.exact) {
      issues.push(`${element.id} button recipe must be an exact-name match`);
    }

    if (element.locator.kind === "role-anchored-value-name"
      && element.id !== KUALI_ACTION_LIST_DOCUMENT_LINK) {
      issues.push(`${element.id} may not use the anchored Action-List link recipe`);
    }
  }
  for (const state of registry.states) {
    for (const evidence of state.evidence) {
      if (evidence.kind === "element" && !elements.has(evidence.element)) {
        issues.push(`${state.id} references unknown evidence element ${evidence.element}`);
      }
    }
  }
  for (const observation of registry.observations) {
    if ((observation.read.kind === "input-value"
      || observation.read.kind === "action-list-matched-link-name")
      && !elements.has(observation.read.element)) {
      issues.push(`${observation.id} reads an unknown Kuali element`);
    }
  }
  // Require one subject-authoritative observation per subject identity.
  const subjectObservations = registry.observations.filter(({ authoritativeFor }) =>
    authoritativeFor.includes("subject"));
  const personSubjects = subjectObservations.filter(({ valueType }) => valueType === "eid");
  if (personSubjects.length !== 1) {
    issues.push("Kuali must expose exactly one person subject-authoritative observation for the write binding");
  }
  // Require unambiguous document identity per screen; different screens have different bindings.
  const documentSubjects = subjectObservations.filter(({ valueType }) => valueType === "document-number");
  const documentSubjectScreens = documentSubjects.map(({ screen }) => screen);
  if (new Set(documentSubjectScreens).size !== documentSubjectScreens.length) {
    issues.push("Kuali must expose at most one document subject-authoritative observation per screen");
  }
  if (subjectObservations.length !== personSubjects.length + documentSubjects.length) {
    issues.push("a Kuali subject-authoritative observation must be a person or a document identity");
  }
  const globalScenarioIds = [
    ...PREFLIGHT_SCENARIO_MANIFESTS.map(({ id }) => ScenarioIdSchema.parse(id)),
    ...registry.scenarios.map(({ id }) => id),
  ];
  if (new Set(globalScenarioIds).size !== globalScenarioIds.length) {
    issues.push("Kuali UI scenario ids must be globally unique");
  }
  const semanticIds = new Set(allIds);
  const referencedScenarios = new Set(facts.flatMap(({ verification: value }) => value.scenarios));
  for (const scenario of registry.scenarios) {
    for (const id of scenario.semanticIds) {
      if (!semanticIds.has(id)) issues.push(`${scenario.id} references unknown Kuali semantic id ${id}`);
    }
    if (!referencedScenarios.has(scenario.id)) issues.push(`Kuali verification scenario ${scenario.id} is vacuous`);
  }
  return issues;
}

function portRowKey(row: z.infer<typeof UiPortMapRowReferenceSchema>): string {
  return `${row.system}:${row.legacyKey}`;
}

export function auditKualiUiEvidenceBindings(input: unknown): readonly string[] {
  const parsed = KualiUiEvidenceBindingInputSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  const { evidenceByRef, portBindings } = parsed.data;
  const issues: string[] = [];
  const facts = [
    ...KUALI_UI_REGISTRY.screens.map((fact) => ({ ...fact, screen: fact.id })),
    ...KUALI_UI_REGISTRY.elements,
    ...KUALI_UI_REGISTRY.states,
    ...KUALI_UI_REGISTRY.observations,
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
        issues.push(`${fact.id} references unknown Kuali port-map row ${portRowKey(row)}`);
      }
    }
    const evidenceRefs = [
      [fact.verification.fixtureEvidenceRef, "deterministic-fixture"],
      [fact.verification.liveReadOnlyEvidenceRef, "live-read-only"],
    ] as const;
    for (const [ref, evidenceKind] of evidenceRefs) {
      const manifest = evidenceByRef[ref];
      if (manifest === undefined) {
        issues.push(`${fact.id} is missing Kuali evidence manifest ${ref}`);
        continue;
      }
      if (manifest.evidenceKind !== evidenceKind) issues.push(`${fact.id} ${ref} has the wrong evidence kind`);
      if (manifest.system !== "kuali") issues.push(`${fact.id} ${ref} crosses systems`);
      if (manifest.externalWriteAttempted !== false) issues.push(`${fact.id} ${ref} claims an external write`);
      if (manifest.verifiedAt !== fact.verification.verifiedAt) issues.push(`${fact.id} ${ref} verification date drifted`);
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
      if (!factsById.has(assertion.semanticId)) issues.push(`${ref} asserts unknown Kuali semantic id ${assertion.semanticId}`);
    }
  }
  for (const element of KUALI_UI_REGISTRY.elements) {
    const binding = bindingsByRow.get(portRowKey({ system: "kuali", legacyKey: element.selectorKey }));
    if (binding === undefined || binding.canonicalId !== element.id) {
      issues.push(`${element.id} does not resolve to its exact Kuali ported row`);
      continue;
    }
    if (binding.evidence.verifiedAt !== element.verification.verifiedAt
      || binding.evidence.fixtureEvidenceRef !== element.verification.fixtureEvidenceRef
      || binding.evidence.liveReadOnlyEvidenceRef !== element.verification.liveReadOnlyEvidenceRef) {
      issues.push(`${element.id} Kuali port-map evidence drifted`);
    }
  }
  return issues;
}
