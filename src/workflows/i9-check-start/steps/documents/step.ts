import { ReadApprovedOcrRecords } from "../../../../models/processing/ocr/read-approved-records.js";
import { ReadI9CheckPeople } from "../../../../models/workflows/i9-check-start/read-people.js";
import { I9CheckStartInput } from "../../../../models/workflows/i9-check/start.js";
import { OcrInputSchema } from "../../../../models/workflows/ocr/input.js";
import { OcrWorkflowResultSchema } from "../../../../models/workflows/ocr/result.js";
import { NodeIdSchema, WorkflowIdSchema } from "../../../../rules/identity/ids.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";

const step = defineWorkflowStep({ key: "documents", label: "Read and approve PDFs" });
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
    result: author.result(ReadI9CheckPeople.output, [people], ({ outputs }) => outputs["read-people"]) };
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
