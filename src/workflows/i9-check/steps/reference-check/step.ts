import { z } from "zod";
import { REFERENCE_CHECK, VerifyWorkbookPerson } from "../../../../models/processing/workbooks/verify-person.js";
import { I9CheckInput } from "../../../../models/workflows/i9-check/input.js";
import { defineStep, defineStepEntries, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { i9CheckPersonLookupDefinition } from "../person-lookup/step.js";
import { i9CheckPersonMatchDefinition } from "../person-match/step.js";
import { i9CheckRosterMatchDefinition, type buildStep as buildRosterMatch } from "../roster-match/step.js";

export const REFERENCE_CHECK_NODE = "reference-check";

export const REFERENCE_CHECK_STEP = Object.freeze({
  ...defineWorkflowStep({ key: "reference-check", label: "Check reference spreadsheets" }), system: "local" as const,
  description: "Look the Employee ID UCPath found up in each picked reference spreadsheet. I-9 Check only reads, so it shows the result and goes on.",
  operatorFields: [
    { label: "Reference spreadsheet", visibility: "logs", sources: [{ nodeId: REFERENCE_CHECK_NODE, kind: "output", fieldPath: "checks.line" }] },
  ] as const,
  review: {
    pages: [{
      id: "reference-spreadsheets", title: "Reference spreadsheets", mode: "Read only", nodeIds: [REFERENCE_CHECK_NODE],
      lines: [
        { id: "check-person", kind: "check", text: "Confirm the Employee ID, and the name when the sheet has one, in each picked spreadsheet.", nodeIds: [REFERENCE_CHECK_NODE] },
      ],
      fields: [],
    }],
    branchLabels: [],
  } as const,
});

const checkEntry = defineStepEntries(REFERENCE_CHECK_STEP).task(REFERENCE_CHECK_NODE, VerifyWorkbookPerson, {
  label: "Check reference spreadsheets", replay: "checkpoint", when: { kind: "is-present", of: { from: "reference", typeId: REFERENCE_CHECK.id } },
});

/** `check` is null when the run picked no reference spreadsheet and the check was skipped. */
const ReferenceCheckStepResultSchema = z.strictObject({ check: VerifyWorkbookPerson.output.nullable() });

/** Checks the person UCPath identified; one UCPath did not find has no Employee ID, so its check finds no person. */
export function buildReferenceCheck(author: WorkflowAuthor<typeof I9CheckInput>, roster: ReturnType<typeof buildRosterMatch>) {
  const check = author.task(checkEntry, [roster.row], ({ outputs }) => {
    const identity = outputs["retention-row"].identity;
    return identity.status === "found" ? { typeId: REFERENCE_CHECK.id, eid: identity.eid, name: identity.name } : { typeId: REFERENCE_CHECK.id, eid: null, name: null };
  });
  return { check, steps: [[REFERENCE_CHECK_STEP, [check]]] as const,
    result: author.result(ReferenceCheckStepResultSchema, [check], ({ outputs }) => ({ check: outputs[REFERENCE_CHECK_NODE] ?? null })) };
}

export const i9CheckReferenceCheckDefinition = defineStep({
  group: REFERENCE_CHECK_STEP, build: buildReferenceCheck,
  proof: { id: "i9-check-reference-check", order: 37,
    build: (parent: WorkflowDefinition<typeof I9CheckInput>) => ({ ...inheritStepProof(parent),
      code: "icrc", label: REFERENCE_CHECK_STEP.label, summary: "Checks the person UCPath identified against the picked reference spreadsheets.",
      steps: (author: WorkflowAuthor<typeof I9CheckInput>) => {
        const matched = i9CheckPersonMatchDefinition.build(author), looked = i9CheckPersonLookupDefinition.build(author, matched);
        const roster = i9CheckRosterMatchDefinition.build(author, matched, looked.search), reference = buildReferenceCheck(author, roster);
        return { steps: [...matched.steps, ...looked.steps, ...roster.steps, ...reference.steps], result: reference.result };
      },
    }),
  },
});
