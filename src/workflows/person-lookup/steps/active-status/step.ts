import { SearchPersonOrg } from "../../../../models/systems/ucpath/search-person-org.js";
import { PersonLookupInput } from "../../../../models/workflows/person-lookup/input.js";
import { ActiveStatusOutcomeSchema, ReadActiveStatus } from "../../../../models/workflows/person-lookup/read-active-status.js";
import { derivePersonLookupOutcome } from "../../../../rules/matching/person-lookup.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep, requireFact } from "../../../../workflow-kit/workflow.js";
import { buildCrossVerify } from "../cross-verify/step.js";
import { buildSearching } from "../searching/step.js";

export const ACTIVE_STATUS_STEP = Object.freeze({
  ...defineWorkflowStep({ key: "active-status", label: "Read employment status" }),
  description: "Determine employment status and read department and termination details when applicable.",
  system: "local",
  operatorFields: [
    {
      label: "Employment status", example: "Active", display: {
        cases: [
          { value: "active", text: "Active" }, { value: "inactive", text: "Inactive" }, { value: "crm-only", text: "CRM only" },
          { value: "multiple-matches", text: "Multiple matches" }, { value: "not-found", text: "Not found" },
          { value: "undetermined", text: "Undetermined" }, { value: "found", text: "Found" }, { value: "not-found-in-ucpath", text: "Not found in UCPath" },
        ]
      }, sources: [{ nodeId: "active-status", kind: "output", fieldPath: "state" }]
    },
    { label: "HDH department", example: "Yes", display: { cases: [{ value: true, text: "Yes" }, { value: false, text: "No" }] }, sources: [{ nodeId: "active-status", kind: "output", fieldPath: "hdh" }] },
    ...[["details.department", "Department", "CAMPUS DINING OPERATIONS"], ["details.endDate", "End date", "4/25/2031"], ["details.terminationReason", "Termination reason", "Appointment ended"]].map(([fieldPath, label, example]) => ({
      label, example,
      sources: [{ nodeId: "active-status", kind: "output" as const, fieldPath }]
    })),
    ...[["details.ucpath", "UCPath", "Found"], ["details.crm", "CRM", "Not checked"]].map(([fieldPath, label, example]) => ({
      label, example, visibility: "logs" as const,
      sources: [{ nodeId: "active-status", kind: "output" as const, fieldPath }]
    })),
    { label: "Status note", visibility: "logs", sources: [{ nodeId: "active-status", kind: "output", fieldPath: "reason" }] },
  ],
  review: {
    pages: [
      {
        id: "person-org-detail",
        title: "Person Organizational Summary detail",
        mode: "Read only",
        nodeIds: ["crm-only-recovery", "active-status"],
        lines: [
          { id: "recover-ucpath", kind: "action", text: "When CRM supplies an employee ID, look up that person in UCPath.", nodeIds: ["crm-only-recovery"] },
          { id: "read-status", kind: "read", text: "Determine employment status and read department and termination details when present.", nodeIds: ["active-status"] }
        ],
        fields: [
          {
            id: "employment-status",
            operatorField: "Employment status",
            source: {
              origin: "UCPath and CRM",
              detail: "Status derived from the resolved identity and verified records.",
              chain: [
                {
                  label: "UCPath identity",
                  detail: "Read and confirm the UCPath person.",
                  read: { stepKey: "searching", page: "Person Organizational Summary detail", field: "Employee ID" }
                },
                {
                  label: "CRM identity",
                  detail: "A verified CRM record can supply the employee ID for a recovery search.",
                  read: { stepKey: "cross-verify", page: "CRM onboarding record", field: "Employee ID" }
                }
              ],
              read: { stepKey: "active-status", page: "Person Organizational Summary detail", field: "Employment status" }
            }
          },
          {
            id: "hdh-department",
            operatorField: "HDH department",
            source: {
              origin: "UCPath",
              detail: "Whether the selected department is HDH.",
              chain: [],
              read: { stepKey: "active-status", page: "Person Organizational Summary detail", field: "HDH department" }
            }
          },
          {
            id: "department",
            operatorField: "Department",
            source: {
              origin: "UCPath",
              detail: "Department from the employment details.",
              chain: [],
              read: { stepKey: "active-status", page: "Person Organizational Summary detail", field: "Department" }
            }
          },
          {
            id: "end-date",
            operatorField: "End date",
            source: {
              origin: "UCPath",
              detail: "End date from the employment details, when present.",
              chain: [],
              read: { stepKey: "active-status", page: "Person Organizational Summary detail", field: "End date" }
            }
          },
          {
            id: "termination-reason",
            operatorField: "Termination reason",
            source: {
              origin: "UCPath",
              detail: "Termination reason from the employment details, when present.",
              chain: [],
              read: { stepKey: "active-status", page: "Person Organizational Summary detail", field: "Termination reason" }
            }
          }
        ]
      }
    ],
    branchLabels: []
  } as const,
} as const);

const activeStatusEntries = defineStepEntries(ACTIVE_STATUS_STEP);

export const RECOVERY_NODE = "crm-only-recovery";

export const recoveryNode = activeStatusEntries.task(RECOVERY_NODE, SearchPersonOrg, {
  replay: "checkpoint",
  when: { kind: "is-present", of: { from: "node", nodeId: "crm-identity", path: "recoveryEid" } }
});

export const ACTIVE_STATUS_NODE = "active-status";

export const activeStatusNode = activeStatusEntries.task(ACTIVE_STATUS_NODE, ReadActiveStatus, {
  replay: "always-rerun",
  when: { kind: "equals", of: { from: "input", path: "mode" }, value: "search" }
});

export function buildActiveStatus(author: WorkflowAuthor<typeof PersonLookupInput>, search: ReturnType<typeof buildSearching>, crossverify: ReturnType<typeof buildCrossVerify>) {
  const { task, result } = author;
  const { matching, initial } = search;
  const { identity, selectedRecord, crmResults } = crossverify;
  const recovery = task(recoveryNode, [identity, selectedRecord, crmResults], ({ outputs }) => ({ kind: "by-eid" as const, emplId: requireFact(outputs["crm-identity"]?.recoveryEid, "crm-identity", "recoveryEid") }));
  const activeStatus = task(activeStatusNode, [initial, identity, recovery, selectedRecord, crmResults], ({ input, outputs }) => ({ input, identity: outputs["crm-identity"] ?? outputs["search-identity"], verifiedCrm: outputs["crm-selected-record"], recovered: outputs["crm-only-recovery"] }));
  return {
    recovery, activeStatus, steps: [[ACTIVE_STATUS_STEP, [recovery, activeStatus]]] as const,
    result: result(ActiveStatusOutcomeSchema, [initial, identity, matching, selectedRecord, crmResults, activeStatus], ({ input, outputs }) => outputs["active-status"] ?? derivePersonLookupOutcome({ input, identity: outputs["crm-identity"] ?? outputs["search-identity"], match: outputs["matching"], verifiedCrm: outputs["crm-selected-record"] }))
  };
}

export const personLookupActiveStatusDefinition = defineStep({
  group: ACTIVE_STATUS_STEP,
  build: buildActiveStatus,
  proof: {
    id: "person-lookup-active-status", order: 7,
    build: (parent: WorkflowDefinition<typeof PersonLookupInput>) => ({
      ...inheritStepProof(parent), code: "pla", label: ACTIVE_STATUS_STEP.label,
      summary: "Proves the Person Lookup active-status step with its prerequisite reads.",
      steps: (author: WorkflowAuthor<typeof PersonLookupInput>) => {
        const searching = buildSearching(author);
        const crossverify = buildCrossVerify(author, searching);
        const built = buildActiveStatus(author, searching, crossverify);
        return { steps: [...searching.steps, ...crossverify.steps, ...built.steps], result: built.result };
      },
    }),
  },
});
