import { describe, expect, it } from "vitest";
import { z } from "zod";
import { WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/models/workflow/presentation.js";
import { StepOmissionsSchema, planStepOmissions } from "../../../src/models/workflow/step-omission.js";
import { defineWorkflowRole } from "../../../src/workflow-kit/validation/module-role.js";
import { defineWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { workflowProjections } from "../../../src/workflow-kit/workflow.js";
import { PersonLookupCanonicalInput, PersonLookupInput } from "../../../src/workflows/person-lookup/workflow.js";
import { actionNode } from "../../../src/workflows/separations/workflow.js";
import { separationsDescriptor, separationsModule } from "../../support/helpers/registered-workflows.js";

describe("workflow definition compiler", () => {

  it("keeps a step-owned identity bound to its exact owning step object", () => {
    expect(() => defineWorkflow({
      id: "foreign-step",
      version: 1,
      code: "fx",
      label: "Fixture",
      icon: "Search",
      category: "search",
      input: PersonLookupInput,
      canonicalInput: PersonLookupCanonicalInput,
      inputSubject: "eid",
      surface: { shape: "single" },
      enqueue: "reject-active",
      actions: STANDARD_WORKFLOW_ACTIONS,
      surfaces: {},
      details: [],
      identity: { matchKey: () => "fixture" },
      presentation: { title: () => "Fixture" },
      scenarios: ["person-lookup/happy-by-eid"],
      role: defineWorkflowRole({ kind: "standalone" }),
      steps: ({ task, result }) => {
        const action = task(actionNode, [], () => ({ documentNumber: "4510" }));
        return {
          steps: [[{ key: "kuali-extraction", label: "Kuali extraction" }, [action]]],
          result: result(z.string(), [], () => "done"),
        };
      },
    })).toThrow(/same key but distinct step objects/u);
  });
});

describe("workflow definition public equivalence characterization", () => {

  it("keeps separations' public descriptor, module stores, declared timeline, and registry value", () => {
    expect({
      descriptor: {
        id: String(separationsDescriptor.id),
        version: separationsDescriptor.version,
        code: separationsDescriptor.code,
        label: separationsDescriptor.label,
        summary: separationsDescriptor.summary,
        icon: separationsDescriptor.icon,
        category: separationsDescriptor.category,
        surface: separationsDescriptor.surface,
        enqueue: separationsDescriptor.enqueue,
        actions: separationsDescriptor.actions,
        capabilities: separationsDescriptor.capabilities,
        verdicts: separationsDescriptor.verdicts,
        surfaces: separationsDescriptor.surfaces,
        details: separationsDescriptor.details,
        subjectProjection: separationsDescriptor.subjectProjection,
        timelineDeclared: separationsDescriptor.timelineDeclared,
        timeline: separationsDescriptor.timeline.map((group) => ({
          key: group.key,
          label: group.label,
          nodes: group.nodes.map((node) => ({ id: String(node.id), label: node.label })),
        })),
        stepOmissions: separationsDescriptor.stepOmissions.map(({ step, form, produces }) => ({
          step,
          form,
          produces: Object.keys(produces),
        })),
      },
      module: {
        role: separationsModule.role,
        stores: separationsModule.stores.map((store) => ({ kind: store.kind, namespace: store.namespace })),
      },
      registryIndex: WORKFLOW_MODULES.indexOf(separationsModule),
    }).toEqual({
      descriptor: {
        id: "separations",
        version: 1,
        code: "sp",
        label: "Separations",
        summary: "The composition: ONE Kuali RRSS separation document becomes ONE terminated employee across three "
          + "systems. It reads Kuali, UCPath and Kronos, reconciles the dates against what the timecard "
          + "actually shows, establishes identity from supplied-EID read-back or the name-only gate, then clears any pending termination, "
          + "files the termination, verifies the receipt, and finalizes the Kuali document.",
        icon: "ShieldCheck",
        category: "separation",
        surface: { shape: "single" },
        enqueue: "reject-active",

        actions: { enabled: ["retry", "restart", "cancel", "bump", "rename", "delete"] },
        capabilities: undefined,
        verdicts: [
          { key: "name-differs", label: "Name differs from UCPath", tone: "warning", tag: true },
          { key: "eid-name-resolved", label: "EID resolved by name", tone: "warning", tag: true },
          { key: "dates-moved", label: "Kronos moved the dates", tone: "neutral", tag: true },
          { key: "unclassified-pay-codes", label: "Unclassified pay codes", tone: "warning", tag: true },
        ],
        surfaces: {
          inputRun: {
            placeholder: "Enter Kuali document numbers, semicolon-separated (e.g. 4502; 4510)",
            parser: {
              split: { kind: "delimited", delimiters: [";", "\n"] },
              rules: [{ when: { kind: "pattern", pattern: "document-number" }, emit: "documentNumber" }],
            },
            examples: [
              { key: "one-document", label: "One document", text: "4502", note: "the ordinary case — one run for one Kuali separation document" },
              {
                key: "two-documents",
                label: "Two documents",
                text: "4502; 4510",
                note: "two runs from one box: each document number starts its own separation, and the "
                  + "action id for each is resolved from the Kuali Action List at run time",
              },
            ],
            supportsDryRun: true,
          },
        },
        details: [
          { key: "ucpath-name", label: "UCPath shows", source: { nodeId: "job-summary", fieldPath: "displayedName" }, display: "text" },
          { key: "template", label: "Template", source: { nodeId: "termination-type", fieldPath: "template" }, display: "text" },
          { key: "reason-code", label: "Reason code", source: { nodeId: "termination-type", fieldPath: "reasonCode" }, display: "text" },
          { key: "last-day-worked", label: "Last day worked", source: { nodeId: "dates", fieldPath: "lastDayWorked" }, display: "text" },
          { key: "effective-date", label: "Termination effective", source: { nodeId: "dates", fieldPath: "terminationEffectiveDate" }, display: "text" },
          { key: "department", label: "Department", source: { nodeId: "department-option", fieldPath: "option" }, display: "text" },
          { key: "transaction-id", label: "Transaction", source: { nodeId: "file-termination", fieldPath: "receipt.transactionId" }, display: "text" },
          { key: "approval-status", label: "Transaction status", source: { nodeId: "file-termination", fieldPath: "receipt.approvalStatus" }, display: "text" },
        ],
        subjectProjection: { nodeId: "job-summary", fieldPath: "displayedName" },
        timelineDeclared: true,
        timeline: [
          {
            key: "kuali-extraction", label: "Kuali extraction", nodes: [
              { id: "resolve-action", label: "Kuali Action" }, { id: "document", label: "Separation Document" },
              { id: "plan", label: "Separation Plan" }, { id: "termination-type", label: "Termination Type" },
            ]
          },
          {
            key: "identity-check", label: "Identity check", nodes: [
              { id: "name-search", label: "Name Search" }, { id: "subject", label: "Separation Subject" },
              { id: "comparison", label: "Identity Comparison" }, { id: "identity-approval", label: "Identity Approval" },
              { id: "approval", label: "Approval Check" },
            ]
          },
          {
            key: "job-summary", label: "Job summary", nodes: [
              { id: "job-summary", label: "Job Summary" }, { id: "employment", label: "Employment" },
              { id: "department-option", label: "Department Option" },
            ]
          },
          {
            key: "kronos-timecard", label: "Kronos timecard", nodes: [
              { id: "timecard-search", label: "Timecard Search" }, { id: "timecard", label: "Timecard" },
              { id: "dates", label: "Reconciled Dates" },
            ]
          },
          {
            key: "ucpath-transaction", label: "UCPath transaction", nodes: [
              { id: "pending-set", label: "Read Exact Pending Set" }, { id: "clear-pending", label: "Clear Pending Terminations" },
              { id: "file-termination", label: "File Termination" }, { id: "receipt", label: "Termination Receipt" },
            ]
          },
          {
            key: "kuali-finalization", label: "Kuali finalization", nodes: [
              { id: "filing-presence", label: "Verify Current UCPath Filing" }, { id: "finalize-kuali", label: "Finalize Kuali Document" },
            ]
          },
        ],
        stepOmissions: [
          {
            step: "kronos-timecard",
            form: {
              fields: [
                { key: "lastDayWorked", label: "Last day worked", help: "The employee's last physical day of work, MM/DD/YYYY. Kronos is not read; this stands in for the card's last punch.", kind: "us-date" },
                { key: "separationDate", label: "Separation date", help: "The last day on pay status, MM/DD/YYYY — the same day as the last day worked unless paid leave follows it. The termination is effective the next day.", kind: "us-date" },
              ]
            },
            produces: ["dates"],
          },
          {
            step: "ucpath-transaction",
            form: {
              fields: [
                { key: "transactionNumber", label: "UCPath transaction number", help: "The T-number of the termination already filed in UCPath (T followed by 6–12 digits). This run files nothing in UCPath.", kind: "text" },
                { key: "approvalStatus", label: "Approval status", help: "The transaction's approval status as UCPath shows it now. Only a status that means the termination took effect can be asserted.", kind: "enum", values: ["Approved", "Manually Processed", "Pending"] },
              ]
            },
            produces: ["receipt"],
          },
          { step: "kuali-finalization", form: { fields: [] }, produces: [] },
        ],
      },
      module: {
        role: { kind: "composition" },
        stores: [
          { kind: "browser", namespace: "kuali" },
          { kind: "browser", namespace: "ucpath" },
          { kind: "browser", namespace: "new-kronos" },
          { kind: "headless", namespace: "workflow:separations" },
        ],
      },
      registryIndex: 1,
    });
  });

  it("keeps separations' node graph, omission plan, gate, and derived projections", () => {
    const projections = workflowProjections(separationsDescriptor);
    const omission = (requested: unknown) => {
      const plan = planStepOmissions(separationsDescriptor, StepOmissionsSchema.parse(requested));
      return {
        asserted: [...plan.asserted].map(([node, entry]) => ({ node, step: entry.step })),
        omitted: [...plan.omitted],
        refusals: plan.refusals,
      };
    };

    expect({
      graph: separationsDescriptor.nodes.map((node) => {
        const when = "when" in node ? node.when : undefined;
        return {
          id: String(node.id),
          kind: node.kind,
          dependsOn: node.dependsOn.map(String),
          ...(when === undefined ? {} : { when }),
          ...(node.kind === "transaction" ? { dryRun: node.dryRun } : {}),
        };
      }),
      omissions: {
        kronos: omission([{ step: "kronos-timecard", facts: { lastDayWorked: "08/02/2026", separationDate: "08/02/2026" } }]),
        ucpath: omission([{ step: "ucpath-transaction", facts: { transactionNumber: "T123456", approvalStatus: "Approved" } }]),
        kuali: omission([{ step: "kuali-finalization", facts: {} }]),
      },
      steps: workflowProjections(separationsDescriptor).steps.map(({ key, nodeId, label, kind, taskId, conditional }) => ({
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
      graph: [
        { id: "resolve-action", kind: "task", dependsOn: [] },
        { id: "document", kind: "task", dependsOn: ["resolve-action"] },
        { id: "plan", kind: "task", dependsOn: ["document"] },
        { id: "termination-type", kind: "task", dependsOn: ["document"] },
        { id: "name-search", kind: "task", dependsOn: ["plan"] },
        { id: "subject", kind: "task", dependsOn: ["document", "plan", "name-search"] },
        { id: "job-summary", kind: "task", dependsOn: ["subject"] },
        { id: "employment", kind: "task", dependsOn: ["document", "job-summary"] },
        { id: "department-option", kind: "task", dependsOn: ["document", "employment"] },
        { id: "timecard-search", kind: "task", dependsOn: ["subject"] },
        { id: "timecard", kind: "task", dependsOn: ["subject", "plan", "timecard-search"] },
        { id: "dates", kind: "task", dependsOn: ["plan", "timecard"] },
        { id: "comparison", kind: "task", dependsOn: ["document", "plan", "subject", "job-summary", "name-search", "termination-type", "department-option", "employment", "dates"] },
        { id: "identity-approval", kind: "gate", dependsOn: ["comparison"], when: { kind: "is-true", of: { from: "node", nodeId: "comparison", path: "approvalRequired" } } },
        { id: "approval", kind: "task", dependsOn: ["comparison", "identity-approval"] },
        { id: "pending-set", kind: "task", dependsOn: ["approval"] },
        { id: "clear-pending", kind: "transaction", dependsOn: ["approval", "pending-set"], dryRun: "stop-after-prepare" },
        { id: "file-termination", kind: "transaction", dependsOn: ["approval", "termination-type", "employment", "dates", "clear-pending"], dryRun: "stop-after-prepare" },
        { id: "receipt", kind: "task", dependsOn: ["approval", "dates", "file-termination"] },
        { id: "filing-presence", kind: "task", dependsOn: ["receipt"] },
        { id: "finalize-kuali", kind: "transaction", dependsOn: ["approval", "resolve-action", "document", "plan", "employment", "department-option", "dates", "receipt", "filing-presence"], dryRun: "stop-after-prepare" },
      ],
      omissions: {
        kronos: { asserted: [{ node: "dates", step: "kronos-timecard" }], omitted: [["timecard-search", "kronos-timecard"], ["timecard", "kronos-timecard"]], refusals: [] },
        ucpath: { asserted: [{ node: "receipt", step: "ucpath-transaction" }], omitted: [["pending-set", "ucpath-transaction"], ["clear-pending", "ucpath-transaction"], ["file-termination", "ucpath-transaction"]], refusals: [] },
        kuali: { asserted: [], omitted: [["filing-presence", "kuali-finalization"], ["finalize-kuali", "kuali-finalization"]], refusals: [] },
      },
      steps: [
        { key: "resolve-action", nodeId: "resolve-action", label: "Kuali Action", kind: "task", taskId: "kuali/search-separation-action", conditional: false },
        { key: "document", nodeId: "document", label: "Separation Document", kind: "task", taskId: "kuali/read-separation-document", conditional: false },
        { key: "plan", nodeId: "plan", label: "Separation Plan", kind: "task", taskId: "workflow:separations/read-separation-plan", conditional: false },
        { key: "termination-type", nodeId: "termination-type", label: "Termination Type", kind: "task", taskId: "workflow:separations/match-termination-type", conditional: false },
        { key: "name-search", nodeId: "name-search", label: "Name Search", kind: "task", taskId: "ucpath/search-person-org", conditional: false },
        { key: "subject", nodeId: "subject", label: "Separation Subject", kind: "task", taskId: "workflow:separations/match-separation-subject", conditional: false },
        { key: "job-summary", nodeId: "job-summary", label: "Job Summary", kind: "task", taskId: "ucpath/read-job-summary", conditional: false },
        { key: "employment", nodeId: "employment", label: "Employment", kind: "task", taskId: "workflow:separations/match-active-employment", conditional: false },
        { key: "department-option", nodeId: "department-option", label: "Department Option", kind: "task", taskId: "workflow:separations/match-department-option", conditional: false },
        { key: "timecard-search", nodeId: "timecard-search", label: "Timecard Search", kind: "task", taskId: "new-kronos/search-employee", conditional: false },
        { key: "timecard", nodeId: "timecard", label: "Timecard", kind: "task", taskId: "new-kronos/read-separation-timecard", conditional: false },
        { key: "dates", nodeId: "dates", label: "Reconciled Dates", kind: "task", taskId: "workflow:separations/read-separation-dates", conditional: false },
        { key: "comparison", nodeId: "comparison", label: "Identity Comparison", kind: "task", taskId: "workflow:separations/match-identity", conditional: false },
        { key: "identity-approval", nodeId: "identity-approval", label: "Identity Approval", kind: "gate", conditional: true },
        { key: "approval", nodeId: "approval", label: "Approval Check", kind: "task", taskId: "workflow:separations/verify-identity-approval", conditional: false },
        { key: "pending-set", nodeId: "pending-set", label: "Read Exact Pending Set", kind: "task", taskId: "ucpath/read-pending-termination-set", conditional: false },
        { key: "clear-pending/prepare", nodeId: "clear-pending", label: "Clear Pending Terminations — prepare", kind: "prepare", taskId: "ucpath/stage-pending-termination-sweep", conditional: false },
        { key: "clear-pending/commit", nodeId: "clear-pending", label: "Clear Pending Terminations — commit", kind: "commit", taskId: "ucpath/delete-pending-terminations", conditional: false },
        { key: "file-termination/prepare", nodeId: "file-termination", label: "File Termination — prepare", kind: "prepare", taskId: "ucpath/stage-termination", conditional: false },
        { key: "file-termination/commit", nodeId: "file-termination", label: "File Termination — commit", kind: "commit", taskId: "ucpath/create-termination", conditional: false },
        { key: "receipt", nodeId: "receipt", label: "Termination Receipt", kind: "task", taskId: "workflow:separations/verify-termination-receipt", conditional: false },
        { key: "filing-presence", nodeId: "filing-presence", label: "Verify Current UCPath Filing", kind: "task", taskId: "ucpath/verify-termination-filing-present", conditional: false },
        { key: "finalize-kuali/prepare", nodeId: "finalize-kuali", label: "Finalize Kuali Document — prepare", kind: "prepare", taskId: "kuali/stage-separation-finalization", conditional: false },
        { key: "finalize-kuali/commit", nodeId: "finalize-kuali", label: "Finalize Kuali Document — commit", kind: "commit", taskId: "kuali/save-separation-finalization", conditional: false },
      ],
      gates: [{ nodeId: "identity-approval", label: "Identity Approval", statusKey: "awaitingIdentityApproval", resolvedBy: "operator" }],
      systems: ["kuali", "new-kronos", "ucpath"],
      requires: [],
      contracts: [
        "kuali/search-separation-action", "kuali/read-separation-document", "workflow:separations/read-separation-plan",
        "workflow:separations/match-termination-type", "ucpath/search-person-org", "workflow:separations/match-separation-subject",
        "ucpath/read-job-summary", "workflow:separations/match-active-employment", "workflow:separations/match-department-option",
        "new-kronos/search-employee", "new-kronos/read-separation-timecard", "workflow:separations/read-separation-dates",
        "workflow:separations/match-identity", "workflow:separations/verify-identity-approval", "ucpath/read-pending-termination-set",
        "ucpath/stage-pending-termination-sweep", "ucpath/delete-pending-terminations", "ucpath/stage-termination",
        "ucpath/create-termination", "workflow:separations/verify-termination-receipt", "ucpath/verify-termination-filing-present",
        "kuali/stage-separation-finalization", "kuali/save-separation-finalization",
      ],
      dryRun: { state: "supported", stopsAt: "clear-pending" },
    });
  });
});
