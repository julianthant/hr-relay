import { launchDescriptor } from "../../../support/fixtures/run-launch-fixtures.js";
import { createMountedRerunWorld } from "../../../support/helpers/dashboard/mounted-rerun-world.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach,describe,it,vi } from "vitest";
import { z } from "zod";
import { StartPlanRequestSchema } from "../../../../src/models/dashboard/start-plan.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { absentProbeEvidence } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { createPlSeparationsReadinessWorld } from "../../../support/helpers/dashboard/pl-separations-readiness-world.js";
import { JsonValueSchema } from "../../../../src/rules/validation/canonical-json.js";

const { setup, text, button, press, checkbox, field, fill, mount, cleanup } = createMountedRerunWorld();
afterEach(cleanup);
type Harness = Awaited<ReturnType<typeof setup>>;

function sourceBytes(h: Harness, source: RunRecord) { return JSON.stringify({ run: h.fresh(source),
  checkpoints: h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId).filter((row) => row.runId === source.envelope.runId),
  intents: h.database.authority.writeIntents.listByRun(source.envelope.runId) }); }

describe("mounted Rerun uses source authority and the ordinary launch host", () => {
  it.each(["fingerprint", "version", "steps"] as const)("opens an earlier %s source with current defaults and accepted input", async change => {
    const h = await setup(); const source = await h.completeSource();
    h.registerDescriptor(launchDescriptor("reject-active", { fingerprint: "b".repeat(64),
      ...(change === "version" ? { version: 2 } : {}), ...(change === "steps" ? { stepPrefix: "current-" } : {}) }));
    await mount(h, source);
    for (const label of ["Read employee", "Check employee", "File transaction"]) assert.equal(checkbox(label).getAttribute("aria-checked"), "true");
    await press("Continue"); assert.match(text(), /already submitted/u);
    await press("Confirm"); assert.equal(field("Employee ID").value, "10812345");
  });
  it("selects completed steps again after a fingerprint-only change on a failed source", async () => {
    const h = await setup(); const queued = h.start(h.proposal());
    h.world.onPrepare = () => { throw new Error("synthetic prepare failure"); };
    assert.equal((await h.execute(queued)).state, "failed"); delete h.world.onPrepare;
    const source = h.fresh(queued);
    h.registerDescriptor(launchDescriptor("reject-active", { fingerprint: "b".repeat(64) }));
    await mount(h, source);
    for (const label of ["Read employee", "Check employee", "File transaction"]) assert.equal(checkbox(label).getAttribute("aria-checked"), "true");
    await press("Continue"); assert.equal(field("Employee ID").value, "10812345");
  });
  it("submits an earlier source as a new current run with repeat consent and fresh evidence", async () => {
    const h = await setup(); const source = await h.completeSource(); const bytes = sourceBytes(h, source);
    h.registerDescriptor(launchDescriptor("reject-active", { version: 2, fingerprint: "b".repeat(64) }));
    await mount(h, source); await press("Continue");
    assert.match(text(), /already submitted/u); assert.equal(h.finalCommands.length, 0);
    await press("Confirm"); assert.equal(field("Employee ID").value, "10812345");
    await press("Continue"); await act(async () => checkbox("Dry run").click()); await press("Continue");
    const submitted = StartPlanRequestSchema.parse(h.submissions.at(-1));
    assert.ok(submitted.warningAcknowledgment); assert.deepEqual(submitted.submissions, [{ eid: "10812345" }]);
    await press("Start dry run");
    const queued = h.queueRoots.at(-1); assert.ok(queued); assert.notEqual(queued.runId, source.envelope.runId);
    const run = h.database.authority.runs.get(queued.runId); assert.ok(run);
    assert.equal(run.envelope.descriptorVersion, 2); assert.equal(run.envelope.contractFingerprint, "b".repeat(64));
    assert.equal(run.envelope.itemId, source.envelope.itemId);
    assert.equal(h.database.authority.runCheckpoints.listByItem(h.descriptor.id, run.envelope.itemId)
      .filter(checkpoint => checkpoint.runId === run.envelope.runId).length, 0);
    assert.deepEqual(h.database.authority.writeIntents.listByRun(run.envelope.runId), []);
    assert.deepEqual(h.database.authority.gateResults.listByRun(run.envelope.runId), []);
    const reads = h.world.events.filter(event => event.startsWith("read:")).length;
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    assert.equal((await h.execute(run)).state, "done");
    assert.ok(h.world.events.filter(event => event.startsWith("read:")).length > reads);
    assert.equal(sourceBytes(h, source), bytes);
  });

  it("submits Rerun without offering or retaining a worker choice", async () => {
    const h = await setup();
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
    const h = await setup(); const source = await h.completeSource(); const bytes = sourceBytes(h, source);
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
    const h = await setup(); const source = await h.completeSource(); const bytes = sourceBytes(h, source); await mount(h, source);
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

describe("registered Person Lookup and Separations served launch", () => {
  const readiness = createPlSeparationsReadinessWorld();
  afterEach(readiness.cleanup);
  const cases = [
    { workflowId: "person-lookup", text: "10000001", submission: { mode: "search", emplId: "10000001",
      crmCheck: true, keepNonHdh: false, includeCrmDates: false }, dryRun: false },
    { workflowId: "separations", text: "4510", submission: { documentNumber: "4510" }, dryRun: true },
  ] as const;

  async function preview(h: Awaited<ReturnType<typeof readiness.setup>>, entry: typeof cases[number]) {
    const input = document.querySelector("textarea"); assert.ok(input);
    await readiness.fill(input, entry.text);
    await readiness.press("Continue");
    if (entry.dryRun) {
      assert.equal(readiness.checkbox("Dry run").getAttribute("aria-checked"), "false");
      await act(async () => readiness.checkbox("Dry run").click());
    }
    await readiness.press("Continue");
    await vi.waitFor(() => assert.ok(document.querySelector("#run-start-confirm")));
    const request = StartPlanRequestSchema.parse(h.submissions.at(-1));
    assert.equal(request.workflowId, entry.workflowId);
    assert.deepEqual(request.submissions, [entry.submission]);
    assert.equal(request.dryRun, entry.dryRun);
  }

  function assertQueued(h: Awaited<ReturnType<typeof readiness.setup>>, entry: typeof cases[number], count = 1) {
    const runs = h.database.authority.runs.listByWorkflow(entry.workflowId);
    assert.equal(runs.length, count);
    const run = runs.find(run => run.lifecycle.state === "queued"); assert.ok(run);
    assert.equal(run.envelope.workflow, entry.workflowId);
    assert.equal(run.envelope.descriptorVersion, h.descriptor.version);
    assert.equal(run.envelope.contractFingerprint, h.descriptor.contractFingerprint);
    assert.equal(run.envelope.dryRun, entry.dryRun);
    const input = z.record(z.string(), JsonValueSchema).parse(run.input.parsed.value);
    if (entry.workflowId === "person-lookup") assert.deepEqual(input, entry.submission);
    else {
      assert.equal(input.documentNumber, "4510");
      assert.ok(run.input.parsed.protectedBindings?.some(binding => binding.name === "timekeeperName"));
      assert.equal(JSON.stringify(h.finalCommands).includes("Fixture Operator"), false);
    }
    assert.deepEqual(h.database.authority.runCheckpoints.listByItem(entry.workflowId, run.envelope.itemId)
      .filter(checkpoint => checkpoint.runId === run.envelope.runId), []);
    assert.deepEqual(h.database.authority.writeIntents.listByRun(run.envelope.runId), []);
    assert.deepEqual(h.database.authority.gateResults.listByRun(run.envelope.runId), []);
    assert.deepEqual(h.world.events, []);
    return run;
  }

  for (const entry of cases) {
    it(`enqueues ${entry.workflowId} only after final confirmation with the real definition and exact input`, async () => {
      const h = await readiness.setup(entry.workflowId), view = await readiness.mount(h);
      await preview(h, entry);
      assert.deepEqual(h.database.authority.runs.listByWorkflow(entry.workflowId), []);
      assert.deepEqual(h.finalCommands, []);
      assert.deepEqual(view.applied, []);
      await readiness.press(entry.dryRun ? "Start dry run" : "Start 1 run");
      await vi.waitFor(() => assert.deepEqual(view.applied, [entry.workflowId]));
      assert.deepEqual(view.closed, [false]);
      const run = assertQueued(h, entry);
      const command = h.finalRequest();
      const stored = h.database.authority.startPlans.get(command.target.startPlanId); assert.ok(stored);
      assert.equal(stored.consumedBy?.commandId, command.commandId);
      assert.equal(stored.configSnapshotId, run.envelope.configSnapshotId);
      assert.equal(h.finalCommands.length, 1);
    });

    it(`retains a lost ${entry.workflowId} submission and replays exact bytes without a second run`, async () => {
      const h = await readiness.setup(entry.workflowId), view = await readiness.mount(h);
      await preview(h, entry);
      h.loseResponse();
      await readiness.press(entry.dryRun ? "Start dry run" : "Start 1 run");
      await vi.waitFor(() => assert.ok([...document.querySelectorAll("button")]
        .some(button => button.textContent?.trim() === "Replay exact submission")));
      assert.deepEqual(view.applied, []);
      const original = h.finalRequest(), queued = assertQueued(h, entry);
      const retained = h.retained(queued);
      await readiness.press("Replay exact submission");
      await vi.waitFor(() => assert.deepEqual(view.applied, [entry.workflowId]));
      assert.equal(h.finalCommands.length, 2);
      assert.deepEqual(h.finalRequest(), original);
      assertQueued(h, entry);
      assert.deepEqual(h.retained(queued), retained);
    });

    it(`reruns a genuinely settled pre-write ${entry.workflowId} failure as fresh work and preserves its source`, async () => {
      const h = await readiness.setup(entry.workflowId);
      const source = await h.failedSource(entry.submission, entry.dryRun), before = h.retained(source);
      const view = await readiness.mount(h, source);
      await vi.waitFor(() => assert.ok([...document.querySelectorAll("button")]
        .some(button => button.textContent?.trim() === "Continue" && !button.disabled)));
      await readiness.press("Continue");
      await vi.waitFor(() => assert.ok(document.querySelector("textarea")));
      assert.equal(document.querySelector("textarea")?.value, entry.text);
      assert.equal(h.submissions.length, 1);
      assert.deepEqual(h.finalCommands, []);
      await readiness.press("Continue");
      if (entry.dryRun) await act(async () => readiness.checkbox("Dry run").click());
      await readiness.press("Continue");
      await vi.waitFor(() => assert.ok(document.querySelector("#run-start-confirm")));
      const planned = StartPlanRequestSchema.parse(h.submissions.at(-1));
      assert.deepEqual(planned.submissions, [entry.submission]);
      assert.equal(planned.rerunSource?.runId, source.envelope.runId);
      assert.equal(planned.rerunSource?.expectedVersion, source.version);
      assert.deepEqual(planned.rerunSource?.copiedFrom, []);
      assert.deepEqual(h.retained(source), before);
      await readiness.press(entry.dryRun ? "Start dry run" : "Create rerun");
      await vi.waitFor(() => assert.deepEqual(view.applied, [entry.workflowId]));
      const run = assertQueued(h, entry, 2);
      assert.notEqual(run.envelope.runId, source.envelope.runId);
      assert.deepEqual(h.retained(source), before);
    });
  }

  it("plans the registered Person Lookup Match input without exposing identifiers in confirmation", async () => {
    const h = await readiness.setup("person-lookup"), view = await readiness.mount(h);
    const match = document.querySelector<HTMLInputElement>('input[type="radio"][value="match"]'); assert.ok(match);
    await act(async () => match.click());
    const input = document.querySelector("textarea"); assert.ok(input);
    await readiness.fill(input, "Example, Person, x, 123456789");
    await readiness.press("Continue"); await readiness.press("Continue");
    await vi.waitFor(() => assert.ok(document.querySelector("#run-start-confirm")));
    const plan = StartPlanRequestSchema.parse(h.submissions.at(-1));
    assert.deepEqual(plan.submissions, [{ mode: "match", lastName: "Example", firstName: "Person", ssn: "123456789",
      crmCheck: false, includeCrmDates: false }]);
    assert.deepEqual(plan.selectedStepKeys, ["searching", "active-status"]);
    assert.equal(readiness.text().includes("123456789"), false);
    assert.deepEqual(view.applied, []);
    assert.deepEqual(h.finalCommands, []);
    assert.deepEqual(h.database.authority.runs.listByWorkflow("person-lookup"), []);
  });
});
