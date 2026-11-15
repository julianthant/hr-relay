import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { GateResultRecordSchema } from "../../../../src/models/workflow/gates.js";
import { launchDescriptor, launchHarness as createLaunchHarness } from "../../../support/fixtures/run-launch-fixtures.js";
import { z } from "zod";
import { EidSchema, NodeIdSchema } from "../../../../src/rules/identity/ids.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { StartPlanRecordSchema } from "../../../../src/models/run/start-plan.js";
import { RunSessionRecordSchema } from "../../../../src/models/run/session.js";
import { testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { afterAll,afterEach,describe,it } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { readRerunValues } from "../../../../src/backend/runs/start/rerun-values.js";
import { buildRerunPlan, previewRerunWarnings, RerunRefusedError } from "../../../../src/backend/runs/start/rerun.js";
import { RunRecordSchema,type RunRecord } from "../../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema,type RunCheckpointRecord } from "../../../../src/models/workflow/checkpoint.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { TransactionOutcomeSchema } from "../../../../src/rules/write-safety/write-safety-primitives.js";
import { WriteIntentRecordSchema } from "../../../../src/rules/write-safety/write-safety.js";
import { descriptorRuntimeNodes, defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { buildNodeFailureRecord } from "../../../../src/backend/runtime/execution/run-failure.js";
import { buildFailureTerminalAuthorization } from "../../../../src/backend/runs/lifecycle/terminal-authorization.js";
import { sourceBoundHarness } from "../../../support/fixtures/integration/source-bound-fixtures.js";
import { WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { mappedReadDescriptor as originalMappedReadDescriptor,rerunValuesDeps,valueShapeHarness } from "../../../support/fixtures/rerun-values-fixtures.js";
import { sourceBoundReadContract, sourceBoundReadStores, failSourceBoundReadCalls } from "../../../support/fixtures/source-bound-read-fixtures.js";
import { absentProbeEvidence, buildWriteFixtureRegistry, writeFixtureMemoDescriptor, WriteFixturePrepare, WriteFixtureCommit, WRITE_FIXTURE_NODE_ID, WRITE_FIXTURE_OBSERVATION } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { protectedSecretSource } from "../../../support/helpers/protected-secret-source.js";
import { RerunValuesResponseSchema } from "../../../../src/models/dashboard/rerun-values.js";
import { ONBOARDING_INPUT_EXAMPLE, OnboardingCanonicalInput, OnboardingInput } from "../../../../src/models/workflows/onboarding/input.js";
import { workbookInputBinding } from "../../../../src/backend/runs/workbooks.js";
import { InputRunSurfaceSchema } from "../../../../src/models/workflow/ingress.js";

const disposers: (() => void | Promise<void>)[] = [];
const profiles = createProfileFixtureSet();
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); });
afterAll(() => profiles.close());
function launchHarness(...args: Parameters<typeof createLaunchHarness>) {
  return createLaunchHarness(args[0], args[1], args[2], profiles.create);
}
function mappedReadDescriptor(...args: Parameters<typeof originalMappedReadDescriptor>) {
  const base = originalMappedReadDescriptor(...args), options = args[1], nodeId = options?.nodeId ?? "read";
  const read = () => flow(sourceBoundReadContract.input).step(nodeId, sourceBoundReadContract,
    { dependsOn: [], replay: "checkpoint", bind: ({ input }) => input });
  const tail = read().step("finish", sourceBoundReadContract, { dependsOn: [nodeId], replay: "checkpoint", bind: ({ input }) => input })
    .build({ schema: sourceBoundReadContract.output, dependsOn: [nodeId], derive: ({ outputs }) => outputs[nodeId] });
  const gated = read().gate("approval", { dependsOn: [nodeId], label: "Approval", resolvedBy: "operator", result: z.strictObject({ approved: z.boolean() }) })
    .step("finish", sourceBoundReadContract, { dependsOn: [nodeId], replay: "checkpoint", bind: ({ input }) => input })
    .build({ schema: sourceBoundReadContract.output, dependsOn: [nodeId], derive: ({ outputs }) => outputs[nodeId] });
  const metadata = { id: base.id, version: base.version, contractFingerprint: base.contractFingerprint,
    code: base.code, label: base.label, icon: base.icon, category: base.category, canonicalInput: base.canonicalInput, inputSubject: "eid",
    surface: base.surface, enqueue: base.enqueue, actions: base.actions, surfaces: {}, details: [], scenarios: ["source-read/happy"],
    identity: { matchKey: (input: z.output<typeof sourceBoundReadContract.input>) => input.eid }, presentation: { title: (input: z.output<typeof sourceBoundReadContract.input>) => input.eid }, rerunValues: args[0] ?? [{ nodeId, fieldPath: "eid", label: "Employee ID", targetFieldPath: "eid" }],
    timeline: [{ key: options?.stepKey ?? "read", label: "Read", nodes: options?.gate ? [nodeId, "approval"] : [nodeId] }, { key: "finish", label: "Finish", nodes: ["finish"] }],
  } as const;
  return options?.gate ? defineWorkflowDescriptor({ ...metadata, flow: gated }) : defineWorkflowDescriptor({ ...metadata, flow: tail });
}
function transactionDescriptor(attribution = false, dependency = false) {
  const base = writeFixtureMemoDescriptor;
  const metadata = { id: base.id, version: base.version, contractFingerprint: base.contractFingerprint,
    code: base.code, label: base.label, icon: base.icon, category: base.category, canonicalInput: defineCanonicalInput(sourceBoundReadContract.input, sourceBoundReadContract.input, [{ eid: "10812345" }]), inputSubject: "eid",
    surface: base.surface, enqueue: base.enqueue, actions: base.actions, surfaces: {}, details: [], scenarios: ["write-fixture/happy"],
    identity: { matchKey: (input: z.output<typeof sourceBoundReadContract.input>) => `eid:${input.eid}` }, presentation: { title: (input: z.output<typeof sourceBoundReadContract.input>) => input.eid },
    ...(attribution ? { rerunValues: [{ nodeId: WRITE_FIXTURE_NODE_ID, fieldPath: "output.value.transactionId", label: "Transaction", targetFieldPath: "memo" }] } : {}),
  } as const;
  const graph = flow(sourceBoundReadContract.input).transaction(WRITE_FIXTURE_NODE_ID, { dependsOn: [],
      prepare: { uses: WriteFixturePrepare, bind: ({ input }) => ({ eid: input.eid }) }, commit: { uses: WriteFixtureCommit, bind: ({ input }) => ({ eid: input.eid }) },
      dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 })
      .step("finish", sourceBoundReadContract, { dependsOn: [WRITE_FIXTURE_NODE_ID], replay: "checkpoint", bind: ({ input }) => input })
      .build({ schema: WriteFixtureCommit.output, dependsOn: [WRITE_FIXTURE_NODE_ID], derive: ({ outputs }) => outputs[WRITE_FIXTURE_NODE_ID].output });
  const dependent = flow(sourceBoundReadContract.input).step("read", sourceBoundReadContract, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => input })
    .transaction(WRITE_FIXTURE_NODE_ID, { dependsOn: ["read"], prepare: { uses: WriteFixturePrepare, bind: ({ input }) => ({ eid: input.eid }) },
      commit: { uses: WriteFixtureCommit, bind: ({ input }) => ({ eid: input.eid }) }, dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 })
    .step("finish", sourceBoundReadContract, { dependsOn: [WRITE_FIXTURE_NODE_ID], replay: "checkpoint", bind: ({ input }) => input })
    .build({ schema: WriteFixtureCommit.output, dependsOn: [WRITE_FIXTURE_NODE_ID], derive: ({ outputs }) => outputs[WRITE_FIXTURE_NODE_ID].output });
  return dependency ? defineWorkflowDescriptor({ ...metadata, flow: dependent }) : defineWorkflowDescriptor({ ...metadata, flow: graph });
}
async function harness(writes = false, attribution = false, dependency = false) {
  const h = await sourceBoundHarness(writes ? transactionDescriptor(attribution, dependency) : mappedReadDescriptor(), world => {
    const reads = sourceBoundReadStores(world, writes && !dependency ? 1 : 2), writeStores = buildWriteFixtureRegistry(world);
    return defineTaskStoreRegistry([...reads.stores, ...writeStores.stores], { scenarioIds: [...reads.corpus.scenarioIds, ...writeStores.corpus.scenarioIds],
      tasks: [...reads.corpus.tasks, ...writeStores.corpus.tasks] });
  }, undefined, undefined, profiles.create);
  disposers.push(h.dispose); return h;
}
type Harness = Awaited<ReturnType<typeof harness>>;
async function failed(h: Harness) { const queued = h.start(h.proposal()); assert.equal((await h.execute(queued)).state, "failed");
  const run = h.fresh(queued); assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed");
  const failureId = run.lifecycle.failureId;
  assert.ok(h.database.authority.failures.listByRun(run.envelope.runId).some(row => row.failureId === failureId)); return run; }
async function failedLaunch(h: Awaited<ReturnType<typeof launchHarness>>, call = 2, dryRun = false) {
  failSourceBoundReadCalls(h.world, [call]); const queued = h.start(h.proposal(undefined, undefined, dryRun)); assert.equal((await h.execute(queued)).state, "failed");
  const source = h.fresh(queued); assert.equal(h.database.authority.failures.listByRun(source.envelope.runId)[0]?.nodeId, "check"); return source;
}
function request(run: RunRecord) { return { runId: run.envelope.runId, expectedVersion: run.version }; }
function snapshot(h: Harness, run: RunRecord) {
  return canonicalJsonStringify({ generation: h.database.getMeta().authorityGeneration,
    runs: h.database.authority.runs.listByWorkflow(h.descriptor.id),
    checkpoints: h.database.authority.runCheckpoints.listByItem(h.descriptor.id, run.envelope.itemId),
    gates: h.database.authority.gateResults.listByRun(run.envelope.runId),
    writes: h.database.authority.writeIntents.listByRun(run.envelope.runId),
    lifecycleIds: h.lifecycleIds.minted(), planIds: h.planIds.minted(), queueRoots: h.queueRoots });
}
function checkpointsDeps(h: Harness, rows: readonly RunCheckpointRecord[]) {
  const deps = rerunValuesDeps(h);
  return { ...deps, database: { withAuthorityReadSnapshot: h.database.withAuthorityReadSnapshot.bind(h.database),
    authority: { ...h.database.authority, runCheckpoints: { ...h.database.authority.runCheckpoints, listByItem: () => rows } } } };
}
function firstCheckpoint(h: Harness, run: RunRecord) { const cp = h.database.authority.runCheckpoints.listByItem(h.descriptor.id, run.envelope.itemId)[0]; assert.ok(cp); return cp; }

describe("source-bound Rerun value read", () => {
  it("offers supported pre-roster Onboarding values through the trusted reader without rewriting retained input", async () => {
    const h = await harness(); const source = await failed(h);
    const current = DESCRIPTORS.find(entry => entry.id === "onboarding"); assert.ok(current);
    const parser = { split: { kind: "whole-text" }, rules: [{ when: { kind: "pattern", pattern: "email" }, emit: "email" }] };
    const descriptor = defineWorkflowDescriptor({ id: current.id, version: current.version, contractFingerprint: current.contractFingerprint,
      code: current.code, label: current.label, icon: current.icon, category: current.category,
      canonicalInput: OnboardingCanonicalInput, inputSubject: "email", surface: current.surface,
      enqueue: current.enqueue, actions: current.actions, details: [], scenarios: ["source-read/happy"],
      identity: { matchKey: input => input.email.toLowerCase() }, presentation: { title: input => input.email },
      surfaces: { inputRun: InputRunSurfaceSchema.parse({
      placeholder: "Email", parser, typedInput: { modeField: "mode", modeLabel: "Hire mode", initialMode: "new-hire",
        description: "Read retained hire input", controls: [], modes: ["new-hire", "rehire"].map(value => ({
          value, label: value, inputLabel: "Email", hint: "Saved email", placeholder: "Email",
          defaults: [{ field: "postalCodeOverride", value: { kind: "text", text: "92093" } },
            { field: "configuredJobEndDate", value: { kind: "text", text: "06/30/2027" } }],
          parser: { kind: "entries", spec: parser }, display: { kind: "first-present", fields: ["email"] }, identityFields: ["email"],
        })) },
      }) },
      flow: flow(OnboardingInput).step("read", sourceBoundReadContract,
        { dependsOn: [], replay: "checkpoint", bind: () => ({ eid: "10812345" }) })
        .build({ schema: sourceBoundReadContract.output, dependsOn: ["read"], derive: ({ outputs }) => outputs.read }),
    });
    const retainedSchema = z.strictObject({ email: OnboardingInput.shape.email, mode: OnboardingInput.shape.mode,
      postalCodeOverride: OnboardingInput.shape.postalCodeOverride, configuredJobEndDate: OnboardingInput.shape.configuredJobEndDate });
    const value = retainedSchema.parse({ email: ONBOARDING_INPUT_EXAMPLE.email, mode: "rehire",
      postalCodeOverride: "92093", configuredJobEndDate: "06/30/2027" });
    const { sessionId: _sessionId, completion: _completion, ...withoutSession } = source;
    const run = RunRecordSchema.parse({ ...withoutSession,
      envelope: { ...source.envelope, workflow: descriptor.id, contractFingerprint: "c".repeat(64) },
      lifecycle: { state: "terminal", outcome: "interrupted", endedAt: h.clock.now().toISOString() },
      input: { ...source.input, parsed: { ...source.input.parsed, schemaHash: deriveSchemaHash(retainedSchema, "output"), value } } });
    const before = canonicalJsonStringify(run);
    const result = readRerunValues({ ...rerunValuesDeps(h), descriptors: { resolve: () => descriptor },
      reader: { read: () => ({ state: "present", disposition: "live", run }) } }, request(run));
    assert.ok(result.state === "available", JSON.stringify(result));
    assert.deepEqual(result.snapshot.sourceInput, { state: "partial", value, identityCopied: true });
    assert.ok(result.snapshot.steps.every(step => step.state === "unfinished"));
    assert.deepEqual(run.input.parsed.protectedBindings, source.input.parsed.protectedBindings);
    assert.equal(canonicalJsonStringify(run), before);
  });

  it("refuses retained input missing protected bindings when the trusted reader decodes it", async () => {
    const h = await harness(); const source = await failed(h);
    const { protectedBindings: _protectedBindings, ...withoutBindings } = source.input.parsed;
    let reads = 0;
    const result = readRerunValues({ ...rerunValuesDeps(h), reader: { read: () => {
      reads++;
      return { state: "present", disposition: "live", run: RunRecordSchema.parse({ ...source,
        input: { ...source.input, parsed: withoutBindings } }) };
    } } }, request(source));
    assert.equal(reads, 1);
    assert.deepEqual(result, { state: "refused", code: "source-invalid" });
  });

  it.each([false, true])("projects verified Onboarding source without roster after descriptor advance %s", async older => {
    const h = await harness(); const source = await failed(h);
    const descriptor = DESCRIPTORS.find(entry => entry.id === "onboarding"); assert.ok(descriptor);
    const value = { ...ONBOARDING_INPUT_EXAMPLE, mode: "rehire", postalCodeOverride: "92093" };
    const { sessionId: _sessionId, completion: _completion, ...withoutSession } = source;
    const run = RunRecordSchema.parse({ ...withoutSession,
      envelope: { ...source.envelope, workflow: descriptor.id, descriptorVersion: descriptor.version,
        contractFingerprint: older ? "c".repeat(64) : descriptor.contractFingerprint },
      lifecycle: { state: "terminal", outcome: "interrupted", endedAt: h.clock.now().toISOString() },
      input: { ...source.input, parsed: { ...source.input.parsed, schemaHash: deriveSchemaHash(descriptor.canonicalInput, "output"), value } } });
    const result = readRerunValues({ ...rerunValuesDeps(h), descriptors: { resolve: () => descriptor },
      reader: { read: () => ({ state: "present", disposition: "live", run }) } }, request(run));
    assert.ok(result.state === "available", JSON.stringify(result));
    const expected = { email: value.email, mode: "rehire", postalCodeOverride: "92093", configuredJobEndDate: value.configuredJobEndDate };
    assert.deepEqual(result.snapshot.sourceInput, { state: "available", value: expected });
    assert.deepEqual(OnboardingInput.parse(expected), expected);
    assert.deepEqual(run.input.parsed.value, value);
    if (!older) {
      const { mode: _mode, ...withoutMode } = value;
      const changed = { ...run, input: { ...run.input, parsed: { ...run.input.parsed, value: withoutMode } } };
      const malformed = readRerunValues({ ...rerunValuesDeps(h), descriptors: { resolve: () => descriptor },
        reader: { read: () => ({ state: "present", disposition: "live", run: changed }) } }, request(changed));
      assert.deepEqual(malformed, { state: "refused", code: "source-invalid" });
    }
  });

  it("keeps caller roster refused and never invents a source mode", () => {
    const binding = workbookInputBinding(OnboardingCanonicalInput); assert.ok(binding);
    const sourceToIngress = binding.sourceToIngress?.bind(undefined); assert.ok(sourceToIngress);
    assert.throws(() => binding.assertSubmission(ONBOARDING_INPUT_EXAMPLE), /caller-supplied roster/u);
    const { mode: _mode, ...missingMode } = ONBOARDING_INPUT_EXAMPLE;
    for (const value of [missingMode, { ...ONBOARDING_INPUT_EXAMPLE, mode: "unknown" }]) {
      assert.throws(() => sourceToIngress(value));
    }
  });

  it("preserves available source input for an unprotected plain-input workflow", async () => {
    const h = await launchHarness(); disposers.push(h.dispose);
    assert.ok(h.descriptor.surfaces.inputRun);
    assert.equal(h.descriptor.surfaces.inputRun.typedInput, undefined);
    const source = await failedLaunch(h);
    assert.deepEqual(source.input.parsed.protectedBindings, []);
    const result = readRerunValues({ reader: h.lifecycle, database: h.database,
      descriptors: { resolve: () => h.descriptor } }, request(source));
    assert.ok(result.state === "available");
    assert.deepEqual(result.snapshot.sourceInput, { state: "available", value: source.input.parsed.value });
  });
  it.each(["safe-identity", "embedded-protected-value"] as const)("withholds protected input in the %s HTTP response", async kind => {
    const descriptor = DESCRIPTORS.find(entry => entry.id === "separations"); assert.ok(descriptor);
    const name = kind === "safe-identity" ? "Fixture Hidden Operator" : "1234567";
    const secrets = protectedSecretSource({ profileName: name, profileInitials: "FO" });
    let secretReads = 0;
    const h = await launchHarness("reject-active", undefined, { descriptor,
      protectedSecrets: { read: () => { secretReads += 1; return secrets.read(); } } });
    disposers.push(h.dispose);
    const submission = { documentNumber: "12345678" };
    const plan = await h.client.submitStartPlan({ workflowId: descriptor.id, submissions: [submission], dryRun: true,
      browserMode: "headless", captureBrowserScreenshots: false });
    assert.deepEqual(plan.refused, []);
    assert.ok(secretReads > 0);
    const queued = h.start(plan);
    assert.equal((await h.execute(queued)).state, "failed");
    const source = h.fresh(queued);
    const before = canonicalJsonStringify(source);
    const response = await h.app.request(`http://localhost/api/v1/runs/${source.envelope.runId}/rerun-values?expectedVersion=${source.version}`);
    assert.equal(response.status, 200);
    const serialized = await response.text();
    assert.equal(serialized.includes(name), false);
    assert.equal(serialized.includes("timekeeperName"), false);
    assert.equal(serialized.includes("withheld-protected-input"), false);
    const result = RerunValuesResponseSchema.parse(JSON.parse(serialized)); assert.ok(result.state === "available");
    if (kind === "embedded-protected-value") {
      assert.deepEqual(result.snapshot.sourceInput, { state: "unavailable", reason: "protected" });
      assert.equal(serialized.includes(submission.documentNumber), false);
    } else {
      assert.deepEqual(result.snapshot.sourceInput, { state: "partial", value: submission, identityCopied: true });
      const readsBeforeRerun = secretReads;
      const nextPlan = await h.client.submitStartPlan({ workflowId: descriptor.id, submissions: [submission], dryRun: true,
        browserMode: "headless", captureBrowserScreenshots: false,
        selectedStepKeys: descriptor.timeline.map(step => step.key),
        rerunSource: { ...request(source), intent: "rerun", selectedStepKeys: descriptor.timeline.map(step => step.key), copiedFrom: [] } });
      assert.deepEqual(nextPlan.refused, []);
      assert.equal(secretReads, readsBeforeRerun + 1);
      const next = h.start(nextPlan);
      assert.notEqual(next.envelope.runId, source.envelope.runId);
      assert.deepEqual(next.input.raw, submission);
      assert.equal(z.record(z.string(), z.unknown()).parse(next.input.parsed.value).timekeeperName, name);
      assert.deepEqual(next.input.parsed.protectedBindings, source.input.parsed.protectedBindings);
      assert.equal(JSON.stringify(nextPlan).includes(name), false);
      assert.equal(JSON.stringify(h.submissions).includes(name), false);
      assert.equal(JSON.stringify(h.finalCommands).includes(name), false);
      assert.deepEqual(h.database.authority.writeIntents.listByRun(next.envelope.runId), []);
      assert.deepEqual(h.world.events, []);
    }
    assert.equal(canonicalJsonStringify(h.fresh(source)), before);
    assert.deepEqual(h.database.authority.writeIntents.listByRun(source.envelope.runId), []);
  });
  it.each(["fingerprint", "version", "steps"] as const)("offers earlier %s source values without treating them as current authority", async change => {
    const h = await harness(); const run = await failed(h); const before = snapshot(h, run);
    h.registerDescriptor(mappedReadDescriptor(undefined, { contractFingerprint: "b".repeat(64),
      ...(change === "version" ? { version: 2 } : {}), ...(change === "steps" ? { stepKey: "current-reading" } : {}) }));
    const result = readRerunValues(rerunValuesDeps(h), request(run));
    assert.ok(result.state === "available", JSON.stringify(result));
    assert.deepEqual(result.snapshot.sourceInput, { state: "available", value: { eid: "10812345" } });
    assert.equal(result.snapshot.source.descriptorVersion, run.envelope.descriptorVersion);
    assert.equal(result.snapshot.source.contractFingerprint, run.envelope.contractFingerprint);
    assert.ok(result.snapshot.values[0]?.state === "available");
    assert.equal(result.snapshot.values[0].value, "10812345");
    assert.equal(snapshot(h, run), before);
  });
  it("plans and consumes ordinary Rerun after the source read node was removed", async () => {
    const h = await harness(); const source = await failed(h);
    const historical = canonicalJsonStringify(h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId));
    h.registerDescriptor(mappedReadDescriptor(undefined, { contractFingerprint: "b".repeat(64), nodeId: "current-read", stepKey: "current-reading" }));
    const removedGate = GateResultRecordSchema.parse({ runId: source.envelope.runId, nodeId: "removed-gate", gateId: "removed-gate",
      commandId: h.ids.uuid(), expectedVersion: source.version, resolvedBy: "local-operator", resolvedAt: h.clock.now().toISOString(),
      checkpointFingerprint: "a".repeat(64), result: { schemaHash: "a".repeat(64), value: { approved: true } } });
    const repositories = { ...h.database.authority, gateResults: { ...h.database.authority.gateResults, listByRun: () => [removedGate] } };
    const response = readRerunValues({ ...rerunValuesDeps(h), database: { authority: repositories,
      withAuthorityReadSnapshot: h.database.withAuthorityReadSnapshot.bind(h.database) } }, request(source));
    assert.ok(response.state === "available", JSON.stringify(response));
    assert.deepEqual(previewRerunWarnings(repositories, h.descriptor,
      { ...request(source), intent: "rerun", selectedStepKeys: ["current-reading", "finish"] }).warnings, []);
    assert.deepEqual(response.snapshot.steps.map(step => step.key), ["current-reading", "finish"]);
    assert.deepEqual(response.snapshot.sourceInput, { state: "available", value: { eid: "10812345" } });
    assert.equal(response.snapshot.values[0]?.state, "unavailable");
    const selectedStepKeys = ["current-reading", "finish"];
    const plan = h.planner.plan({ workflowId: h.descriptor.id, submissions: [{ eid: "10812345" }], dryRun: false, selectedStepKeys,
      rerunSource: { ...request(source), intent: "rerun", selectedStepKeys } });
    const run = h.start(plan);
    assert.equal(run.envelope.continuation, undefined);
    assert.equal(run.envelope.sourceBound?.source.runId, source.envelope.runId);
    assert.notEqual(run.envelope.runId, source.envelope.runId);
    assert.equal(run.envelope.contractFingerprint, h.descriptor.contractFingerprint);
    assert.equal((await h.execute(run)).state, "done");
    assert.equal(canonicalJsonStringify(h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId)
      .filter(row => row.runId === source.envelope.runId)), historical);
  });
  it("disregards an incompatible historical same-ID gate for fresh read-only work", async () => {
    const h = await harness(); const source = await failed(h);
    const historical = canonicalJsonStringify(h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId));
    const gate = GateResultRecordSchema.parse({ runId: source.envelope.runId, nodeId: "approval", gateId: "approval",
      commandId: h.ids.uuid(), expectedVersion: source.version, resolvedBy: "local-operator", resolvedAt: h.clock.now().toISOString(),
      checkpointFingerprint: "a".repeat(64), result: { schemaHash: "a".repeat(64), value: { oldApproval: "accepted" } } });
    h.registerDescriptor(mappedReadDescriptor(undefined, { contractFingerprint: "b".repeat(64), gate: true }));
    const repositories = { ...h.database.authority, gateResults: { ...h.database.authority.gateResults, listByRun: () => [gate] } };
    const response = readRerunValues({ ...rerunValuesDeps(h), database: { authority: repositories,
      withAuthorityReadSnapshot: h.database.withAuthorityReadSnapshot.bind(h.database) } }, request(source));
    assert.ok(response.state === "available", JSON.stringify(response));
    const sourceRef = { ...request(source), intent: "rerun" as const, selectedStepKeys: h.descriptor.timeline.map(step => step.key) };
    assert.deepEqual(previewRerunWarnings(repositories, h.descriptor, sourceRef).warnings, []);
    const plan = h.planner.plan({ workflowId: h.descriptor.id, submissions: [{ eid: "10812345" }], dryRun: false,
      selectedStepKeys: sourceRef.selectedStepKeys, rerunSource: sourceRef });
    const run = h.start(plan);
    assert.equal(run.envelope.continuation, undefined);
    assert.equal(run.envelope.sourceBound?.source.runId, source.envelope.runId);
    assert.notEqual(run.envelope.runId, source.envelope.runId);
    assert.equal(run.envelope.contractFingerprint, h.descriptor.contractFingerprint);
    assert.deepEqual(h.database.authority.gateResults.listByRun(run.envelope.runId), []);
    assert.equal(canonicalJsonStringify(h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId)
      .filter(row => row.runId === source.envelope.runId)), historical);
    h.registerDescriptor(mappedReadDescriptor(undefined, { gate: true }));
    assert.deepEqual(readRerunValues({ ...rerunValuesDeps(h), database: { authority: repositories,
      withAuthorityReadSnapshot: h.database.withAuthorityReadSnapshot.bind(h.database) } }, request(source)),
    { state: "refused", code: "source-invalid" });
    assert.throws(() => previewRerunWarnings(repositories, h.descriptor, sourceRef),
      error => error instanceof RerunRefusedError && error.code === "schema-mismatch");
  });
  it("refuses an incompatible historical gate consumed by current transaction warnings", async () => {
    const h = await launchHarness(); disposers.push(h.dispose); const source = await failedLaunch(h);
    const plan = h.proposal(undefined, undefined, true);
    const stored = h.database.authority.startPlans.get(plan.startPlanId); assert.ok(stored);
    h.registerDescriptor(launchDescriptor("reject-active", { fingerprint: "b".repeat(64), gateDependency: true }));
    const gate = GateResultRecordSchema.parse({ runId: source.envelope.runId, nodeId: "approval", gateId: "approval",
      commandId: h.ids.uuid(), expectedVersion: source.version, resolvedBy: "local-operator", resolvedAt: h.clock.now().toISOString(),
      checkpointFingerprint: "a".repeat(64), result: { schemaHash: "a".repeat(64), value: { oldApproval: "accepted" } } });
    const repositories = { ...h.database.authority, gateResults: { ...h.database.authority.gateResults, listByRun: () => [gate] } };
    const sourceRef = { ...request(source), intent: "rerun" as const, selectedStepKeys: h.descriptor.timeline.map(step => step.key) };
    assert.throws(() => previewRerunWarnings(repositories, h.descriptor, sourceRef),
      error => error instanceof RerunRefusedError && error.code === "schema-mismatch");
    assert.throws(() => buildRerunPlan(repositories, h.descriptor, sourceRef, stored.planned),
      error => error instanceof RerunRefusedError && error.code === "schema-mismatch");
    h.registerDescriptor(launchDescriptor("reject-active", { gateDependency: true }));
    assert.throws(() => previewRerunWarnings(repositories, h.descriptor, sourceRef),
      error => error instanceof RerunRefusedError && error.code === "schema-mismatch");
    assert.throws(() => buildRerunPlan(repositories, h.descriptor, sourceRef, stored.planned),
      error => error instanceof RerunRefusedError && error.code === "schema-mismatch");
  });
  it.each(["padded-name", "missing-control"] as const)("prefills older typed %s only where current input accepts exact values", async kind => {
    const h = await harness(); const source = await failed(h);
    const descriptor = DESCRIPTORS.find(entry => entry.id === "person-lookup"); assert.ok(descriptor);
    const value = kind === "padded-name" ? { mode: "match", lastName: " Example ", firstName: "Person", dob: "01/15/2000", crmCheck: true, includeCrmDates: false }
      : { mode: "search", emplId: "10000001", crmCheck: false, keepNonHdh: true };
    const { sessionId: _sessionId, ...withoutSession } = source;
    const run = RunRecordSchema.parse({ ...withoutSession, envelope: { ...source.envelope, workflow: descriptor.id },
      input: { ...source.input, parsed: { ...source.input.parsed, value } } });
    const result = readRerunValues({ ...rerunValuesDeps(h), descriptors: { resolve: () => descriptor },
      database: { authority: { ...h.database.authority, failures: { ...h.database.authority.failures,
        listByRun: (id: string) => h.database.authority.failures.listByRun(id).map(failure => ({ ...failure, workflowId: descriptor.id })) } },
        withAuthorityReadSnapshot: h.database.withAuthorityReadSnapshot.bind(h.database) },
      reader: { read: () => ({ state: "present", disposition: "live", run }) } }, request(run));
    assert.ok(result.state === "available", JSON.stringify(result));
    assert.equal(result.snapshot.sourceInput.state, "partial");
    if (result.snapshot.sourceInput.state !== "partial") throw new Error("partial typed source required");
    assert.equal(result.snapshot.sourceInput.identityCopied, kind !== "padded-name");
    assert.deepEqual(result.snapshot.sourceInput.value, kind === "padded-name"
      ? { mode: "match", crmCheck: true, includeCrmDates: false }
      : { mode: "search", emplId: "10000001", crmCheck: false, keepNonHdh: true });
  });
  it("leaves an earlier value rejected by the current input uncopied without coercing it", async () => {
    const h = await harness(); const run = await failed(h);
    const input = z.strictObject({ eid: EidSchema.refine(value => value === "10899999") });
    h.registerDescriptor(mappedReadDescriptor(undefined, { contractFingerprint: "b".repeat(64),
      canonicalInput: defineCanonicalInput(input, input, [{ eid: "10899999" }]) }));
    const result = readRerunValues(rerunValuesDeps(h), request(run));
    assert.ok(result.state === "available", JSON.stringify(result));
    assert.ok(result.snapshot.values[0]?.state === "unavailable");
    assert.equal(result.snapshot.values[0].reason, "target-invalid");
  });

  it("allows ordinary Rerun across contracts and keeps fresh Start free of inherited authority", async () => {
    const h = await harness(); const source = await failed(h);
    const sourceCheckpoints = canonicalJsonStringify(h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId));
    h.registerDescriptor(mappedReadDescriptor(undefined, { version: 2, contractFingerprint: "b".repeat(64) }));
    const ordinary = h.proposal(source);
    assert.equal(ordinary.rerun?.source.runId, source.envelope.runId);
    const plan = h.proposal();
    const run = h.start(plan);
    assert.equal(run.envelope.continuation, undefined); assert.equal(run.envelope.sourceBound, undefined);
    assert.notEqual(run.envelope.runId, source.envelope.runId);
    assert.equal(run.envelope.itemId, source.envelope.itemId);
    assert.equal(run.envelope.descriptorVersion, 2);
    assert.equal(run.envelope.contractFingerprint, "b".repeat(64));
    assert.deepEqual(h.database.authority.runCheckpoints.listByItem(h.descriptor.id, run.envelope.itemId)
      .filter(checkpoint => checkpoint.runId === run.envelope.runId), []);
    assert.deepEqual(h.database.authority.writeIntents.listByRun(run.envelope.runId), []);
    assert.deepEqual(h.database.authority.gateResults.listByRun(run.envelope.runId), []);
    assert.equal((await h.execute(run)).state, "done");
    assert.ok(h.database.authority.runCheckpoints.listByItem(h.descriptor.id, run.envelope.itemId)
      .filter(checkpoint => checkpoint.runId === run.envelope.runId)
      .every(checkpoint => checkpoint.contractFingerprint === "b".repeat(64)));
    assert.equal(canonicalJsonStringify(h.fresh(source)), canonicalJsonStringify(source));
    assert.equal(canonicalJsonStringify(h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId)
      .filter(checkpoint => checkpoint.runId === source.envelope.runId)), sourceCheckpoints);
  });
  it("requires repeat acknowledgment for an independent settled key when the failed source has no transaction checkpoint", async () => {
    const descriptor = launchDescriptor("reject-active", { readReplay: "always-rerun" });
    const h = await launchHarness("reject-active", undefined, { descriptor, protectedSecrets: protectedSecretSource() }); disposers.push(h.dispose);
    const prior = await h.completeSource();
    const source = await failedLaunch(h, 4, true);
    assert.notEqual(source.envelope.runId, prior.envelope.runId);
    assert.equal(h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId).filter(row => row.runId === source.envelope.runId && row.nodeId === "submit-write").length, 0);
    const selectedStepKeys = h.descriptor.timeline.map(step => step.key);
    const warning = h.planner.previewWarnings({ workflowId: h.descriptor.id,
      source: { ...request(source), intent: "rerun", selectedStepKeys } });
    assert.equal(warning.rerun.warnings.length, 1);
    const unconfirmed = h.proposal(source, undefined, true);
    assert.equal(unconfirmed.rerun?.warnings.length, 1);
    assert.equal(h.kernel.execute(h.command(unconfirmed)).state, "confirmation-required");
    const confirmed = h.proposal(source, warning.rerun.warningDigest, true);
    const run = h.start(confirmed);
    assert.equal(run.envelope.dryRun, true);
    assert.notEqual(run.envelope.runId, source.envelope.runId);
    assert.equal(run.envelope.descriptorVersion, source.envelope.descriptorVersion);
    assert.deepEqual(h.database.authority.writeIntents.listByRun(run.envelope.runId), []);
    const effects = () => canonicalJsonStringify({ priorIntents: h.database.authority.writeIntents.listByRun(prior.envelope.runId),
      checkpoints: h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId).filter(row => row.nodeId === "submit-write"),
      confirmations: h.database.authority.timelineEvents.page({}).filter(row => row.payload.kind === "operation-confirmed") });
    const before = effects();
    const eventCount = h.world.events.length;
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    assert.equal((await h.execute(run)).state, "done");
    assert.deepEqual(h.world.events.slice(eventCount).filter(event => !event.startsWith("read:")),
      ["probe", "prepare", `subject-read:${WRITE_FIXTURE_OBSERVATION}`]);
    assert.deepEqual(h.world.probeResults, []);
    assert.equal(effects(), before);
    assert.deepEqual(h.database.authority.writeIntents.listByRun(run.envelope.runId), []);
  });
  it("refuses missing or incompatible submitted-write warning evidence during preview and planned revalidation", async () => {
    const h = await harness(true, false, true); h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString())); const source = await failed(h);
    const selectedStepKeys = h.descriptor.timeline.map(step => step.key);
    const rerunSource = { ...request(source), intent: "rerun" as const, selectedStepKeys };
    const plan = h.proposal(source);
    const stored = h.database.authority.startPlans.get(plan.startPlanId); assert.ok(stored);
    const checkpoints = h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId);
    for (const incompatible of [false, true]) {
      const rows = checkpoints.flatMap(checkpoint => checkpoint.nodeId !== "read" ? [checkpoint]
        : incompatible ? [RunCheckpointRecordSchema.parse({ ...checkpoint, output: { ...checkpoint.output, schemaHash: "f".repeat(64) } })] : []);
      const repositories = { ...h.database.authority,
        runCheckpoints: { ...h.database.authority.runCheckpoints, listByItem: () => rows,
          listByAttempt: (workflowId: string, itemId: string, nodeId: string, attempt: number) => rows.filter(row => row.workflowId === workflowId && row.itemId === itemId && row.nodeId === nodeId && row.attempt === attempt),
          get: (workflowId: string, itemId: string, nodeId: string, attempt: number, generation: number) => rows.find(row => row.workflowId === workflowId && row.itemId === itemId && row.nodeId === nodeId && row.attempt === attempt && row.claimGeneration === generation) } };
      const refuses = (error: unknown) => error instanceof RerunRefusedError
        && error.code === (incompatible ? "schema-mismatch" : "invalid-value");
      assert.throws(() => previewRerunWarnings(repositories, h.descriptor, rerunSource), refuses);
      assert.throws(() => buildRerunPlan(repositories, h.descriptor, rerunSource, stored.planned, plan.rerun?.warningDigest), refuses);
    }
  });
  it.each([false, true])("refuses a parked UNKNOWN source after descriptor advance %s", async older => {
    const h = await launchHarness(); disposers.push(h.dispose); h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    h.world.commitThrows = new Error("synthetic lost submit outcome");
    const queued = h.start(h.proposal()); const outcome = await h.execute(queued);
    assert.equal(outcome.state, "parked-write"); const source = h.fresh(queued);
    if (older) h.registerDescriptor(launchDescriptor("reject-active", { version: 2, fingerprint: "b".repeat(64) }));
    assert.deepEqual(readRerunValues(rerunValuesDeps(h), request(source)), { state: "refused", code: "source-ineligible" });
    assert.throws(() => h.proposal(source), error => error instanceof RerunRefusedError && error.code === "invalid-state");
  });
  it("offers exact completed values and provenance without changing authority or minting plans", async () => {
    const h = await harness(); const run = await failed(h); const before = snapshot(h, run);
    const result = readRerunValues(rerunValuesDeps(h), request(run));
    assert.equal(result.state, "available"); if (result.state !== "available") throw new Error("valid source refused");
    const cp = firstCheckpoint(h, run);
    assert.equal(result.snapshot.source.runId, run.envelope.runId);
    assert.equal(result.snapshot.source.version, run.version);
    assert.deepEqual(result.snapshot.sourceInput, { state: "available", value: run.input.parsed.value });
    assert.equal(result.snapshot.values[0]?.state, "available");
    const value = result.snapshot.values[0]; assert.ok(value?.state === "available");
    assert.equal(value.value, "10812345");
    assert.equal(value.nodeId, cp.nodeId); assert.equal(value.fieldPath, "eid");
    assert.deepEqual(value.provenance, cp.provenance[0]);
    assert.deepEqual(value.checkpoint, { attempt: cp.attempt, claimGeneration: cp.claimGeneration, writtenAt: cp.writtenAt });
    assert.equal(result.snapshot.steps[0]?.state, "completed");
    assert.deepEqual(result.snapshot.transactions, []);
    assert.equal(snapshot(h, run), before);
    const continued = h.start(h.proposal(run));
    assert.equal((await h.execute(continued)).state, "done");
    const retained = h.database.authority.runCheckpoints.listByItem(h.descriptor.id, run.envelope.itemId);
    const reads = retained.filter(row => row.nodeId === cp.nodeId);
    assert.equal(reads.length, 2, "ordinary Rerun executes the read under its new run identity");
    assert.deepEqual(reads.find(row => row.runId === run.envelope.runId), cp);
    assert.ok(reads.some(row => row.runId === continued.envelope.runId));
    assert.equal(continued.envelope.continuation, undefined);
    assert.ok(retained.some(row => row.nodeId === "finish" && row.runId === continued.envelope.runId), "failed later work actually executes");
  });
  it("keeps source plan identity without carrying a worker choice", async () => {
    const h = await harness();
    const selectedStepKeys = h.descriptor.timeline.map(({ key }) => key);
    const plan = h.planner.plan({ workflowId: h.descriptor.id, submissions: [{ eid: "10812345" }],
      dryRun: false, selectedStepKeys });
    const queued = h.start(plan); assert.equal((await h.execute(queued)).state, "failed");
    const run = h.fresh(queued);
    const result = readRerunValues(rerunValuesDeps(h), request(run)); assert.ok(result.state === "available");
    assert.equal(Object.hasOwn(result.snapshot, "workers"), false);
    const input = { workflowId: h.descriptor.id, submissions: [{ eid: "10812345" }], dryRun: false, selectedStepKeys,
      rerunSource: { ...request(run), intent: "rerun", selectedStepKeys } };
    assert.equal(Object.hasOwn(h.planner.plan(input), "workers"), false);
    assert.throws(() => h.planner.plan({ ...input, workers: "auto" }));
    assert.throws(() => h.planner.plan({ ...input, workers: 2 }));
  });
  it.each(["session", "plan", "mismatch"] as const)("refuses a missing or mismatched source %s without a worker choice", async missing => {
    const h = await harness(); const run = await failed(h); const deps = rerunValuesDeps(h);
    const authority = { ...h.database.authority,
      ...(missing === "session" ? { runSessions: { ...h.database.authority.runSessions, get: () => undefined } }
        : { startPlans: { ...h.database.authority.startPlans, get: (id: string) => {
          const plan = h.database.authority.startPlans.get(id);
          return missing === "plan" || plan === undefined ? undefined : StartPlanRecordSchema.parse({ ...plan, workflowId: "wrong-workflow" });
        } } }),
    };
    assert.deepEqual(readRerunValues({ ...deps, database: { ...deps.database, authority,
      withAuthorityReadSnapshot: h.database.withAuthorityReadSnapshot.bind(h.database) } }, request(run)),
    { state: "refused", code: "source-invalid" });
    const { createStartPlanService } = await import("../../../../src/backend/runs/commands/start-plan-service.js");
    const active = h.database.authority.runtimeConfig.get(); assert.ok(active);
    const planner = createStartPlanService({ authority: { withAuthorityTransaction: work => h.database.withAuthorityTransaction(() => work(authority)) },
      authorityRead: h.database, descriptors: { resolve: () => h.descriptor }, clock: h.clock, ids: h.planIds,
      planTtlMs: 600_000, configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId, plannedBy: "local-operator" });
    const selectedStepKeys = h.descriptor.timeline.map(({ key }) => key);
    assert.throws(() => planner.plan({ workflowId: h.descriptor.id, submissions: [{ eid: "10812345" }], dryRun: false,
      selectedStepKeys, rerunSource: { ...request(run), intent: "rerun", selectedStepKeys } }),
    error => error instanceof RerunRefusedError && error.code === "schema-mismatch");
  });
  it.each(["sessionless", "intake"] as const)("accepts a legitimate %s source without a start choice", async origin => {
    const h = await harness(); const original = await failed(h); const deps = rerunValuesDeps(h);
    const { sessionId: _sessionId, ...sessionless } = original;
    const run = origin === "sessionless" ? RunRecordSchema.parse(sessionless) : original;
    const sessions = h.database.authority.runSessions;
    const result = readRerunValues({ ...deps, reader: { read: () => ({ state: "present", disposition: "live", run }) },
      database: { authority: { ...h.database.authority, runSessions: { ...sessions, get: (id: string) => {
        const session = sessions.get(id); assert.ok(session);
        return RunSessionRecordSchema.parse({ ...session, origin: { kind: "intake-manifest", intakeManifestId: h.ids.uuid(), actorId: "local-operator" } });
      } } }, withAuthorityReadSnapshot: h.database.withAuthorityReadSnapshot.bind(h.database) } }, request(run));
    assert.ok(result.state === "available"); assert.equal(Object.hasOwn(result.snapshot, "workers"), false);
  });
  it("round-trips attribution into the existing planner and rejects an edited value retaining attribution", async () => {
    const h = await harness(); const run = await failed(h);
    const result = readRerunValues(rerunValuesDeps(h), request(run)); assert.ok(result.state === "available");
    const value = result.snapshot.values[0]; assert.ok(value?.state === "available");
    const selectedStepKeys = h.descriptor.timeline.map(({ key }) => key);
    const input = { workflowId: h.descriptor.id, submissions: [{ eid: value.value }], dryRun: false, selectedStepKeys,
      rerunSource: { ...request(run), intent: "rerun", selectedStepKeys,
        copiedFrom: [{ nodeId: value.nodeId, fieldPath: value.fieldPath, targetFieldPath: value.targetFieldPath }] } };
    assert.ok(h.planner.plan(input).rerun?.source.copiedFrom?.length);
    assert.throws(() => h.planner.plan({ ...input, submissions: [{ eid: "10899999" }] }),
      (error) => error instanceof RerunRefusedError && error.code === "invalid-value");
    assert.ok(h.planner.plan({ ...input, submissions: [{ eid: "10899999" }], rerunSource: { ...input.rerunSource, copiedFrom: [] } }));
  });
  it("canonical absence and stale versions win over retained evidence", async () => {
    const h = await harness(); const run = await failed(h); const before = snapshot(h, run);
    const deps = rerunValuesDeps(h);
    assert.deepEqual(readRerunValues({ ...deps, reader: { read: () => ({ state: "absent", runId: run.envelope.runId }) } }, request(run)), { state: "refused", code: "target-not-found" });
    assert.deepEqual(readRerunValues(deps, { ...request(run), expectedVersion: run.version - 1 }), { state: "refused", code: "source-stale" });
    assert.deepEqual(readRerunValues({ ...deps, descriptors: { resolve: () => undefined } }, request(run)), { state: "refused", code: "descriptor-mismatch" });
    assert.equal(snapshot(h, run), before);
  });
  it("refuses active and cancelled canonical sources", async () => {
    const h = await harness(); const queued = h.start(h.proposal());
    assert.deepEqual(readRerunValues(rerunValuesDeps(h), request(queued)), { state: "refused", code: "source-ineligible" });
    const cancelled = requireLifecycleApplied(h.lifecycle.transition({ commandId: h.ids.uuid(), ...request(queued),
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: h.clock.now().toISOString() } }));
    assert.deepEqual(readRerunValues(rerunValuesDeps(h), request(cancelled)), { state: "refused", code: "source-ineligible" });
  });
  it("offers ordinary Rerun for successful and interrupted sources with completed evidence", async () => {
    const h = await harness(); await failed(h);
    const queued = h.start(h.proposal()); assert.equal((await h.execute(queued)).state, "done");
    const done = h.fresh(queued);
    assert.ok(h.database.authority.runCheckpoints.listByItem(h.descriptor.id, done.envelope.itemId).length > 0);
    assert.equal(readRerunValues(rerunValuesDeps(h), request(done)).state, "available");
    assert.equal(h.proposal(done).rerun?.source.runId, done.envelope.runId);
    const next = h.start(h.proposal()), owner = testWorkerLifetime(h.database, h.descriptor.id, 1);
    const claimed = requireLifecycleApplied(h.lifecycle.claimNext({ commandId: h.ids.uuid(), workflow: h.descriptor.id, workerId: owner.workerId,
      runtimeConfig: selectRunRuntime(h.database.authority) }));
    assert.equal(claimed.envelope.runId, next.envelope.runId);
    assert.equal(h.database.authority.runs.transition({ ...request(claimed), now: h.clock.now().toISOString(),
      claim: { workerId: owner.workerId, claimGeneration: claimed.claimGeneration }, lifecycle: { state: "terminal", outcome: "interrupted", endedAt: h.clock.now().toISOString() } }).state, "applied");
    const interrupted = h.fresh(next);
    assert.equal(readRerunValues(rerunValuesDeps(h), request(interrupted)).state, "available");
    assert.equal(h.proposal(interrupted).rerun?.source.runId, interrupted.envelope.runId);
  });
  it("never borrows another run's checkpoint", async () => {
    const h = await harness(); const run = await failed(h); const cp = firstCheckpoint(h, run);
    const deps = checkpointsDeps(h, [RunCheckpointRecordSchema.parse({ ...cp, runId: h.ids.uuid() })]);
    const result = readRerunValues(deps, request(run)); assert.ok(result.state === "available");
    assert.equal(result.snapshot.steps[0]?.state, "unfinished");
    assert.equal(result.snapshot.values[0]?.state, "unavailable");
  });
  for (const [name, patch] of [
    ["descriptor", { descriptorVersion: 99 }], ["attempt", { attempt: 99 }], ["future execution", { claimGeneration: 99 }],
    ["schema", { output: { schemaHash: "f".repeat(64), value: { eid: "10812345" } } }],
    ["payload", { output: { value: { eid: "bad" } } }],
  ] as const) it(`refuses mismatched checkpoint ${name}`, async () => {
    const h = await harness(); const run = await failed(h); const cp = firstCheckpoint(h, run);
    const deps = checkpointsDeps(h, [RunCheckpointRecordSchema.parse({ ...cp, ...patch,
      output: "output" in patch ? { ...cp.output, ...patch.output } : cp.output })]);
    assert.deepEqual(readRerunValues(deps, request(run)), { state: "refused", code: "source-invalid" });
  });
  it("reports missing provenance rather than inventing an observation date", async () => {
    const h = await harness(); const run = await failed(h); const cp = firstCheckpoint(h, run);
    const deps = checkpointsDeps(h, [{ ...cp, provenance: [] }]);
    const result = readRerunValues(deps, request(run)); assert.ok(result.state === "available");
    assert.equal(result.snapshot.values[0]?.state, "unavailable");
    assert.ok(result.snapshot.values[0]?.state === "unavailable" && result.snapshot.values[0].reason === "provenance-unavailable");
  });
  it("does not label operator assertions or later failed work as completed", async () => {
    const h = await harness(); const run = await failed(h); const cp = firstCheckpoint(h, run);
    const asserted = RunCheckpointRecordSchema.parse({ ...cp, assertion: { step: "read", assertedAt: cp.writtenAt } });
    const deps = checkpointsDeps(h, [asserted]);
    let result = readRerunValues(deps, request(run)); assert.ok(result.state === "available");
    assert.deepEqual(result.snapshot.steps[0]?.nodes[0], { nodeId: "read", state: "unfinished", reason: "operator-asserted" });
    result = readRerunValues({ ...rerunValuesDeps(h), executions: () => [{ nodeId: "read", attempt: run.envelope.attempt, startedAt: "2099-01-01T00:00:00.000Z", outcome: "failed" }] }, request(run));
    assert.ok(result.state === "available"); assert.equal(result.snapshot.steps[0]?.state, "failed");
    result = readRerunValues({ ...rerunValuesDeps(h), executions: () => [{ nodeId: "read", attempt: run.envelope.attempt, startedAt: "2099-01-01T00:00:00.000Z" }] }, request(run));
    assert.ok(result.state === "available"); assert.equal(result.snapshot.steps[0]?.state, "unfinished");
  });
  for (const disposition of ["committed", "observed-present"] as const) it(`serves ${disposition} transaction coordinates without granting consent`, async () => {
    const h = await harness(true);
    h.world.probeResults.push(disposition === "committed" ? absentProbeEvidence(h.clock.now().toISOString())
      : { state: "present", proof: { transactionId: "T123456" } });
    const run = await failed(h); const before = snapshot(h, run);
    const result = readRerunValues(rerunValuesDeps(h), request(run)); assert.ok(result.state === "available", JSON.stringify(result));
    assert.ok(result.snapshot.transactions.length > 0);
    assert.equal(result.snapshot.transactions[0]?.disposition, disposition);
    assert.equal(/acknowledgment|confirmationCommandId|businessKeyDigest/u.test(JSON.stringify(result)), false);
    assert.equal(snapshot(h, run), before);
  });
  it("withholds captured protected values, embedded copies, absent leaves and invalid targets", async () => {
    const h = await valueShapeHarness(profiles.create); disposers.push(h.dispose);
    const queued = h.start(h.planner.plan({ workflowId: h.descriptor.id, submissions: [{ eid: "10812345", documentNumber: "PRIVATE987" }],
      dryRun: false, selectedStepKeys: h.descriptor.timeline.map(({ key }) => key) }));
    const active = h.database.authority.runtimeConfig.get(); assert.ok(active);
    const { workerId } = testWorkerLifetime(h.database, h.descriptor.id, 1);
    const claimed = requireLifecycleApplied(h.lifecycle.claimNext({ commandId: h.ids.uuid(), workflow: h.descriptor.id,
      workerId, runtimeConfig: { generation: active.generation, settingsRevision: active.settingsRevision,
        settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint } }));
    assert.equal(claimed.envelope.runId, queued.envelope.runId);
    const node = descriptorRuntimeNodes(h.descriptor).find(({ id }) => id === "read"); assert.ok(node?.kind === "task");
    const value = { eid: "10812345", documentNumber: "PRIVATE987", embedded: "record PRIVATE987", invalidEid: "invalid" };
    const now = h.clock.now().toISOString();
    h.database.authority.runCheckpoints.insert(RunCheckpointRecordSchema.parse({ workflowId: h.descriptor.id,
      itemId: claimed.envelope.itemId, runId: claimed.envelope.runId, nodeId: "read", attempt: claimed.envelope.attempt, claimGeneration: claimed.claimGeneration,
      output: { schemaHash: deriveSchemaHash(node.uses.output, "output"), value }, descriptorVersion: h.descriptor.version,
      contractFingerprint: h.descriptor.contractFingerprint, implFingerprint: "b".repeat(64), writtenAt: now,
      provenance: Object.keys(value).map((path) => ({ path, source: "live", observedAt: now, originalObservedAt: now })),
    }));
    const later = descriptorRuntimeNodes(h.descriptor).find(node => node.id === "later"); assert.ok(later?.kind === "task");
    let running = claimed;
    for (const state of ["validating", "running"] as const) running = requireLifecycleApplied(h.lifecycle.workerTransition({
      commandId: h.ids.uuid(), runId: running.envelope.runId, expectedVersion: running.version,
      claim: { workerId, claimGeneration: running.claimGeneration }, lifecycle: { state, workerId,
        claimedAt: now, heartbeatAt: now, ...(state === "running" ? { currentNodeId: "later" } : {}) } }));
    const failure = buildNodeFailureRecord({ writes: [], run: running, failureId: h.ids.uuid(), nodeId: NodeIdSchema.parse("later"),
      taskId: later.uses.id, error: new Error("fixture later read failed"), occurredAt: now });
    const authorization = buildFailureTerminalAuthorization({ run: running, authorizedAt: now, consequence: { kind: "failed", failure } });
    const run = requireLifecycleApplied(h.lifecycle.terminalize({ commandId: h.ids.uuid(), kind: "failure", terminal: { authorization, failure } }, h.descriptor));
    const protectedRun = { ...run, input: { ...run.input, parsed: { ...run.input.parsed, protectedBindings: [{
      kind: "test-data-local" as const, inputPath: "documentNumber" as const,
      name: "separationsKualiFinalizationCanaryDocumentNumber" as const, sourceId: "10000000-0000-4000-8000-000000000001",
    }] } } };
    const result = readRerunValues({ ...rerunValuesDeps(h), reader: { read: () => ({ state: "present", disposition: "live", run: protectedRun }) } }, request(run));
    assert.ok(result.state === "available");
    assert.deepEqual(result.snapshot.values.map((value) => value.state === "available" ? "available" : value.reason),
      ["available", "protected", "protected", "not-recorded", "target-invalid"]);
    assert.equal(JSON.stringify(result).includes("PRIVATE987"), false);
    assert.deepEqual(result.snapshot.sourceInput, { state: "unavailable", reason: "protected" });
    assert.equal(result.snapshot.source.outcome, "failed");
    assert.deepEqual(result.snapshot.steps.map(({ state }) => state), ["completed", "failed"]);
  });
  it("deletion wins over retained checkpoints and never resurrects the source", async () => {
    const h = await harness(); const run = await failed(h);
    const cp = firstCheckpoint(h, run);
    const deleted=h.kernel.execute({commandId:h.ids.uuid(),requestedAt:h.clock.now().toISOString(),requestedBy:"local-operator",
      source:"dashboard",family:"run",type:"delete",target:request(run)});
    assert.equal(deleted.state,"applied",JSON.stringify(deleted));
    assert.ok(h.database.authority.deletedRuns.get(run.envelope.runId));
    const before = snapshot(h, run);
    assert.deepEqual(readRerunValues(checkpointsDeps(h, [cp]), request(run)), { state: "refused", code: "target-deleted" });
    assert.equal(snapshot(h, run), before);
  });

  for (const kind of ["nested-schema", "proof-link"] as const) it(`refuses transaction ${kind} corruption`, async () => {
    const h = await harness(true); h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    const run = await failed(h); const cp = firstCheckpoint(h, run);
    const outcome = TransactionOutcomeSchema.parse(cp.output.value);
    const proof = kind === "nested-schema" ? { ...outcome.proof, schemaHash: "f".repeat(64) }
      : { ...outcome.proof, value: { transactionId: "T999999" } };
    const altered = RunCheckpointRecordSchema.parse({ ...cp, output: { ...cp.output, value: { ...outcome, proof } } });
    assert.deepEqual(readRerunValues(checkpointsDeps(h, [altered]), request(run)), { state: "refused", code: "source-invalid" });
  });

  it("classifies a real failed source from its retained failure without exposing its diagnostic text", async () => {
    const h = await harness(true); h.world.subjectReadThrows = new Error("synthetic private diagnostic");
    const queued = h.start(h.proposal()); assert.equal((await h.execute(queued)).state, "failed"); const run = h.fresh(queued);
    const result = readRerunValues(rerunValuesDeps(h), request(run)); assert.ok(result.state === "available", JSON.stringify(result));
    assert.equal(result.snapshot.source.outcome, "failed"); assert.equal(result.snapshot.steps[0]?.state, "failed");
    assert.equal(JSON.stringify(result).includes("synthetic private diagnostic"), false);
  });

  it("refuses an otherwise eligible source while the same item has an attempting write", async () => {
    const h = await harness(); const run = await failed(h); const deps = rerunValuesDeps(h);
    const attempting = WriteIntentRecordSchema.parse({ ...WRITE_INTENT_ATTEMPTING, workflowId: h.descriptor.id,
      itemId: run.envelope.itemId, runId: run.envelope.runId, runAttempt: run.envelope.attempt });
    const database = { withAuthorityReadSnapshot: h.database.withAuthorityReadSnapshot.bind(h.database),
      authority: { ...h.database.authority, writeIntents: { ...h.database.authority.writeIntents,
        listAttemptingByItem: () => [attempting] } } };
    assert.deepEqual(readRerunValues({ ...deps, database }, request(run)), { state: "refused", code: "source-ineligible" });
  });

  it("offers attributed completed transaction evidence and explicitly recovers it without new effects", async () => {
    const h = await harness(true, true);
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString())); const run = await failed(h);
    const result = readRerunValues(rerunValuesDeps(h), request(run)); assert.ok(result.state === "available");
    const value = result.snapshot.values[0]; assert.ok(value?.state === "available", JSON.stringify(value));
    assert.equal(value.value, "T123456"); assert.equal(value.fieldPath, "output.value.transactionId");
    const effects = () => canonicalJsonStringify({ events: h.world.events.filter(event => !event.startsWith("read:")),
      intents: h.database.authority.writeIntents.listByRun(run.envelope.runId), checkpoints: h.database.authority.runCheckpoints.listByItem(h.descriptor.id, run.envelope.itemId).filter(row => row.nodeId === WRITE_FIXTURE_NODE_ID),
      confirmations: h.database.authority.timelineEvents.page({}).filter(row => row.payload.kind === "operation-confirmed") });
    const before = effects();
    const recovered = h.kernel.execute({ commandId: h.ids.uuid(), requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator",
      source: "dashboard", family: "run", type: "recover-run", target: request(run) });
    assert.equal(recovered.state, "applied"); assert.ok(recovered.state === "applied");
    const target = recovered.affectedTargets[0]; assert.ok(target?.family === "run");
    const continued = h.database.authority.runs.get(target.runId); assert.ok(continued);
    assert.ok(continued.envelope.continuation); assert.equal(continued.envelope.sourceBound, undefined);
    assert.equal((await h.execute(continued)).state, "done");
    assert.deepEqual(h.database.authority.writeIntents.listByRun(continued.envelope.runId), []);
    assert.equal(effects(), before);
  });

  it("never echoes malformed stored JSON and still propagates operational storage failures", async () => {
    const h = await harness(); const run = await failed(h); const deps = rerunValuesDeps(h);
    assert.deepEqual(readRerunValues({ ...deps, reader: { read: () => { throw new SyntaxError("PRIVATE_SOURCE_TEXT"); } } }, request(run)),
      { state: "refused", code: "source-invalid" });
    const busy = new Error("SQLITE_BUSY");
    assert.throws(() => readRerunValues({ ...deps, reader: { read: () => { throw busy; } } }, request(run)), (error) => error === busy);
  });

  it("retains earlier same-run claims and chooses the latest execution independently of repository order", async () => {
    let pause = () => {};
    const h = await sourceBoundHarness(mappedReadDescriptor(), world => sourceBoundReadStores(world, 2, () => pause()),
      undefined, undefined, profiles.create); disposers.push(h.dispose);
    const source = h.start(h.proposal());
    pause = () => {
      pause = () => {};
      const current = h.fresh(source);
      requireLifecycleApplied(h.lifecycle.pause({ commandId: h.ids.uuid(), runId: current.envelope.runId, expectedVersion: current.version }));
    };
    assert.equal((await h.execute(source)).state, "abandoned");
    const held = h.fresh(source); assert.equal(held.pause?.state, "paused");
    const cp = firstCheckpoint(h, held);
    h.clock.advanceWall(1);
    const resumed = requireLifecycleApplied(h.lifecycle.resumePaused({ commandId: h.ids.uuid(), runId: held.envelope.runId, expectedVersion: held.version }));
    assert.equal((await h.execute(resumed)).state, "failed");
    const run = h.fresh(resumed); assert.equal(run.claimGeneration, 2);
    const attemptDeps = (rows: readonly RunCheckpointRecord[]) => checkpointsDeps(h, rows);
    const earlier = readRerunValues(attemptDeps([cp]), request(run)); assert.ok(earlier.state === "available");
    assert.ok(earlier.snapshot.values[0]?.state === "available"); assert.equal(earlier.snapshot.values[0].checkpoint.claimGeneration, 1);
    const later = RunCheckpointRecordSchema.parse({ ...cp, claimGeneration: 2,
      output: { ...cp.output, value: { eid: "10899999" } } });
    const newest = readRerunValues(attemptDeps([later, cp]), request(run)); assert.ok(newest.state === "available");
    assert.ok(newest.snapshot.values[0]?.state === "available"); assert.equal(newest.snapshot.values[0].value, "10899999");
    const interrupted = readRerunValues({ ...attemptDeps([cp]),
      executions: () => [{ nodeId: "read", attempt: run.envelope.attempt, startedAt: h.clock.now().toISOString() }] }, request(run));
    assert.ok(interrupted.state === "available"); assert.equal(interrupted.snapshot.steps[0]?.state, "unfinished");
  });

});
