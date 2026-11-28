
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { flow } from "../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor, descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import { DESCRIPTORS } from "../../../src/backend/app/registries/workflow-registry.js";
import { CONTACT_PLAN_MANUAL } from "../../../src/workflows/emergency-contact-member/steps/contact-plan/step.js";
import { CONTACT_PREVIEW_MANUAL } from "../../../src/workflows/emergency-contact-member/steps/contact-preview/step.js";
import { ONBASE_FILING_MANUAL } from "../../../src/workflows/emergency-contact-member/steps/onbase-filing/step.js";
import { REFERENCE_CHECK_MANUAL as MEMBER_REFERENCE_CHECK_MANUAL } from "../../../src/workflows/emergency-contact-member/steps/reference-check/step.js";
import { emergencyContactMemberModule } from "../../support/helpers/registered-workflows.js";
import { defineTaskContract } from "../../../src/models/task/task-contract.js";
import { EidSchema, FingerprintSchema, ScenarioIdSchema, TaskIdSchema } from "../../../src/rules/identity/ids.js";
import {
  planStepOmissions,
  stepOmissionCascade,
  stepOmissionPlaceholderFacts,
  StepOmissionFormSchema,
  type StepOmissionCascadeRow,
  type StepManualDeclaration,
  type StepOmissionGraphView,
  type StepOmissionPlan,
} from "../../../src/models/workflow/step-omission.js";
import { defineCanonicalInput } from "../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/models/workflow/presentation.js";
import {
  KRONOS_TIMECARD_OMISSION,
} from "../../../src/workflows/separations/workflow.js";
import { IDENTITY_CHECK_OMISSION, IDENTITY_REVIEW_OMISSION } from "../../../src/workflows/separations/steps/identity-check/step.js";
import { KUALI_EXTRACTION_OMISSION } from "../../../src/workflows/separations/steps/kuali-extraction/step.js";
import { KUALI_FINALIZATION_OMISSION } from "../../../src/workflows/separations/steps/kuali-finalization/step.js";
import { PENDING_TERMINATION_OMISSION, UCPATH_TRANSACTION_OMISSION } from "../../../src/workflows/separations/steps/ucpath-transaction/step.js";
import { ACTIVE_STATUS_MANUAL } from "../../../src/workflows/person-lookup/steps/active-status/step.js";
import { CRM_DATES_MANUAL } from "../../../src/workflows/person-lookup/steps/crm-dates/step.js";
import { CROSS_VERIFY_MANUAL } from "../../../src/workflows/person-lookup/steps/cross-verify/step.js";
import { SEARCHING_MANUAL } from "../../../src/workflows/person-lookup/steps/searching/step.js";
import { CRM_DOCUMENT_SEARCH_MANUAL } from "../../../src/workflows/crm-doc-download/steps/search-records/step.js";
import { CRM_DOCUMENT_REFERENCE_MANUAL } from "../../../src/workflows/crm-doc-download/steps/reference/step.js";
import { CRM_DOCUMENT_READ_IDOCS_MANUAL } from "../../../src/workflows/crm-doc-download/steps/read-idocs/step.js";
import { CRM_DOCUMENT_PACKAGE_MANUAL } from "../../../src/workflows/crm-doc-download/steps/package-worksheets/step.js";
import { TRANSACTION_STEP } from "../../../src/workflows/work-study/steps/transaction/step.js";
import { UCPATH_AUTH_STEP } from "../../../src/workflows/work-study/steps/ucpath-auth/step.js";
import { DOCUMENTS_STEP } from "../../../src/workflows/i9-check-start/steps/documents/step.js";
import { PUBLICATION_STEP, RETENTION_STEP } from "../../../src/workflows/i9-check-start/steps/retention/step.js";
import { ROSTER_REFERENCE_STEP } from "../../../src/workflows/i9-check-start/steps/roster-reference/step.js";
import { FixtureCommit, FixtureStage } from "../../support/fixtures/descriptor-fixtures.js";
import { CRM_DATA_MANUAL } from "../../../src/workflows/onboarding/steps/crm-data/step.js";
import { UCPATH_SEARCH_MANUAL } from "../../../src/workflows/onboarding/steps/ucpath-search/step.js";
import { I9_SEARCH_MANUAL } from "../../../src/workflows/onboarding/steps/i9-search/step.js";
import { HIRE_REVIEW_MANUAL, I9_CREATION_MANUAL, UCPATH_HIRE_MANUAL, MASTER_RESULTS_MANUAL } from "../../../src/workflows/onboarding/steps/hire-review/step.js";
import { REFERENCE_CHECK_MANUAL } from "../../../src/workflows/onboarding/steps/reference-check/step.js";

const FixtureInput = z.strictObject({ eid: EidSchema });
const FixtureCanonicalInput = defineCanonicalInput(
  FixtureInput,
  z.strictObject({ eid: EidSchema }),
  [{ eid: "10800000" }],
);

const ReadContract = defineTaskContract({
  id: TaskIdSchema.parse("ocr/read-step-omission-guard"),
  title: "Step omission guard fixture read",
  effect: "read",
  input: FixtureInput,
  output: z.strictObject({ value: z.string().min(1) }),
  errorCodes: ["unexpected-page-state"] as const,
  subject: { kind: "none", reason: "step omission guard fixture" },
  scenarios: [ScenarioIdSchema.parse("step-omission-guard/happy")],
  freshness: { defaultMaxAgeMs: 0 },
  provenance: { default: "live" as const },
  example: { value: "observed" },
});

const ApproveContract = defineTaskContract({
  id: TaskIdSchema.parse("ocr/verify-step-omission-guard"),
  title: "Step omission guard fixture approve",
  effect: "read",
  input: FixtureInput,
  output: z.strictObject({ approved: z.boolean() }),
  errorCodes: ["unexpected-page-state"] as const,
  subject: { kind: "none", reason: "step omission guard fixture" },
  scenarios: [ScenarioIdSchema.parse("step-omission-guard/happy")],
  freshness: { defaultMaxAgeMs: 0 },
  provenance: { default: "live" as const },
  example: { approved: true },
});


function buildStepOmissionFixture(
  id: string,
  code: string,
  overrides: {
    identityCheckOmission?: StepManualDeclaration;
    writingOmission?: StepManualDeclaration;
  } = {},
): AnyWorkflowDescriptor {
  const fixtureFlow = flow(FixtureInput)
    .step("read", ReadContract, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => ({ eid: input.eid }) })
    .gate("identity-approval", {
      dependsOn: ["read"],
      label: "Identity Approval",
      statusKey: "needsReview",
      resolvedBy: "operator",
      result: z.strictObject({ approved: z.boolean() }),
    })
    .step("approve", ApproveContract, {
      dependsOn: ["read", "identity-approval"],
      replay: "checkpoint",
      bind: ({ input }) => ({ eid: input.eid }),
    })
    .transaction("submit", {
      dependsOn: ["approve"],
      prepare: { uses: FixtureStage, bind: ({ input }) => ({ eid: input.eid }) },
      commit: { uses: FixtureCommit, bind: ({ input }) => ({ eid: input.eid }) },
      dryRun: "stop-after-prepare",
      probePolicy: "always",
      probeToFenceMaxMs: 30_000,
    })
    .build({
      schema: z.strictObject({ transactionId: z.string().min(1) }),
      dependsOn: ["submit"],
      derive: ({ outputs }) => ({ transactionId: outputs.submit.output.transactionId }),
    });

  return defineWorkflowDescriptor({
    id,
    version: 1,
    contractFingerprint: FingerprintSchema.parse("f".repeat(64)),
    code,
    label: "Step omission invariants fixture",
    icon: "ShieldCheck",
    category: "operations",
    canonicalInput: FixtureCanonicalInput,
    inputSubject: "eid",
    surface: { shape: "single" },
    enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    identity: { matchKey: (input) => `eid:${input.eid}` },
    presentation: { title: (input) => `Fixture ${input.eid}` },
    scenarios: [`${id}/happy`],
    timeline: [
      { key: "reading", label: "Reading", nodes: ["read"] },
      {
        key: "identity-check",
        label: "Identity Check",
        nodes: ["identity-approval", "approve"],
        ...(overrides.identityCheckOmission === undefined ? {} : { manual: overrides.identityCheckOmission }),
      },
      {
        key: "writing",
        label: "Writing",
        nodes: ["submit"],
        ...(overrides.writingOmission === undefined ? {} : { manual: overrides.writingOmission }),
      },
    ],
    flow: fixtureFlow,
  });
}

const VALID_OMISSION: StepManualDeclaration = {
  form: { fields: [{ key: "approvedFlag", label: "Approved", kind: "boolean" }] },
  produces: { approve: ({ facts }) => ({ approved: facts.approvedFlag }) },
  skips: [],
};

/** The descriptor ids this guard names explicitly: the registry's manual-entry authors, and the fixture's. */
const SEPARATIONS_ID = "separations";
const PERSON_LOOKUP_ID = "person-lookup";
const ONBOARDING_ID = "onboarding";
const WORK_STUDY_ID = "work-study";
const I9_CHECK_START_ID = "i9-check-start";
const EC_MEMBER_ID = "emergency-contact-member";
const FIXTURE_ID = "step-omission-guard-valid";

/** The one legitimate fixture descriptor every positive check runs against too. */
const validFixture = buildStepOmissionFixture(FIXTURE_ID, "sov", {
  identityCheckOmission: VALID_OMISSION,
});

function graphViewOf(descriptor: AnyWorkflowDescriptor): StepOmissionGraphView {
  return {
    nodes: descriptorRuntimeNodes(descriptor),
    timeline: descriptor.timeline,
    stepOmissions: descriptor.stepOmissions,
  };
}


const PRODUCTION_DECLARATIONS: readonly Readonly<{
  descriptor: string;
  step: string;
  declaration: StepManualDeclaration;
  fieldKeys: readonly string[];
  produces: readonly string[];
}>[] = [
  {
    descriptor: "crm-doc-download", step: "search-records", declaration: CRM_DOCUMENT_SEARCH_MANUAL,
    fieldKeys: ["records"], produces: ["document-records"],
  },
  {
    descriptor: "crm-doc-download", step: "reference", declaration: CRM_DOCUMENT_REFERENCE_MANUAL,
    fieldKeys: ["worksheetRows"], produces: [],
  },
  {
    descriptor: "crm-doc-download", step: "read-idocs", declaration: CRM_DOCUMENT_READ_IDOCS_MANUAL,
    fieldKeys: ["pdfFileNames"], produces: [],
  },
  {
    descriptor: "crm-doc-download", step: "package-worksheets", declaration: CRM_DOCUMENT_PACKAGE_MANUAL,
    fieldKeys: [], produces: [],
  },
  {
    descriptor: SEPARATIONS_ID, step: "kuali-extraction", declaration: KUALI_EXTRACTION_OMISSION,
    fieldKeys: ["employeeName", "lastDayWorked", "separationDate", "terminationType"], produces: ["plan", "termination-type"],
  },
  {
    descriptor: SEPARATIONS_ID, step: "identity-check", declaration: IDENTITY_CHECK_OMISSION,
    fieldKeys: ["emplId", "emplRecord", "department", "payrollTitleCode", "payrollTitle"], produces: ["subject", "employment", "department-option"],
  },
  {
    descriptor: SEPARATIONS_ID, step: "kronos-timecard", declaration: KRONOS_TIMECARD_OMISSION,
    fieldKeys: ["lastDayWorked", "separationDate"], produces: ["dates"],
  },
  {
    descriptor: SEPARATIONS_ID, step: "identity-review", declaration: IDENTITY_REVIEW_OMISSION,
    fieldKeys: ["emplId", "ucpathName"], produces: ["approval"],
  },
  {
    descriptor: SEPARATIONS_ID, step: "pending-termination", declaration: PENDING_TERMINATION_OMISSION,
    fieldKeys: [], produces: [],
  },
  {
    descriptor: SEPARATIONS_ID, step: "ucpath-transaction", declaration: UCPATH_TRANSACTION_OMISSION,
    fieldKeys: ["transactionNumber", "approvalStatus", "effectiveDate"], produces: ["receipt"],
  },
  {
    descriptor: SEPARATIONS_ID, step: "kuali-finalization", declaration: KUALI_FINALIZATION_OMISSION,
    fieldKeys: [], produces: [],
  },
  {
    descriptor: PERSON_LOOKUP_ID, step: "searching", declaration: SEARCHING_MANUAL,
    fieldKeys: ["emplId", "name", "department", "jobTitle", "hrStatus", "employeeStatus", "hdh"], produces: ["searching", "matching", "search-identity"],
  },
  {
    descriptor: PERSON_LOOKUP_ID, step: "cross-verify", declaration: CROSS_VERIFY_MANUAL,
    fieldKeys: ["name", "firstDayOfService"], produces: ["crm-identity"],
  },
  {
    descriptor: PERSON_LOOKUP_ID, step: "active-status", declaration: ACTIVE_STATUS_MANUAL,
    fieldKeys: ["state", "hrStatus", "startDate", "endDate", "terminationReason", "ucpath"], produces: ["active-status"],
  },
  {
    descriptor: PERSON_LOOKUP_ID, step: "crm-dates", declaration: CRM_DATES_MANUAL,
    fieldKeys: ["employmentDate", "oathDate"], produces: ["crm-dates"],
  },
  {
    descriptor: ONBOARDING_ID, step: "crm-data", declaration: CRM_DATA_MANUAL, produces: ["crm-source"],
    fieldKeys: ["recordUrl", "firstName", "lastName", "middleName", "personalEmail", "workEmail", "email", "dob", "ssn", "phone",
      "address", "addressLine2", "city", "state", "postalCode", "positionNumber", "department", "recruitmentNumber", "appointment", "wage", "effectiveDate", "expectedJobEndDate"],
  },
  { descriptor: ONBOARDING_ID, step: "ucpath-search", declaration: UCPATH_SEARCH_MANUAL, fieldKeys: ["match", "emplId"], produces: [] },
  { descriptor: ONBOARDING_ID, step: "i9-search", declaration: I9_SEARCH_MANUAL, fieldKeys: ["i9Status", "profileId"], produces: [] },
  { descriptor: ONBOARDING_ID, step: "hire-review", declaration: HIRE_REVIEW_MANUAL, fieldKeys: ["decision", "emplId"], produces: [] },
  { descriptor: ONBOARDING_ID, step: "reference-check", declaration: REFERENCE_CHECK_MANUAL, fieldKeys: ["referenceResult"], produces: [] },
  { descriptor: ONBOARDING_ID, step: "i9-creation", declaration: I9_CREATION_MANUAL, fieldKeys: [], produces: [] },
  { descriptor: ONBOARDING_ID, step: "ucpath-hire", declaration: UCPATH_HIRE_MANUAL, fieldKeys: [], produces: [] },
  { descriptor: ONBOARDING_ID, step: "master-results", declaration: MASTER_RESULTS_MANUAL, fieldKeys: [], produces: [] },
  {
    descriptor: WORK_STUDY_ID, step: "ucpath-auth", declaration: UCPATH_AUTH_STEP.manual,
    fieldKeys: ["emplId", "displayedName", "positionNumber", "effectiveDate", "positionChangeReason", "positionPool"], produces: ["paypath-position"],
  },
  {
    descriptor: WORK_STUDY_ID, step: "transaction", declaration: TRANSACTION_STEP.manual,
    fieldKeys: [], produces: [],
  },
  ...[DOCUMENTS_STEP, ROSTER_REFERENCE_STEP, RETENTION_STEP, PUBLICATION_STEP]
    .map(step => ({ descriptor: I9_CHECK_START_ID, step: step.key, declaration: step.manual, fieldKeys: [], produces: [] })),
  { descriptor: EC_MEMBER_ID, step: "contact-plan", declaration: CONTACT_PLAN_MANUAL, fieldKeys: ["emplId"], produces: ["map-contact"] },
  { descriptor: EC_MEMBER_ID, step: "reference-check", declaration: MEMBER_REFERENCE_CHECK_MANUAL, fieldKeys: ["referenceResult"], produces: ["reference-stop"] },
  { descriptor: EC_MEMBER_ID, step: "contact-preview", declaration: CONTACT_PREVIEW_MANUAL, fieldKeys: [], produces: [] },
  { descriptor: EC_MEMBER_ID, step: "onbase-filing", declaration: ONBASE_FILING_MANUAL, fieldKeys: [], produces: [] },
];

/** Every `<descriptor>::<step>` row a complete sweep MUST have visited — the production declarations plus the fixture's one. */
const REQUIRED_SWEEP_ROWS: readonly string[] = [
  ...PRODUCTION_DECLARATIONS.map(({ descriptor, step }) => `${descriptor}::${step}`),
  `${FIXTURE_ID}::identity-check`,
];

/** The exact cascade row each production step yields today (check b). */
const PRODUCTION_CASCADE_ROWS: Readonly<Record<string, StepOmissionCascadeRow>> = {
  "crm-doc-download::search-records": { state: "omittable", forces: [] },
  "crm-doc-download::reference": { state: "omittable", forces: ["read-idocs", "package-worksheets"] },
  "crm-doc-download::read-idocs": { state: "omittable", forces: ["package-worksheets"] },
  "crm-doc-download::package-worksheets": { state: "omittable", forces: [] },
  "separations::kuali-extraction": { state: "omittable", forces: ["identity-check", "identity-review", "kuali-finalization"] },
  "separations::identity-check": { state: "omittable", forces: ["identity-review"] },
  "separations::kronos-timecard": { state: "omittable", forces: [] },
  "separations::identity-review": { state: "omittable", forces: [] },
  "separations::pending-termination": { state: "omittable", forces: [] },
  "separations::ucpath-transaction": { state: "omittable", forces: [] },
  "separations::kuali-finalization": { state: "omittable", forces: [] },
  "person-lookup::searching": { state: "omittable", forces: [] },
  "person-lookup::cross-verify": { state: "omittable", forces: [] },
  "person-lookup::active-status": { state: "omittable", forces: [] },
  "person-lookup::crm-dates": { state: "omittable", forces: [] },
  "onboarding::crm-data": { state: "omittable", forces: [] },
  "onboarding::ucpath-search": { state: "omittable", forces: ["i9-search", "hire-review", "reference-check", "i9-creation", "ucpath-hire", "master-results"] },
  "onboarding::i9-search": { state: "omittable", forces: ["hire-review", "i9-creation", "reference-check", "ucpath-hire", "master-results"] },
  "onboarding::hire-review": { state: "omittable", forces: ["reference-check", "i9-creation", "ucpath-hire", "master-results"] },
  "onboarding::reference-check": { state: "omittable", forces: ["i9-creation", "ucpath-hire", "master-results"] },
  "onboarding::i9-creation": { state: "omittable", forces: ["ucpath-hire", "master-results"] },
  "onboarding::ucpath-hire": { state: "omittable", forces: ["master-results"] },
  "onboarding::master-results": { state: "omittable", forces: [] },
  "work-study::ucpath-auth": { state: "omittable", forces: [] },
  "work-study::transaction": { state: "omittable", forces: [] },
  "i9-check-start::documents": { state: "omittable", forces: ["roster-reference", "retention", "publication"] },
  "i9-check-start::roster-reference": { state: "omittable", forces: ["retention", "publication"] },
  "i9-check-start::retention": { state: "omittable", forces: ["publication"] },
  "i9-check-start::publication": { state: "omittable", forces: [] },
  "emergency-contact-member::contact-plan": { state: "omittable", forces: ["onbase-filing", "contact-preview"] },
  "emergency-contact-member::reference-check": { state: "omittable", forces: [] },
  "emergency-contact-member::contact-preview": { state: "omittable", forces: [] },
  "emergency-contact-member::onbase-filing": { state: "omittable", forces: [] },
};


const PRODUCTION_PLANS: Readonly<Record<string, Readonly<{ asserted: readonly string[]; omitted: readonly string[]; manual?: readonly string[] }>>> = {
  "crm-doc-download::search-records": { asserted: ["document-records"], omitted: [] },
  "crm-doc-download::reference": { asserted: [], omitted: ["document-row-choice", "document-rows", "workbook-reference"] },
  "crm-doc-download::read-idocs": { asserted: [], omitted: ["document-pdfs"] },
  "crm-doc-download::package-worksheets": { asserted: [], omitted: ["worksheet-archives"] },
  "separations::kuali-extraction": { asserted: ["plan", "termination-type"], omitted: ["document", "resolve-action"] },
  "separations::identity-check": { asserted: ["department-option", "employment", "subject"], omitted: ["job-summary", "name-search"] },
  "separations::kronos-timecard": { asserted: ["dates"], omitted: ["timecard", "timecard-search"] },
  "separations::identity-review": { asserted: ["approval"], omitted: ["comparison", "identity-approval"] },
  "separations::pending-termination": { asserted: [], omitted: ["clear-pending", "pending-set"] },
  "separations::ucpath-transaction": { asserted: ["receipt"], omitted: ["file-termination"] },
  "separations::kuali-finalization": { asserted: [], omitted: ["filing-presence", "finalize-kuali"] },
  "person-lookup::searching": { asserted: ["matching", "search-identity", "searching"], omitted: [] },
  "person-lookup::cross-verify": { asserted: ["crm-identity"], omitted: ["cross-verify"] },
  "person-lookup::active-status": { asserted: ["active-status"], omitted: ["crm-only-recovery"] },
  "person-lookup::crm-dates": { asserted: ["crm-dates"], omitted: [] },
  "onboarding::crm-data": { asserted: ["crm-source"], omitted: [] },
  "onboarding::ucpath-search": { asserted: [], omitted: ["hire-subject", "ucpath-source"] },
  "onboarding::i9-search": { asserted: [], omitted: ["i9-lookup", "i9-lookup-child"] },
  "onboarding::hire-review": { asserted: [], omitted: ["hire-findings", "hire-review"] },
  "onboarding::reference-check": { asserted: [], omitted: ["reference-check", "reference-check-review", "reference-stop"] },
  "onboarding::i9-creation": { asserted: [], omitted: [], manual: ["i9-profile-plan", "i9-profile-save", "i9-remote-create", "i9-route", "write-plan"] },
  "onboarding::ucpath-hire": { asserted: [], omitted: [], manual: ["concurrent-hire-create", "concurrent-hire-receipt", "hire-create", "hire-receipt"] },
  "onboarding::master-results": { asserted: [], omitted: [], manual: ["concurrent-master-results", "master-results"] },
  "work-study::ucpath-auth": { asserted: ["paypath-position"], omitted: [] },
  "work-study::transaction": { asserted: [], omitted: ["save-transaction", "transaction-plan"] },
  "i9-check-start::documents": { asserted: [], omitted: ["read-approved-records", "read-documents", "read-people"] },
  "i9-check-start::roster-reference": { asserted: [], omitted: ["read-reference", "read-requests"] },
  "i9-check-start::retention": { asserted: [], omitted: ["check-people", "read-rows"] },
  "i9-check-start::publication": { asserted: [], omitted: [], manual: ["publish-results", "save-workbook"] },
  "emergency-contact-member::contact-plan": { asserted: ["map-contact"], omitted: ["contact-plan", "read-contacts"] },
  "emergency-contact-member::reference-check": { asserted: ["reference-stop"], omitted: ["reference-check"] },
  "emergency-contact-member::contact-preview": { asserted: [], omitted: [], manual: ["contact-preview"] },
  "emergency-contact-member::onbase-filing": { asserted: [], omitted: [], manual: ["onbase-filing"] },
};

/** The same pinning for the whole-descriptor plan: every omittable step of a descriptor omitted at once. */
const PRODUCTION_WHOLE_DESCRIPTOR_PLANS: Readonly<Record<string, Readonly<{ asserted: readonly string[]; omitted: readonly string[]; manual?: readonly string[] }>>> = {
  "crm-doc-download": {
    asserted: ["document-records"],
    omitted: ["document-pdfs", "document-row-choice", "document-rows", "workbook-reference", "worksheet-archives"],
  },
  [SEPARATIONS_ID]: {
    asserted: ["approval", "dates", "department-option", "employment", "plan", "receipt", "subject", "termination-type"],
    omitted: ["clear-pending", "comparison", "document", "file-termination", "filing-presence", "finalize-kuali", "identity-approval",
      "job-summary", "name-search", "pending-set", "resolve-action", "timecard", "timecard-search"],
  },
  [PERSON_LOOKUP_ID]: {
    asserted: ["active-status", "crm-dates", "crm-identity", "matching", "search-identity", "searching"],
    omitted: ["crm-only-recovery", "cross-verify"],
  },
  [ONBOARDING_ID]: {
    asserted: ["crm-source"],
    omitted: ["hire-findings", "hire-review", "hire-subject", "i9-lookup", "i9-lookup-child", "reference-check", "reference-check-review", "reference-stop", "ucpath-source"],
    manual: ["concurrent-hire-create", "concurrent-hire-receipt", "concurrent-master-results", "hire-create", "hire-receipt", "i9-profile-plan",
      "i9-profile-save", "i9-remote-create", "i9-route", "master-results", "write-plan"],
  },
  [WORK_STUDY_ID]: {
    asserted: ["paypath-position"],
    omitted: ["save-transaction", "transaction-plan"],
  },
  [I9_CHECK_START_ID]: {
    asserted: [],
    omitted: ["check-people", "publish-results", "read-approved-records", "read-documents", "read-people", "read-reference", "read-requests", "read-rows", "save-workbook"],
  },
  [EC_MEMBER_ID]: {
    asserted: ["map-contact", "reference-stop"],
    omitted: ["contact-plan", "read-contacts", "reference-check"],
    manual: ["contact-preview", "onbase-filing"],
  },
};

/** Every descriptor this guard sweeps: the whole production registry plus the one legitimate fixture. */
const SWEPT_DESCRIPTORS: readonly AnyWorkflowDescriptor[] = [...DESCRIPTORS, emergencyContactMemberModule.descriptor, validFixture];

function isFixture(descriptor: AnyWorkflowDescriptor): boolean {
  return String(descriptor.id) === FIXTURE_ID;
}

function sorted(ids: Iterable<string>): readonly string[] {
  return [...ids].sort((left, right) => left.localeCompare(right));
}


function planSteps(descriptor: AnyWorkflowDescriptor, steps: readonly string[]): StepOmissionPlan {
  const view = graphViewOf(descriptor);
  const specByStep = new Map(view.stepOmissions.map((spec) => [spec.step, spec]));
  return planStepOmissions(view, steps.map((step) => {
    const spec = specByStep.get(step);
    if (spec === undefined) throw new Error(`${String(descriptor.id)}: step "${step}" declares no omission`);
    return { step, facts: stepOmissionPlaceholderFacts(spec.form) };
  }));
}

/** Every sweep ends here: the rows it actually visited must be EXACTLY the declarations this tree has. */
function assertSweptEveryDeclaration(audited: readonly string[], sweep: string): void {
  assert.deepEqual(
    sorted(audited),
    sorted(REQUIRED_SWEEP_ROWS),
    `${sweep}: the sweep did not visit exactly the declared omissions — a production declaration went missing, `
      + "or a new one was added without pinning it here",
  );
}

describe("step-omission invariants", () => {
  it("throws at definition time when an omission produces the gate node of its own step", () => {
    const gateOmission: StepManualDeclaration = {
      form: { fields: [] },
      produces: { "identity-approval": () => ({ approved: true }) },
      skips: ["approve"],
    };
    assert.throws(
      () => buildStepOmissionFixture("step-omission-guard-gate", "sog", { identityCheckOmission: gateOmission }),
      /identity-check" omission produces gate node "identity-approval"; only task nodes are ever asserted/u,
    );
  });

  it("throws at definition time when an omission produces the transaction node of its own step", () => {
    const transactionOmission: StepManualDeclaration = {
      form: { fields: [] },
      produces: { submit: () => ({ transactionId: "T1" }) },
      skips: [],
    };
    assert.throws(
      () => buildStepOmissionFixture("step-omission-guard-txn", "sot", { writingOmission: transactionOmission }),
      /writing" omission produces transaction node "submit"; only task nodes are ever asserted/u,
    );
  });

  it("throws at definition time when an omission skips a gate or a transaction node", () => {
    const skipsGate: StepManualDeclaration = { form: { fields: [] }, produces: {}, skips: ["identity-approval"] };
    assert.throws(
      () => buildStepOmissionFixture("step-omission-guard-skip-gate", "ssg", { identityCheckOmission: skipsGate }),
      /identity-check" omission skips gate node "identity-approval"; a gate or transaction always runs/u,
    );
    const skipsTransaction: StepManualDeclaration = { form: { fields: [] }, produces: {}, skips: ["submit"] };
    assert.throws(
      () => buildStepOmissionFixture("step-omission-guard-skip-txn", "sst", { writingOmission: skipsTransaction }),
      /writing" omission skips transaction node "submit"; a gate or transaction always runs/u,
    );
  });

  it("refuses a descriptor whose omission form declares a duplicate field key (negative arm for check c)", () => {
    const duplicateFieldOmission: StepManualDeclaration = {
      form: { fields: [{ key: "value", label: "V1", kind: "text" }, { key: "value", label: "V2", kind: "text" }] },
      produces: { approve: () => ({ approved: true }) },
      skips: [],
    };
    assert.throws(
      () => buildStepOmissionFixture("step-omission-guard-dup", "sod", { identityCheckOmission: duplicateFieldOmission }),
      /declared twice/u,
    );
  });

  it("yields the exact pinned cascade row for every production omittable step, and a non-throwing omittable/blocked row for the fixture", () => {
    const audited: string[] = [];
    for (const descriptor of SWEPT_DESCRIPTORS) {
      const view = graphViewOf(descriptor);
      if (view.stepOmissions.length === 0) continue;

      const rows = stepOmissionCascade(view);
      for (const spec of view.stepOmissions) {
        const key = `${String(descriptor.id)}::${spec.step}`;
        audited.push(key);
        const row = rows.get(spec.step);
        assert.ok(row !== undefined, `${key}: no cascade row for this step`);
        if (isFixture(descriptor)) {
          // The fixture's job is the arms the registry cannot reach; only the
          // union is promised of it.
          assert.ok(
            row?.state === "omittable" || row?.state === "blocked",
            `${key}: cascade row is neither omittable nor blocked`,
          );
          continue;
        }
        const expected = PRODUCTION_CASCADE_ROWS[key];
        assert.ok(expected !== undefined, `${key}: a production step declares an omission with no pinned cascade row`);
        assert.deepEqual(row, expected, `${key}: cascade row changed`);
      }
    }
    assertSweptEveryDeclaration(audited, "cascade sweep");
  });

  it("parses every RAW step-folder declaration through StepOmissionFormSchema, with exactly the pinned keys and producers", () => {
    const audited: string[] = [];
    const raw: readonly Readonly<{ key: string; declaration: StepManualDeclaration; fieldKeys: readonly string[]; produces: readonly string[] }>[] = [
      ...PRODUCTION_DECLARATIONS.map(({ descriptor, step, declaration, fieldKeys, produces }) => ({
        key: `${descriptor}::${step}`, declaration, fieldKeys, produces,
      })),
      { key: `${FIXTURE_ID}::identity-check`, declaration: VALID_OMISSION, fieldKeys: ["approvedFlag"], produces: ["approve"] },
    ];
    for (const { key, declaration, fieldKeys, produces } of raw) {
      audited.push(key);
      // The RAW declaration the step folder exports — not `spec.form`, which
      // the factory already parsed, so re-parsing it would prove nothing.
      const parsed = StepOmissionFormSchema.parse(declaration.form);
      const keys = parsed.fields.map((field) => field.key);
      assert.deepEqual(keys, fieldKeys, `${key}: declared form field keys changed`);
      assert.equal(new Set(keys).size, keys.length, `${key}: declares a duplicate form field key`);
      assert.deepEqual(Object.keys(declaration.produces), produces, `${key}: declared producers changed`);
    }
    assertSweptEveryDeclaration(audited, "raw declaration sweep");


    const carried: string[] = [];
    for (const descriptor of SWEPT_DESCRIPTORS) {
      for (const spec of descriptor.stepOmissions) {
        const key = `${String(descriptor.id)}::${spec.step}`;
        carried.push(key);
        const declared = raw.find((row) => row.key === key);
        assert.ok(declared !== undefined, `${key}: the registry carries an omission this guard does not pin`);
        assert.deepEqual(spec.form, StepOmissionFormSchema.parse(declared?.declaration.form), `${key}: the registry's form is not the folder's`);
        assert.deepEqual(Object.keys(spec.produces), declared?.produces, `${key}: the registry's producers are not the folder's`);
      }
    }
    assertSweptEveryDeclaration(carried, "registry-carried declaration sweep");
  });

  it("never asserts a gate, and omits one only where its step skips it by declaration — alone, with its cascade forces, or with every omittable step of its descriptor", () => {
    const audited: string[] = [];
    const wholeDescriptorsAudited: string[] = [];
    const gatedDescriptors: string[] = [];
    for (const descriptor of SWEPT_DESCRIPTORS) {
      const view = graphViewOf(descriptor);
      if (view.stepOmissions.length === 0) continue;
      const id = String(descriptor.id);
      const gateIds = view.nodes.filter((node) => node.kind === "gate").map((node) => node.id);
      if (gateIds.length > 0) gatedDescriptors.push(id);
      if (id === SEPARATIONS_ID) {
        assert.ok(gateIds.includes("identity-approval"), "separations must still carry the identity-approval gate");
      }
      const cascade = stepOmissionCascade(view);

      const declaredSkips = new Set(view.stepOmissions.flatMap((spec) => spec.skipsGatesAndTransactions === true ? spec.skips ?? [] : []));
      const assertGatesExecute = (plan: StepOmissionPlan, shape: string): void => {
        for (const gateId of gateIds) {
          assert.ok(!plan.asserted.has(gateId), `${id} (${shape}): asserts gate "${gateId}"`);
          assert.ok((!plan.omitted.has(gateId) && !plan.manual.has(gateId)) || declaredSkips.has(gateId), `${id} (${shape}): omits gate "${gateId}" that no step declares it skips`);
        }
      };

      for (const spec of view.stepOmissions) {
        const key = `${id}::${spec.step}`;
        audited.push(key);
        const row = cascade.get(spec.step);
        assert.ok(row !== undefined, `${key}: no cascade row`);

        const alone = planSteps(descriptor, [spec.step]);
        assertGatesExecute(alone, `step "${spec.step}" alone`);

        const withForces = planSteps(descriptor, [spec.step, ...(row?.forces ?? [])]);
        assertGatesExecute(withForces, `step "${spec.step}" + forces`);
        if (row?.state === "omittable") {
          if (row.forces.length === 0) assert.deepEqual(alone.refusals, [], `${key}: an omittable step with no forces refuses on its own`);
          assert.deepEqual(withForces.refusals, [], `${key}: an omittable step refuses with its own forced set`);
        }
        if (isFixture(descriptor)) continue;
        const expected = PRODUCTION_PLANS[key];
        assert.ok(expected !== undefined, `${key}: a production step declares an omission with no pinned plan`);
        assert.deepEqual(sorted(alone.asserted.keys()), expected?.asserted, `${key}: asserted nodes changed`);
        assert.deepEqual(sorted(alone.omitted.keys()), expected?.omitted, `${key}: omitted nodes changed`);
        assert.deepEqual(sorted(alone.manual.keys()), expected.manual ?? [], `${key}: nodes done by hand changed`);
      }

      // Every omittable step of the descriptor, omitted at once.
      const everyStep = view.stepOmissions.map(({ step }) => step);
      const whole = planSteps(descriptor, everyStep);
      wholeDescriptorsAudited.push(id);
      assertGatesExecute(whole, "every omittable step at once");
      if (isFixture(descriptor)) continue;
      assert.deepEqual(whole.refusals, [], `${id}: omitting every omittable step at once refuses`);
      const expectedWhole = PRODUCTION_WHOLE_DESCRIPTOR_PLANS[id];
      assert.ok(expectedWhole !== undefined, `${id}: a production descriptor declares omissions with no pinned whole-descriptor plan`);
      assert.deepEqual(sorted(whole.asserted.keys()), expectedWhole?.asserted, `${id}: whole-descriptor asserted nodes changed`);
      assert.deepEqual(sorted(whole.omitted.keys()), expectedWhole?.omitted, `${id}: whole-descriptor omitted nodes changed`);
      assert.deepEqual(sorted(whole.manual.keys()), expectedWhole.manual ?? [], `${id}: whole-descriptor nodes done by hand changed`);
    }
    assertSweptEveryDeclaration(audited, "planner sweep");
    assert.deepEqual(sorted(wholeDescriptorsAudited), sorted([SEPARATIONS_ID, PERSON_LOOKUP_ID, ONBOARDING_ID, WORK_STUDY_ID, I9_CHECK_START_ID, EC_MEMBER_ID, FIXTURE_ID, "crm-doc-download"]), "the whole-descriptor sweep visited the wrong descriptors");
    // Person Lookup has no gate; the ALWAYS-GATE sweep stays non-vacuous through these gated descriptors.
    assert.deepEqual(sorted(gatedDescriptors), sorted([SEPARATIONS_ID, ONBOARDING_ID, WORK_STUDY_ID, EC_MEMBER_ID, FIXTURE_ID, "crm-doc-download"]), "the gated descriptors the ALWAYS-GATE sweep covers changed");
  });
});
