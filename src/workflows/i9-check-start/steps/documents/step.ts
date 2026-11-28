import { z } from "zod";
import { ReadApprovedOcrRecords } from "../../../../models/processing/ocr/read-approved-records.js";
import { ReadI9CheckPeople } from "../../../../models/workflows/i9-check-start/read-people.js";
import { I9CheckStartInput } from "../../../../models/workflows/i9-check/start.js";
import { OcrInputSchema } from "../../../../models/workflows/ocr/input.js";
import { OcrWorkflowResultSchema } from "../../../../models/workflows/ocr/result.js";
import type { StepManualDeclaration } from "../../../../models/workflow/step-omission.js";
import { PERSON_LOOKUP_EXAMPLE_EID } from "../../../../models/workflows/person-lookup/input.js";
import { NodeIdSchema, WorkflowIdSchema } from "../../../../rules/identity/ids.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";

export function stopWithoutRead(stop: string, skips: readonly string[]): StepManualDeclaration {
  return { off: "values", stop, form: { fields: [] }, produces: {}, skips };
}

export const i9CheckStoppedResult = z.strictObject({
  state: z.literal("stopped"),
  reason: z.enum(["approved-records-unavailable", "roster-reference-unavailable", "retention-results-unavailable"]),
});
const documentsResult = z.union([ReadI9CheckPeople.output, i9CheckStoppedResult]);

export const DOCUMENTS_STEP = Object.freeze({
  ...defineWorkflowStep({ key: "documents", label: "Read and approve PDFs" }),
  manual: stopWithoutRead("Stops without approved I-9 records from the attached PDFs.", ["read-documents", "read-approved-records", "read-people"]),
  review: {
    starts: [{ nodeId: "read-documents", each: "Each attached PDF" }],
    pages: [{
      id: "source-pdfs", title: "I-9 PDFs and approved records", mode: "Read only",
      nodeIds: ["read-documents", "read-approved-records", "read-people"],
      lines: [
        { id: "review", kind: "action", text: "Read each attached PDF and wait for you to review and approve its records in Logs.", nodeIds: ["read-documents"] },
        { id: "approved", kind: "check", text: "Use only approved records from these PDFs and group their I-9 sections by person, keeping every source page.", nodeIds: ["read-approved-records", "read-people"] },
      ],
      fields: [
        { id: "pdf", label: "PDF", inputField: "documents.fileName", example: "fictional-i9-packet.pdf",
          source: { origin: "Attached PDFs", detail: "The original file selected when the run starts.", chain: [] } },
        { id: "person", label: "Approved person", taskFields: [{ nodeId: "read-people", kind: "output", fieldPath: "people.person.name" }], example: "Morrow, Bea",
          source: { origin: "Approved PDF records", detail: "The name on the I-9 sections you approved in Logs.", chain: [] } },
        { id: "eid", label: "Employee ID", taskFields: [{ nodeId: "read-people", kind: "output", fieldPath: "people.eid" }], example: PERSON_LOOKUP_EXAMPLE_EID,
          source: { origin: "Approved PDF records", detail: "The employee identity approved with the source-bound record.", chain: [] } },
      ],
    }],
    branchLabels: [],
    decisions: [{ id: "document-review", label: "PDF record review", reads: { nodeId: "read-approved-records", fieldPath: "state" },
      nodeIds: ["read-approved-records", "read-people"], initial: "ready", outcomes: [
        { value: "ready", label: "Records approved", then: "Continues with the approved people after every PDF has settled." },
        { value: "refused", label: "Review unavailable", then: "Stops before the roster or person checks; resolve the PDF review in Logs.", stops: true },
      ] }],
  } as const
});
const step = DOCUMENTS_STEP;
const entries = defineStepEntries(step);
type Author = WorkflowAuthor<typeof I9CheckStartInput>;
export function buildDocuments(author: Author) {
  const documents = author.delegate({ id: "read-documents", label: "Read and review each attached PDF",
    target: { id: WorkflowIdSchema.parse("ocr"), input: OcrInputSchema, result: OcrWorkflowResultSchema },
    edgeId: "i9-documents", cardinality: "many", await: "terminal", join: "all-settled",
    policy: { onChildFailed: "allow-partial", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
  }, [], { bind: ({ input }) => input.documents.map(({ document, fileName, readingId, reading }) => ({ document, fileName, readingId, reading, formType: "i9" as const, approval: "release" as const, roster: null })),
    deriveChildItemId: (_input, identity) => identity.canonicalItemId });
  const approved = author.task(entries.task("read-approved-records", ReadApprovedOcrRecords, { replay: "always-rerun" }), [documents], ({ outputs }) => ({
    delegationNodeId: NodeIdSchema.parse("read-documents"), outcomes: [...outputs["read-documents"]],
  }));
  const people = author.task(entries.task("read-people", ReadI9CheckPeople, { replay: "checkpoint" }), [approved], ({ input, outputs }) => ({ request: input, selection: outputs["read-approved-records"] }));
  return { documents, approved, people, steps: [[step, [documents, approved, people]]] as const,
    result: author.result(documentsResult, [people], ({ outputs }): z.input<typeof documentsResult> =>
      outputs["read-people"] ?? { state: "stopped", reason: "approved-records-unavailable" }) };
}
export const i9CheckStartDocumentsDefinition = defineStep({ group: step, build: buildDocuments,
  nodePurposes: [
    { nodeId: "read-documents", purpose: "Delegate each original PDF to admitted OCR and wait for explicit review approval." },
    { nodeId: "read-approved-records", purpose: "Authenticate the exact native OCR outcomes and current corrected selections." },
    { nodeId: "read-people", purpose: "Group approved I-9 sections by asserted identity while retaining every source coordinate." },
  ],
  proof: { id: "i9-check-start-documents", order: 25, build: (parent: WorkflowDefinition<typeof I9CheckStartInput>) => ({
    ...inheritStepProof(parent), code: "icsd", label: "I-9 PDF review", summary: "Proves admitted OCR review and grouping of approved I-9 sections.", steps: buildDocuments,
  }) },
});
