import { z } from "zod";
import { UcpathReadJobSummary } from "../../../../models/systems/ucpath/read-job-summary.js";
import { SearchPersonOrg } from "../../../../models/systems/ucpath/search-person-org.js";
import {
  KualiDocumentNumberSchema
} from "../../../../models/ui/kuali-document-identity.js";
import { KualiEidFieldSchema } from "../../../../models/ui/kuali-separation-document.js";
import { defineCanonicalInput } from "../../../../models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../models/workflow/presentation.js";
import {
  MatchActiveEmploymentOutputSchema,
  SeparationsMatchActiveEmployment,
} from "../../../../models/workflows/separations/match-active-employment.js";
import { ReadSeparationPlanOutputSchema } from "../../../../models/workflows/separations/read-separation-plan.js";
import type { StepManualDeclaration } from "../../../../models/workflow/step-omission.js";
import {
  SeparationsMatchDepartmentOption,
} from "../../../../models/workflows/separations/match-department-option.js";
import { SeparationsMatchIdentity } from "../../../../models/workflows/separations/match-identity.js";
import {
  SeparationsMatchSeparationSubject,
} from "../../../../models/workflows/separations/match-separation-subject.js";
import {
  SeparationsVerifyIdentityApproval
} from "../../../../models/workflows/separations/verify-identity-approval.js";
import { EidSchema, LocalDateSchema } from "../../../../rules/identity/ids.js";
import {
  IdentityApprovalResultSchema,
  ResolvedIdentitySubjectSchema,
} from "../../../../rules/separations/identity-approval.js";
import { IdentityEidSourceSchema } from "../../../../rules/separations/identity-evidence.js";
import { JobSummaryClassificationSchema } from "../../../../rules/separations/job-summary-classification.js";
import { kualiDepartmentOptionCode, kualiDepartmentOptionDescription } from "../../../../rules/separations/department-option.js";
import { classifyNameSimilarity } from "../../../../rules/matching/name-match.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../rules/validation/sha256.js";
import { noSeparationWritePlan } from "../../../../rules/separations/write-plan.js";
import type { StepProofSpec, WorkflowAuthor, WorkflowGroupOptions } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep, requireFact } from "../../../../workflow-kit/workflow.js";
import type { SeparationsInput } from "../../workflow.js";
import type { buildTimecard } from "../kronos-timecard/step.js";
import type { buildExtraction } from "../kuali-extraction/step.js";
type Author = WorkflowAuthor<typeof SeparationsInput>;
type Extraction = ReturnType<typeof buildExtraction>;
type Subject = ReturnType<typeof resolveSubject>;
type Jobs = ReturnType<typeof readJobs>;
type Timecard = ReturnType<typeof buildTimecard>;

export const IDENTITY_CHECK_STEP = defineWorkflowStep({
  key: "identity-check",
  label: "Identity check",
});

/** Operator text and fields for this group in Explorer and Logs. */
const IDENTITY_CHECK_DISPLAY = {
  description: "Search UCPath by the Employee ID on the Kuali document, read the job summary, choose the active job and match its department to the Kuali option.",
  system: "ucpath",
  operatorFields: [
    { label: "Searched Employee ID", example: "10000001", sources: [{ nodeId: "subject", kind: "output", fieldPath: "searchedEmployeeId" }] },
    { label: "Employee ID", example: "10000001", sources: [{ nodeId: "subject", kind: "output", fieldPath: "emplId" }] },
    { label: "HR status", example: "Active", sources: [{ nodeId: "employment", kind: "output", fieldPath: "hrStatus" }] },
    { label: "Department", example: "CAMPUS DINING OPERATIONS", sources: [{ nodeId: "employment", kind: "output", fieldPath: "department" }] },
    { label: "Payroll title", example: "Fictional analyst", sources: [{ nodeId: "employment", kind: "output", fieldPath: "payrollTitle" }] },
    { label: "Kuali department option", example: "Campus Dining", sources: [{ nodeId: "department-option", kind: "output", fieldPath: "option" }] },
  ],
  review: {
    pages: [
      {
        id: "person-org-search",
        title: "Person Organizational Summary search",
        mode: "Read only",
        nodeIds: ["name-search", "subject"],
        lines: [
          { id: "search-employee-id", kind: "action", text: "Search UCPath for the employee by the Employee ID on the Kuali document.", nodeIds: ["name-search"] },
          { id: "search", kind: "click", target: "Search", nodeIds: ["name-search"] },
          { id: "select-subject", kind: "check", text: "Confirm the exact Employee ID in UCPath.", nodeIds: ["subject"] }
        ],
        fields: [
          {
            id: "searched-employee-id",
            operatorField: "Searched Employee ID",
            source: {
              origin: "Kuali document",
              detail: "Employee ID used for the UCPath search.",
              chain: [
                {
                  label: "Document Employee ID",
                  detail: "Read on the Kuali separation request.",
                  read: { stepKey: "kuali-extraction", page: "Kuali RRSS Separation Request Form", field: "Employee ID" }
                }
              ],
              read: { stepKey: "identity-check", page: "Person Organizational Summary search", field: "Searched Employee ID" }
            }
          },
          {
            id: "employee-id",
            operatorField: "Employee ID",
            source: {
              origin: "UCPath",
              detail: "Employee ID of the resolved separation subject.",
              chain: [],
              read: { stepKey: "identity-check", page: "Person Organizational Summary search", field: "Employee ID" }
            }
          }
        ]
      },
      {
        id: "job-summary",
        title: "Workforce Job Summary",
        mode: "Read only",
        nodeIds: ["job-summary", "employment", "department-option"],
        lines: [
          { id: "read-jobs", kind: "read", text: "Read the employee’s job summary and identify the active job.", nodeIds: ["job-summary", "employment"] },
          { id: "match-department", kind: "check", text: "Match its department with the option on the Kuali document.", nodeIds: ["department-option"] }
        ],
        fields: [
          {
            id: "hr-status",
            operatorField: "HR status",
            source: {
              origin: "UCPath",
              detail: "HR status for the selected active employment.",
              chain: [],
              read: { stepKey: "identity-check", page: "Workforce Job Summary", field: "HR status" }
            }
          },
          {
            id: "department",
            operatorField: "Department",
            source: {
              origin: "UCPath",
              detail: "Department for the selected active employment.",
              chain: [],
              read: { stepKey: "identity-check", page: "Workforce Job Summary", field: "Department" }
            }
          },
          {
            id: "payroll-title",
            operatorField: "Payroll title",
            source: {
              origin: "UCPath",
              detail: "Payroll title for the selected active employment.",
              chain: [],
              read: { stepKey: "identity-check", page: "Workforce Job Summary", field: "Payroll title" }
            }
          },
          {
            id: "kuali-department-option",
            operatorField: "Kuali department option",
            source: {
              origin: "Kuali and UCPath",
              detail: "Kuali option matched to the selected UCPath department.",
              chain: [
                {
                  label: "UCPath department",
                  detail: "Read from the selected active job.",
                  read: { stepKey: "identity-check", page: "Workforce Job Summary", field: "Department" }
                },
                { label: "Kuali options", detail: "Read from the separation request." }
              ],
              read: { stepKey: "identity-check", page: "Workforce Job Summary", field: "Kuali department option" }
            }
          }
        ]
      }
    ],
    branchLabels: []
  } as const,
} satisfies WorkflowGroupOptions;

export const IDENTITY_REVIEW_STEP = defineWorkflowStep({
  key: "identity-review",
  label: "Identity approval",
});

/** Operator text and fields for this group in Explorer and Logs. */
const IDENTITY_REVIEW_DISPLAY = {
  description: "Compare the document with UCPath and wait for your approval when they do not agree.",
  system: "local",
  operatorFields: [
    { label: "UCPath name", example: "Quillan, Petra A.", sources: [{ nodeId: "comparison", kind: "output", fieldPath: "packet.ucpathName" }] },
    { label: "Document name", example: "Quillan, Petra A.", sources: [{ nodeId: "comparison", kind: "output", fieldPath: "packet.documentName" }] },
  ],
  review: {
    pages: [
      {
        id: "identity-review",
        title: "Identity comparison",
        mode: "Read only",
        nodeIds: ["comparison", "identity-approval", "approval"],
        lines: [
          { id: "compare-identities", kind: "check", text: "Compare document and UCPath identity evidence.", nodeIds: ["comparison"] },
          { id: "request-approval", kind: "action", text: "Request operator approval when the names or identifiers require it.", nodeIds: ["identity-approval"], when: [{ "identity-result": ["true"] }] },
          { id: "verify-approval", kind: "check", text: "Verify the approval against the comparison evidence.", nodeIds: ["approval"] }
        ],
        fields: [
          {
            id: "ucpath-name",
            operatorField: "UCPath name",
            source: {
              origin: "UCPath",
              detail: "Name in the selected UCPath record.",
              chain: [{ label: "UCPath result", detail: "Read the name of the UCPath person selected for comparison." }],
              read: { stepKey: "identity-review", page: "Identity comparison", field: "UCPath name" }
            }
          },
          {
            id: "document-name",
            operatorField: "Document name",
            source: {
              origin: "Kuali",
              detail: "Name read from the Kuali separation request.",
              chain: [],
              read: { stepKey: "kuali-extraction", page: "Kuali RRSS Separation Request Form", field: "Employee" }
            }
          }
        ]
      }
    ],
    branchLabels: [],
    decisions: [{
      id: "identity-result", label: "Identity result", reads: { nodeId: "comparison", fieldPath: "approvalRequired" },
      nodeIds: ["comparison", "identity-approval", "approval"], initial: "false",
      outcomes: [
        { value: "false", label: "Identity agrees", then: "Continues with the verified identity." },
        { value: "true", label: "Identity needs approval", then: "Waits for you to approve or correct the identity in Logs before anything is filed.", stops: true },
      ],
    }],
  } as const,
} satisfies WorkflowGroupOptions;

export const NAME_SEARCH_NODE = "name-search";
export const SUBJECT_NODE = "subject";
export const COMPARISON_NODE = "comparison";
export const GATE_NODE = "identity-approval";
export const APPROVAL_NODE = "approval";

const identityCheckEntries = defineStepEntries(IDENTITY_CHECK_STEP);
const identityReviewEntries = defineStepEntries(IDENTITY_REVIEW_STEP);

const employeeIdSearch = { label: "Employee ID Search", replay: "checkpoint" } as const;
const employeeIdSearchNode = identityCheckEntries.task(NAME_SEARCH_NODE, SearchPersonOrg, employeeIdSearch);
const documentEmployeeIdSearchNode = identityCheckEntries.task(NAME_SEARCH_NODE, SearchPersonOrg, {
  ...employeeIdSearch,
  when: { kind: "equals", of: { from: "node", nodeId: "document", path: "employee.eid.state" }, value: "present" },
});

const subjectNode = identityCheckEntries.task(SUBJECT_NODE, SeparationsMatchSeparationSubject, {
  label: "Separation Subject",
  replay: "checkpoint",
});

export const comparisonNode = identityReviewEntries.task(COMPARISON_NODE, SeparationsMatchIdentity, {
  label: "Identity Comparison",
  replay: "checkpoint",
});

export const identityApprovalGate = identityReviewEntries.operatorGate(GATE_NODE, {
  label: "Identity Approval",
  statusKey: "awaitingIdentityApproval",
  result: IdentityApprovalResultSchema,
  when: { kind: "is-true", of: { from: "node", nodeId: COMPARISON_NODE, path: "approvalRequired" } },
});

export const approvalNode = identityReviewEntries.task(APPROVAL_NODE, SeparationsVerifyIdentityApproval, {
  label: "Approval Check",
  replay: "always-rerun",
});


export const JOB_SUMMARY_NODE = "job-summary";
export const EMPLOYMENT_NODE = "employment";
export const DEPARTMENT_NODE = "department-option";

export const jobSummaryNode = identityCheckEntries.task(JOB_SUMMARY_NODE, UcpathReadJobSummary, {
  label: "Job Summary",
  replay: "checkpoint",
});

const employmentNode = identityCheckEntries.task(EMPLOYMENT_NODE, SeparationsMatchActiveEmployment, {
  label: "Employment",
  replay: "checkpoint",
});

const departmentOptionNode = identityCheckEntries.task(DEPARTMENT_NODE, SeparationsMatchDepartmentOption, {
  label: "Department Option",
  replay: "checkpoint",
});


const IdentityCheckFactsSchema = z.strictObject({
  emplId: EidSchema,
  emplRecord: z.string().min(1),
  department: z.string().min(1),
  payrollTitleCode: z.string().min(1),
  payrollTitle: z.string().min(1),
});

/** Every separation Relay files is on the SDCMP business unit; the Person Org search keeps only those rows. */
const SEPARATION_BUSINESS_UNIT = "SDCMP";

const typedDepartment = (facts: z.infer<typeof IdentityCheckFactsSchema>) => ({
  code: kualiDepartmentOptionCode(facts.department),
  description: kualiDepartmentOptionDescription(facts.department),
});

/** Off: UCPath is not searched; the typed values stand for the subject, the active job and the Kuali department option. */
export const IDENTITY_CHECK_OMISSION: StepManualDeclaration = {
  form: {
    fields: [
      { key: "emplId", label: "Employee ID", kind: "eid" },
      { key: "emplRecord", label: "Empl record", kind: "text", help: "The active job's record number, e.g. 0." },
      { key: "department", label: "Department", kind: "text", help: "The Kuali option: code - name." },
      { key: "payrollTitleCode", label: "Title code", kind: "text" },
      { key: "payrollTitle", label: "Title", kind: "text" },
    ],
  },
  produces: {
    [SUBJECT_NODE]: ({ facts }) => {
      const typed = IdentityCheckFactsSchema.parse(facts);
      return { emplId: typed.emplId, emplIdSource: "operator-entered", searchedEmployeeId: typed.emplId, candidateCount: 1 };
    },
    [EMPLOYMENT_NODE]: ({ facts }) => {
      const typed = IdentityCheckFactsSchema.parse(facts);
      const department = typedDepartment(typed);
      return {
        rowIndex: 0, emplRecord: typed.emplRecord, hrStatus: "Active", businessUnit: SEPARATION_BUSINESS_UNIT,
        deptId: { state: "present", value: department.code }, department: { state: "present", value: department.description },
        payrollTitleCode: typed.payrollTitleCode, payrollTitle: typed.payrollTitle,
        effectiveDate: { state: "absent", reason: "typed by the operator" }, rowCount: 1,
      };
    },
    [DEPARTMENT_NODE]: ({ facts }) => {
      const typed = IdentityCheckFactsSchema.parse(facts);
      const department = typedDepartment(typed);
      return {
        option: typed.department, departmentCode: department.code, optionDescription: department.description,
        ucpathDepartment: department.description, observedOptionCount: 1,
      };
    },
  },
  skips: [NAME_SEARCH_NODE, JOB_SUMMARY_NODE],
  refine: (facts) => {
    const option = typeof facts["department"] === "string" ? facts["department"] : "";
    return kualiDepartmentOptionCode(option) === "" || kualiDepartmentOptionDescription(option) === "" ? [{ field: "department", message: "Enter code - name." }] : [];
  },
};

const IdentityReviewFactsSchema = z.strictObject({ emplId: EidSchema, ucpathName: z.string().min(1) });

/** Off: no comparison and no approval prompt; typing the bound Employee ID is the operator's approval. */
export const IDENTITY_REVIEW_OMISSION: StepManualDeclaration = {
  form: {
    fields: [
      { key: "emplId", label: "Employee ID", kind: "eid" },
      { key: "ucpathName", label: "Name in UCPath", kind: "text", help: "Last, First, as UCPath shows it." },
    ],
  },
  produces: {
    [APPROVAL_NODE]: ({ facts, scope }) => {
      const typed = IdentityReviewFactsSchema.parse(facts);
      const plan = ReadSeparationPlanOutputSchema.parse(scope.outputs["plan"]);
      const employment = MatchActiveEmploymentOutputSchema.parse(scope.outputs[EMPLOYMENT_NODE]);
      const { emplId } = SeparationsMatchSeparationSubject.output.parse(scope.outputs[SUBJECT_NODE]);
      if (typed.emplId !== emplId) throw new Error("the typed Employee ID is not the run's Employee ID; nothing was written");
      const cell = (value: typeof employment.department) => value.state === "present" ? value.value : `(unreadable: ${value.reason})`;
      return {
        documentNumber: plan.documentNumber,
        approved: {
          authority: "operator-approval", emplId: typed.emplId, chosenFrom: "manual",
          evidenceDigest: sha256Hex(canonicalJsonStringify(typed)), ucpathName: typed.ucpathName,
          nameTier: classifyNameSimilarity(plan.employeeName, typed.ucpathName), approvalShape: "type-the-eid",
        },
        jobs: {
          disposition: "single-active-job", rowCount: 1, activeRowCount: 1, inactiveRowCount: 0, unknownRowCount: 0,
          rows: [{
            rowIndex: employment.rowIndex, emplRecord: employment.emplRecord, hrStatus: employment.hrStatus, tier: "active",
            department: cell(employment.department), jobTitle: employment.payrollTitle, effectiveDate: cell(employment.effectiveDate),
          }],
          unreadableCells: [],
        },
      };
    },
  },
  skips: [COMPARISON_NODE, GATE_NODE],
  skipsGatesAndTransactions: true,
};


const IdentityCheckInputShape = {
  documentNumber: KualiDocumentNumberSchema,
  employeeName: z.string().min(1),
  emplId: EidSchema,
  emplIdSource: IdentityEidSourceSchema,
  documentEid: KualiEidFieldSchema,
} as const;
function refineIdentityInput(
  input: Readonly<{
    emplId: string;
    emplIdSource: z.infer<typeof IdentityEidSourceSchema>;
    documentEid: z.infer<typeof KualiEidFieldSchema>;
  }>,
  context: z.RefinementCtx,
): void {
  const documentValue =
    input.documentEid.state === "present" ? input.documentEid.value : undefined;
  if (input.emplIdSource === "document-eid" && documentValue !== input.emplId) {
    context.addIssue({
      code: "custom",
      path: ["emplIdSource"],
      message:
        "a document-eid source requires the document's own EID field to hold exactly this EID",
    });
  }
  if (input.emplIdSource !== "document-eid" && input.emplIdSource !== "operator-entered" && documentValue !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["emplIdSource"],
      message: `${input.emplIdSource} requires the document to supply no EID`,
    });
  }
}
const SeparationsIdentityCheckInput = z
  .strictObject(IdentityCheckInputShape)
  .superRefine(refineIdentityInput);
export const SeparationsIdentityCheckCanonicalInput = defineCanonicalInput(
  SeparationsIdentityCheckInput,
  z.strictObject(IdentityCheckInputShape).superRefine(refineIdentityInput),
  [
    {
      documentNumber: "4510",
      employeeName: "Battistessa, Johnnie",
      emplId: "10873698",
      emplIdSource: "document-eid",
      documentEid: { state: "present", value: "10873698" },
    },
    {
      documentNumber: "4511",
      employeeName: "Canonical Harness Person",
      emplId: "10873698",
      emplIdSource: "canonical-eid",
      documentEid: {
        state: "absent",
        reason: "the harness supplies the EID directly",
      },
    },
    {
      documentNumber: "4502",
      employeeName: "Hernandez, Jose Santos",
      emplId: "10401814",
      emplIdSource: "name-resolved",
      documentEid: {
        state: "absent",
        reason: "the separation document's EID field was blank",
      },
    },
  ],
);
const SeparationsIdentityCheckResultSchema = z.strictObject({
  documentNumber: z.string().min(1),
  approved: ResolvedIdentitySubjectSchema,
  jobs: JobSummaryClassificationSchema,
});

export function resolveSubject({ task }: Author, extraction: Extraction) {
  const { document } = extraction;
  const eidSearch = task(documentEmployeeIdSearchNode, [document], ({ outputs }) => {
    const eid = outputs["document"].employee.eid;
    if (eid.state !== "present") throw new Error("Person Org search is missing the document Employee ID");
    return { kind: "by-eid" as const, emplId: eid.value };
  });
  const subject = task(subjectNode, [document, eidSearch], ({ input, outputs }) => ({
    documentNumber: input.documentNumber,
    ...(input.operatorEmployeeId === undefined ? {} : { operatorEmployeeId: input.operatorEmployeeId }),
    documentEid: outputs["document"].employee.eid,
    searchSelection: outputs[NAME_SEARCH_NODE]?.selection,
  }));
  return { eidSearch, subject };
}
export function readJobs({ task, group }: Author, extraction: Extraction, resolved: Subject) {
  const { document } = extraction, { eidSearch, subject } = resolved;
  const jobSummary = task(jobSummaryNode, [document, subject], ({ outputs }) => {
    const separationDate = outputs["document"].separation.separationDate;
    return {
      emplId: outputs[SUBJECT_NODE].emplId,
      ...(separationDate.state === "present" ? { asOf: LocalDateSchema.parse(separationDate.value) } : {}),
    };
  });
  const employment = task(employmentNode, [document, jobSummary], ({ input, outputs }) => ({
    documentNumber: input.documentNumber,
    jobSummary: outputs[JOB_SUMMARY_NODE],
    request: {
      studentTitleCode: outputs["document"].employee.studentTitleCode,
      additionalComments: outputs["document"].separation.additionalComments,
    },
  }));
  const departmentOption = task(
    departmentOptionNode,
    [document, employment],
    ({ input, outputs }) => ({
      deptId: outputs[EMPLOYMENT_NODE].deptId,
      department: outputs[EMPLOYMENT_NODE].department,
      observedOptions: outputs["document"].options.department,
      documentNumber: input.documentNumber,
    }),
  );
  return {
    jobSummary, employment, departmentOption,
    steps: [[group(IDENTITY_CHECK_STEP, { ...IDENTITY_CHECK_DISPLAY, manual: IDENTITY_CHECK_OMISSION }), [eidSearch, subject, jobSummary, employment, departmentOption]]] as const,
  };
}
export function buildIdentity({ task, gate, group }: Author, extraction: Extraction, resolved: Subject, jobs: Jobs, timecard: Timecard) {
  const { document, plan, terminationType } = extraction, { eidSearch, subject } = resolved;
  const { jobSummary, employment, departmentOption } = jobs, { dates } = timecard;
  const comparison = task(
    comparisonNode,
    [document, plan, subject, jobSummary, eidSearch, terminationType, departmentOption, employment, dates],
    ({ input, outputs, protectedInputBindings }) => {
      const timekeeperBinding = protectedInputBindings?.find(({ name }) => name === "timekeeperName");
      if (timekeeperBinding === undefined) throw new Error("protected input timekeeperName binding is absent");
      return {
        ...(protectedInputBindings === undefined ? {} : { protectedBindings: [...protectedInputBindings] }),
        documentNumber: input.documentNumber,
        documentName: outputs["plan"].employeeName,
        documentEid: outputs["document"].employee.eid,
        emplId: outputs[SUBJECT_NODE].emplId,
        emplIdSource: outputs[SUBJECT_NODE].emplIdSource,
        jobSummary: outputs[JOB_SUMMARY_NODE],
        nameSelection: requireFact(outputs[NAME_SEARCH_NODE]?.selection, NAME_SEARCH_NODE, "selection"),
        searchedEmployeeId: outputs[SUBJECT_NODE].searchedEmployeeId,
        plan: {
          state: "planned" as const,
          termination: {
            terminationType: outputs["termination-type"].terminationType,
            classification: outputs["termination-type"].classification,
            template: outputs["termination-type"].template,
            reasonCode: outputs["termination-type"].reasonCode,
            emplRecord: outputs[EMPLOYMENT_NODE].emplRecord,
            effectiveDate: outputs["dates"].terminationEffectiveDate,
            lastDateWorked: outputs["dates"].lastDayWorked,
            initiatorComments: outputs["dates"].terminationComments,
          },
          document: {
            documentNumber: input.documentNumber,
            department: outputs[DEPARTMENT_NODE].option,
            departmentCode: outputs[DEPARTMENT_NODE].departmentCode,
            ucpathDepartment: outputs[DEPARTMENT_NODE].ucpathDepartment,
            payrollTitleCode: outputs[EMPLOYMENT_NODE].payrollTitleCode,
            payrollTitle: outputs[EMPLOYMENT_NODE].payrollTitle,
            terminationEffectiveDate: outputs["dates"].terminationEffectiveDate,
            timekeeperName: timekeeperBinding,
          },
          dates: {
            kualiLastDayWorked: outputs["dates"].kualiLastDayWorked,
            lastDayWorked: outputs["dates"].lastDayWorked,
            lastDayWorkedChanged: outputs["dates"].lastDayWorkedChanged,
            kualiSeparationDate: outputs["dates"].kualiSeparationDate,
            separationDate: outputs["dates"].separationDate,
            separationDateChanged: outputs["dates"].separationDateChanged,
            separationDeterminingLeave: outputs["dates"].separationDeterminingLeave,
            unclassifiedPayCodes: outputs["dates"].unclassifiedPayCodes,
            source: outputs["dates"].source,
          },
        },
      };
    },
  );
  const identityGate = gate(identityApprovalGate, [comparison]);
  // The subject is read only by the manual approval, which must type its Employee ID.
  const approval = task(approvalNode, [comparison, identityGate, plan, employment, subject], ({ outputs }) => ({
    packet: outputs[COMPARISON_NODE].packet,
    evidenceDigest: outputs[COMPARISON_NODE].evidenceDigest,
    approval: outputs[GATE_NODE],
  }));
  return {
    approval, steps: [[group(IDENTITY_REVIEW_STEP, { ...IDENTITY_REVIEW_DISPLAY, manual: IDENTITY_REVIEW_OMISSION }), [comparison, identityGate, approval]]] as const
  };
}

export const separationsIdentityCheckDefinition = defineStep({
  group: IDENTITY_CHECK_STEP, build: buildIdentity,
  resolveSubject, readJobs,
  proof: {
    id: "separations-identity-check", order: 2, build: (): StepProofSpec<typeof SeparationsIdentityCheckInput, typeof SeparationsIdentityCheckResultSchema> => ({
      version: 1,
      code: "si",
      label: "Identity Check",
      summary: "Chunk 3 of the separations migration: the UCPath identity passage, read-only, carrying ref write-safety " +
        "§14's typed authority. A supplied EID verified by UCPath read-back proceeds with machine authority; " +
        "a name-resolved EID parks for the operator gate.",
      icon: "ShieldCheck",
      category: "separation",
      canonicalInput: SeparationsIdentityCheckCanonicalInput,
      inputSubject: "eid",
      surface: { shape: "single" },
      enqueue: "reject-active",
      actions: STANDARD_WORKFLOW_ACTIONS,
      surfaces: {},
      verdicts: [
        {
          key: "no-active-job",
          label: "No active job in UCPath",
          tone: "warning",
          tag: true,
        },
        {
          key: "concurrent-jobs",
          label: "Concurrent active jobs",
          tone: "warning",
          tag: true,
        },
        {
          key: "name-differs",
          label: "Name differs from UCPath",
          tone: "warning",
          tag: true,
        },
      ],
      details: [
        {
          key: "ucpath-name",
          label: "UCPath shows",
          source: { nodeId: "job-summary", fieldPath: "displayedName" },
          display: "text",
        },
        {
          key: "employment",
          label: "Employment",
          source: { nodeId: "comparison", fieldPath: "packet.jobs.disposition" },
          display: "text",
        },
        {
          key: "name-tier",
          label: "Name match",
          source: { nodeId: "comparison", fieldPath: "packet.nameTier" },
          display: "text",
        },
        {
          key: "approval-shape",
          label: "Approval required",
          source: { nodeId: "comparison", fieldPath: "packet.approvalShape" },
          display: "text",
        },
      ],
      subjectProjection: { nodeId: "job-summary", fieldPath: "displayedName" },
      identity: {
        matchKey: (input) =>
          `separations-identity:${input.documentNumber}:${input.emplId}`,
      },
      presentation: {
        title: (input) => `${input.employeeName} (${input.emplId})`,
        subtitle: (input) => `Separation document ${input.documentNumber}`,
      },
      nodePurposes: [
        {
          nodeId: "job-summary",
          purpose:
            "Reads the subject's whole UCPath job summary grid verbatim — every row, every status — and " +
            "classifies nothing; the disposition is a separate, pure fold.",
        },
        {
          nodeId: "name-search",
          purpose: "Searches UCPath Person Organizational Summary by the Employee ID bound to this identity check.",
        },
        {
          nodeId: "comparison",
          purpose:
            "Builds the identity evidence packet — DISCONFIRMING evidence first — and the digest that " +
            "machine verification or an operator decision binds to. Pure: it reaches no browser.",
        },
        {
          nodeId: "identity-approval",
          purpose:
            "Requires the typed operator resolve-gate command when the packet's EID came from a name search; " +
            "a supplied-EID packet makes this declared condition false and records no human decision.",
        },
        {
          nodeId: "approval",
          purpose:
            "Re-derives the evidence and produces explicit machine-verification or operator-approval " +
            "authority. It re-runs on every attempt, so moved evidence or identity origin cannot reuse an old answer.",
        },
      ],
      scenarios: [
        "separations-identity-check/single-active-job",
        "separations-identity-check/similar-name-never-auto-proceeds",
        "separations-identity-check/different-name-two-candidates",
        "separations-identity-check/already-terminated-single-row",
        "separations-identity-check/already-terminated-multi-row",
        "separations-identity-check/concurrent-active-jobs",
        "separations-identity-check/unreadable-department",
        "separations-identity-check/job-summary-not-found",
        "separations-identity-check/gate-approved",
        "separations-identity-check/gate-rejected",
        "separations-identity-check/gate-evidence-moved",
      ],
      input: SeparationsIdentityCheckInput,
      steps: (author: WorkflowAuthor<typeof SeparationsIdentityCheckInput>) => {
        const { task, gate, result } = author;
        const jobSummary = task(jobSummaryNode, [], ({ input }) => ({
          emplId: input.emplId,
        }));
        const eidSearch = task(employeeIdSearchNode, [], ({ input }) => ({
          kind: "by-eid" as const,
          emplId: input.emplId,
        }));
        const comparison = task(
          comparisonNode,
          [jobSummary, eidSearch],
          ({ input, outputs }) => ({
            documentNumber: input.documentNumber,
            documentName: input.employeeName,
            documentEid: input.documentEid,
            emplId: input.emplId,
            emplIdSource: input.emplIdSource,
            jobSummary: outputs[JOB_SUMMARY_NODE],
            nameSelection: outputs[NAME_SEARCH_NODE].selection,
            searchedEmployeeId: input.emplId,
            plan: noSeparationWritePlan(
              "this chunk resolves an identity and files nothing; the composed `separations` graph is where a write plan exists to show",
            ),
          }),
        );
        const identityGate = gate(identityApprovalGate, [comparison]);
        const approval = task(
          approvalNode,
          [comparison, identityGate],
          ({ outputs }) => ({
            packet: outputs[COMPARISON_NODE].packet,
            evidenceDigest: outputs[COMPARISON_NODE].evidenceDigest,
            approval: outputs[GATE_NODE],
          }),
        );
        return {
          steps: [
            [IDENTITY_CHECK_STEP, [eidSearch, jobSummary]],
            [IDENTITY_REVIEW_STEP, [comparison, identityGate, approval]],
          ],
          result: result(
            SeparationsIdentityCheckResultSchema,
            [approval],
            ({ outputs }) => outputs[APPROVAL_NODE],
          ),
        };
      },
    }),
  },
});
