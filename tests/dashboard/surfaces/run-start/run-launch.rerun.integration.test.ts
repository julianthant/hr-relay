import { createMountedRerunWorld } from "../../../support/helpers/dashboard/mounted-rerun-world.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach,describe,it } from "vitest";
import { StartPlanRequestSchema } from "../../../../src/models/dashboard/start-plan.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { absentProbeEvidence } from "../../../support/fixtures/write-sequencer-fixtures.js";

const { setup, text, button, press, checkbox, field, fill, mount, cleanup } = createMountedRerunWorld();
afterEach(cleanup);
type Harness = ReturnType<typeof setup>;

function sourceBytes(h: Harness, source: RunRecord) { return JSON.stringify({ run: h.fresh(source),
  checkpoints: h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId).filter((row) => row.runId === source.envelope.runId),
  intents: h.database.authority.writeIntents.listByRun(source.envelope.runId) }); }

describe("mounted Rerun uses source authority and the ordinary launch host", () => {
  it("submits Rerun without offering or retaining a worker choice", async () => {
    const h = setup();
    const selectedStepKeys = h.descriptor.timeline.map(step => step.key);
    const plan = h.planner.plan({ workflowId: h.descriptor.id, submissions: [{ eid: "10812345" }],
      dryRun: false, selectedStepKeys });
    const queued = h.start(plan); h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    assert.equal((await h.execute(queued)).state, "done"); const source = h.fresh(queued);
    await mount(h, source); await press("Continue"); await press("Confirm"); await press("Continue");
    assert.equal(document.querySelector('button[aria-label$=" Workers"]') === null, true);
    await press("Continue");
    assert.equal(Object.hasOwn(StartPlanRequestSchema.parse(h.submissions.at(-1)), "workers"), false);
    assert.match(text(), /Review the plan/u);
  });
  it("warns before Values exist, Cancel returns to Steps and Confirm only advances; final dry run executes fresh work", async () => {
    const h = setup(); const source = await h.completeSource(); const bytes = sourceBytes(h, source);
    await mount(h, source);
    for (const name of ["Read employee", "Check employee", "File transaction"]) assert.equal(checkbox(name).getAttribute("aria-checked"), "true");
    assert.equal(checkbox("Read employee").disabled, true); assert.match(text(), /Completed in the source; this workflow requires it to run again/u);
    const before = h.authoritySnapshot(); await press("Continue");
    assert.match(text(), /already submitted/u); assert.equal(h.authoritySnapshot(), before); assert.equal(h.submissions.length, 0);
    await press("Cancel"); assert.match(text(), /3 \/ 3 included/u); assert.equal(h.authoritySnapshot(), before);
    await press("Continue"); await press("Confirm"); assert.ok(document.querySelector('[aria-label="Values"]'));
    assert.equal(h.authoritySnapshot(), before); assert.equal(h.submissions.length, 0);
    assert.equal(field("Employee ID").value, "10812345"); await press("Copy Previous transaction");
    await fill(field("Previous transaction"), "edited memo");
    await press("Continue"); await act(async () => checkbox("Dry run").click()); await press("Continue");
    assert.match(text(), /Review the plan/u); const submitted = StartPlanRequestSchema.parse(h.submissions.at(-1));
    assert.deepEqual(submitted.submissions, [{ eid: "10812345", memo: "edited memo" }]);
    assert.deepEqual(submitted.rerunSource?.copiedFrom, [{ nodeId: "read", fieldPath: "eid", targetFieldPath: "eid" }]);
    assert.equal(h.queueRoots.length, 1); await press("Start dry run"); assert.equal(document.querySelector('[role="dialog"]'), null); assert.match(text(), /Rerun started/u);
    const queued = h.queueRoots.at(-1); assert.ok(queued); assert.notEqual(queued.runId, source.envelope.runId);
    const run = h.database.authority.runs.get(queued.runId); assert.ok(run); assert.equal(run.envelope.dryRun, true);
    const priorCommits = h.world.events.filter((event) => event === "commit").length;
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    const executed = await h.execute(run); assert.equal(executed.state, "done", JSON.stringify(executed.state === "failed" ? h.database.authority.failures.get(executed.failureId) : executed));
    assert.equal(h.world.events.filter((event) => event === "commit").length, priorCommits);
    assert.ok(h.world.events.includes("read:edited memo")); assert.equal(sourceBytes(h, source), bytes);
  });
  it("omitted work has no new transaction proof; copied omission facts can be cleared/edited without attribution", async () => {
    const h = setup(); const source = await h.completeSource(); const bytes = sourceBytes(h, source); await mount(h, source);
    await act(async () => { checkbox("Check employee").click(); checkbox("File transaction").click(); });
    const before = h.authoritySnapshot(); await press("Continue"); assert.ok(document.querySelector('[aria-label="Values"]'));
    assert.equal(h.authoritySnapshot(), before);
    assert.equal(field("Employee ID").value, "10812345"); await fill(field("Employee ID"), ""); assert.equal(field("Employee ID").value, "");
    await fill(field("Employee ID"), "10812346"); await press("Copy Check employee · Checked employee ID");
    await fill(field("Checked employee ID"), ""); assert.equal(button("Continue").disabled, true); assert.ok(document.querySelector('[aria-label="Values"]'));
    await fill(field("Checked employee ID"), "10812346"); await press("Continue"); await act(async () => checkbox("Dry run").click()); await press("Continue");
    const request = StartPlanRequestSchema.parse(h.submissions.at(-1)); assert.deepEqual(request.submissions, [{ eid: "10812346" }]);
    assert.deepEqual(request.stepOmissions, [{ step: "checking", facts: { eid: "10812346" } }, { step: "filing", facts: {} }]);
    assert.deepEqual(request.rerunSource?.copiedFrom, []); await press("Start dry run");
    const queued = h.queueRoots.at(-1); assert.ok(queued); const run = h.database.authority.runs.get(queued.runId); assert.ok(run);
    assert.notEqual(run.envelope.itemId, source.envelope.itemId); assert.equal((await h.execute(run)).state, "done");
    assert.equal(h.database.authority.writeIntents.listByRun(run.envelope.runId).length, 0); assert.equal(sourceBytes(h, source), bytes);
  });

});
