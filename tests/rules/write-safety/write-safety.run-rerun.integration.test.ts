import { createMountedRerunWorld } from "../../support/helpers/dashboard/mounted-rerun-world.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { RerunWarningWireSchema } from "../../../src/models/dashboard/rerun-warning.js";
import { deriveIdempotencyKeyDigest } from "../../../src/rules/write-safety/write-safety.js";
import { absentProbeEvidence } from "../../support/fixtures/write-sequencer-fixtures.js";

const { setup, press, pressOnce, mount, unmount, cleanup } = createMountedRerunWorld();
afterEach(cleanup);

describe("mounted Rerun uses source authority and the ordinary launch host", () => {
  it("a changed business key renews the exact warning while an edited memo preserves it", async () => {
    const h = await setup(); const source = await h.completeSource();
    const other = h.start(h.proposal(undefined, undefined, false, "10812346"));
    const absence = absentProbeEvidence(h.clock.now().toISOString()); h.world.subjectEid = "10812346";
    h.world.probeResults.push({ ...absence, evidence: { ...absence.evidence,
      idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", "10812346|fixture-termination") } });
    assert.equal((await h.execute(other)).state, "done");
    await mount(h, source); await press("Next"); await pressOnce("Start live run");
    assert.ok(document.querySelector('[aria-label="Repeat transaction warning"]'), "the source's warning is read before any plan");
    assert.equal(h.submissions.length, 0); assert.equal(h.finalCommands.length, 0); assert.equal(h.queueRoots.length, 2);
    // The dialog keeps the source's own key, so a changed key goes through the launch door it plans with.
    await unmount();
    const selectedStepKeys = h.descriptor.timeline.map(step => step.key);
    const rerunSource = { runId: source.envelope.runId, expectedVersion: source.version, intent: "rerun" as const, selectedStepKeys };
    const shown = RerunWarningWireSchema.parse(await h.launch.previewWarnings({ workflowId: h.descriptor.id, source: rerunSource }));
    assert.equal(shown.rerun.warnings.length, 1);
    const plan = (changed: object) => h.launch.preview({ workflowId: h.descriptor.id, submissions: [{ eid: "10812346" }], dryRun: false, browserMode: "headless",
      captureBrowserScreenshots: false, selectedStepKeys, rerunSource: { ...rerunSource, copiedFrom: [] }, ...changed });
    const first = await plan({ warningAcknowledgment: shown.rerun.warningDigest });
    assert.ok(first.rerun); assert.notEqual(first.rerun.warningDigest, shown.rerun.warningDigest, "the changed business key renews the warning at planning");
    const start = (proposed: typeof first) => h.kernel.executeStart(h.launch.prepareFinal(proposed));
    assert.equal((await start(first)).state, "confirmation-required");
    assert.equal(h.queueRoots.length, 2);
    const second = await plan({ warningAcknowledgment: first.rerun.warningDigest });
    assert.equal(second.rerun?.warningDigest, first.rerun.warningDigest);
    assert.equal(second.rerun?.acknowledgment, first.rerun.warningDigest, "the confirmed warning rides the second plan");
    const memo = await plan({ submissions: [{ eid: "10812346", memo: "edited" }], warningAcknowledgment: first.rerun.warningDigest });
    assert.equal(memo.rerun?.warningDigest, first.rerun.warningDigest, "an edited memo preserves the warning");
    assert.equal((await start(second)).state, "applied", "a clean plan with the confirmed warning submits at once");
    assert.equal(h.queueRoots.length, 3);
    const run = h.database.authority.runs.get(h.queueRoots.at(-1)?.runId ?? ""); assert.deepEqual(run?.input.parsed.value, { eid: "10812346" });
  });

});
