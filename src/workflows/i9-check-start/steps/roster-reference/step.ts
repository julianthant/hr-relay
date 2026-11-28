import { z } from "zod";
import { ReadWorkbookReference } from "../../../../models/processing/workbooks/read-reference.js";
import { ReadI9CheckReferenceConflicts, ReadI9CheckRequests } from "../../../../models/workflows/i9-check-start/read-requests.js";
import { WORKSHEET_ROW_CHOICE_GATE, WorksheetRowChoiceSchema } from "../../../../models/processing/workbooks/reference-choice.js";
import { I9CheckStartInput, I9_CHECK_REFERENCE } from "../../../../models/workflows/i9-check/start.js";
import { PERSON_LOOKUP_EXAMPLE_EID } from "../../../../models/workflows/person-lookup/input.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { buildDocuments, i9CheckStoppedResult, stopWithoutRead } from "../documents/step.js";

export const ROSTER_REFERENCE_STEP = Object.freeze({
  ...defineWorkflowStep({ key: "roster-reference", label: "Look up in roster" }),
  manual: {
    ...stopWithoutRead("Stops without the selected Action History evidence.", ["read-reference", "read-reference-conflicts", WORKSHEET_ROW_CHOICE_GATE, "read-requests"]),
    skipsGatesAndTransactions: true as const,
  },
  review: {
    pages: [
      {
        id: "retention-roster",
        title: "Retention roster",
        mode: "Read only",
        nodeIds: ["read-reference", "read-reference-conflicts", WORKSHEET_ROW_CHOICE_GATE, "read-requests"],
        lines: [
          { id: "reference", kind: "read", text: "Read the captured roster version for the approved people.", nodeIds: ["read-reference"] },
          { id: "captured", kind: "check", text: "Keep the captured spreadsheet version and worksheet rows selected when the run started.", nodeIds: ["read-reference"] },
          { id: "bind", kind: "check", text: "Check the selected worksheet rows and retention evidence before checking each person.", nodeIds: ["read-requests"] }
        ],
        fields: [
          { id: "version", label: "Reference version", taskFields: [{ nodeId: "read-reference", kind: "output", fieldPath: "reference.snapshot.versionName" }], example: "Fictional retention roster",
            source: { origin: "Selected reference spreadsheet", detail: "The named version captured when the run starts.", chain: [] } },
          { id: "eid", label: "Employee ID", taskFields: [{ nodeId: "read-requests", kind: "output", fieldPath: "people.eid" }], example: PERSON_LOOKUP_EXAMPLE_EID,
            source: { origin: "Approved PDF records", detail: "Look up each approved Employee ID in the captured roster.",
              read: { stepKey: "documents", page: "I-9 PDFs and approved records", field: "Employee ID" }, chain: [] } },
          { id: "pps", label: "PPS ID", taskFields: [{ nodeId: "read-requests", kind: "output", fieldPath: "children.roster.rows.ppsEid" }], example: "700001",
            source: { origin: "Retention roster", detail: "The PPS ID on the selected person's captured roster row, when available.", chain: [] } },
          { id: "separation", label: "Separation date", taskFields: [{ nodeId: "read-requests", kind: "output", fieldPath: "children.roster.rows.separationDate" }], example: "2022-10-15",
            source: { origin: "Retention roster", detail: "The separation date retained with the selected roster evidence, when available.", chain: [] } },
        ]
      }
    ],
    branchLabels: []
  } as const
});
const step = ROSTER_REFERENCE_STEP;
const referenceResult = z.union([ReadI9CheckRequests.output, i9CheckStoppedResult]);
const entries = defineStepEntries(step);
type Author = WorkflowAuthor<typeof I9CheckStartInput>;
export function buildRosterReference(author: Author, documents: ReturnType<typeof buildDocuments>) {
  const reference = author.task(entries.task("read-reference", ReadWorkbookReference, { replay: "checkpoint" }), [documents.people], ({ outputs }) => ({
    typeId: I9_CHECK_REFERENCE.typeId, keys: outputs["read-people"].people.map(person => person.eid),
  }));
  const conflicts = author.task(entries.task("read-reference-conflicts", ReadI9CheckReferenceConflicts, { replay: "checkpoint" }), [reference],
    ({ outputs }) => outputs["read-reference"]);
  const choice = author.gate({ ...entries.operatorGate(WORKSHEET_ROW_CHOICE_GATE, { label: "Choose roster rows", result: WorksheetRowChoiceSchema }),
    when: { kind: "is-true", of: { from: "node", nodeId: "read-reference-conflicts", path: "needsChoice" } } }, [reference, conflicts]);
  const prepared = author.task(entries.task("read-requests", ReadI9CheckRequests, { replay: "checkpoint" }), [documents.people, reference, choice], ({ input, outputs }) => ({
    request: input, people: outputs["read-people"], reference: outputs["read-reference"], ...(outputs[WORKSHEET_ROW_CHOICE_GATE] === undefined ? {} : { choice: outputs[WORKSHEET_ROW_CHOICE_GATE] }),
  }));
  return { prepared, reference, steps: [[step, [reference, conflicts, choice, prepared]]] as const,
    result: author.result(referenceResult, [prepared], ({ outputs }): z.input<typeof referenceResult> =>
      outputs["read-requests"] ?? { state: "stopped", reason: "roster-reference-unavailable" }) };
}
export const i9CheckStartRosterReferenceDefinition = defineStep({ group: step, build: buildRosterReference,
  nodePurposes: [
    { nodeId: "read-reference", purpose: "Read discovered people from the immutable roster version captured for this Start." },
    { nodeId: "read-reference-conflicts", purpose: "Find selected roster rows that disagree for an approved person." },
    { nodeId: WORKSHEET_ROW_CHOICE_GATE, purpose: "Wait for the operator to choose one captured row for each conflicting employee." },
    { nodeId: "read-requests", purpose: "Bind exact worksheet rows and retention evidence to each approved person." },
  ],
  proof: { id: "i9-check-start-roster-reference", order: 26, build: (parent: WorkflowDefinition<typeof I9CheckStartInput>) => ({
    ...inheritStepProof(parent), version: 2, code: "icsr", label: "I-9 reference lookup", summary: "Proves exact selected-version membership after PDF review.",
    steps: (author: Author) => {
      const documents = buildDocuments(author), reference = buildRosterReference(author, documents);
      return { steps: [...documents.steps, ...reference.steps], result: reference.result };
    },
  }) },
});
