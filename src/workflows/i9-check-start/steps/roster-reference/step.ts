import { ReadWorkbookReference } from "../../../../models/processing/workbooks/read-reference.js";
import { ReadI9CheckRequests } from "../../../../models/workflows/i9-check-start/read-requests.js";
import { I9CheckStartInput, I9_CHECK_REFERENCE } from "../../../../models/workflows/i9-check/start.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { buildDocuments } from "../documents/step.js";

const step = Object.freeze({
  ...defineWorkflowStep({ key: "roster-reference", label: "Look up in roster" }),
  review: {
    pages: [
      {
        id: "retention-roster",
        title: "Retention roster",
        mode: "Read only",
        nodeIds: ["read-reference", "read-requests"],
        lines: [
          { id: "reference", kind: "read", text: "Read the captured roster version for the approved people.", nodeIds: ["read-reference"] },
          { id: "bind", kind: "check", text: "Check the selected worksheet rows and retention evidence before checking each person.", nodeIds: ["read-requests"] }
        ],
        fields: []
      }
    ],
    branchLabels: []
  } as const
});
const entries = defineStepEntries(step);
type Author = WorkflowAuthor<typeof I9CheckStartInput>;
export function buildRosterReference(author: Author, documents: ReturnType<typeof buildDocuments>) {
  const reference = author.task(entries.task("read-reference", ReadWorkbookReference, { replay: "checkpoint" }), [documents.people], ({ outputs }) => ({
    typeId: I9_CHECK_REFERENCE.typeId, keys: outputs["read-people"].people.map(person => person.eid),
  }));
  const prepared = author.task(entries.task("read-requests", ReadI9CheckRequests, { replay: "checkpoint" }), [documents.people, reference], ({ input, outputs }) => ({
    request: input, people: outputs["read-people"], reference: outputs["read-reference"],
  }));
  return { prepared, reference, steps: [[step, [reference, prepared]]] as const,
    result: author.result(ReadI9CheckRequests.output, [prepared], ({ outputs }) => outputs["read-requests"]) };
}
export const i9CheckStartRosterReferenceDefinition = defineStep({ group: step, build: buildRosterReference,
  nodePurposes: [
    { nodeId: "read-reference", purpose: "Read discovered people from the immutable roster version captured for this Start." },
    { nodeId: "read-requests", purpose: "Bind exact worksheet rows and retention evidence to each approved person." },
  ],
  proof: { id: "i9-check-start-roster-reference", order: 26, build: (parent: WorkflowDefinition<typeof I9CheckStartInput>) => ({
    ...inheritStepProof(parent), code: "icsr", label: "I-9 reference lookup", summary: "Proves exact selected-version membership after PDF review.",
    steps: (author: Author) => {
      const documents = buildDocuments(author), reference = buildRosterReference(author, documents);
      return { steps: [...documents.steps, ...reference.steps], result: reference.result };
    },
  }) },
});
