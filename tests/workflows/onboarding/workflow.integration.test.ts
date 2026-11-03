import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { compileWorkflow, workflowExplorerDeclaration } from "../../../src/workflow-kit/workflow-definition.js";
import { descriptorRuntimeNodes, workflowTerminalResultExecution } from "../../../src/workflow-kit/workflow.js";
import { crmStore } from "../../../src/backend/systems/crm/task-registry.js";
import { createDeterministicCrmOnboardingDriver } from "../../../src/backend/systems/crm/driver/fake.js";
import { CrmReadHireData } from "../../../src/models/systems/crm/read-hire-data.js";
import { CrmReadOnboardingRecord } from "../../../src/models/systems/crm/read-onboarding-record.js";
import { CrmReadOnboardingDates } from "../../../src/models/systems/crm/read-onboarding-dates.js";
import { readHireDataTask } from "../../../src/backend/systems/crm/tasks/read-hire-data.js";
import { readHirePlanTask } from "../../../src/workflows/onboarding/tasks/read-hire-plan.js";
import { WORKFLOW_DESCRIPTORS } from "../../../src/workflows/descriptor-registry.js";
import { onboardingWorkflow } from "../../../src/workflows/onboarding/workflow.js";
import { i9LookupInput, i9LookupItemId } from "../../../src/workflows/onboarding/steps/i9-search/step.js";
import { SearchPersonMatch } from "../../../src/models/systems/ucpath/search-person-match.js";
import { registration } from "../../../src/workflows/onboarding/index.js";
import { childWorkflowModuleOf, workflowModuleOf } from "../../../src/backend/app/registries/workflow-registry.js";
import { STEP_PROOF_MODULES } from "../../../src/backend/app/registries/step-proof-modules.js";
import { ONBOARDING_INPUT_EXAMPLE } from "../../../src/models/workflows/onboarding/input.js";
import { OnboardingReadHirePlan } from "../../../src/models/workflows/onboarding/read-hire-plan.js";
import { OnboardingReadI9ProfilePlan } from "../../../src/models/workflows/onboarding/read-i9-profile-plan.js";
import { OnboardingReadI9Lookup, OnboardingI9OutcomeSchema } from "../../../src/models/workflows/onboarding/read-i9-lookup.js";
import { OnboardingResultSchema } from "../../../src/models/workflows/onboarding/result.js";
import { I9LookupInputSchema, I9SignerOutputSchema } from "../../../src/models/systems/i9/read-section2-signer.js";
import { readI9LookupTask } from "../../../src/workflows/onboarding/tasks/read-i9-lookup.js";
import { TaskRefusal, createSeparationTaskFixtures } from "../../support/helpers/separation-task-fixtures.js";
import { classifyEvidenceLeaf, evidenceLeaves, redactEvidenceLeaf } from "../../../src/models/trust/evidence-classification.js";
import { DataPointSchema } from "../../../src/rules/workflow/task-provenance.js";
import { WorkflowIdSchema } from "../../../src/rules/identity/ids.js";

const descriptor = compileWorkflow(onboardingWorkflow).descriptor;
const nodes = descriptorRuntimeNodes(descriptor);
const plan = OnboardingReadHirePlan.output.parse(OnboardingReadHirePlan.example);

describe("read-only onboarding workflow", () => {
  it("onboarding/crm-extraction — binds the real CRM task output to the snapshot-backed hire plan", async () => {
    const source = nodes.find(node => node.id === "crm-source");
    const planNode = nodes.find(node => node.id === "hire-plan");
    assert.ok(source?.kind === "task" && planNode?.kind === "task");
    const driver = createDeterministicCrmOnboardingDriver({ record: CrmReadOnboardingRecord.example,
      dates: CrmReadOnboardingDates.example, hireData: CrmReadHireData.example });
    const read = await readHireDataTask.impl.run({ input: CrmReadHireData.input.parse(source.bind({ input: ONBOARDING_INPUT_EXAMPLE, outputs: {} })),
      ctx: { driver, signal: new AbortController().signal,
        log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
        captureScreenshot: async () => { throw new Error("CRM fixture has no screenshot surface"); },
        fail: (code: string, message: string): never => { throw new TaskRefusal(code, message); },
        recordData: points => { for (const point of Array.isArray(points) ? points : [points]) DataPointSchema.parse(point); },
      } });
    const planContext = createSeparationTaskFixtures().taskContext();
    const result = await readHirePlanTask.impl.run({ input: OnboardingReadHirePlan.input.parse(planNode.bind({ input: ONBOARDING_INPUT_EXAMPLE,
      outputs: { "crm-source": read } })), ctx: planContext.ctx });
    assert.deepEqual(result, plan);
    assert.deepEqual(result.roster, ONBOARDING_INPUT_EXAMPLE.roster.binding);
  });
  it("has workflow-owned task calls, a harness for every timeline checkpoint and exact implementation bindings", () => {
    assert.deepEqual(registration.exposure, { kind: "public", order: 2 });
    const registered = workflowModuleOf("onboarding");
    assert.equal(WORKFLOW_DESCRIPTORS.find(value => String(value.id) === "onboarding"), registered.descriptor);
    assert.equal(childWorkflowModuleOf("onboarding", "i9-lookup").descriptor.id, "i9-lookup");
    assert.deepEqual(STEP_PROOF_MODULES.filter(module => module.role.kind === "chunk-harness" && module.role.of === "onboarding")
      .map(module => module.descriptor.id), registration.proofs.map(proof => proof.definition.id));
    assert.deepEqual(descriptor.timeline.map(step => step.key), ["crm-data", "ucpath-search", "i9-search", "i9-profile-creation"]);
    assert.deepEqual(onboardingWorkflow.steps.map(([, entries]) => entries.map(entry => entry.id)), [
      ["crm-source", "hire-plan"], ["ucpath-source", "hire-subject"], ["i9-lookup-child", "i9-lookup"], ["i9-profile-plan"],
    ]);
    for (const [index, proof] of registration.proofs.entries()) {
      assert.deepEqual(proof.definition.role, { kind: "chunk-harness", of: "onboarding", step: descriptor.timeline[index]?.key });
    }
    assert.equal(onboardingWorkflow.steps[0]?.[1][0]?.contracts[0], CrmReadHireData);
    assert.equal(onboardingWorkflow.steps[1]?.[1][0]?.contracts[0], SearchPersonMatch);
    assert.equal(crmStore.tasks.readHireData.contract.id, "crm/read-hire-data");
    assert.ok(nodes.every(node => node.kind !== "transaction"));
  });

  it("preserves the read graph dependencies and exact task contracts", () => {
    assert.deepEqual(workflowExplorerDeclaration(onboardingWorkflow).flatMap(group => group.entries), [
      { id: "crm-source", kind: "task", nodeIds: ["crm-source"], dependsOn: [], taskIds: ["crm/read-hire-data"] },
      { id: "hire-plan", kind: "task", nodeIds: ["hire-plan"], dependsOn: ["crm-source"], taskIds: ["workflow:onboarding/read-hire-plan"] },
      { id: "ucpath-source", kind: "task", nodeIds: ["ucpath-source"], dependsOn: ["hire-plan"], taskIds: ["ucpath/search-person-match"] },
      { id: "hire-subject", kind: "task", nodeIds: ["hire-subject"], dependsOn: ["hire-plan", "ucpath-source"], taskIds: ["workflow:onboarding/match-hire-subject"] },
      { id: "i9-lookup-child", kind: "delegate", nodeIds: ["i9-lookup-child"], dependsOn: ["hire-plan", "hire-subject"], taskIds: [] },
      { id: "i9-lookup", kind: "task", nodeIds: ["i9-lookup"], dependsOn: ["hire-plan", "hire-subject", "i9-lookup-child"], taskIds: ["workflow:onboarding/read-i9-lookup"] },
      { id: "i9-profile-plan", kind: "task", nodeIds: ["i9-profile-plan"], dependsOn: ["hire-plan", "i9-lookup"], taskIds: ["workflow:onboarding/read-i9-profile-plan"] },
    ]);
    assert.deepEqual(onboardingWorkflow.result.references.map(reference => reference.id), ["hire-plan", "hire-subject", "i9-profile-plan"]);
  });

  it("preserves proof identities, shared ingress and every safety prerequisite", () => {
    assert.deepEqual(registration.proofs.map(proof => [proof.definition.id, proof.definition.code, proof.order]), [
      ["onboarding-crm-data", "onc", 15], ["onboarding-ucpath-search", "onu", 16],
      ["onboarding-i9-search", "onis", 17], ["onboarding-i9-profile-creation", "onip", 18],
    ]);
    const entryIds = ["crm-source", "hire-plan", "ucpath-source", "hire-subject", "i9-lookup-child", "i9-lookup", "i9-profile-plan"];
    const proofSizes = [2, 4, 6, 7];
    const targets = ["hire-plan", "hire-subject", "i9-lookup", "i9-profile-plan"];
    for (const [index, proof] of registration.proofs.entries()) {
      assert.equal(proof.definition.input, onboardingWorkflow.input);
      assert.equal(proof.definition.canonicalInput, onboardingWorkflow.canonicalInput);
      assert.deepEqual(proof.definition.steps.flatMap(([, entries]) => entries.map(entry => entry.id)), entryIds.slice(0, proofSizes[index]));
      assert.deepEqual(proof.definition.result.references.map(reference => reference.id), [targets[index]]);
    }
  });

  it("delegates only new hires to the actual I-9 child schemas using snapshot legal names", () => {
    const child = nodes.find(node => node.id === "i9-lookup-child");
    assert.ok(child?.kind === "child-run" && child.cardinality === "many");
    assert.equal(child.target.id, "i9-lookup");
    assert.equal(child.target.input, I9LookupInputSchema);
    assert.equal(child.target.result, I9SignerOutputSchema);
    assert.equal(child.await, "terminal");
    assert.equal(child.join, "all-settled");
    const input = ONBOARDING_INPUT_EXAMPLE;
    const planned = { ...plan, employee: { ...plan.employee, firstName: "Legal", preferredFirstName: "Lived" } };
    assert.deepEqual(child.bind({ input, outputs: { "hire-plan": planned, "hire-subject": { state: "new-hire", candidateEids: [] } } }),
      [{ firstName: "Legal", lastName: "Hire" }]);
    assert.deepEqual(child.bind({ input, outputs: { "hire-plan": planned, "hire-subject": {
      state: "review-required", candidates: [{ emplId: "10800000", name: "Hire, Other" }],
    } } }), []);
    const request = i9LookupInput(planned);
    assert.equal(child.deriveChildItemId(request, { canonicalItemId: i9LookupItemId(request) }), i9LookupItemId(request));
  });

  it("keeps all write results explicitly unimplemented in its terminal declaration", () => {
    const subject = { state: "new-hire", candidateEids: [] };
    const terminal = workflowTerminalResultExecution(descriptor);
    const result = OnboardingResultSchema.parse(terminal.derive({ input: ONBOARDING_INPUT_EXAMPLE, outputs: {
      "hire-plan": plan, "hire-subject": subject, "i9-profile-plan": OnboardingReadI9ProfilePlan.example,
    } }));
    assert.equal(result.state, "implementation-incomplete");
    assert.deepEqual(result.hireWrite, { state: "unimplemented", owner: "write-safety" });
    assert.deepEqual(result.rosterAccess, { state: "unimplemented", owner: "spreadsheets" });
    assert.equal(result.i9.state, "creation-required");
    assert.match(descriptor.summary ?? "", /Read-only.*not yet available/u);
    assert.deepEqual(descriptor.outcomeProjection, { fieldPath: "state", cases: [
      { value: "implementation-incomplete", label: "Hire unavailable", tone: "warning" },
    ] });
    assert.ok(descriptor.details.some(detail => "kind" in detail.source && detail.source.kind === "result" && detail.source.fieldPath === "hireWrite.state"));
  });

  it("classifies registered inputs and every planning outcome without exposing SSNs in diagnostic evidence", () => {
    for (const proof of [{ definition: onboardingWorkflow }, ...registration.proofs]) {
      for (const leaf of evidenceLeaves(ONBOARDING_INPUT_EXAMPLE)) {
        classifyEvidenceLeaf({ kind: "workflow-input", workflowId: WorkflowIdSchema.parse(proof.definition.id) }, leaf.path);
      }
    }
    const terminal = workflowTerminalResultExecution(descriptor);
    const outcomes = [
      OnboardingReadI9ProfilePlan.example,
      { state: "not-required", subjectState: "existing-person" },
      { state: "existing-profile", profileId: "900001", i9Status: "signed" },
      { state: "review-required", reason: "lookup-restricted" },
    ];
    for (const i9 of outcomes) {
      const result = terminal.derive({ input: ONBOARDING_INPUT_EXAMPLE, outputs: {
        "hire-plan": plan, "hire-subject": { state: "new-hire", candidateEids: [] }, "i9-profile-plan": i9,
      } });
      for (const leaf of evidenceLeaves(result)) classifyEvidenceLeaf({ kind: "workflow-result", workflowId: descriptor.id }, leaf.path);
    }
    const ssn = "123456789";
    const redacted = redactEvidenceLeaf({ kind: "task-output", taskId: OnboardingReadHirePlan.id },
      { path: "employee.ssn", field: "ssn", value: ssn });
    assert.equal(JSON.stringify(redacted).includes(ssn), false);
  });

  it("records exact successful child observations and refuses failure without recording absence", async () => {
    const { taskContext } = createSeparationTaskFixtures();
    const expectedItemId = i9LookupItemId(i9LookupInput(plan));
    const subject = { state: "new-hire" as const, candidateEids: [] };
    const outcome = OnboardingI9OutcomeSchema.parse({ state: "done", runId: "aaaaaaaa-0001-4000-8000-000100000001",
      itemId: expectedItemId, output: { i9Status: "not-found", signerName: "" } });
    const good = taskContext();
    const output = await readI9LookupTask.impl.run({ input: { subject, expectedItemId, outcomes: [outcome] }, ctx: good.ctx });
    assert.deepEqual(output, OnboardingReadI9Lookup.example);
    assert.deepEqual(Object.fromEntries(good.records.map(point => [point.field, point.value])), output);
    const bad = taskContext();
    await assert.rejects(readI9LookupTask.impl.run({ input: { subject, expectedItemId, outcomes: [] }, ctx: bad.ctx }),
      error => error instanceof TaskRefusal && error.code === "ONBOARDING_I9_LOOKUP_UNRESOLVED");
    assert.deepEqual(bad.records, []);
  });
});
