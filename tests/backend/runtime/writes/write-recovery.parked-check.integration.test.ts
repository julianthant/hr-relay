import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { checkParkedWrite } from "../../../../src/backend/runtime/writes/write-recovery.js";
import { WorkerSessionClosureUnprovedError } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { UcpathTerminationTargetSchema, UcpathTransactionScanSchema } from "../../../../src/models/ui/ucpath-smart-hr-termination.js";
import { UcpathCreateTermination, UcpathCreateTerminationOutputSchema, ucpathTerminationIdempotencyKey } from "../../../../src/models/systems/ucpath/create-termination.js";
import { UcpathStageTermination } from "../../../../src/models/systems/ucpath/stage-termination.js";
import { ParkedWriteCheckTargetSchema } from "../../../../src/rules/commands/commands.js";
import { PositiveIntSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { deriveIdempotencyKeyDigest, deriveWriteAuthorityReason, deriveWriteBindingProofDigest, WriteAttemptRecordSchema, WriteIntentRecordSchema } from "../../../../src/rules/write-safety/write-safety.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { openBoundDatabaseFixture } from "../../../support/helpers/admission-fixture.js";
import { ManualScheduler, recordingLogger } from "../../../support/helpers/phase1f-executor-harness.js";
import { UUID_5, UUID_6, UUID_7, UUID_8 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { WRITE_FIXTURE_NOW, WRITE_FIXTURE_FINGERPRINT, WRITE_FIXTURE_OBSERVATION, WRITE_FIXTURE_STAGED_STATE, writeFixtureQueuedRun } from "../../../support/fixtures/write-sequencer-fixtures.js";

const NOW = WRITE_FIXTURE_NOW;
const TARGET = UcpathTerminationTargetSchema.parse({ emplId: "10800000", expectedName: "Synthetic Person", emplRecord: "0", effectiveDate: "06/11/2026",
  template: "UC_VOL_TERM", reasonCode: "Resign - Attend School", lastDateWorked: "06/10/2026", initiatorComments: "Synthetic read-only check" });
const canonical = defineCanonicalInput(UcpathTerminationTargetSchema, UcpathTerminationTargetSchema, [TARGET]);
const graph = flow(UcpathTerminationTargetSchema).transaction("submit-write", { dependsOn: [],
  prepare: { uses: UcpathStageTermination, bind: ({ input }) => input },
  commit: { uses: UcpathCreateTermination, bind: ({ input }) => input },
  dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000,
}).build({ schema: UcpathCreateTerminationOutputSchema, dependsOn: ["submit-write"], derive: ({ outputs }) => outputs["submit-write"].output });
const descriptor = defineWorkflowDescriptor({ id: WorkflowIdSchema.parse("separations"), version: 1, contractFingerprint: WRITE_FIXTURE_FINGERPRINT,
  code: "sep", label: "Synthetic held probe", icon: "ShieldCheck", category: "operations", canonicalInput: canonical, inputSubject: "eid",
  surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [],
  identity: { matchKey: input => `eid:${input.emplId}` }, presentation: { title: () => "Synthetic held probe" }, scenarios: ["parked-check/read"], flow: graph });

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose(); });
async function fixture(rows: number) {
  const clock = manualClock(new Date(NOW));
  const opened = await openBoundDatabaseFixture("parked-read-check", clock);
  disposers.push(() => opened.close());
  const template = RunRecordSchema.parse(writeFixtureQueuedRun());
  const run = RunRecordSchema.parse({ ...template, envelope: { ...template.envelope, workflow: descriptor.id, descriptorVersion: descriptor.version,
    contractFingerprint: descriptor.contractFingerprint, resolvedInstance: { ucpath: "production" }, dryRun: false },
    input: { raw: TARGET, parsed: { schemaHash: deriveSchemaHash(canonical, "output"), value: TARGET, protectedBindings: [] },
      ingressSchemaHash: deriveSchemaHash(UcpathTerminationTargetSchema, "input") },
    lifecycle: { state: "parked-write", writeIntentId: UUID_8, intentGeneration: 1, parkedAt: NOW, code: "unknown", message: "Synthetic unknown write" }, version: 4 });
  const proof = { kind: "subject-match", version: 1, proofId: UUID_7, runId: run.envelope.runId, attempt: run.envelope.attempt, leaseId: UUID_6,
    taskId: UcpathCreateTermination.id, observationId: WRITE_FIXTURE_OBSERVATION, pageStateId: WRITE_FIXTURE_STAGED_STATE,
    expected: { kind: "person", identifierKind: "eid", bindingDigest: "a".repeat(64), displaySuffix: "0000" },
    observed: { kind: "person", identifierKind: "eid", bindingDigest: "a".repeat(64), displaySuffix: "0000" }, match: "match", observedAt: NOW,
    afterPrepareSpanPath: `${run.envelope.traceId}/submit-write/prepare` };
  const key = ucpathTerminationIdempotencyKey(TARGET);
  const intent = WriteIntentRecordSchema.parse({ writeIntentId: UUID_8, workflowId: descriptor.id, itemId: run.envelope.itemId, taskId: UcpathCreateTermination.id,
    system: "ucpath", idempotencyKey: key, idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", key), currentAttemptId: UUID_5,
    generation: 1, runId: run.envelope.runId, runAttempt: run.envelope.attempt, bindingProof: proof, bindingProofDigest: deriveWriteBindingProofDigest(proof),
    fencedAt: NOW, version: 1, createdAt: NOW, updatedAt: NOW, status: "parked", parkedCode: "unknown", message: "Synthetic unknown write",
    authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "synthetic") });
  const attempt = WriteAttemptRecordSchema.parse({ writeAttemptId: UUID_5, writeIntentId: UUID_8, generation: 1, runId: run.envelope.runId,
    runAttempt: run.envelope.attempt, leaseId: UUID_6, bindingProof: proof, bindingProofDigest: intent.bindingProofDigest, fencedAt: NOW,
    outcome: { state: "parked", code: "unknown", message: "Synthetic unknown write", authorityReason: intent.authorityReason }, recordedAt: NOW });
  const repositories = { ...opened.database.authority, runs: { ...opened.database.authority.runs, get: () => run },
    writeIntents: { ...opened.database.authority.writeIntents, get: () => intent }, writeAttempts: { ...opened.database.authority.writeAttempts, get: () => attempt } };
  const target = ParkedWriteCheckTargetSchema.parse({ workerId: "separations-worker-1", expectedVersion: 1, controlBasis: { leaseGeneration: 1, controlRevision: 1 },
    membershipRevision: 1, processId: 42, startedAt: NOW, installationId: UUID_6, profileId: UUID_7,
    workflowId: descriptor.id, itemId: run.envelope.itemId, runId: run.envelope.runId, runVersion: run.version,
    runAttempt: run.envelope.attempt, traceId: run.envelope.traceId, nodeId: "submit-write", writeIntentId: UUID_8, intentVersion: 1,
    intentGeneration: 1, writeAttemptId: UUID_5, bindingProofDigest: intent.bindingProofDigest, occurrenceKeyDigest: intent.idempotencyKeyDigest });
  const events: string[] = [];
  let failClose = false;
  let failRead = false;
  let afterRead = () => {};
  const driver = { system: "ucpath" as const, scanTerminationTransactions: async () => UcpathTransactionScanSchema.parse({ state: "read", emplId: TARGET.emplId,
    rows: Array.from({ length: rows }, (_, index) => ({ transactionId: `T00220963${index + 1}`, emplId: TARGET.emplId, action: "Terminatn", approvalStatus: "Pending",
      startDate: TARGET.effectiveDate, displayedName: TARGET.expectedName })), scannedRowCount: rows, observedAt: NOW }) };
  const sessions: Parameters<typeof checkParkedWrite>[0]["sessions"] = {
    withDriver: async (_need, _instance, _signal, operation) => { events.push("read"); if (failRead) throw new Error("synthetic-read-unavailable"); const result = await operation(driver); afterRead(); return result; },
    bindRunConfigFingerprint: () => { events.push("bind"); }, releaseRunConfigFingerprint: () => { events.push("release"); },
    closeAll: async () => { events.push("close"); if (failClose && events.includes("read")) throw new WorkerSessionClosureUnprovedError("separations-worker-1"); },
  };
  const input: Parameters<typeof checkParkedWrite>[0] = { repositories, descriptor, target, commandId: UUID_7, requestedBy: "local-operator", signal: new AbortController().signal,
    probe: { stores: taskStoreRegistry, clock, scheduler: new ManualScheduler(clock), taskDeadlineMs: 1000, log: recordingLogger().log }, sessions,
    configureRun: () => ({ taskDeadlineMs: 1000 }) };
  return { input, events, run, intent, attempt, failClosure: () => { failClose = true; }, failRead: () => { failRead = true; }, afterRead: (fn: () => void) => { afterRead = fn; } };
}

describe("held-only parked write checks", () => {
  for (const rows of [0, 1, 2]) it(`reads ${rows} synthetic matches without changing write or run authority`, async () => {
    const h = await fixture(rows);
    const before = canonicalJsonStringify([h.run, h.intent, h.attempt]);
    const result = await checkParkedWrite(h.input);
    assert.equal(result.result.held, true);
    assert.equal(result.result.state, rows === 0 ? "absent" : "ambiguous");
    assert.equal(result.result.code, rows === 1 ? "PARKED_CHECK_OCCURRENCE_UNPROVED" : rows === 0 ? "PARKED_CHECK_ABSENT" : "PARKED_CHECK_AMBIGUOUS");
    assert.equal(result.result.provenance, "system-probe");
    assert.ok(result.evidence);
    assert.deepEqual(h.events, ["close", "bind", "read", "close", "release"]);
    assert.equal(canonicalJsonStringify([h.run, h.intent, h.attempt]), before);
  });
  it("refuses stale occurrence identities before session or provider access", async () => {
    const h = await fixture(1);
    for (const patch of [{ runVersion: 5 }, { intentGeneration: 2 }, { writeAttemptId: UUID_6 }, { bindingProofDigest: "b".repeat(64) }, { occurrenceKeyDigest: "b".repeat(64) }]) {
      await assert.rejects(checkParkedWrite({ ...h.input, target: ParkedWriteCheckTargetSchema.parse({ ...h.input.target, ...patch }) }), /parked-check-authority-changed/);
    }
    assert.deepEqual(h.events, []);
  });
  it("keeps missing read capability unavailable before session access", async () => {
    const h = await fixture(1);
    const result = await checkParkedWrite({ ...h.input, probe: { ...h.input.probe, stores: { ...taskStoreRegistry, stores: [] } } });
    assert.equal(result.result.state, "unavailable"); assert.equal(result.result.provenance, "not-observed");
    assert.equal(result.evidence, undefined); assert.deepEqual(h.events, []);
  });
  it("refuses a foreign actor or cancelled request before provider access", async () => {
    const h = await fixture(1);
    await assert.rejects(checkParkedWrite({ ...h.input, requestedBy: "assistant" }), /PARKED_CHECK_UNAVAILABLE/);
    const controller = new AbortController(); controller.abort(new Error("synthetic-stop"));
    await assert.rejects(checkParkedWrite({ ...h.input, signal: controller.signal }), /synthetic-stop/);
    assert.deepEqual(h.events, []);
  });
  it("keeps a failed read UNKNOWN without granting retry or settlement", async () => {
    const h = await fixture(1); h.failRead();
    const before = canonicalJsonStringify([h.run, h.intent, h.attempt]);
    const result = await checkParkedWrite(h.input);
    assert.equal(result.result.state, "unknown"); assert.equal(result.result.provenance, "not-observed");
    assert.equal(result.evidence, undefined); assert.equal(result.result.held, true);
    assert.deepEqual(h.events, ["close", "bind", "read", "close", "release"]);
    assert.equal(canonicalJsonStringify([h.run, h.intent, h.attempt]), before);
  });
  it("refuses a successful but stale or cancelled observation after closing its sessions", async () => {
    for (const scenario of ["revision", "abort"] as const) {
      const h = await fixture(1), controller = new AbortController();
      h.afterRead(() => { if (scenario === "revision") h.run.version = PositiveIntSchema.parse(h.run.version + 1); else controller.abort(new Error("synthetic-late-stop")); });
      await assert.rejects(checkParkedWrite({ ...h.input, signal: controller.signal }), scenario === "revision" ? /parked-check-authority-changed/ : /synthetic-late-stop/);
      assert.deepEqual(h.events, ["close", "bind", "read", "close", "release"]);
      assert.equal(h.intent.status, "parked"); assert.equal(h.attempt.outcome.state, "parked");
    }
  });
  it("propagates unproved closure and releases the retained config binding", async () => {
    const h = await fixture(1); h.failClosure();
    await assert.rejects(checkParkedWrite(h.input), WorkerSessionClosureUnprovedError);
    assert.deepEqual(h.events, ["close", "bind", "read", "close", "release"]);
    assert.equal(h.run.lifecycle.state, "parked-write"); assert.equal(h.intent.status, "parked");
  });
});
