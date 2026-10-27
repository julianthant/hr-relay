import { createMountedRerunWorld } from "../../support/helpers/dashboard/mounted-rerun-world.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach,describe,it } from "vitest";
import { StartPlanRequestSchema } from "../../../src/models/dashboard/start-plan.js";
import { deriveIdempotencyKeyDigest } from "../../../src/rules/write-safety/write-safety.js";
import { absentProbeEvidence } from "../../support/fixtures/write-sequencer-fixtures.js";

const { setup, button, press, checkbox, field, fill, mount, cleanup } = createMountedRerunWorld();
afterEach(cleanup);

describe("mounted Rerun uses source authority and the ordinary launch host", () => {
  it("a changed business key renews the exact warning while an edited memo preserves it", async () => {
    const h = await setup(); const source = await h.completeSource();
    const other = h.start(h.proposal(undefined, undefined, false, "10812346"));
    const absence = absentProbeEvidence(h.clock.now().toISOString()); h.world.subjectEid = "10812346";
    h.world.probeResults.push({ ...absence, evidence: { ...absence.evidence,
      idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", "10812346|fixture-termination") } });
    assert.equal((await h.execute(other)).state, "done");
    await mount(h, source); await press("Continue"); await press("Confirm"); assert.equal(field("Employee ID").value, "10812345");
    await fill(field("Employee ID"), "10812346"); await press("Continue"); await act(async () => checkbox("Dry run").click()); await press("Continue");
    assert.ok(document.querySelector('[aria-label="Repeat transaction warning"]'));
    assert.equal(h.finalCommands.length, 0); assert.equal(h.queueRoots.length, 2);
    const first = StartPlanRequestSchema.parse(h.submissions.at(-1)); await press("Confirm");
    assert.ok(document.querySelector('[aria-label="Values"]')); await press("Continue"); await press("Continue");
    const second = StartPlanRequestSchema.parse(h.submissions.at(-1));
    assert.notEqual(first.warningAcknowledgment, second.warningAcknowledgment); assert.deepEqual(second.submissions[0], { eid: "10812346" });
    assert.ok(button("Start dry run")); assert.equal(h.finalCommands.length, 0);
  });

});
