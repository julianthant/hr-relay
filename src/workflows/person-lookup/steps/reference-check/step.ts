import { z } from "zod";
import { VerifyWorkbookPerson, REFERENCE_CHECK } from "../../../../models/processing/workbooks/verify-person.js";
import { PersonLookupInput } from "../../../../models/workflows/person-lookup/input.js";
import { derivePersonLookupOutcome } from "../../../../rules/matching/person-lookup.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { buildActiveStatus } from "../active-status/step.js";
import { buildCrmDates } from "../crm-dates/step.js";
import { buildCrossVerify } from "../cross-verify/step.js";
import { buildSearching } from "../searching/step.js";

export const REFERENCE_CHECK_STEP = Object.freeze({
  ...defineWorkflowStep({ key: "reference-check", label: "Check reference spreadsheets" }),
  description: "Look the found Employee ID up in each picked reference spreadsheet.",
  system: "local",
  operatorFields: [
    { label: "Reference spreadsheet", visibility: "logs", sources: [{ nodeId: "reference-check", kind: "output", fieldPath: "checks.line" }] },
  ],
  review: {
    pages: [
      {
        id: "reference-spreadsheets",
        title: "Reference spreadsheets",
        mode: "Read only",
        nodeIds: ["reference-check"],
        lines: [{ id: "check-person", kind: "check", text: "Confirm the found Employee ID, and the name when the sheet has one, in each picked spreadsheet.", nodeIds: ["reference-check"] }],
        fields: []
      }
    ],
    branchLabels: []
  } as const,
} as const);

/** `check` is null when the run picked no reference spreadsheet and the step was skipped. */
const ReferenceCheckStepResultSchema = z.strictObject({ check: VerifyWorkbookPerson.output.nullable() });

const referenceCheckEntries = defineStepEntries(REFERENCE_CHECK_STEP);

export const REFERENCE_CHECK_NODE = "reference-check";

export const referenceCheckNode = referenceCheckEntries.task(REFERENCE_CHECK_NODE, VerifyWorkbookPerson, {
  label: "Check reference spreadsheets",
  replay: "checkpoint",
  when: { kind: "is-present", of: { from: "reference", typeId: REFERENCE_CHECK.id } }
});

export function buildReferenceCheck(author: WorkflowAuthor<typeof PersonLookupInput>, search: ReturnType<typeof buildSearching>, crossverify: ReturnType<typeof buildCrossVerify>, activestatus: ReturnType<typeof buildActiveStatus>) {
  const { task, result } = author;
  const { matching, initial } = search;
  const { identity, selectedRecord, crmResults } = crossverify;
  const { activeStatus } = activestatus;
  const referenceCheck = task(referenceCheckNode, [initial, identity, matching, selectedRecord, crmResults, activeStatus], ({ input, outputs }) => {
    const { details } = outputs["active-status"] ?? derivePersonLookupOutcome({ input, identity: outputs["crm-identity"] ?? outputs["search-identity"], match: outputs.matching, verifiedCrm: outputs["crm-selected-record"] });
    return { typeId: REFERENCE_CHECK.id, eid: details.eid, name: details.name };
  });
  return {
    referenceCheck, steps: [[REFERENCE_CHECK_STEP, [referenceCheck]]] as const,
    result: result(ReferenceCheckStepResultSchema, [referenceCheck], ({ outputs }) => ({ check: outputs["reference-check"] ?? null }))
  };
}

export const personLookupReferenceCheckDefinition = defineStep({
  group: REFERENCE_CHECK_STEP,
  build: buildReferenceCheck,
  proof: {
    id: "person-lookup-reference-check", order: 34,
    build: (parent: WorkflowDefinition<typeof PersonLookupInput>) => ({
      ...inheritStepProof(parent), code: "plr", label: REFERENCE_CHECK_STEP.label,
      summary: "Proves the Person Lookup reference-check step with its prerequisite reads.",
      steps: (author: WorkflowAuthor<typeof PersonLookupInput>) => {
        const searching = buildSearching(author);
        const crossverify = buildCrossVerify(author, searching);
        const activestatus = buildActiveStatus(author, searching, crossverify);
        const crmdates = buildCrmDates(author, searching, crossverify, activestatus);
        const built = buildReferenceCheck(author, searching, crossverify, activestatus);
        return { steps: [...searching.steps, ...crossverify.steps, ...activestatus.steps, ...crmdates.steps, ...built.steps], result: built.result };
      },
    }),
  },
});
