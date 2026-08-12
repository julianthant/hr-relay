/**
 * The Kuali semantic UI registry — the closed set of screens, elements, page
 * states, and observations the Kuali driver may resolve.
 *
 * Three elements, and only three: the EID field (the write's SUBJECT), the
 * timekeeper field (what the write changes), and the Save button (the external
 * commit). Everything else on an RRSS Separation Request Form is deliberately
 * absent — this registry exists to serve Phase 2's transaction proof, and an
 * element nobody uses is an element nobody verifies.
 *
 * Every element is a legacy PORT with exact provenance (legacy commit, path,
 * key, source line, blob) plus its own live read-only re-verification on
 * 2026-08-04. Two ports narrow deliberately, and both narrowings are safety
 * fixes rather than transcription:
 *
 *  - `save.navbarSaveButton()` is a three-deep `.or()` chain in legacy
 *    (`[class*="action-bar"] button:has-text("Save")` → `nav button:has-text("Save")`
 *    → the role selector). On the live 2026-08-04 DOM there is exactly ONE
 *    `button "Save"`, and it sits in one action group with `button "Send Back"`
 *    and `button "Mark Complete"` — both of which ADVANCE the workflow. A
 *    `has-text("Save")` branch is a substring match; a fallback chain around a
 *    button whose neighbours file real separation steps is precisely the
 *    "plausible-but-wrong element" this program bans. The port keeps the exact
 *    role+name branch only, and the driver fails loud on any match count but 1.
 *  - `separationForm.separationDate()` is NOT ported at all, but it is worth
 *    recording why the live check mattered: its legacy recipe is the loose
 *    regex `/Separation Date/`, while the live accessible name is
 *    `"Separation Date (Last day actively employed)*"`. A future port must use
 *    the full literal.
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
  KUALI_RRSS_DISPLAYED_EID,
  KUALI_RRSS_DISPLAYED_TIMEKEEPER,
  KUALI_RRSS_DOCUMENT_READY,
  KUALI_RRSS_DOCUMENT_SCREEN,
  KUALI_RRSS_EID_FIELD,
  KUALI_RRSS_SAVE_BUTTON,
  KUALI_RRSS_TIMEKEEPER_FIELD,
  KUALI_RRSS_TIMEKEEPER_STAGED,
} from "../../../domain/ui/kuali-rrss-document.js";
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
} from "../../../domain/ui/kuali-separation-document.js";
import { PREFLIGHT_SCENARIO_MANIFESTS } from "../../../domain/trust/preflight-scenarios.js";

const LEGACY_COMMIT = "793abe1f8265f3213ffe8a80d6cfd9860a32a1dc";
const KUALI_SELECTOR_BLOB = "1c55c7d307891e07951ca38a89548418bdc23f49";
const FIXTURE_EVIDENCE = "evidence/ui/kuali/rrss-document.fixture.json";
const LIVE_EVIDENCE = "evidence/ui/kuali/rrss-document.live.json";
const IDENTITY_SCENARIO = "ui/kuali-rrss-document-identity";
const WRITE_SURFACE_SCENARIO = "ui/kuali-rrss-timekeeper-write-surface";

/**
 * The separation READ surface carries its own evidence pair and its own
 * verification date, because a manifest states ONE `verifiedAt` and the audit
 * compares it per fact. The write's three elements were live-verified
 * 2026-08-04; the fourteen read elements below were live-verified 2026-08-12.
 * Folding both into one manifest would have to lie about one of them.
 */
const READ_FIXTURE_EVIDENCE = "evidence/ui/kuali/separation-document.fixture.json";
const READ_LIVE_EVIDENCE = "evidence/ui/kuali/separation-document.live.json";
const READ_SURFACE_SCENARIO = "ui/kuali-separation-document-read-surface";

const EID_PORT_KEY = "separationForm.eid()";
const TIMEKEEPER_PORT_KEY = "timekeeperTasks.timekeeperName()";
const SAVE_PORT_KEY = "save.navbarSaveButton()";

const VERIFIED_AT = "2026-08-04";
const READ_VERIFIED_AT = "2026-08-12";

const GitBlobSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const LegacySelectorProvenanceSchema = z.strictObject({
  commit: z.literal(LEGACY_COMMIT),
  path: z.literal("src/systems/kuali/selectors.ts"),
  key: z.string().regex(/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*\(\)$/u),
  sourceLine: z.number().int().positive(),
  blob: GitBlobSchema,
  /**
   * When the rebuild does NOT copy the legacy recipe verbatim, the reason is
   * recorded here and reviewed. A silent narrowing would be indistinguishable
   * from a transcription error.
   */
  narrowedFromLegacy: z.string().min(1).optional(),
});

/**
 * Kuali form controls are addressed the way the live accessibility tree
 * exposes them: role + the EXACT accessible name, `*` included. There is no
 * CSS arm and no `.or()` arm on purpose — doc 09 §13 OQ1 (c) records that DOM
 * refs change on every reload, and the Save neighbourhood makes a fuzzy match
 * dangerous.
 */
export const KualiLocatorRecipeSchema = z.strictObject({
  kind: z.literal("role-exact-name"),
  role: z.enum(["textbox", "button", "combobox", "checkbox", "radio"]),
  name: z.string().min(1),
  exact: z.literal(true),
});
export type KualiLocatorRecipe = z.infer<typeof KualiLocatorRecipeSchema>;

export const KualiStateEvidenceRuleSchema = z.discriminatedUnion("kind", [
  /** `…/build/space/<space>/actions/<actionId>` — which redirects to `…/view`. */
  z.strictObject({ kind: z.literal("action-view-url"), space: z.string().regex(/^[0-9a-f]{24}$/u) }),
  /** The level-1 heading is the document number; it is how we prove identity. */
  z.strictObject({ kind: z.literal("document-number-heading"), level: z.literal(1) }),
  /**
   * Kuali's document route names the FORM in the page title
   * (`Form - <form name> - Kuali`, live 2026-08-12). It is the only
   * unambiguous read of the form type on the page: the same string also appears
   * in the space's app list and in the Action List dialog's rows, so a
   * page-wide text match would resolve several nodes on a document that is not
   * even open (S2).
   */
  z.strictObject({ kind: z.literal("document-title-form-name"), formName: z.string().min(1) }),
  z.strictObject({ kind: z.literal("element"), element: ElementIdSchema }),
]);

export const KualiObservationRecipeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("input-value"),
    element: ElementIdSchema,
    /** Kuali inputs return whitespace-padded values (legacy LESSONS.md:49-54). */
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

export const KualiUiRegistrySchema = z.strictObject({
  system: z.literal("kuali"),
  screens: z.array(ScreenDefinitionSchema).min(1),
  elements: z.array(ElementDefinitionSchema).min(1),
  states: z.array(PageStateDefinitionSchema).min(1),
  observations: z.array(ObservationDefinitionSchema).min(1),
  scenarios: z.array(UiVerificationScenarioSchema).min(1),
});
export type KualiUiRegistry = z.infer<typeof KualiUiRegistrySchema>;

export const KualiUiRegistryPortBindingSchema = z.strictObject({
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

/** The Kuali Build space that owns the RRSS form (legacy `src/config.ts:131`). */
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

function provenance(key: string, sourceLine: number, narrowedFromLegacy?: string) {
  return {
    commit: LEGACY_COMMIT,
    path: "src/systems/kuali/selectors.ts" as const,
    key,
    sourceLine,
    blob: KUALI_SELECTOR_BLOB,
    ...(narrowedFromLegacy === undefined ? {} : { narrowedFromLegacy }),
  };
}

/** The 2026-08-12 read-surface verification, against its own evidence pair. */
function readVerification(legacyKey: string) {
  return {
    verifiedAt: DateOnlySchema.parse(READ_VERIFIED_AT),
    fixtureEvidenceRef: READ_FIXTURE_EVIDENCE,
    liveReadOnlyEvidenceRef: READ_LIVE_EVIDENCE,
    scenarios: [ScenarioIdSchema.parse(READ_SURFACE_SCENARIO)],
    portMapRows: [{ system: "kuali" as const, legacyKey }],
  };
}

/**
 * One read-surface element: a legacy port, live re-verified 2026-08-12 to
 * resolve to EXACTLY ONE node on real documents 4510 / 4502 / 4495.
 */
function readElement(input: Readonly<{
  id: typeof KUALI_RRSS_EID_FIELD;
  label: string;
  searchTerms: readonly string[];
  role: "textbox" | "combobox" | "checkbox" | "radio";
  name: string;
  sensitivity: "public" | "hr" | "restricted";
  legacyKey: string;
  sourceLine: number;
  narrowedFromLegacy?: string;
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
    provenance: provenance(input.legacyKey, input.sourceLine, input.narrowedFromLegacy),
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
      provenance: provenance(EID_PORT_KEY, 96),
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
      requiredStates: [KUALI_RRSS_DOCUMENT_READY, KUALI_RRSS_TIMEKEEPER_STAGED],
      verification: verification(WRITE_SURFACE_SCENARIO, TIMEKEEPER_PORT_KEY),
      provenance: provenance(TIMEKEEPER_PORT_KEY, 138),
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
      requiredStates: [KUALI_RRSS_TIMEKEEPER_STAGED],
      verification: verification(WRITE_SURFACE_SCENARIO, SAVE_PORT_KEY),
      provenance: provenance(
        SAVE_PORT_KEY,
        223,
        "legacy chains [class*=\"action-bar\"] button:has-text(\"Save\") .or(nav button:has-text(\"Save\")) "
        + ".or(role button Save exact); the rebuild keeps ONLY the exact role+name branch because the live "
        + "2026-08-04 DOM has exactly one button \"Save\" adjacent to \"Send Back\" and \"Mark Complete\", "
        + "and a has-text fallback around workflow-advancing buttons is an unacceptable write risk",
      ),
      supersedes: [],
    },
    /* ── The separation READ surface (2i chunk 2, live-verified 2026-08-12) ── */
    readElement({
      id: KUALI_RRSS_EMPLOYEE_NAME_FIELD,
      label: "RRSS document employee name field",
      searchTerms: ["kuali rrss document employee name field"],
      role: "textbox",
      name: "Employee Last Name, First Name*",
      sensitivity: "hr",
      legacyKey: "separationForm.employeeName()",
      sourceLine: 90,
    }),
    readElement({
      id: KUALI_RRSS_LAST_DAY_WORKED_FIELD,
      label: "RRSS document last day worked field",
      searchTerms: ["kuali rrss document last day worked field"],
      role: "textbox",
      name: "Last Day Worked*",
      sensitivity: "hr",
      legacyKey: "separationForm.lastDayWorked()",
      sourceLine: 102,
    }),
    readElement({
      id: KUALI_RRSS_SEPARATION_DATE_FIELD,
      label: "RRSS document separation date field",
      searchTerms: ["kuali rrss document separation date field"],
      role: "textbox",
      name: "Separation Date (Last day actively employed)*",
      sensitivity: "hr",
      legacyKey: "separationForm.separationDate()",
      sourceLine: 108,
      narrowedFromLegacy: "legacy matches the loose regex /Separation Date/; the live accessible name is "
        + "the full literal \"Separation Date (Last day actively employed)*\", and this document also "
        + "renders a helper paragraph containing the words \"separation date\" — so the regex is a "
        + "substring match on a page that has more than one place to hit. The port uses the exact name",
    }),
    readElement({
      id: KUALI_RRSS_TERMINATION_TYPE_FIELD,
      label: "RRSS document type of termination select",
      searchTerms: ["kuali rrss document type of termination select"],
      role: "combobox",
      name: "Type of Termination*",
      sensitivity: "hr",
      legacyKey: "separationForm.terminationType()",
      sourceLine: 114,
    }),
    readElement({
      id: KUALI_RRSS_LOCATION_FIELD,
      label: "RRSS document location field",
      searchTerms: ["kuali rrss document location field"],
      role: "textbox",
      name: "Location*",
      sensitivity: "public",
      legacyKey: "separationForm.location()",
      sourceLine: 120,
      narrowedFromLegacy: "legacy asks for the accessible name \"Location  *\" (a space before the "
        + "asterisk) and the live name is \"Location*\" with none, so legacy's recipe matched ZERO nodes "
        + "on every document — which its own catch turned into location=\"\" (S13). The corrected name "
        + "resolves to exactly one node; S13 is a broken selector, not an optional field",
    }),
    readElement({
      id: KUALI_RRSS_REQUEST_ACKNOWLEDGED_CHECKBOX,
      label: "RRSS document request acknowledged checkbox",
      searchTerms: ["kuali rrss document request acknowledged checkbox"],
      role: "checkbox",
      name: "Request Acknowledged - In Progress",
      sensitivity: "public",
      legacyKey: "timekeeperTasks.requestAcknowledgedCheckbox()",
      sourceLine: 131,
    }),
    readElement({
      id: KUALI_RRSS_TIMEKEEPER_COMMENTS_FIELD,
      label: "RRSS document timekeeper approver comments field",
      searchTerms: ["kuali rrss document timekeeper approver comments field"],
      role: "textbox",
      name: "Timekeeper/Approver Comments:",
      sensitivity: "hr",
      legacyKey: "timekeeperTasks.timekeeperComments()",
      sourceLine: 145,
    }),
    readElement({
      id: KUALI_RRSS_TERMINATION_EFF_DATE_FIELD,
      label: "RRSS document termination effective date field",
      searchTerms: ["kuali rrss document termination effective date field"],
      role: "textbox",
      name: "Termination Effective Date*",
      sensitivity: "hr",
      legacyKey: "finalTransactions.terminationEffDate()",
      sourceLine: 156,
    }),
    readElement({
      id: KUALI_RRSS_DEPARTMENT_FIELD,
      label: "RRSS document department select",
      searchTerms: ["kuali rrss document department select"],
      role: "combobox",
      name: "Department*",
      sensitivity: "public",
      legacyKey: "finalTransactions.department()",
      sourceLine: 163,
    }),
    readElement({
      id: KUALI_RRSS_PAYROLL_TITLE_CODE_FIELD,
      label: "RRSS document payroll title code field",
      searchTerms: ["kuali rrss document payroll title code field"],
      role: "textbox",
      name: "Payroll Title Code*",
      sensitivity: "public",
      legacyKey: "finalTransactions.payrollTitleCode()",
      sourceLine: 170,
    }),
    readElement({
      id: KUALI_RRSS_PAYROLL_TITLE_FIELD,
      label: "RRSS document payroll title field",
      searchTerms: ["kuali rrss document payroll title field"],
      role: "textbox",
      name: "Payroll Title*",
      sensitivity: "public",
      legacyKey: "finalTransactions.payrollTitle()",
      sourceLine: 177,
    }),
    readElement({
      id: KUALI_RRSS_SUBMITTED_TEMPLATE_CHECKBOX,
      label: "RRSS document submitted termination template checkbox",
      searchTerms: ["kuali rrss document submitted termination template checkbox"],
      role: "checkbox",
      name: "Submitted Termination Template",
      sensitivity: "public",
      legacyKey: "transactionResults.submittedTemplateCheckbox()",
      sourceLine: 188,
    }),
    readElement({
      id: KUALI_RRSS_TRANSACTION_NUMBER_FIELD,
      label: "RRSS document transaction number field",
      searchTerms: ["kuali rrss document transaction number field"],
      role: "textbox",
      name: "Transaction Number:*",
      sensitivity: "restricted",
      legacyKey: "transactionResults.transactionNumber()",
      sourceLine: 195,
    }),
    readElement({
      id: KUALI_RRSS_FINAL_PAY_STUDENT_RADIO,
      label: "RRSS document does-not-need-final-pay student radio",
      searchTerms: ["kuali rrss document final pay student employee radio"],
      role: "radio",
      name: "Does not need Final Pay (student employee)",
      sensitivity: "public",
      legacyKey: "transactionResults.doesNotNeedFinalPayRadio()",
      sourceLine: 202,
    }),
  ],
  states: [
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
      // A cold document open measured ~6s live on 2026-08-04; 30s is the same
      // budget every other store's ready state carries.
      timeoutMs: 30_000,
      verification: verification(IDENTITY_SCENARIO, EID_PORT_KEY),
    },
    {
      id: KUALI_RRSS_TIMEKEEPER_STAGED,
      system: "kuali",
      screen: KUALI_RRSS_DOCUMENT_SCREEN,
      label: "RRSS document with an unsaved staged timekeeper value",
      searchTerms: ["kuali rrss document timekeeper staged state"],
      sensitivity: "restricted",
      // Structural evidence only. That the field holds the STAGED value is
      // proved by the prepare task's read-back (`fillWithVerify` discipline),
      // not by a page-state rule — a value-dependent state id would be a
      // different state per value and could not be registered at all.
      evidence: [
        { kind: "action-view-url", space: KUALI_RRSS_SPACE_ID },
        { kind: "element", element: KUALI_RRSS_TIMEKEEPER_FIELD },
        { kind: "element", element: KUALI_RRSS_SAVE_BUTTON },
      ],
      timeoutMs: 30_000,
      verification: verification(WRITE_SURFACE_SCENARIO, TIMEKEEPER_PORT_KEY),
    },
    {
      id: KUALI_RRSS_SEPARATION_READY,
      system: "kuali",
      screen: KUALI_RRSS_DOCUMENT_SCREEN,
      label: "RRSS separation document loaded and proved to be a separation form",
      searchTerms: ["kuali rrss separation document ready state"],
      sensitivity: "restricted",
      /**
       * Strictly stronger than `…ready`: the same URL and document-number
       * heading PLUS the form's own name off the document title (S2). A
       * non-separation document reaches `…ready` and never reaches this.
       */
      evidence: [
        { kind: "action-view-url", space: KUALI_RRSS_SPACE_ID },
        { kind: "document-number-heading", level: 1 },
        { kind: "document-title-form-name", formName: KUALI_SEPARATION_FORM_TYPE },
        { kind: "element", element: KUALI_RRSS_EID_FIELD },
        { kind: "element", element: KUALI_RRSS_TERMINATION_TYPE_FIELD },
      ],
      /**
       * The document route paints client-side in stages, measured live
       * 2026-08-12 on a warm SPA: no headings at ~7ms, an EMPTY document
       * heading at ~258ms, and the real number + the `Form - … - Kuali` title
       * + the form controls together at ~1.77s. A cold open measured ~3.0s on
       * 2026-08-04. 30s is the same budget the write surface carries.
       */
      timeoutMs: 30_000,
      verification: readVerification("separationForm.employeeName()"),
    },
  ],
  observations: [
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
      id: KUALI_RRSS_DISPLAYED_TIMEKEEPER,
      system: "kuali",
      screen: KUALI_RRSS_DOCUMENT_SCREEN,
      label: "Displayed RRSS document timekeeper name",
      searchTerms: ["authoritative kuali rrss displayed timekeeper name"],
      sensitivity: "hr",
      valueType: "text",
      read: { kind: "input-value", element: KUALI_RRSS_TIMEKEEPER_FIELD, trim: true, valueType: "text" },
      authoritativeFor: ["completion"],
      verification: verification(WRITE_SURFACE_SCENARIO, TIMEKEEPER_PORT_KEY),
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
      /**
       * The ARTIFACT subject of the separation read: the run names a document
       * and DISCOVERS the person, so the document number is what the read's
       * subject binding is proved against. The person-subject observation
       * beside it (`displayed-eid`) is unchanged and still the write's binding.
       */
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
      id: WRITE_SURFACE_SCENARIO,
      kind: "ui-verification",
      title: "The Kuali timekeeper write surface resolves to exactly one field and one Save",
      system: "kuali",
      semanticIds: [
        KUALI_RRSS_TIMEKEEPER_FIELD,
        KUALI_RRSS_SAVE_BUTTON,
        KUALI_RRSS_TIMEKEEPER_STAGED,
        KUALI_RRSS_DISPLAYED_TIMEKEEPER,
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
      assertions: ["recipe-resolves", "exactly-one-visible"],
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
    if (element.locator.role === "button" && !element.locator.exact) {
      issues.push(`${element.id} button recipe must be an exact-name match`);
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
    if (observation.read.kind === "input-value" && !elements.has(observation.read.element)) {
      issues.push(`${observation.id} reads an unknown Kuali element`);
    }
  }
  /**
   * ONE subject-authoritative observation per SUBJECT IDENTITY, not one
   * overall.
   *
   * The original rule ("exactly one") was written when this store had one
   * binding: the write's PERSON subject, the displayed EID. The separation read
   * introduced a second, genuinely different subject — doc 01's `artifact` kind
   * with `identity:"document-id"`, because that read names a document and
   * DISCOVERS the person. Both must still be unambiguous, so the rule becomes
   * per-identity rather than being relaxed: exactly one `eid` subject
   * observation (the write's binding, unchanged) and at most one
   * `document-number` subject observation.
   */
  const subjectObservations = registry.observations.filter(({ authoritativeFor }) =>
    authoritativeFor.includes("subject"));
  const personSubjects = subjectObservations.filter(({ valueType }) => valueType === "eid");
  if (personSubjects.length !== 1) {
    issues.push("Kuali must expose exactly one person subject-authoritative observation for the write binding");
  }
  const documentSubjects = subjectObservations.filter(({ valueType }) => valueType === "document-number");
  if (documentSubjects.length > 1) {
    issues.push("Kuali must expose at most one document subject-authoritative observation");
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
    const binding = bindingsByRow.get(portRowKey({ system: "kuali", legacyKey: element.provenance.key }));
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
