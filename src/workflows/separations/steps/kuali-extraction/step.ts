import { z } from "zod";
import { KualiReadSeparationDocument } from "../../../../models/systems/kuali/read-separation-document.js";
import { KualiSearchSeparationAction } from "../../../../models/systems/kuali/search-separation-action.js";
import {
  KualiActionIdSchema,
  KualiDocumentNumberSchema
} from "../../../../models/ui/kuali-document-identity.js";
import { KualiSeparationDocumentSchema } from "../../../../models/ui/kuali-separation-document.js";
import { defineCanonicalInput } from "../../../../models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../models/workflow/presentation.js";
import {
  MatchTerminationTypeOutputSchema,
  SeparationsMatchTerminationType,
} from "../../../../models/workflows/separations/match-termination-type.js";
import {
  SeparationsReadSeparationPlan
} from "../../../../models/workflows/separations/read-separation-plan.js";
import type { StepProofSpec, WorkflowAuthor, WorkflowGroupOptions } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep, requireFact } from "../../../../workflow-kit/workflow.js";
import type { SeparationsInput } from "../../workflow.js";
type Author = WorkflowAuthor<typeof SeparationsInput>;

export const KUALI_EXTRACTION_STEP = defineWorkflowStep({
  key: "kuali-extraction",
  label: "Kuali extraction",
});

/** Operator text and fields for this group in Explorer and Logs. */
const KUALI_EXTRACTION_DISPLAY = {
  description: "Find the Kuali separation action, read the separation document and work out the separation plan and termination type.",
  system: "kuali",
  operatorFields: [
    { label: "Document number", example: "3000001", sources: [{ nodeId: "resolve-action", kind: "output", fieldPath: "documentNumber" }] },
    { label: "Employee", example: "Quillan, Petra A.", sources: [{ nodeId: "document", kind: "output", fieldPath: "employee.name" }] },
    { label: "Employee ID", example: "10000001", sources: [{ nodeId: "document", kind: "output", fieldPath: "employee.eid" }] },
    { label: "Last day worked", example: "4/25/2031", sources: [{ nodeId: "plan", kind: "output", fieldPath: "kualiLastDayWorked" }] },
    { label: "Separation date", example: "4/26/2031", sources: [{ nodeId: "plan", kind: "output", fieldPath: "kualiSeparationDate" }] },
    { label: "Termination type", example: "Resignation", sources: [{ nodeId: "termination-type", kind: "output", fieldPath: "terminationType" }] },
  ],
  review: {
    pages: [
      {
        id: "action-list",
        title: "Kuali Build Action List",
        mode: "Read only",
        nodeIds: ["resolve-action"],
        lines: [{ id: "find-action", kind: "action", text: "Find the exact separation action by document number.", nodeIds: ["resolve-action"] }],
        fields: [
          {
            id: "document-number",
            operatorField: "Document number",
            source: {
              origin: "Kuali",
              detail: "Exact number of the selected separation action.",
              chain: [],
              read: { stepKey: "kuali-extraction", page: "Kuali Build Action List", field: "Document number" }
            }
          }
        ]
      },
      {
        id: "separation-document",
        title: "Kuali RRSS Separation Request Form",
        mode: "Read only",
        nodeIds: ["document", "plan", "termination-type"],
        lines: [
          { id: "open-document", kind: "action", text: "Open and verify the separation request document.", nodeIds: ["document"] },
          { id: "read-form", kind: "read", text: "Read the employee, dates and type of termination.", nodeIds: ["document"] },
          {
            id: "derive-plan",
            kind: "check",
            text: "Validate the dates and resolve the termination type against the visible options.",
            nodeIds: ["plan", "termination-type"]
          }
        ],
        fields: [
          {
            id: "employee",
            operatorField: "Employee",
            source: {
              origin: "Kuali",
              detail: "Employee name on the separation document.",
              chain: [],
              read: { stepKey: "kuali-extraction", page: "Kuali RRSS Separation Request Form", field: "Employee" }
            }
          },
          {
            id: "employee-id",
            operatorField: "Employee ID",
            source: {
              origin: "Kuali",
              detail: "Employee ID on the separation document, when present.",
              chain: [],
              read: { stepKey: "kuali-extraction", page: "Kuali RRSS Separation Request Form", field: "Employee ID" }
            }
          },
          {
            id: "last-day-worked",
            operatorField: "Last day worked",
            source: {
              origin: "Kuali",
              detail: "Last day worked read from the document and validated in the plan.",
              chain: [],
              read: { stepKey: "kuali-extraction", page: "Kuali RRSS Separation Request Form", field: "Last day worked" }
            }
          },
          {
            id: "separation-date",
            operatorField: "Separation date",
            source: {
              origin: "Kuali",
              detail: "Separation date read from the document and validated in the plan.",
              chain: [],
              read: { stepKey: "kuali-extraction", page: "Kuali RRSS Separation Request Form", field: "Separation date" }
            }
          },
          {
            id: "termination-type",
            operatorField: "Termination type",
            source: {
              origin: "Kuali",
              detail: "Selected type of termination matched to its form option.",
              chain: [],
              read: { stepKey: "kuali-extraction", page: "Kuali RRSS Separation Request Form", field: "Termination type" }
            }
          }
        ]
      }
    ],
    branchLabels: []
  } as const,
} satisfies WorkflowGroupOptions;

export const ACTION_NODE = "resolve-action";
export const DOCUMENT_NODE = "document";
export const PLAN_NODE = "plan";
export const TERMINATION_TYPE_NODE = "termination-type";

const kualiExtractionEntries = defineStepEntries(KUALI_EXTRACTION_STEP);

export const actionNode = kualiExtractionEntries.task(ACTION_NODE, KualiSearchSeparationAction, {
  label: "Kuali Action",
  replay: "checkpoint",
});

export const documentNode = kualiExtractionEntries.task(DOCUMENT_NODE, KualiReadSeparationDocument, {
  label: "Separation Document",
  replay: "checkpoint",
});

const planNode = kualiExtractionEntries.task(PLAN_NODE, SeparationsReadSeparationPlan, {
  label: "Separation Plan",
  replay: "checkpoint",
});

export const terminationTypeNode = kualiExtractionEntries.task(TERMINATION_TYPE_NODE, SeparationsMatchTerminationType, {
  label: "Termination Type",
  replay: "checkpoint",
});



const SeparationsKualiReadInput = z.strictObject({
  actionId: KualiActionIdSchema,
  documentNumber: KualiDocumentNumberSchema,
});
const SeparationsKualiReadCanonicalInput = defineCanonicalInput(
  SeparationsKualiReadInput,
  z.strictObject({
    actionId: KualiActionIdSchema,
    documentNumber: KualiDocumentNumberSchema,
  }),
  [
    { actionId: "6a7a33b2ac106d428b3217e0", documentNumber: "4510" },
    { actionId: "6a766ae6f0549046f7f0dc06", documentNumber: "4502" },
  ],
);
const SeparationsKualiReadResultSchema = z.strictObject({
  document: KualiSeparationDocumentSchema,
  termination: MatchTerminationTypeOutputSchema,
});

export function buildExtraction({ task, group }: Author) {
  const action = task(actionNode, [], ({ input }) => ({
    documentNumber: input.documentNumber,
  }));
  const document = task(documentNode, [action], ({ input, outputs }) => ({
    actionId: outputs[ACTION_NODE].actionId,
    documentNumber: input.documentNumber,
  }));
  const plan = task(planNode, [document], ({ input, outputs }) => ({
    documentNumber: input.documentNumber,
    employeeName: outputs[DOCUMENT_NODE].employee.name,
    lastDayWorked: outputs[DOCUMENT_NODE].separation.lastDayWorked,
    separationDate: outputs[DOCUMENT_NODE].separation.separationDate,
    observedAt: outputs[DOCUMENT_NODE].observedAt,
  }));
  const terminationType = task(
    terminationTypeNode,
    [document],
    ({ input, outputs }) => ({
      terminationType: outputs[DOCUMENT_NODE].separation.terminationType,
      observedOptions: outputs[DOCUMENT_NODE].options.terminationType,
      documentNumber: input.documentNumber,
    }),
  );
  return { action, document, plan, terminationType, steps: [[group(KUALI_EXTRACTION_STEP, KUALI_EXTRACTION_DISPLAY), [action, document, plan, terminationType]]] as const };
}

export const separationsKualiReadDefinition = defineStep({
  group: KUALI_EXTRACTION_STEP, build: buildExtraction,
  proof: {
    id: "separations-kuali-read", order: 1, build: (): StepProofSpec<typeof SeparationsKualiReadInput, typeof SeparationsKualiReadResultSchema> => ({
      version: 1,
      code: "sd",
      label: "Separation Document",
      summary: "Chunk 2 of the separations migration: the Kuali passage on its own. Reads the whole RRSS " +
        "separation request form in one page visit, then resolves the document's termination type against " +
        "the mapped set. Strictly read-only.",
      icon: "FileText",
      category: "separation",
      canonicalInput: SeparationsKualiReadCanonicalInput,
      inputSubject: "document",
      surface: { shape: "single" },
      enqueue: "reject-active",
      actions: STANDARD_WORKFLOW_ACTIONS,
      surfaces: {},
      verdicts: [
        {
          key: "unprocessed",
          label: "Not yet processed",
          tone: "neutral",
          tag: true,
        },
        {
          key: "already-filed",
          label: "Transaction already filed",
          tone: "warning",
          tag: true,
        },
      ],
      details: [
        {
          key: "form-type",
          label: "Form",
          source: { nodeId: "document", fieldPath: "formType.observed" },
          display: "text",
        },
        {
          key: "termination-type",
          label: "Type of Termination",
          source: { nodeId: "termination-type", fieldPath: "terminationType" },
          display: "text",
        },
        {
          key: "template",
          label: "UCPath template",
          source: { nodeId: "termination-type", fieldPath: "template" },
          display: "text",
        },
        {
          key: "reason-code",
          label: "UCPath reason code",
          source: { nodeId: "termination-type", fieldPath: "reasonCode" },
          display: "text",
        },
      ],
      subjectProjection: { nodeId: "document", fieldPath: "employee.name.value" },
      identity: {
        matchKey: (input) => `kuali-separation-document:${input.documentNumber}`,
      },
      presentation: {
        title: (input) => `Document ${input.documentNumber}`,
        subtitle: (input) => `Kuali action ${input.actionId.slice(0, 8)}…`,
      },
      nodePurposes: [
        {
          nodeId: "document",
          purpose:
            "Reads the entire Kuali RRSS separation request form in ONE page visit: the employee, the " +
            "separation dates, the comments, and every control's own option list as this run observed it.",
        },
        {
          nodeId: "termination-type",
          purpose:
            "Resolves the document's termination type to the UCPath template and reason code it files under, " +
            "refusing a type nobody has mapped. Pure: it reaches no browser.",
        },
      ],
      scenarios: [
        "separations-kuali-read/reads-a-real-separation-document",
        "separations-kuali-read/unprocessed-document-absent-arms",
        "separations-kuali-read/non-separation-document",
        "separations-kuali-read/unknown-termination-type",
        "separations-kuali-read/unparseable-separation-date",
      ],
      input: SeparationsKualiReadInput,
      steps: (author: WorkflowAuthor<typeof SeparationsKualiReadInput>) => {
        const { task, result } = author;
        const document = task(documentNode, [], ({ input }) => ({
          actionId: input.actionId,
          documentNumber: input.documentNumber,
        }));
        const terminationType = task(
          terminationTypeNode,
          [document],
          ({ input, outputs }) => ({
            terminationType: outputs[DOCUMENT_NODE].separation.terminationType,
            observedOptions: outputs[DOCUMENT_NODE].options.terminationType,
            documentNumber: input.documentNumber,
          }),
        );
        return {
          steps: [[KUALI_EXTRACTION_STEP, [document, terminationType]]],
          result: result(
            SeparationsKualiReadResultSchema,
            [document, terminationType],
            ({ outputs }) => ({
              document: {
                ...outputs[DOCUMENT_NODE],
                formType: requireFact(
                  outputs[DOCUMENT_NODE].formType,
                  DOCUMENT_NODE,
                  "formType",
                ),
              },
              termination: outputs[TERMINATION_TYPE_NODE],
            }),
          ),
        };
      },
    }),
  },
});
