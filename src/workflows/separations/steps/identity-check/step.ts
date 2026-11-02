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
  SeparationsMatchActiveEmployment,
} from "../../../../models/workflows/separations/match-active-employment.js";
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
import { EidSchema } from "../../../../rules/identity/ids.js";
import {
  IdentityApprovalResultSchema,
  ResolvedIdentitySubjectSchema,
} from "../../../../rules/separations/identity-approval.js";
import { IdentityEidSourceSchema } from "../../../../rules/separations/identity-evidence.js";
import { JobSummaryClassificationSchema } from "../../../../rules/separations/job-summary-classification.js";
import { noSeparationWritePlan } from "../../../../rules/separations/write-plan.js";
import type { StepProofSpec, WorkflowAuthor } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import type { SeparationsInput } from "../../workflow.js";
import type { buildTimecard } from "../kronos-timecard/step.js";
import type { buildExtraction } from "../kuali-extraction/step.js";
type Author = WorkflowAuthor<typeof SeparationsInput>;
type Extraction = ReturnType<typeof buildExtraction>;
type Subject = ReturnType<typeof resolveSubject>;
type Jobs = ReturnType<typeof readJobs>;
type Timecard = ReturnType<typeof buildTimecard>;
type Identity = ReturnType<typeof buildIdentity>;

export const IDENTITY_CHECK_STEP = defineWorkflowStep({
  key: "identity-check",
  label: "Identity check",
});

export const NAME_SEARCH_NODE = "name-search";
export const SUBJECT_NODE = "subject";
export const COMPARISON_NODE = "comparison";
export const GATE_NODE = "identity-approval";
export const APPROVAL_NODE = "approval";

const identityCheckEntries = defineStepEntries(IDENTITY_CHECK_STEP);

export const nameSearchNode = identityCheckEntries.task(NAME_SEARCH_NODE, SearchPersonOrg, {
  label: "Name Search",
  replay: "checkpoint",
});

const subjectNode = identityCheckEntries.task(SUBJECT_NODE, SeparationsMatchSeparationSubject, {
  label: "Separation Subject",
  replay: "checkpoint",
});

export const comparisonNode = identityCheckEntries.task(COMPARISON_NODE, SeparationsMatchIdentity, {
  label: "Identity Comparison",
  replay: "checkpoint",
});

export const identityApprovalGate = identityCheckEntries.operatorGate(GATE_NODE, {
  label: "Identity Approval",
  statusKey: "awaitingIdentityApproval",
  result: IdentityApprovalResultSchema,
  when: { kind: "is-true", of: { from: "node", nodeId: COMPARISON_NODE, path: "approvalRequired" } },
});

export const approvalNode = identityCheckEntries.task(APPROVAL_NODE, SeparationsVerifyIdentityApproval, {
  label: "Approval Check",
  replay: "always-rerun",
});


export const JOB_SUMMARY_STEP = defineWorkflowStep({
  key: "job-summary",
  label: "Job summary",
});

export const JOB_SUMMARY_NODE = "job-summary";
export const EMPLOYMENT_NODE = "employment";
export const DEPARTMENT_NODE = "department-option";

const jobSummaryEntries = defineStepEntries(JOB_SUMMARY_STEP);

export const jobSummaryNode = jobSummaryEntries.task(JOB_SUMMARY_NODE, UcpathReadJobSummary, {
  label: "Job Summary",
  replay: "checkpoint",
});

const employmentNode = jobSummaryEntries.task(EMPLOYMENT_NODE, SeparationsMatchActiveEmployment, {
  label: "Employment",
  replay: "checkpoint",
});

const departmentOptionNode = jobSummaryEntries.task(DEPARTMENT_NODE, SeparationsMatchDepartmentOption, {
  label: "Department Option",
  replay: "checkpoint",
});



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
  const { document, plan } = extraction;
  const nameSearch = task(nameSearchNode, [plan], ({ outputs }) => ({
    kind: "by-name" as const,
    name: outputs["plan"].employeeName,
    keepNonHdh: true,
  }));
  const subject = task(subjectNode, [document, plan, nameSearch], ({ input, outputs }) => ({
    documentNumber: input.documentNumber,
    employeeName: outputs["plan"].employeeName,
    ...(input.operatorEmployeeId === undefined ? {} : { operatorEmployeeId: input.operatorEmployeeId }),
    documentEid: outputs["document"].employee.eid,
    nameSelection: outputs[NAME_SEARCH_NODE].selection,
  }));
  return { nameSearch, subject };
}
export function readJobs({ task }: Author, extraction: Extraction, resolved: Subject) {
  const { document } = extraction, { subject } = resolved;
  const jobSummary = task(jobSummaryNode, [subject], ({ outputs }) => ({
    emplId: outputs[SUBJECT_NODE].emplId,
  }));
  const employment = task(employmentNode, [document, jobSummary], ({ input, outputs }) => ({
    documentNumber: input.documentNumber,
    jobSummary: outputs[JOB_SUMMARY_NODE],
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
  return { jobSummary, employment, departmentOption };
}
export function buildIdentity({ task, gate }: Author, extraction: Extraction, resolved: Subject, jobs: Jobs, timecard: Timecard) {
  const { document, plan, terminationType } = extraction, { nameSearch, subject } = resolved;
  const { jobSummary, employment, departmentOption } = jobs, { dates } = timecard;
  const comparison = task(
    comparisonNode,
    [document, plan, subject, jobSummary, nameSearch, terminationType, departmentOption, employment, dates],
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
        nameSelection: outputs[NAME_SEARCH_NODE].selection,
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
  const approval = task(approvalNode, [comparison, identityGate], ({ outputs }) => ({
    packet: outputs[COMPARISON_NODE].packet,
    evidenceDigest: outputs[COMPARISON_NODE].evidenceDigest,
    approval: outputs[GATE_NODE],
  }));
  return {
    approval, steps: [[IDENTITY_CHECK_STEP, [nameSearch, subject, comparison, identityGate, approval]],
    [JOB_SUMMARY_STEP, [jobSummary, employment, departmentOption]]] as const
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
          purpose:
            "Searches UCPath Person Org by the document's employee name, unconditionally, so the operator " +
            "sees every person that name matches rather than only the ones a similarity threshold selected.",
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
        const nameSearch = task(nameSearchNode, [], ({ input }) => ({
          kind: "by-name" as const,
          name: input.employeeName,
          keepNonHdh: true,
        }));
        const comparison = task(
          comparisonNode,
          [jobSummary, nameSearch],
          ({ input, outputs }) => ({
            documentNumber: input.documentNumber,
            documentName: input.employeeName,
            documentEid: input.documentEid,
            emplId: input.emplId,
            emplIdSource: input.emplIdSource,
            jobSummary: outputs[JOB_SUMMARY_NODE],
            nameSelection: outputs[NAME_SEARCH_NODE].selection,
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
            [JOB_SUMMARY_STEP, [jobSummary]],
            [IDENTITY_CHECK_STEP, [nameSearch, comparison, identityGate, approval]],
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
