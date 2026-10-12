import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { workflowPlanning, workflowProjections } from "../../../src/workflow-kit/workflow.js";
import { personLookupDescriptor, personLookupModule, separationsIdentityCheckDescriptor, separationsKronosTimecardDescriptor, separationsUcpathTerminationDescriptor } from "../../support/helpers/registered-workflows.js";

describe("workflow definition public equivalence characterization", () => {
  it("keeps person lookup's public descriptor, module stores, normalized timeline, and registry value", () => {
    const intake = personLookupModule.intake;
    if (intake === undefined) throw new Error("person-lookup registers no intake projection");

    expect({
      descriptor: {
        id: String(personLookupDescriptor.id),
        version: personLookupDescriptor.version,
        code: personLookupDescriptor.code,
        label: personLookupDescriptor.label,
        summary: personLookupDescriptor.summary,
        icon: personLookupDescriptor.icon,
        category: personLookupDescriptor.category,
        surface: personLookupDescriptor.surface,
        enqueue: personLookupDescriptor.enqueue,
        actions: personLookupDescriptor.actions,
        capabilities: personLookupDescriptor.capabilities,
        verdicts: personLookupDescriptor.verdicts,
        surfaces: personLookupDescriptor.surfaces,
        details: personLookupDescriptor.details,
        subjectProjection: personLookupDescriptor.subjectProjection,
        timelineDeclared: personLookupDescriptor.timelineDeclared,
        timeline: personLookupDescriptor.timeline.map((group) => ({
          key: group.key,
          label: group.label,
          nodes: group.nodes.map((node) => ({ id: String(node.id), label: node.label })),
        })),
        stepOmissions: personLookupDescriptor.stepOmissions,
      },
      module: {
        role: personLookupModule.role,
        stores: personLookupModule.stores.map((store) => ({ kind: store.kind, namespace: store.namespace })),
        intakeTargets: intake.targets.map((target) => ({
          targetFieldId: target.targetFieldId,
          canonicalFieldId: target.canonicalFieldId,
          label: target.label,
          required: target.required,
        })),
      },
      registryIndex: WORKFLOW_MODULES.indexOf(personLookupModule),
    }).toEqual({
      descriptor: {
        id: "person-lookup",
        version: 1,
        code: "pl",
        label: "Person Lookup",
        summary: "Resolves ONE person across UCPath and the CRM: searches Person Org by EID or name, "
          + "cross-verifies the match against the CRM onboarding record, folds the two into an active / "
          + "inactive verdict, and reads the CRM onboarding dates when the run asks for them.",
        icon: "Search",
        category: "search",
        surface: { shape: "single" },
        enqueue: "reject-active",

        actions: { enabled: ["retry", "restart", "cancel", "bump", "rename", "delete"] },
        capabilities: {
          review: false,
          editData: {
            fields: [
              { nodeId: "crm-dates", fieldPath: "invitedOn.value", label: "Invited on" },
              { nodeId: "crm-dates", fieldPath: "startsOn.value", label: "Starts on" },
              { nodeId: "crm-dates", fieldPath: "completedOn.value", label: "Completed on" },
            ],
          },
        },
        verdicts: [
          { key: "not-found", label: "Not found", tone: "warning" },
          { key: "inactive", label: "Inactive", tone: "warning", tag: true },
        ],
        surfaces: {
          inputRun: {
            placeholder: "Enter EIDs or names, semicolon-separated (e.g. 10873698; Battistessa, Johnnie)",
            parser: {
              split: { kind: "delimited", delimiters: [";", "\n"] },
              rules: [
                { when: { kind: "pattern", pattern: "eid" }, emit: "emplId" },
                { when: { kind: "otherwise" }, emit: "name" },
              ],
              constants: [
                { field: "keepNonHdh", value: { kind: "boolean", value: false } },
                { field: "includeCrmDates", value: { kind: "boolean", value: false } },
              ],
            },
            examples: [
              { key: "one-eid", label: "One EID", text: "10873698", note: "the ordinary case — one run for one employee id" },
              {
                key: "eid-and-name",
                label: "An EID and a name",
                text: "10873698; Battistessa, Johnnie",
                note: "two runs from one box: the parser reads the first as an employee id and the second as a name, "
                  + "and the comma inside the name is not a separator",
              },
            ],
            supportsDryRun: false,
          },
        },
        details: [
          { key: "selection-status", label: "Selection", source: { nodeId: "searching", fieldPath: "selection.status" }, display: "badge" },
          { key: "active-state", label: "Active status", source: { nodeId: "active-status", fieldPath: "state" }, display: "badge" },
        ],
        subjectProjection: { nodeId: "searching", fieldPath: "selection.selected.name" },
        timelineDeclared: false,
        timeline: [
          { key: "searching", label: "Searching", nodes: [{ id: "searching", label: "Searching" }] },
          { key: "cross-verify", label: "Cross Verification", nodes: [{ id: "cross-verify", label: "Cross Verification" }] },
          { key: "active-status", label: "Active Status", nodes: [{ id: "active-status", label: "Active Status" }] },
          { key: "crm-dates", label: "CRM Dates", nodes: [{ id: "crm-dates", label: "CRM Dates" }] },
        ],
        stepOmissions: [],
      },
      module: {
        role: { kind: "standalone" },
        stores: [
          { kind: "browser", namespace: "ucpath" },
          { kind: "browser", namespace: "crm" },
          { kind: "headless", namespace: "workflow:person-lookup" },
        ],
        intakeTargets: [
          { targetFieldId: "emplId", canonicalFieldId: "eid", label: "Employee ID (EID)", required: false },
          { targetFieldId: "name", canonicalFieldId: "fullName", label: "Full Name", required: false },
        ],
      },
      registryIndex: 0,
    });
  });

  it("keeps person lookup's input-subject, node graph, and derived projections", () => {
    const projections = workflowProjections(personLookupDescriptor);

    expect({
      inputSubjects: [
        workflowPlanning(personLookupDescriptor).inputSubject({ name: "Battistessa, Johnnie", keepNonHdh: false, includeCrmDates: false }),
        workflowPlanning(personLookupDescriptor).inputSubject({ emplId: "10873698", keepNonHdh: false, includeCrmDates: false }),
      ],
      graph: personLookupDescriptor.nodes.map((node) => {
        const when = "when" in node ? node.when : undefined;
        return {
          id: String(node.id),
          kind: node.kind,
          dependsOn: node.dependsOn.map(String),
          ...(when === undefined ? {} : { when }),
          ...(node.kind === "transaction" ? { dryRun: node.dryRun } : {}),
        };
      }),
      steps: workflowProjections(personLookupDescriptor).steps.map(({ key, nodeId, label, kind, taskId, conditional }) => ({
        key,
        nodeId: String(nodeId),
        label,
        kind,
        ...(taskId === undefined ? {} : { taskId: String(taskId) }),
        conditional,
      })),
      gates: projections.gates,
      systems: projections.systems,
      requires: projections.requires,
      contracts: projections.contracts.map((contract) => String(contract.id)),
      dryRun: projections.dryRun,
    }).toEqual({
      inputSubjects: ["name", "eid"],
      graph: [
        { id: "searching", kind: "task", dependsOn: [] },
        { id: "cross-verify", kind: "task", dependsOn: ["searching"] },
        { id: "active-status", kind: "task", dependsOn: ["searching", "cross-verify"] },
        {
          id: "crm-dates",
          kind: "task",
          dependsOn: ["searching"],
          when: { kind: "is-true", of: { from: "input", path: "includeCrmDates" } },
        },
      ],
      steps: [
        { key: "searching", nodeId: "searching", label: "Searching", kind: "task", taskId: "ucpath/search-person-org", conditional: false },
        { key: "cross-verify", nodeId: "cross-verify", label: "Cross Verification", kind: "task", taskId: "crm/read-onboarding-record", conditional: false },
        { key: "active-status", nodeId: "active-status", label: "Active Status", kind: "task", taskId: "workflow:person-lookup/read-active-status", conditional: false },
        { key: "crm-dates", nodeId: "crm-dates", label: "CRM Dates", kind: "task", taskId: "crm/read-onboarding-dates", conditional: true },
      ],
      gates: [],
      systems: ["crm", "ucpath"],
      requires: [],
      contracts: [
        "ucpath/search-person-org",
        "crm/read-onboarding-record",
        "workflow:person-lookup/read-active-status",
        "crm/read-onboarding-dates",
      ],
      dryRun: { state: "unsupported", reason: "no-transaction-node" },
    });
  });
});

const EID = "10833507";

describe("workflow durable match-key identity", () => {
  it("preserves the byte-exact natural keys that predate identifier redaction", () => {
    const personByEid = personLookupDescriptor.input.parse({ emplId: EID });
    const personByName = personLookupDescriptor.input.parse({ name: "Hernandez, Jose Santos" });
    const identityCheck = separationsIdentityCheckDescriptor.input.parse({
      documentNumber: "4510",
      employeeName: "Hernandez, Jose Santos",
      emplId: EID,
      emplIdSource: "document-eid",
      documentEid: { state: "present", value: EID },
    });
    const timecard = separationsKronosTimecardDescriptor.input.parse({
      emplId: EID,
      expectedName: "Hernandez, Jose Santos",
      rangeStart: "06/01/2026",
      rangeEnd: "08/12/2026",
    });
    const termination = separationsUcpathTerminationDescriptor.input.parse({
      documentNumber: "4510",
      employeeName: "Hernandez, Jose Santos",
      emplId: EID,
      emplIdSource: "document-eid",
      documentEid: { state: "present", value: EID },
      terminationType: { state: "present", value: "No Reason Given" },
      observedTerminationTypeOptions: ["- - -", "No Reason Given"],
      emplRecord: "0",
      effectiveDate: "06/11/2026",
      lastDateWorked: "06/10/2026",
      initiatorComments: "Separation filed from Kuali RRSS document 4510.",
    });

    assert.deepEqual([
      personLookupDescriptor.identity.matchKey(personByEid),
      personLookupDescriptor.identity.matchKey(personByName),
      separationsIdentityCheckDescriptor.identity.matchKey(identityCheck),
      separationsKronosTimecardDescriptor.identity.matchKey(timecard),
      separationsUcpathTerminationDescriptor.identity.matchKey(termination),
    ], [
      `eid:${EID}`,
      "name:Hernandez, Jose Santos",
      `separations-identity:4510:${EID}`,
      `kronos-timecard:${EID}:06/01/2026:08/12/2026`,
      `separations-ucpath-termination:${EID}:06/11/2026`,
    ]);
  });
});
