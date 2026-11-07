import assert from "node:assert/strict";
import { z } from "zod";
import { afterEach, describe, it } from "vitest";
import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";
import { absentProbeEvidence, WRITE_FIXTURE_NOW, WRITE_FIXTURE_RUN_ID, WRITE_FIXTURE_WORKFLOW_ID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID, writeFixtureSaveDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { WriteParkedError } from "../../../../src/backend/runtime/writes/write-sequencer.js";

const { harness, claimRunning, contextFor, intentByKey, cleanup } = createWriteSequencerTestWorld();
afterEach(cleanup);

// The probe refusal wraps the capture failure as its cause; the prepare refusal raises it directly.
const screenshotCaptureFailure = (error: unknown): boolean => {
  const code = (value: unknown) => value instanceof Error && "code" in value ? value.code : undefined;
  return code(error) === "BROWSER_SCREENSHOT_CAPTURE_FAILED" || (error instanceof Error && code(error.cause) === "BROWSER_SCREENSHOT_CAPTURE_FAILED");
};

describe("required transaction captures", () => {
  for (const role of ["probe", "prepare"] as const) it(`refuses before fence when the ${role} step capture fails`, async () => {
    const h = await harness({ captureFailure: role });
    const claimed = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    await assert.rejects(h.execute(contextFor(claimed.run, claimed.claim)), screenshotCaptureFailure);
    assert.equal(intentByKey(h.database), undefined);
    assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, 0);
    assert.ok(h.world.events.includes("capture:step"));
  });

  it("parks a verified write when the verifier step capture fails", async () => {
    const h = await harness({ captureFailure: "verify" });
    const claimed = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.verifyResults.push({ state: "present", proof: { transactionId: "T222222" } });
    await assert.rejects(h.execute(contextFor(claimed.run, claimed.claim, writeFixtureSaveDescriptor)), WriteParkedError);
    assert.equal(intentByKey(h.database)?.status, "parked");
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
    assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, 1);
    assert.ok(h.world.events.includes("verify"));
    assert.equal(h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID), undefined);
  });

  it("stops before the fence and click when the pre-submit capture fails", async () => {
    const h = await harness({ captureFailure: "before-submit" });
    const claimed = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    await assert.rejects(h.execute(contextFor(claimed.run, claimed.claim)), /screenshot/i);
    assert.equal(intentByKey(h.database), undefined);
    assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, 0);
    assert.ok(h.world.events.includes("capture:before-submit"));
  });

  it("verifies then parks after a post-submit capture failure with one click", async () => {
    const h = await harness({ captureFailure: "after-submit" });
    const claimed = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.verifyResults.push({ state: "present", proof: { transactionId: "T222222" } });
    await assert.rejects(h.execute(contextFor(claimed.run, claimed.claim, writeFixtureSaveDescriptor)), WriteParkedError);
    assert.equal(intentByKey(h.database)?.status, "parked");
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
    assert.equal(h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID), undefined);
    assert.equal(h.database.authority.timelineEvents.page({ runId: WRITE_FIXTURE_RUN_ID, limit: 100 }).some(event => event.payload.kind === "operation-confirmed"), false);
    assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, 1);
    assert.ok(h.world.events.indexOf("capture:before-submit") < h.world.events.findIndex(event => event.startsWith("commit-click:")));
    assert.ok(h.world.events.indexOf("capture:after-submit") < h.world.events.indexOf("verify"));
  });

  it("verifies then parks even when the unavailable-capture warning fails schema validation", async () => {
    const h = await harness({ captureFailure: "after-submit" });
    const claimed = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.verifyResults.push({ state: "present", proof: { transactionId: "T222222" } });
    let reported = 0;
    await assert.rejects(h.execute({ ...contextFor(claimed.run, claimed.claim, writeFixtureSaveDescriptor),
      captureLog: { warn: () => { throw new z.ZodError([]); } },
      onDiagnosticDeliveryFailure: () => { reported += 1; },
    }), WriteParkedError);
    assert.equal(intentByKey(h.database)?.status, "parked");
    assert.ok(h.world.events.includes("verify"));
    assert.equal(h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID), undefined);
    assert.equal(h.database.authority.timelineEvents.page({ runId: WRITE_FIXTURE_RUN_ID, limit: 100 }).some(event => event.payload.kind === "operation-confirmed"), false);
    assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, 1);
    assert.equal(reported, 1);
  });

  it("parks unknown verification after a post-submit capture failure without clicking again", async () => {
    const h = await harness({ captureFailure: "after-submit" });
    const claimed = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.verifyResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    await assert.rejects(h.execute(contextFor(claimed.run, claimed.claim, writeFixtureSaveDescriptor)), WriteParkedError);
    assert.equal(intentByKey(h.database)?.status, "parked");
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
    assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, 1);
    assert.ok(h.world.events.includes("verify"));
  });
});
