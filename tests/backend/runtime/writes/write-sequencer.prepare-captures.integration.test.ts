import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";
import { absentProbeEvidence, WRITE_FIXTURE_NOW, writeFixtureQueuedRun } from "../../../support/fixtures/write-sequencer-fixtures.js";

const { harness, claimRunning, contextFor, cleanup } = createWriteSequencerTestWorld();
afterEach(cleanup);

describe("run-owned captures within prepare", () => {
  for (const dryRun of [false, true]) {
    it(`awaits intermediate captures before leaving the page (${dryRun ? "preview" : "real"})`, async () => {
      const order: string[] = [];
      let release: () => void = () => { throw new Error("capture not held"); };
      const held = new Promise<void>(resolve => { release = resolve; });
      let entered: () => void = () => { throw new Error("capture entry unavailable"); };
      const captureEntered = new Promise<void>(resolve => { entered = resolve; });
      let retainedCapture: (() => Promise<void>) | undefined;
      const h = await harness({ onCapture: async boundary => {
        if (boundary === "step" && order.at(-1) === "first-page") { entered(); await held; }
        order.push(`capture:${boundary}`);
      } });
      const claimed = claimRunning(h.database, h.clock, writeFixtureQueuedRun({ dryRun }));
      h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
      h.world.prepareSteps = async capture => {
        retainedCapture = capture;
        order.push("first-page");
        await capture();
        order.push("second-page");
        await capture();
        order.push("last-page");
      };
      const context = contextFor(claimed.run, claimed.claim, undefined, dryRun);
      const execution = dryRun ? h.executeDryRun(context) : h.execute(context);
      await captureEntered;
      assert.equal(order.includes("second-page"), false);
      assert.deepEqual(h.database.authority.writeIntents.listByRun(claimed.run.envelope.runId), []);
      assert.equal(h.world.events.some(event => event.startsWith("commit-click:")), false);
      release();
      await execution;
      assert.deepEqual(order.slice(order.indexOf("first-page"), order.indexOf("last-page") + 1),
        ["first-page", "capture:step", "second-page", "capture:step", "last-page"]);
      assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, dryRun ? 0 : 1);
      if (dryRun) assert.deepEqual(h.database.authority.writeIntents.countDryRunEvidenceByRun(claimed.run.envelope.runId),
        { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
      assert.ok(retainedCapture);
      await assert.rejects(retainedCapture(), error => error instanceof Error && "code" in error && error.code === "BROWSER_SCREENSHOT_CAPTURE_FAILED");
    });

    it(`refuses before fence when an intermediate capture fails (${dryRun ? "preview" : "real"})`, async () => {
      const h = await harness({ captureFailure: "prepare" });
      const claimed = claimRunning(h.database, h.clock, writeFixtureQueuedRun({ dryRun }));
      h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
      h.world.prepareSteps = async capture => { await capture(); h.world.events.push("left-page"); };
      const context = contextFor(claimed.run, claimed.claim, undefined, dryRun);
      await assert.rejects(dryRun ? h.executeDryRun(context) : h.execute(context),
        error => error instanceof Error && "code" in error && error.code === "BROWSER_SCREENSHOT_CAPTURE_FAILED");
      assert.equal(h.world.events.includes("left-page"), false);
      assert.equal(h.world.events.some(event => event.startsWith("commit-click:")), false);
      assert.deepEqual(h.database.authority.writeIntents.countDryRunEvidenceByRun(claimed.run.envelope.runId),
        { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
    });
  }
});
