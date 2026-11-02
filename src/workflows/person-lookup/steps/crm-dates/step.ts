import { CrmReadOnboardingDates } from "../../../../models/systems/crm/read-onboarding-dates.js";
import { PersonLookupInput } from "../../../../models/workflows/person-lookup/input.js";
import { PersonLookupResultSchema } from "../../../../models/workflows/person-lookup/result.js";
import { derivePersonLookupOutcome } from "../../../../rules/matching/person-lookup.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep, requireFact } from "../../../../workflow-kit/workflow.js";
import { buildActiveStatus } from "../active-status/step.js";
import { buildCrossVerify } from "../cross-verify/step.js";
import { buildSearching } from "../searching/step.js";

export const CRM_DATES_STEP = Object.freeze({
  ...defineWorkflowStep({ key: "crm-dates", label: "Read CRM dates" }),
  description: "Read employment and oath dates from the selected CRM record.",
  system: "crm",
  selection: { inputField: "includeCrmDates", selectedWhen: true },
  operatorFields: [
    ...[["employmentDate", "Employment date", "3/14/2031"], ["oathDate", "Oath date", "3/10/2031"]].map(([fieldPath, label, example]) => ({
      label, example,
      sources: [{ nodeId: "crm-dates", kind: "output" as const, fieldPath }]
    })),
  ],
} as const);

const crmDatesEntries = defineStepEntries(CRM_DATES_STEP);

export const CRM_DATES_NODE = "crm-dates";

export const crmDatesNode = crmDatesEntries.task(CRM_DATES_NODE, CrmReadOnboardingDates, {
  replay: "checkpoint",
  when: { kind: "is-present", of: { from: "node", nodeId: "active-status", path: "datesEid" } }
});

export function buildCrmDates(author: WorkflowAuthor<typeof PersonLookupInput>, search: ReturnType<typeof buildSearching>, crossverify: ReturnType<typeof buildCrossVerify>, activestatus: ReturnType<typeof buildActiveStatus>) {
  const { task, result } = author;
  const { matching, initial } = search;
  const { identity, selectedRecord, crmResults } = crossverify;
  const { activeStatus } = activestatus;
  const crmDates = task(crmDatesNode, [activeStatus], ({ outputs }) => ({ eid: requireFact(outputs["active-status"]?.details.eid, "active-status", "details.eid"), ...(outputs["active-status"]?.details.name == null ? {} : { name: outputs["active-status"].details.name }) }));
  return {
    crmDates, steps: [[CRM_DATES_STEP, [crmDates]]] as const,
    result: result(PersonLookupResultSchema, [initial, identity, matching, selectedRecord, crmResults, activeStatus, crmDates], ({ input, outputs }) => ({
      activeStatus: outputs["active-status"] ?? derivePersonLookupOutcome({ input, identity: outputs["crm-identity"] ?? outputs["search-identity"], match: outputs.matching, verifiedCrm: outputs["crm-selected-record"] }),
      crmDates: outputs["crm-dates"] === undefined ? { state: "not-requested" as const } : { state: "included" as const, dates: outputs["crm-dates"] },
    }))
  };
}

export const personLookupCrmDatesDefinition = defineStep({
  group: CRM_DATES_STEP,
  build: buildCrmDates,
  proof: {
    id: "person-lookup-crm-dates", order: 8,
    build: (parent: WorkflowDefinition<typeof PersonLookupInput>) => ({
      ...inheritStepProof(parent), code: "pld", label: CRM_DATES_STEP.label,
      summary: "Proves the Person Lookup crm-dates step with its prerequisite reads.",
      steps: (author: WorkflowAuthor<typeof PersonLookupInput>) => {
        const searching = buildSearching(author);
        const crossverify = buildCrossVerify(author, searching);
        const activestatus = buildActiveStatus(author, searching, crossverify);
        const built = buildCrmDates(author, searching, crossverify, activestatus);
        return { steps: [...searching.steps, ...crossverify.steps, ...activestatus.steps, ...built.steps], result: built.result };
      },
    }),
  },
});
