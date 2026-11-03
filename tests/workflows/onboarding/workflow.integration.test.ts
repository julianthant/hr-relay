import { createOnboardingWriteWorld } from "../../support/helpers/backend/onboarding-write-world.js";
import { RunDryRunPreviewResultSchema } from "../../../src/models/run/result.js";
import { DRY_RUN_I9_PROFILE_ID } from "../../../src/models/workflow/dry-run.js";
import { I9ProfileProofSchema, I9RemoteProofSchema, i9ProfileKey, i9RemoteKey } from "../../../src/models/ui/i9-creation.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
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
import { GateIdSchema, WorkflowIdSchema } from "../../../src/rules/identity/ids.js";

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
    assert.deepEqual(result.roster, ONBOARDING_INPUT_EXAMPLE.roster.row.binding);
  });
  it("has workflow-owned task calls, a harness for every timeline checkpoint and exact implementation bindings", () => {
    assert.deepEqual(registration.exposure, { kind: "public", order: 2 });
    assert.deepEqual(descriptor.requiredWorkbookTypeIds, ["onboarding-roster"]);
    const registered = workflowModuleOf("onboarding");
    assert.equal(WORKFLOW_DESCRIPTORS.find(value => String(value.id) === "onboarding"), registered.descriptor);
    assert.equal(childWorkflowModuleOf("onboarding", "i9-lookup").descriptor.id, "i9-lookup");
    assert.deepEqual(STEP_PROOF_MODULES.filter(module => module.role.kind === "chunk-harness" && module.role.of === "onboarding")
      .map(module => module.descriptor.id), registration.proofs.map(proof => proof.definition.id));
    assert.deepEqual(descriptor.timeline.map(step => step.key), ["crm-data", "ucpath-search", "i9-search", "i9-profile-creation"]);
    assert.deepEqual(onboardingWorkflow.steps.map(([, entries]) => entries.map(entry => entry.id)), [
      ["roster-choice", "crm-source", "hire-plan"], ["ucpath-source", "hire-subject"], ["i9-lookup-child", "i9-lookup"], ["i9-profile-plan"],
    ]);
    for (const [index, proof] of registration.proofs.entries()) {
      assert.deepEqual(proof.definition.role, { kind: "chunk-harness", of: "onboarding", step: descriptor.timeline[index]?.key });
    }
    assert.equal(onboardingWorkflow.steps[0]?.[1][1]?.contracts[0], CrmReadHireData);
    assert.equal(onboardingWorkflow.steps[1]?.[1][0]?.contracts[0], SearchPersonMatch);
    assert.equal(crmStore.tasks.readHireData.contract.id, "crm/read-hire-data");
    assert.ok(nodes.every(node => node.kind !== "transaction"));
  });

  it("preserves the read graph dependencies and exact task contracts", () => {
    assert.deepEqual(workflowExplorerDeclaration(onboardingWorkflow).flatMap(group => group.entries), [
      { id: "roster-choice", kind: "gate", nodeIds: ["roster-choice"], dependsOn: [], taskIds: [] },
      { id: "crm-source", kind: "task", nodeIds: ["crm-source"], dependsOn: ["roster-choice"], taskIds: ["crm/read-hire-data"] },
      { id: "hire-plan", kind: "task", nodeIds: ["hire-plan"], dependsOn: ["crm-source", "roster-choice"], taskIds: ["workflow:onboarding/read-hire-plan"] },
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
    const entryIds = ["roster-choice", "crm-source", "hire-plan", "ucpath-source", "hire-subject", "i9-lookup-child", "i9-lookup", "i9-profile-plan"];
    const proofSizes = [3, 5, 7, 8];
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
    assert.deepEqual(result.rosterAccess, { state: "snapshot-bound", owner: "spreadsheets" });
    assert.equal(result.i9.state, "creation-required");
    assert.match(descriptor.summary ?? "", /Read-only.*not yet available/u);
    assert.deepEqual(descriptor.outcomeProjection, { fieldPath: "state", cases: [
      { value: "implementation-incomplete", label: "Hire unavailable", tone: "warning" },
    ] });
    assert.ok(descriptor.details.some(detail => "kind" in detail.source && detail.source.kind === "result" && detail.source.fieldPath === "hireWrite.state"));
  });

  it("classifies registered inputs and every planning outcome without exposing SSNs in diagnostic evidence", () => {
    for (const proof of [{ definition: onboardingWorkflow }, ...registration.proofs]) {
      for (const leaf of evidenceLeaves({ decision: "selected", row: ONBOARDING_INPUT_EXAMPLE.roster.row })) {
        classifyEvidenceLeaf({ kind: "gate-result", workflowId: WorkflowIdSchema.parse(proof.definition.id), gateId: GateIdSchema.parse("roster-choice") }, leaf.path);
      }
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

const { harness, cleanup } = createOnboardingWriteWorld();
afterEach(cleanup);

it("onboarding/write-transactions — saves the profile and remote record through separate fenced, verified writes", async () => {
  const h = await harness(), run = await h.run();
  assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
  assert.deepEqual(h.driver.events.filter(event => event.startsWith("commit:")), ["commit:profile", "commit:remote"]);
  const intents = h.database.authority.writeIntents.listByRun(run.envelope.runId);
  assert.equal(intents.length, 2); assert.ok(intents.every(intent => intent.status === "committed"));
  assert.equal(h.driver.profiles.length, 1); assert.equal(h.driver.records.length, 1);
  assert.ok(h.captures.filter(value => value === "profile-create:step").length >= 11);
  assert.ok(h.captures.filter(value => value === "remote-create:step").length >= 6);
  assert.ok(h.captures.includes("profile-create:before-submit") && h.captures.includes("profile-create:after-submit"));
  assert.ok(h.captures.includes("remote-create:before-submit") && h.captures.includes("remote-create:after-submit"));
  const repeat = await h.run();
  assert.ok(repeat.lifecycle.state === "terminal" && repeat.lifecycle.outcome === "done");
  assert.equal(h.driver.events.filter(event => event.startsWith("commit:")).length, 2);
});

it("fills both preview forms with labelled numeric provenance and creates no write authority or master fill", async () => {
  const h = await harness(), run = await h.run(true);
  assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
  const result = h.database.authority.runResults.get(run.envelope.runId); assert.ok(result);
  const preview = RunDryRunPreviewResultSchema.parse(result.result.value);
  assert.deepEqual(preview.steps.map(step => step.state), ["transaction-preview", "transaction-preview"]);
  const remote = preview.steps.find(step => step.nodeId === "remote-create"); assert.ok(remote?.state === "transaction-preview");
  assert.deepEqual(remote.samples.map(sample => sample.value), [DRY_RUN_I9_PROFILE_ID]);
  assert.deepEqual(remote.preview.probe, { state: "not-required", reason: "preview-only-sample" });
  assert.equal(h.driver.events.includes("probe:remote"), false);
  assert.equal(h.driver.events.some(event => event.startsWith("commit:")), false);
  assert.deepEqual(h.driver.profiles, []); assert.deepEqual(h.driver.records, []);
  assert.deepEqual(h.database.authority.writeIntents.countDryRunEvidenceByRun(run.envelope.runId), { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
  assert.deepEqual(h.database.authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId), []);
  assert.deepEqual(h.database.authority.workbooks.runOperations(run.envelope.runId), []);
});

it("refuses a real numeric sample before opening a browser or probing, and rejects it as either completion proof", async () => {
  const h = await harness(), run = await h.run(false, { ...h.example, existingProfileId: DRY_RUN_I9_PROFILE_ID });
  assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed");
  assert.equal(h.database.authority.failures.listByRun(run.envelope.runId)[0]?.code, "DRY_RUN_SAMPLE_REFUSED");
  assert.deepEqual(h.driver.events, []);
  assert.deepEqual(h.database.authority.writeIntents.listByRun(run.envelope.runId), []);
  for (const [schema, proof] of [[I9ProfileProofSchema, { kind: "i9-profile", profileId: DRY_RUN_I9_PROFILE_ID,
    firstName: "Fixture", lastName: "Hire", dob: "2000-01-14", email: "hire@example.test", departmentNumber: "000412", source: "saved-profile-read" }],
  [I9RemoteProofSchema, { kind: "i9-remote-record", profileId: DRY_RUN_I9_PROFILE_ID, i9Id: "900002", startDate: "09/11/2026",
    email: "hire@example.test", source: "i9-record-read" }]] as const) assert.equal(schema.safeParse(proof).success, false);
});

for (const role of ["profile", "remote"] as const) it(`parks an UNKNOWN ${role} submit and refuses another unattended attempt`, async () => {
  const h = await harness({ [role === "profile" ? "profileSubmitFailure" : "remoteSubmitFailure"]: new Error("synthetic lost submit response") });
  const run = await h.run(); assert.equal(run.lifecycle.state, "parked-write");
  const key = role === "profile" ? i9ProfileKey(h.example) : i9RemoteKey({ ...h.example, profileId: "900001" });
  const intent = h.database.authority.writeIntents.findByPermanentKey("i9", key); assert.equal(intent?.status, "parked");
  assert.equal(intent?.generation, 1);
  const clicks = h.driver.events.filter(event => event.startsWith("commit:")).length;
  const repeated = await h.run();
  assert.ok(repeated.lifecycle.state === "terminal" && repeated.lifecycle.outcome === "failed");
  assert.equal(h.driver.events.filter(event => event.startsWith("commit:")).length, clicks);
  assert.equal(h.database.authority.writeIntents.findByPermanentKey("i9", key)?.generation, 1);
});

it("files the hire through the sequencer after both I-9 receipts and reuses all three saved effects", async () => {
  const h = await harness({}, {}), run = await h.run();
  assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done", JSON.stringify({ lifecycle: run.lifecycle, failures: h.database.authority.failures.listByRun(run.envelope.runId), intents: h.database.authority.writeIntents.listByRun(run.envelope.runId) }));
  assert.equal(h.database.authority.writeIntents.listByRun(run.envelope.runId).length, 3);
  assert.deepEqual(h.hire.events.filter(event => event === "commit:hire"), ["commit:hire"]);
  assert.ok(h.captures.filter(value => value === "hire-create:step").length >= 30);
  assert.ok(h.captures.includes("hire-create:before-submit") && h.captures.includes("hire-create:after-submit"));
  const again = await h.run(); assert.ok(again.lifecycle.state === "terminal" && again.lifecycle.outcome === "done");
  assert.equal(h.hire.events.filter(event => event === "commit:hire").length, 1);
  assert.equal(h.hire.rows[0]?.approvalStatus, "Pending");
});

it("previews the entire three-write sequence with a labelled Tracker Profile ID and no authoritative sample probe", async () => {
  const h = await harness({}, {}), run = await h.run(true);
  assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
  const result = h.database.authority.runResults.get(run.envelope.runId); assert.ok(result);
  const preview = RunDryRunPreviewResultSchema.parse(result.result.value);
  assert.deepEqual(preview.steps.map(step => step.state), ["transaction-preview", "transaction-preview", "transaction-preview"]);
  const hire = preview.steps.find(step => step.nodeId === "hire-create"); assert.ok(hire?.state === "transaction-preview");
  assert.equal(hire.samples[0]?.value, DRY_RUN_I9_PROFILE_ID);
  assert.equal(hire.samples[0]?.field, "Tracker Profile ID");
  assert.deepEqual(hire.preview.probe, { state: "not-required", reason: "preview-only-sample" });
  assert.equal(h.hire.events.includes("probe:hire"), false); assert.equal(h.hire.events.includes("commit:hire"), false);
  assert.deepEqual(h.hire.rows, []);
  assert.deepEqual(h.database.authority.writeIntents.countDryRunEvidenceByRun(run.envelope.runId), { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
  assert.deepEqual(h.database.authority.workbooks.runOperations(run.envelope.runId), []);
});

for (const fault of [{ submitFailure: new Error("synthetic lost hire response") }, { approvalStatus: "Denied" as const }]) {
  it(`parks an unproved hire submission (${fault.approvalStatus ?? "lost response"}) without a second submit`, async () => {
    const h = await harness({}, fault), run = await h.run();
    assert.equal(run.lifecycle.state, "parked-write");
    assert.equal(h.hire.events.filter(event => event === "commit:hire").length, 1);
    const retry = await h.run(); assert.ok(retry.lifecycle.state === "terminal" && retry.lifecycle.outcome === "failed");
    assert.equal(h.hire.events.filter(event => event === "commit:hire").length, 1);
    const parked = h.database.authority.writeIntents.listByRun(run.envelope.runId).filter(intent => intent.status === "parked");
    assert.equal(parked.length, 1); assert.equal(parked[0]?.generation, 1);
  });
}
