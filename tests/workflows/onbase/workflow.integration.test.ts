import { onbaseModule } from "../../support/helpers/registered-workflows.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { PDFDocument } from "@cantoo/pdf-lib";
import { afterEach, it } from "vitest";
import { createOnbaseDriver } from "../../../src/backend/systems/onbase/driver/interpreter.js";
import { executeClaimedRun } from "../../../src/backend/runtime/execution/run-executor.js";
import { createWriteSequencer } from "../../../src/backend/runtime/writes/write-sequencer.js";
import { planStart } from "../../../src/backend/runs/start/plan.js";
import { buildQueuedRun } from "../../../src/backend/runs/start/enqueue.js";
import { ONBASE_EXAMPLE_INPUT, OnbaseInputSchema } from "../../../src/models/systems/onbase/import-document.js";
import { createRunExecutorTestWorld } from "../../support/helpers/backend/run-executor-world.js";
import { sessionFactoryHarness } from "../../support/helpers/phase1f-executor-harness.js";
import { fakeOnbasePage } from "../../support/helpers/browser/fake-onbase-page.js";
import { testWorkerPorts } from "../../support/fixtures/run-lifecycle-fixtures.js";
import { sequentialIdFactory } from "../../support/fixtures/phase1f-run-fixtures.js";
import { CONFIG_SNAPSHOT } from "../../support/fixtures/phase1c-contract-fixtures.js";

const world = createRunExecutorTestWorld();
afterEach(world.cleanup);
async function runOnbase(mode: "dry-run" | "committed" | "lost-acknowledgement") {
  const pdf = await PDFDocument.create({ updateMetadata: false }); pdf.addPage([100, 200]); pdf.addPage([300, 400]);
  const bytes = await pdf.save(), page = fakeOnbasePage({ lostClick: mode === "lost-acknowledgement" });
  const sessions = sessionFactoryHarness({ onbase: () => createOnbaseDriver(() => undefined, page.page, harness.authority.clock) });
  const harness = await world.executorHarness({ descriptor: onbaseModule.descriptor, sessions });
  const { database, clock, path } = harness.authority, descriptor = onbaseModule.descriptor;
  const input = OnbaseInputSchema.parse({ ...ONBASE_EXAMPLE_INPUT, sourcePage: 2,
    document: { ...ONBASE_EXAMPLE_INPUT.document, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length } });
  const dryRun = mode === "dry-run";
  const plan = planStart({ authority: database, clock, ids: sequentialIdFactory("f"), planTtlMs: 600000 }, { descriptor, submissions: [input], dryRun,
    priority: "bulk", shape: "operation-member", plannedBy: "local-operator", configFingerprint: CONFIG_SNAPSHOT.fingerprint, configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId });
  assert.equal(plan.refused.length, 0); const entry = plan.planned[0]; assert.ok(entry);
  const queued = buildQueuedRun({ descriptor, runId: "22222222-2222-4222-8222-222222222222", itemId: entry.itemId, traceId: "ob-090000-2222",
    rawInput: entry.rawInput, canonicalInput: entry.input, ingressSchemaHash: plan.ingressSchemaHash, configFingerprint: plan.configFingerprint,
    configSnapshotId: plan.configSnapshotId, resolvedInstance: plan.resolvedInstance, shape: plan.shape, priority: plan.priority, dryRun,
    attempt: 1, runNumber: 1, appVersion: "0.1.0", now: clock.now().toISOString() });
  testWorkerPorts(database, clock, { path, descriptor, poolIndex: 1 });
  const slot = database.authority.workerSlots.list(descriptor.id).find(member => member.poolIndex === 1 && member.retiredAt === null); assert.ok(slot);
  database.authority.runs.enqueue(queued);
  const claimed = database.authority.runs.claimNext({ workflow: descriptor.id, workerId: slot.workerId, now: clock.now().toISOString() });
  assert.equal(claimed.state, "claimed"); if (claimed.state !== "claimed") throw new Error("fixture claim failed");
  const sequencer = createWriteSequencer({ lifecycle: harness.deps.lifecycle, stores: harness.deps.stores, authority: database, sessions: harness.manager,
    emitter: harness.emitter.emitter, clock, ids: harness.deps.ids, scheduler: harness.scheduler, taskDeadlineMs: 60000, operator: "local-operator", log: harness.deps.log });
  const result = await executeClaimedRun({ ...harness.deps, writeSequencer: sequencer, artifacts: { open: async () => Readable.from([bytes]),
    put: async () => { throw new Error("unexpected artifact write"); } } },
  { run: claimed.run, claim: { workerId: slot.workerId, claimGeneration: claimed.run.claimGeneration }, signal: new AbortController().signal });
  const failures = database.authority.failures.listByRun(queued.envelope.runId);
  assert.equal(result.state, mode === "lost-acknowledgement" ? "parked-write" : "done", JSON.stringify(failures.map(failure => failure.summary)));
  assert.equal(page.actions.filter(action => action === "click:Import").length, dryRun ? 0 : 1);
  if (dryRun) assert.deepEqual(database.authority.writeIntents.countDryRunEvidenceByRun(queued.envelope.runId), { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
  if (mode === "lost-acknowledgement") assert.equal(database.authority.writeIntents.listByRun(queued.envelope.runId)[0]?.status, "parked");
  if (mode === "committed") assert.ok(database.authority.runResults.get(queued.envelope.runId));
}

it("onbase/dry-run — runs the registered child through the real executor and stops after preparation", () => runOnbase("dry-run"));
it("onbase/committed — runs one import through the real executor and sequencer with a durable result", () => runOnbase("committed"));
it("onbase/unknown — parks a lost Import acknowledgement without another click", () => runOnbase("lost-acknowledgement"));
