import { OnboardingReadWritePlan } from "../../../src/models/workflows/onboarding/read-write-plan.js";
import { ONBOARDING_ROSTER_FIELDS } from "../../../src/models/workflows/onboarding/roster.js";
import { createOnboardingRunWorld } from "../../support/helpers/backend/onboarding-run-world.js";
import { buildRunGate } from "../../../src/backend/runs/queries/run-trust.js";
import { buildRunDetail, resolveGateArmAnswer } from "../../../src/backend/runs/queries/run-detail.js";
import { GateArmAnswerRequestSchema } from "../../../src/rules/commands/commands.js";
import { randomUUID } from "node:crypto";
import type { RunDetailQueryDeps } from "../../../src/backend/runs/queries/run-detail.js";
import { testRunService } from "../../support/fixtures/run-lifecycle-fixtures.js";
import { GateDecisionWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { UCPATH_HIRE_PROOF_EXAMPLE } from "../../../src/models/ui/ucpath-hire.js";
import { I9CreateRemoteRecord } from "../../../src/models/systems/i9/create-remote-record.js";
import { createOnboardingWriteWorld } from "../../support/helpers/backend/onboarding-write-world.js";
import { RunDryRunPreviewResultSchema } from "../../../src/models/run/result.js";
import { DRY_RUN_I9_PROFILE_ID } from "../../../src/models/workflow/dry-run.js";
import { I9ProfileProofSchema, I9RemoteProofSchema, i9ProfileKey, i9RemoteKey } from "../../../src/models/ui/i9-creation.js";
import assert from "node:assert/strict";
import { afterAll, afterEach, describe, it } from "vitest";
import { compileWorkflow, workflowExplorerDeclaration } from "../../../src/workflow-kit/workflow-definition.js";
import { descriptorRuntimeNodes, workflowTerminalResultExecution } from "../../../src/workflow-kit/workflow.js";
import { crmStore } from "../../../src/backend/systems/crm/task-registry.js";
import { createDeterministicCrmOnboardingDriver } from "../../../src/backend/systems/crm/driver/fake.js";
import { CrmReadHireData } from "../../../src/models/systems/crm/read-hire-data.js";
import { CrmReadOnboardingRecord } from "../../../src/models/systems/crm/read-onboarding-record.js";
import { CrmReadOnboardingDates } from "../../../src/models/systems/crm/read-onboarding-dates.js";
import { readHireDataTask } from "../../../src/backend/systems/crm/tasks/read-hire-data.js";
import { readHirePlanTask } from "../../../src/workflows/onboarding/tasks/read-hire-plan.js";
import { onboardingWorkflow } from "../../../src/workflows/onboarding/workflow.js";
import { i9LookupInput, i9LookupItemId } from "../../../src/workflows/onboarding/steps/i9-search/step.js";
import { SearchPersonMatch, SearchPersonMatchOutputSchema } from "../../../src/models/systems/ucpath/search-person-match.js";
import { registration } from "../../../src/workflows/onboarding/index.js";
import { PUBLIC_WORKFLOWS } from "../../../src/workflows/registry.js";
import { DESCRIPTORS, childWorkflowModuleOf, workflowModuleOf } from "../../../src/backend/app/registries/workflow-registry.js";
import { STEP_PROOF_MODULES } from "../../../src/backend/app/registries/step-proof-modules.js";
import { ONBOARDING_INPUT_EXAMPLE } from "../../../src/models/workflows/onboarding/input.js";
import { OnboardingReadHirePlan } from "../../../src/models/workflows/onboarding/read-hire-plan.js";
import { OnboardingReadI9ProfilePlan } from "../../../src/models/workflows/onboarding/read-i9-profile-plan.js";
import { OnboardingReadI9Lookup, OnboardingI9OutcomeSchema } from "../../../src/models/workflows/onboarding/read-i9-lookup.js";
import { OnboardingResultSchema } from "../../../src/models/workflows/onboarding/result.js";
import { I9LookupInputSchema, I9SignerOutputSchema, I9RecordIdsSchema } from "../../../src/models/systems/i9/read-section2-signer.js";
import { readI9LookupTask } from "../../../src/workflows/onboarding/tasks/read-i9-lookup.js";
import { TaskRefusal, createSeparationTaskFixtures } from "../../support/helpers/separation-task-fixtures.js";
import { classifyEvidenceLeaf, evidenceLeaves, redactEvidenceLeaf } from "../../../src/models/trust/evidence-classification.js";
import { DataPointSchema } from "../../../src/rules/workflow/task-provenance.js";
import { FingerprintSchema, GateIdSchema, WorkflowIdSchema } from "../../../src/rules/identity/ids.js";
import { createOperatorProjection, createOperatorRunDetail } from "../../../src/backend/app/composition/dashboard/operator.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";

const descriptor = compileWorkflow(onboardingWorkflow).descriptor;
const nodes = descriptorRuntimeNodes(descriptor);
const plan = OnboardingReadHirePlan.output.parse(OnboardingReadHirePlan.example);

describe("onboarding workflow", () => {
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
    assert.ok(PUBLIC_WORKFLOWS.includes(registration));
    assert.deepEqual(descriptor.requiredWorkbookFields, [...ONBOARDING_ROSTER_FIELDS]);
    assert.deepEqual(onboardingWorkflow.requiredWorkbookFields, ["email", "fullName", "livedName", "eid", "transactionNumber"]);
    assert.deepEqual(onboardingWorkflow.workbookReference?.writableFields, ["eid", "transactionNumber"]);
    const registered = workflowModuleOf("onboarding");
    assert.equal(DESCRIPTORS.find(value => String(value.id) === "onboarding"), registered.descriptor);
    assert.equal(childWorkflowModuleOf("onboarding", "i9-lookup").descriptor.id, "i9-lookup");
    assert.deepEqual(STEP_PROOF_MODULES.filter(module => module.role.kind === "chunk-harness" && module.role.of === "onboarding")
      .map(module => module.descriptor.id), registration.proofs.map(proof => proof.definition.id));
    assert.deepEqual(descriptor.timeline.map(step => step.key), ["crm-data", "ucpath-search", "i9-search", "hire-review", "i9-creation", "ucpath-hire", "master-results"]);
    assert.deepEqual(onboardingWorkflow.steps.map(([, entries]) => entries.map(entry => entry.id)), [
      ["roster-choice", "crm-source", "hire-plan"], ["ucpath-source", "hire-subject"], ["i9-lookup-child", "i9-lookup"], ["hire-findings", "hire-review"],
      ["write-plan", "i9-route", "i9-profile-plan", "i9-profile-save", "i9-remote-create"], ["hire-create", "hire-receipt", "concurrent-hire-create", "concurrent-hire-receipt"], ["master-results", "concurrent-master-results"],
    ]);
    for (const [index, proof] of registration.proofs.entries()) {
      assert.deepEqual(proof.definition.role, { kind: "chunk-harness", of: "onboarding", step: ["crm-data", "ucpath-search", "i9-search", "hire-review"][index] });
    }
    assert.equal(onboardingWorkflow.steps[0]?.[1][1]?.contracts[0], CrmReadHireData);
    assert.equal(onboardingWorkflow.steps[1]?.[1][0]?.contracts[0], SearchPersonMatch);
    assert.equal(crmStore.tasks.readHireData.contract.id, "crm/read-hire-data");
    assert.deepEqual(nodes.filter(node => node.kind === "transaction").map(node => node.commit.uses.id), ["i9/create-profile", "i9/create-remote-record", "ucpath/create-hire", "ucpath/create-hire"]);
  });

  it("pins the reviewed graph dependencies and exact task contracts", () => {
    assert.deepEqual(workflowExplorerDeclaration(onboardingWorkflow).flatMap(group => group.entries), [
      { id: "roster-choice", kind: "gate", nodeIds: ["roster-choice"], dependsOn: [], taskIds: [] },
      { id: "crm-source", kind: "task", nodeIds: ["crm-source"], dependsOn: ["roster-choice"], taskIds: ["crm/read-hire-data"] },
      { id: "hire-plan", kind: "task", nodeIds: ["hire-plan"], dependsOn: ["crm-source", "roster-choice"], taskIds: ["workflow:onboarding/read-hire-plan"] },
      { id: "ucpath-source", kind: "task", nodeIds: ["ucpath-source"], dependsOn: ["hire-plan"], taskIds: ["ucpath/search-person-match"] },
      { id: "hire-subject", kind: "task", nodeIds: ["hire-subject"], dependsOn: ["hire-plan", "ucpath-source"], taskIds: ["workflow:onboarding/match-hire-subject"] },
      { id: "i9-lookup-child", kind: "delegate", nodeIds: ["i9-lookup-child"], dependsOn: ["hire-plan", "ucpath-source", "hire-subject"], taskIds: [] },
      { id: "i9-lookup", kind: "task", nodeIds: ["i9-lookup"], dependsOn: ["hire-plan", "hire-subject", "i9-lookup-child"], taskIds: ["workflow:onboarding/read-i9-lookup"] },
      { id: "hire-findings", kind: "task", nodeIds: ["hire-findings"], dependsOn: ["hire-plan", "hire-subject", "i9-lookup"], taskIds: ["ucpath/read-hire-findings"] },
      { id: "hire-review", kind: "gate", nodeIds: ["hire-review"], dependsOn: ["hire-plan", "ucpath-source", "hire-subject", "i9-lookup", "hire-findings"], taskIds: [] },
      { id: "write-plan", kind: "task", nodeIds: ["write-plan"], dependsOn: ["hire-plan", "ucpath-source", "hire-subject", "i9-lookup", "hire-findings", "hire-review"], taskIds: ["workflow:onboarding/read-write-plan"] },
      { id: "i9-route", kind: "branch", nodeIds: ["i9-route"], dependsOn: ["write-plan"], taskIds: [] },
      { id: "i9-profile-plan", kind: "task", nodeIds: ["i9-profile-plan"], dependsOn: ["hire-plan", "i9-lookup", "write-plan"], taskIds: ["workflow:onboarding/read-i9-profile-plan"] },
      { id: "i9-profile-save", kind: "transaction", nodeIds: ["i9-profile-save"], dependsOn: ["write-plan", "hire-review"], taskIds: ["i9/stage-profile", "i9/create-profile"] },
      { id: "i9-remote-create", kind: "transaction", nodeIds: ["i9-remote-create"], dependsOn: ["write-plan", "i9-profile-save"], taskIds: ["i9/stage-remote-record", "i9/create-remote-record"] },
      { id: "hire-create", kind: "transaction", nodeIds: ["hire-create"], dependsOn: ["write-plan", "hire-review", "i9-profile-save", "i9-remote-create"], taskIds: ["ucpath/stage-hire", "ucpath/create-hire"] },
      { id: "hire-receipt", kind: "task", nodeIds: ["hire-receipt"], dependsOn: ["write-plan", "hire-create"], taskIds: ["ucpath/read-hire-receipt"] },
      { id: "concurrent-hire-create", kind: "transaction", nodeIds: ["concurrent-hire-create"], dependsOn: ["write-plan", "hire-review", "i9-profile-plan"], taskIds: ["ucpath/stage-hire", "ucpath/create-hire"] },
      { id: "concurrent-hire-receipt", kind: "task", nodeIds: ["concurrent-hire-receipt"], dependsOn: ["write-plan", "concurrent-hire-create"], taskIds: ["ucpath/read-hire-receipt"] },
      { id: "master-results", kind: "task", nodeIds: ["master-results"], dependsOn: ["write-plan", "hire-receipt", "i9-remote-create"], taskIds: ["workbooks/read-result"] },
      { id: "concurrent-master-results", kind: "task", nodeIds: ["concurrent-master-results"], dependsOn: ["write-plan", "concurrent-hire-receipt"], taskIds: ["workbooks/read-result"] },
    ]);
    assert.deepEqual(onboardingWorkflow.result.references.map(reference => reference.id), ["hire-plan", "write-plan", "hire-review", "hire-create", "hire-receipt", "i9-remote-create", "master-results", "concurrent-hire-create", "concurrent-hire-receipt", "concurrent-master-results"]);
  });

  it("preserves proof identities, shared ingress and every safety prerequisite", () => {
    assert.deepEqual(registration.proofs.map(proof => [proof.definition.id, proof.definition.code, proof.order]), [
      ["onboarding-crm-data", "onc", 15], ["onboarding-ucpath-search", "onu", 16],
      ["onboarding-i9-search", "onis", 17], ["onboarding-hire-writes", "onhw", 18],
    ]);
    const entryIds = ["roster-choice", "crm-source", "hire-plan", "ucpath-source", "hire-subject", "i9-lookup-child", "i9-lookup", "i9-profile-plan"];
    const proofSizes = [3, 5, 7, 8];
    const targets = ["hire-plan", "hire-subject", "i9-lookup", "i9-profile-plan"];
    for (const [index, proof] of registration.proofs.entries()) {
      assert.equal(proof.definition.input, onboardingWorkflow.input);
      assert.equal(proof.definition.canonicalInput, onboardingWorkflow.canonicalInput);
      assert.deepEqual(proof.definition.steps.flatMap(([, entries]) => entries.map(entry => entry.id)), index === 3
        ? onboardingWorkflow.steps.flatMap(([, entries]) => entries.map(entry => entry.id)) : entryIds.slice(0, proofSizes[index]));
      assert.deepEqual(proof.definition.result.references.map(reference => reference.id), index === 3
        ? onboardingWorkflow.result.references.map(reference => reference.id) : [targets[index]]);
    }
  });

  it("delegates the I-9 lookup whenever a new hire is still possible, using snapshot legal names", () => {
    const child = nodes.find(node => node.id === "i9-lookup-child");
    assert.ok(child?.kind === "child-run" && child.cardinality === "many");
    assert.equal(child.target.id, "i9-lookup");
    assert.equal(child.target.input, I9LookupInputSchema);
    assert.equal(child.target.result, I9SignerOutputSchema);
    assert.equal(child.await, "terminal");
    assert.equal(child.join, "all-settled");
    const input = ONBOARDING_INPUT_EXAMPLE;
    const planned = { ...plan, employee: { ...plan.employee, firstName: "Legal", preferredFirstName: "Lived" } };
    const other = { emplId: "10800000", name: "Hire, Other" };
    const bind = (match: unknown, mode: "new-hire" | "rehire" = "new-hire") => child.bind({ input: { ...input, mode }, outputs: { "hire-plan": planned, "ucpath-source": SearchPersonMatchOutputSchema.parse(match) } });
    assert.deepEqual(bind({ hits: [], confirmed: [], dropped: [] }), [{ firstName: "Legal", lastName: "Hire" }]);
    const dropped = { hits: [other], confirmed: [], dropped: [{ ...other, reason: "Last name does not match" }] };
    assert.deepEqual(bind(dropped), [{ firstName: "Legal", lastName: "Hire" }], "an all-dropped match may still become a new hire");
    assert.deepEqual(bind(dropped, "rehire"), []);
    assert.deepEqual(bind({ hits: [other], confirmed: [other], dropped: [] }), []);
    const request = i9LookupInput(planned);
    assert.equal(child.deriveChildItemId(request, { canonicalItemId: i9LookupItemId(request) }), i9LookupItemId(request));
  });

  it("derives completion from independent receipts and the actual master write disposition", () => {
    const terminal = workflowTerminalResultExecution(descriptor);
    const outputs = {
      "hire-plan": plan, "write-plan": OnboardingReadWritePlan.example, "hire-review": { decision: "new-hire", ruledOut: [] },
      "hire-create": { disposition: "committed", output: { receipt: UCPATH_HIRE_PROOF_EXAMPLE } },
      "hire-receipt": UCPATH_HIRE_PROOF_EXAMPLE, "i9-remote-create": { output: I9CreateRemoteRecord.example },
      "master-results": { state: "recorded", operationId: "results", libraryId: "master", version: 2, receiptState: "applied" },
    };
    const derive = (value: typeof outputs) => OnboardingResultSchema.parse(terminal.derive({ input: ONBOARDING_INPUT_EXAMPLE, outputs: value }));
    const result = derive(outputs);
    assert.equal(result.state, "filed"); assert.equal(result.hireWrite.receipt.transactionId, UCPATH_HIRE_PROOF_EXAMPLE.transactionId);
    assert.equal(result.i9.state, "verified");
    assert.equal(derive({ ...outputs, "master-results": { ...outputs["master-results"], receiptState: "resolve-required" } }).state, "master-review-required");
    assert.throws(() => OnboardingResultSchema.parse(terminal.derive({ input: ONBOARDING_INPUT_EXAMPLE, outputs: { ...outputs, "hire-receipt": null } })));
    assert.deepEqual(descriptor.outcomeProjection?.cases.map(value => value.value), ["filed", "master-review-required"]);
    assert.ok(descriptor.details.some(detail => "kind" in detail.source && detail.source.kind === "result" && detail.source.fieldPath === "hireWrite.state"));
    for (const workflow of ["onboarding", "onboarding-hire-writes"]) {
      for (const leaf of evidenceLeaves(result)) classifyEvidenceLeaf({ kind: "workflow-result", workflowId: WorkflowIdSchema.parse(workflow) }, leaf.path);
    }
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
    for (const output of [OnboardingReadI9ProfilePlan.example, { state: "not-required", subjectState: "existing-person" },
      { state: "existing-profile", profileId: "900001", i9Status: "signed" }, { state: "review-required", reason: "lookup-restricted" }]) {
      for (const leaf of evidenceLeaves(output)) classifyEvidenceLeaf({ kind: "task-output", taskId: OnboardingReadI9ProfilePlan.id }, leaf.path);
    }
    for (const leaf of evidenceLeaves(OnboardingReadWritePlan.example)) classifyEvidenceLeaf({ kind: "task-output", taskId: OnboardingReadWritePlan.id }, leaf.path);
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
  assert.deepEqual(preview.steps.map(step => step.state), ["exercised", "transaction-preview", "transaction-preview", "not-run"]);
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
  assert.equal(I9RecordIdsSchema.safeParse({ profileId: DRY_RUN_I9_PROFILE_ID, i9Id: "900002" }).success, false);
  assert.equal(I9SignerOutputSchema.safeParse({ i9Status: "unsigned", signerName: "", profileId: DRY_RUN_I9_PROFILE_ID }).success, false);
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
  assert.deepEqual(preview.steps.map(step => step.state), ["exercised", "transaction-preview", "transaction-preview", "not-run", "transaction-preview"]);
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

describe("onboarding roster names in a real run", () => {
  const runWorld = createOnboardingRunWorld();
  afterAll(runWorld.close);
  afterEach(runWorld.cleanup);

  it("fails an unresolved roster name at the hire plan before the UCPath search or any transaction", async () => {
    const f = await runWorld.executionFixture(false, { match: "unique", legalName: "Fixture Other" }), root = f.start();
    const executed = await f.execution.execute(root, new AbortController().signal);
    assert.ok(executed.run?.lifecycle.state === "terminal" && executed.run.lifecycle.outcome === "failed");
    assert.deepEqual(f.database.authority.failures.listByRun(root.envelope.runId).map(failure => [failure.code, failure.nodeId]),
      [["ONBOARDING_NAME_UNRESOLVED", "hire-plan"]]);
    assert.deepEqual(f.calls.map(call => call.system), ["crm"]);
    assert.deepEqual(f.database.authority.writeIntents.listByRun(root.envelope.runId), []);
    assert.deepEqual(f.repository.runOperations(root.envelope.runId), []);
  });

  it("computes a fresh Start's hire plan from its own input after an earlier run left a hire-plan checkpoint", async () => {
    const f = await runWorld.executionFixture(false, { match: "unique" }), first = f.start();
    const done = await f.execution.execute(first, new AbortController().signal);
    assert.ok(done.run?.lifecycle.state === "terminal" && done.run.lifecycle.outcome === "done");
    const [submission] = f.request.submissions; assert.ok(submission);
    const selection = { ...f.selection, versionId: f.library.libraryVersion(f.id).version.id, expectedVersion: f.library.read(f.id).version };
    const second = f.start({ ...f.request, submissions: [{ ...submission, postalCodeOverride: "92101" }], workbookReferences: [selection] });
    assert.equal(second.envelope.itemId, first.envelope.itemId);
    await f.rawExecution.execute(second, new AbortController().signal);
    const planOf = (runId: string) => f.database.authority.runCheckpoints.listByItem(descriptor.id, first.envelope.itemId)
      .find(row => row.runId === runId && row.nodeId === "hire-plan")?.output.value;
    assert.equal(OnboardingReadHirePlan.output.parse(planOf(first.envelope.runId)).postalCodeOverride, null);
    assert.equal(OnboardingReadHirePlan.output.parse(planOf(second.envelope.runId)).postalCodeOverride, "92101");
  });

  it("serves the split legal and preferred names at the hire review before approval", async () => {
    const f = await runWorld.executionFixture(false, { match: "unique", legalName: "Fixture  Marie Hire", livedName: "Fix Hire" }), root = f.start();
    const parked = await f.rawExecution.execute(root, new AbortController().signal);
    assert.ok(parked.run?.lifecycle.state === "parked-gate" && parked.run.lifecycle.gateId === "hire-review");
    const reader = testRunService(f.database, f.clock);
    const deps = { runReader: reader, authority: { listGateResults: (runId: string) => f.database.authority.gateResults.listByRun(runId) },
      canonical: { reader, database: f.database, descriptors: { resolve: (id: string) => id === descriptor.id ? descriptor : undefined } } };
    const gate = GateDecisionWireSchema.parse(buildRunGate(deps as unknown as RunDetailQueryDeps, root.envelope.runId, undefined, parked.run));
    assert.ok(gate.state === "open" && gate.decision !== undefined);
    assert.deepEqual(gate.decision.options.map(option => option.id), ["new-hire"]);
    assert.equal(gate.decision.context, "Legal name: first Fixture, middle Marie, last Hire. Preferred name: first Fix, no middle name, last Hire.");
  });

  const allDroppedMatch = () => {
    const dropped = ["10800001", "10800002", "10800003"].map(emplId => ({ emplId, name: "Other, Person" }));
    return SearchPersonMatchOutputSchema.parse({ hits: dropped, confirmed: [], dropped: dropped.map(hit => ({ ...hit, reason: "Last name does not match" })) });
  };
  for (const shape of ["every UCPath hit dropped", "a confirmed existing person"] as const) it(`reads the settled CRM and I-9 steps as done while parked at the hire review with ${shape}`, async () => {
    const lookupRuns = shape === "every UCPath hit dropped";
    const person = { emplId: "10800000", name: "Hire, Fixture" };
    const personMatch = lookupRuns ? allDroppedMatch() : SearchPersonMatchOutputSchema.parse({ hits: [person], confirmed: [person], dropped: [] });
    const f = await runWorld.executionFixture(false, { match: "unique", personMatch }), root = f.start();
    const parked = await f.rawExecution.execute(root, new AbortController().signal);
    assert.ok(parked.run?.lifecycle.state === "parked-gate" && parked.run.lifecycle.gateId === "hire-review");
    assert.equal(f.database.authority.runs.listChildren(root.envelope.runId).length, lookupRuns ? 1 : 0, "the I-9 lookup runs only while a new hire is possible");
    const reader = testRunService(f.database, f.clock);
    const descriptors = { resolve: (id: string) => id === descriptor.id ? descriptor : undefined };
    const projection = createOperatorProjection({ database: f.database, stateRoot: f.stateRoot, clock: f.clock, reader, appVersion: "0.1.0",
      descriptorSetHash: FingerprintSchema.parse("a".repeat(64)), ledger: createTransactionHistory(f.database.authority), descriptors });
    projection.ingestFromTimeline();
    const detail = buildRunDetail(createOperatorRunDetail({ database: f.database, stateRoot: f.stateRoot, projection, runReader: reader,
      canonical: { database: f.database, reader, descriptors } }), root.envelope.runId);
    assert.deepEqual(detail.timeline.steps?.slice(0, 4).map(step => [step.key, step.state, step.members.map(member => [member.nodeId, member.state, member.notRunReason])]), [
      ["crm-data", "done", [["roster-choice", "skipped", "condition-false"], ["crm-source", "done", undefined], ["hire-plan", "done", undefined]]],
      ["ucpath-search", "done", [["ucpath-source", "done", undefined], ["hire-subject", "done", undefined]]],
      ["i9-search", "done", [lookupRuns ? ["i9-lookup-child", "done", undefined] : ["i9-lookup-child", "skipped", "condition-false"], ["i9-lookup", "done", undefined]]],
      ["hire-review", "blocked", [["hire-findings", "done", undefined], ["hire-review", "blocked", undefined]]],
    ]);
  });

  it("answers the all-dropped hire review through the served arms, composing the gate result from the run's own match", async () => {
    // 10800002 carries the hire's own name; the others are under another name and are never offered.
    const dropped = ["10800003", "10800001", "10800002"].map(emplId => ({ emplId, name: emplId === "10800002" ? "Hire, Fixture" : "Other, Person" }));
    const personMatch = SearchPersonMatchOutputSchema.parse({ hits: dropped, confirmed: [], dropped: dropped.map(hit => ({ ...hit, reason: "Last name does not match" })) });
    const f = await runWorld.executionFixture(false, { match: "unique", dryRun: true, personMatch }), root = f.start();
    const parked = await f.rawExecution.execute(root, new AbortController().signal);
    assert.ok(parked.run?.lifecycle.state === "parked-gate" && parked.run.lifecycle.gateId === "hire-review");
    const version: number = parked.run.version;
    const reader = testRunService(f.database, f.clock);
    const deps = { runReader: reader, authority: { listGateResults: (runId: string) => f.database.authority.gateResults.listByRun(runId) },
      canonical: { reader, database: f.database, descriptors: { resolve: (id: string) => id === descriptor.id ? descriptor : undefined } } } as unknown as RunDetailQueryDeps;
    const gate = GateDecisionWireSchema.parse(buildRunGate(deps, root.envelope.runId, undefined, parked.run));
    assert.ok(gate.state === "open" && gate.decision !== undefined);
    assert.deepEqual(gate.decision.options.map(option => option.id), ["existing-person", "new-hire"]);
    const answer = (payload: { arm: string; rowId?: string }, expectedVersion = version) => GateArmAnswerRequestSchema.parse({
      commandId: randomUUID(), requestedAt: f.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard", family: "gate", type: "answer-gate-arm",
      target: { runId: root.envelope.runId, gateId: "hire-review", expectedVersion }, payload });
    const valueOf = (resolution: ReturnType<typeof resolveGateArmAnswer>) => resolution.state === "accepted" && resolution.request.family === "gate" && resolution.request.type === "resolve-gate"
      ? resolution.request.payload.result.value : resolution;
    assert.deepEqual(valueOf(resolveGateArmAnswer(deps, answer({ arm: "new-hire" }), undefined)), { decision: "new-hire", ruledOut: ["10800001", "10800002", "10800003"] });
    assert.deepEqual(valueOf(resolveGateArmAnswer(deps, answer({ arm: "existing-person", rowId: "10800002" }), undefined)),
      { decision: "existing-person", emplId: "10800002", confirmedBy: "operator" });
    for (const refused of [answer({ arm: "existing-person", rowId: "10800004" }), answer({ arm: "existing-person", rowId: "10800001" }), answer({ arm: "new-hire", rowId: "10800002" }), answer({ arm: "new-hire" }, version + 1)]) {
      assert.deepEqual(resolveGateArmAnswer(deps, refused, undefined), { state: "refused", code: "invalid-state", message: "This review changed. Reload it before answering." });
    }
    const chosen = answer({ arm: "new-hire" }), accepted = resolveGateArmAnswer(deps, chosen, undefined);
    assert.ok(accepted.state === "accepted");
    assert.equal(resolveGateArmAnswer(deps, { ...chosen, payload: { arm: "existing-person", rowId: "10800002" } }, accepted.request).state, "refused");
    assert.deepEqual(resolveGateArmAnswer(deps, chosen, accepted.request), accepted);
    assert.equal(f.rawExecution.kernel.execute(accepted.request).state, "applied");
    const done = await f.rawExecution.execute(root, new AbortController().signal);
    assert.ok(done.run?.lifecycle.state === "terminal" && done.run.lifecycle.outcome === "done", JSON.stringify(f.database.authority.failures.listByRun(root.envelope.runId)));
  });

  it("refuses a new hire and every other-name pick for a concurrent hire over dropped matches, serving only the manual rehire path", async () => {
    // 10800002 differs from the hire's name only in punctuation, which the UCPath hire query refuses.
    const dropped = [{ emplId: "10800001", name: "Other, Person" }, { emplId: "10800002", name: "HIRE,FIXTURE" }];
    const personMatch = SearchPersonMatchOutputSchema.parse({ hits: dropped, confirmed: [], dropped: dropped.map(hit => ({ ...hit, reason: "Last name does not match" })) });
    const f = await runWorld.executionFixture(false, { match: "unique", dryRun: true, mode: "rehire", personMatch }), root = f.start();
    const parked = await f.rawExecution.execute(root, new AbortController().signal);
    assert.ok(parked.run?.lifecycle.state === "parked-gate" && parked.run.lifecycle.gateId === "hire-review");
    const reader = testRunService(f.database, f.clock);
    const deps = { runReader: reader, authority: { listGateResults: (runId: string) => f.database.authority.gateResults.listByRun(runId) },
      canonical: { reader, database: f.database, descriptors: { resolve: () => descriptor } } } as unknown as RunDetailQueryDeps;
    const gate = GateDecisionWireSchema.parse(buildRunGate(deps, root.envelope.runId, undefined, parked.run));
    assert.ok(gate.state === "open" && gate.decision !== undefined, "the dead end is explained instead of a bare Waiting");
    assert.deepEqual(gate.decision.options, []);
    assert.match(gate.decision.context ?? "", /Under another name: Other, Person \(••••0001\): Last name does not match; HIRE,FIXTURE \(••••0002\): Last name does not match\..*file the rehire by hand in UCPath\./u);
    for (const payload of [{ arm: "new-hire" }, { arm: "existing-person", rowId: "10800002" }, { arm: "existing-person", rowId: "10800001" }]) {
      const resolution = resolveGateArmAnswer(deps, GateArmAnswerRequestSchema.parse({ commandId: randomUUID(), requestedAt: f.clock.now().toISOString(), requestedBy: "local-operator",
        source: "run-detail", family: "gate", type: "answer-gate-arm", target: { runId: root.envelope.runId, gateId: "hire-review", expectedVersion: parked.run.version }, payload }), undefined);
      assert.equal(resolution.state, "refused", JSON.stringify(payload));
    }
  });

  it("files a resolved roster name and patches only the Employee ID and Transaction Number cells", async () => {
    const f = await runWorld.executionFixture(false, { match: "unique", legalName: "Hire, Fixture" }), root = f.start();
    const executed = await f.execution.execute(root, new AbortController().signal);
    assert.ok(executed.run?.lifecycle.state === "terminal" && executed.run.lifecycle.outcome === "done");
    const result = f.database.authority.runResults.get(root.envelope.runId); assert.ok(result);
    const output = OnboardingResultSchema.parse(result.result.value);
    assert.equal(output.state, "filed");
    assert.equal(output.plan.employee.firstName, "Fixture"); assert.equal(output.plan.employee.lastName, "Hire");
    const operations = f.repository.runOperations(root.envelope.runId);
    assert.equal(operations.length, 1); assert.equal(operations[0]?.receipt.state, "applied");
    const change = operations[0]?.operation.change;
    assert.ok(change?.kind === "patch");
    assert.deepEqual(Object.keys(change.values).sort(), output.hireWrite.receipt.emplId === null ? ["transactionNumber"] : ["eid", "transactionNumber"]);
    assert.equal(change.values.transactionNumber, output.hireWrite.receipt.transactionId);
  });
});
