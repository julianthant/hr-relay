import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { compileWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { descriptorRuntimeNodes, workflowTerminalResultExecution } from "../../../src/workflow-kit/workflow.js";
import { crmStore } from "../../../src/backend/systems/crm/task-registry.js";
import { createDeterministicCrmOnboardingDriver } from "../../../src/backend/systems/crm/driver/fake.js";
import { CrmReadHireData } from "../../../src/models/systems/crm/read-hire-data.js";
import { CrmReadOnboardingRecord } from "../../../src/models/systems/crm/read-onboarding-record.js";
import { CrmReadOnboardingDates } from "../../../src/models/systems/crm/read-onboarding-dates.js";
import { readHireDataTask } from "../../../src/backend/systems/crm/tasks/read-hire-data.js";
import { readHirePlanTask } from "../../../src/workflows/onboarding/tasks/read-hire-plan.js";
import { WORKFLOW_DESCRIPTORS } from "../../../src/workflows/descriptor-registry.js";
import { onboardingWorkflow, ONBOARDING_STEPS } from "../../../src/workflows/onboarding/workflow.js";
import { registration } from "../../../src/workflows/onboarding/index.js";
import { ONBOARDING_INPUT_EXAMPLE } from "../../../src/models/workflows/onboarding/input.js";
import { OnboardingReadHirePlan } from "../../../src/models/workflows/onboarding/read-hire-plan.js";
import { OnboardingReadI9ProfilePlan, OnboardingI9OutcomeSchema } from "../../../src/models/workflows/onboarding/i9-profile.js";
import { OnboardingReadI9Lookup } from "../../../src/models/workflows/onboarding/i9-profile.js";
import { OnboardingResultSchema } from "../../../src/models/workflows/onboarding/result.js";
import { I9LookupInputSchema, I9SignerOutputSchema } from "../../../src/models/systems/i9/read-section2-signer.js";
import { i9LookupInput, i9LookupItemId } from "../../../src/workflows/onboarding/tasks/lookup-i9.js";
import { readI9LookupTask } from "../../../src/workflows/onboarding/tasks/read-i9-profile.js";
import { TaskRefusal, createSeparationTaskFixtures } from "../../support/helpers/separation-task-fixtures.js";
import { UNREGISTERED_ONBOARDING_MODULES } from "../../support/fixtures/onboarding/unregistered-workflows.js";
import { DataPointSchema } from "../../../src/rules/workflow/task-provenance.js";

const descriptor = compileWorkflow(onboardingWorkflow).descriptor;
const nodes = descriptorRuntimeNodes(descriptor);
const plan = OnboardingReadHirePlan.output.parse(OnboardingReadHirePlan.example);

describe("unregistered onboarding workflow", () => {
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
    assert.equal(registration.exposure.kind, "unregistered");
    assert.equal(WORKFLOW_DESCRIPTORS.some(value => String(value.id) === "onboarding"), false);
    assert.equal(UNREGISTERED_ONBOARDING_MODULES.length, 5);
    assert.deepEqual(descriptor.timeline.map(step => step.key), ["crm-data", "ucpath-search", "i9-search", "i9-profile-creation"]);
    assert.deepEqual(onboardingWorkflow.steps.map(([, entries]) => entries.map(entry => entry.id)), [
      ["crm-source", "hire-plan"], ["ucpath-source", "hire-subject"], ["i9-lookup-child", "i9-lookup"], ["i9-profile-plan"],
    ]);
    for (const [index, proof] of registration.proofs.entries()) {
      assert.deepEqual(proof.definition.role, { kind: "chunk-harness", of: "onboarding", step: ONBOARDING_STEPS[index]?.key });
    }
    assert.equal(crmStore.tasks.readHireData.contract.id, "crm/read-hire-data");
    assert.ok(nodes.every(node => node.kind !== "transaction"));
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
