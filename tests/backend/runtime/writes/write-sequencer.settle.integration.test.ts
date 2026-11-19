import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it, vi } from "vitest";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { WriteParkedError } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { recordingLogger } from "../../../support/helpers/phase1f-executor-harness.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { absentProbeEvidence, WRITE_FIXTURE_NOW, writeFixtureSaveDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";

const { harness, claimRunning, contextFor, intentByKey, cleanup } = createWriteSequencerTestWorld();
afterEach(cleanup);

it("commits a verified Save when Pause wins the race to the settlement transaction", async () => {
  const h = await harness();
  const { run, claim } = claimRunning(h.database, h.clock);
  h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
  h.world.verifyResults.push({ state: "present", proof: { transactionId: "T123456" } });
  const transact = h.database.withAuthorityTransaction.bind(h.database);
  await h.execute({
    ...contextFor(run, claim, writeFixtureSaveDescriptor),
    onSavedEffectVerified() {
      vi.spyOn(h.database, "withAuthorityTransaction").mockImplementationOnce(work => {
        const current = h.database.authority.runs.get(run.envelope.runId);
        assert.ok(current);
        requireLifecycleApplied(testRunService(h.database, h.clock).pause({
          commandId: randomUUID(), runId: run.envelope.runId, expectedVersion: current.version,
        }));
        return transact(work);
      });
    },
  });
  assert.equal(h.database.authority.runs.get(run.envelope.runId)?.pause?.state, "requested");
  assert.equal(intentByKey(h.database)?.status, "committed");
  assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, 1);
});

it("parks the uncertain Save before a close warning reaches a throwing sink", async () => {
  const warning = vi.fn<() => void>();
  const h = await harness({ log: { ...recordingLogger().log, warn: warning } });
  const { run, claim } = claimRunning(h.database, h.clock);
  h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
  h.world.commitThrows = new Error("Save outcome unknown");
  vi.spyOn(h.manager, "closeAll").mockRejectedValueOnce(new Error("browser close failed"));
  let statusAtWarning: string | undefined;
  warning.mockImplementation(() => {
    statusAtWarning = intentByKey(h.database)?.status;
    throw new Error("warning sink unavailable");
  });
  const diagnosticFailure = vi.fn();
  await assert.rejects(h.execute({ ...contextFor(run, claim), onDiagnosticDeliveryFailure: diagnosticFailure }),
    (error: unknown) => error instanceof WriteParkedError && error.parkCode === "unknown");
  assert.equal(statusAtWarning, "parked");
  assert.equal(diagnosticFailure.mock.calls.length, 1);
  assert.equal(h.database.authority.runs.get(run.envelope.runId)?.lifecycle.state, "parked-write");
});

it("parks a proven Save with its settlement reason when poison-close also fails", async () => {
  const settlementError = new Error("settlement transaction failed");
  const closeError = new Error("poison-close failed");
  const h = await harness({ hooks: { afterSequencedStep() { throw settlementError; } } });
  const { run, claim } = claimRunning(h.database, h.clock);
  h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
  h.world.verifyResults.push({ state: "present", proof: { transactionId: "T123456" } });
  const open = h.sessions.factory.open.bind(h.sessions.factory);
  vi.spyOn(h.sessions.factory, "open").mockImplementation(async input => {
    const resource = await open(input);
    return { ...resource, async close(options) {
      if (options.reason === "poisoned") throw closeError;
      return resource.close(options);
    } };
  });

  await assert.rejects(h.execute(contextFor(run, claim, writeFixtureSaveDescriptor)), (error: unknown) => {
    assert.ok(error instanceof WriteParkedError);
    const intent = intentByKey(h.database);
    assert.ok(intent?.status === "parked");
    assert.equal(intent.authorityReason?.evidence.kind, "settlement");
    assert.equal(intent.parkedCode, "unknown");
    assert.equal(intent.message, "The save was proven but could not be recorded; check again to confirm it");
    const lifecycle = h.database.authority.runs.get(run.envelope.runId)?.lifecycle;
    assert.ok(lifecycle?.state === "parked-write");
    assert.equal(lifecycle.writeIntentId, intent.writeIntentId);
    assert.equal(lifecycle.intentGeneration, intent.generation);
    assert.equal(lifecycle.message, intent.message);
    assert.ok(error.cause instanceof AggregateError);
    assert.ok(error.cause.cause instanceof Error);
    assert.equal(error.cause.cause.cause, settlementError);
    assert.ok(error.cause.errors.includes(closeError));
    return true;
  });
  assert.equal(h.database.authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId).length, 0);
  assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, 1);
});

for (const resetFails of [false, true]) {
  it(`durably commits a verified Save before the browser reset ${resetFails ? "fails" : "succeeds"}`, async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.verifyResults.push({ state: "present", proof: { transactionId: "T123456" } });
    const open = h.sessions.factory.open.bind(h.sessions.factory);
    const statusAtReset: (string | undefined)[] = [];
    const resetError = new Error("neutral reset failed");
    vi.spyOn(h.sessions.factory, "open").mockImplementation(async input => {
      const resource = await open(input);
      return { ...resource, async reset(options) {
        if (h.world.events.includes("verify")) {
          statusAtReset.push(intentByKey(h.database)?.status);
          if (resetFails) throw resetError;
        }
        await resource.reset(options);
      } };
    });

    const execution = h.execute(contextFor(run, claim, writeFixtureSaveDescriptor));
    if (resetFails) {
      await assert.rejects(execution, (error: unknown) => error === resetError);
      assert.deepEqual(h.sessions.closeReasons(), ["poisoned"]);
    } else {
      assert.deepEqual(await execution, { disposition: "committed", proofSource: "normal-output",
        output: { transactionId: "T123456" }, proof: { transactionId: "T123456" } });
    }
    assert.deepEqual(statusAtReset, ["committed"]);
    assert.equal(intentByKey(h.database)?.status, "committed");
    assert.equal(h.database.authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId).length, 1);
    assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, 1);
  });
}
