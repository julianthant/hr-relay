import assert from "node:assert/strict";
import { z } from "zod";
import { afterEach, describe, it } from "vitest";
import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";
import { absentProbeEvidence, WRITE_FIXTURE_NOW, WRITE_FIXTURE_RUN_ID, writeFixtureSaveDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { WriteParkedError } from "../../../../src/backend/runtime/writes/write-sequencer.js";

const { harness, claimRunning, contextFor, intentByKey, cleanup } = createWriteSequencerTestWorld();
afterEach(cleanup);

describe("required transaction captures", () => {
  it("stops before the fence and click when the pre-submit capture fails", async () => {
    const h = await harness({ captureFailure: "before-submit" });
    const claimed = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    await assert.rejects(h.execute(contextFor(claimed.run, claimed.claim)), /screenshot/i);
    assert.equal(intentByKey(h.database), undefined);
    assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, 0);
    assert.ok(h.world.events.includes("capture:before-submit"));
  });

  it("keeps saved-effect proof after a post-submit capture failure with one click", async () => {
    const h = await harness({ captureFailure: "after-submit" });
    const claimed = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.verifyResults.push({ state: "present", proof: { transactionId: "T222222" } });
    await h.execute(contextFor(claimed.run, claimed.claim, writeFixtureSaveDescriptor));
    assert.equal(intentByKey(h.database)?.status, "committed");
    assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, 1);
    assert.ok(h.world.events.indexOf("capture:before-submit") < h.world.events.findIndex(event => event.startsWith("commit-click:")));
    assert.ok(h.world.events.indexOf("capture:after-submit") < h.world.events.indexOf("verify"));
  });

  it("retains proof even when the unavailable-capture warning itself fails schema validation", async () => {
    const h = await harness({ captureFailure: "after-submit" });
    const claimed = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.verifyResults.push({ state: "present", proof: { transactionId: "T222222" } });
    let reported = 0;
    await h.execute({ ...contextFor(claimed.run, claimed.claim, writeFixtureSaveDescriptor),
      captureLog: { warn: () => { throw new z.ZodError([]); } },
      onDiagnosticDeliveryFailure: () => { reported += 1; },
    });
    assert.equal(intentByKey(h.database)?.status, "committed");
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
