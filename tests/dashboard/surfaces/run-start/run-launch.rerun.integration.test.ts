import { afterAll, afterEach, describe, it, vi } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { launchDescriptor, launchHarness } from "../../../support/fixtures/run-launch-fixtures.js";
import { protectedSecretSource } from "../../../support/helpers/protected-secret-source.js";
import { createMountedRerunWorld } from "../../../support/helpers/dashboard/mounted-rerun-world.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { z } from "zod";
import { StartPlanRequestSchema } from "../../../../src/models/dashboard/start-plan.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { absentProbeEvidence } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { createPlSeparationsReadinessWorld } from "../../../support/helpers/dashboard/pl-separations-readiness-world.js";
import { JsonValueSchema } from "../../../../src/rules/validation/canonical-json.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

const { setup, text, button, press, pressOnce, checkbox, field, fill, mount, cleanup } = createMountedRerunWorld(profileFixtures.create);
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
    assert.equal(document.querySelector("textarea") === null, true);
    for (const label of ["Read employee", "Check employee", "File transaction"]) assert.equal(checkbox(label).matches(":checked"), true);
    await press("Continue");
    await pressOnce("Start live run");
    assert.match(text(), /already submitted/u);
  });
  it("selects completed steps again after a fingerprint-only change on a failed source", async () => {
    const h = await setup(); const queued = h.start(h.proposal());
    h.world.onPrepare = () => { throw new Error("synthetic prepare failure"); };
    assert.equal((await h.execute(queued)).state, "failed"); delete h.world.onPrepare;
    const source = h.fresh(queued);
    h.registerDescriptor(launchDescriptor("reject-active", { fingerprint: "b".repeat(64) }));
    await mount(h, source);
    for (const label of ["Read employee", "Check employee", "File transaction"]) assert.equal(checkbox(label).matches(":checked"), true);
  });
  it("opens Rerun on a run cancelled mid-run with the steps a run failed at the same step gets", async () => {
    const rows = ["Read employee", "Check employee", "File transaction"];
    const picked = async (stop: "failed" | "cancelled") => {
      const h = await setup(); const queued = h.start(h.proposal()); h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
      h.world.onPrepare = () => {
        if (stop === "failed") throw new Error("synthetic prepare failure");
        const run = h.fresh(queued); h.lifecycle.transition({ commandId: h.ids.uuid(), runId: run.envelope.runId, expectedVersion: run.version,
          lifecycle: { state: "terminal", outcome: "cancelled", endedAt: h.clock.now().toISOString() } });
      };
      await h.execute(queued); delete h.world.onPrepare;
      const source = h.fresh(queued);
      assert.ok(source.lifecycle.state === "terminal" && source.lifecycle.outcome === stop, JSON.stringify(source.lifecycle));
      await mount(h, source);
      const checked = rows.map(label => checkbox(label).matches(":checked"));
      await cleanup(); return checked;
    };
    const cancelled = await picked("cancelled");
    assert.equal(cancelled.at(-1), true);
    assert.deepEqual(cancelled, await picked("failed"));
  });
  it("names a cancelled run's receipt on Start whether its filing step runs again or is left off", async () => {
    const h = await launchHarness("reject-active", undefined, { descriptor: launchDescriptor("reject-active", { confirmAfterFiling: true }),
      protectedSecrets: protectedSecretSource() }, profileFixtures.create);
    try {
      const queued = h.start(h.proposal()); h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
      let reads = 0;
      // The third read is Confirm filing, after the write committed; the operator cancels there and it never finishes.
      h.world.onRead = () => { reads += 1; if (reads !== 3) return;
        const run = h.fresh(queued); h.lifecycle.transition({ commandId: h.ids.uuid(), runId: run.envelope.runId, expectedVersion: run.version,
          lifecycle: { state: "terminal", outcome: "cancelled", endedAt: h.clock.now().toISOString() } });
        throw new Error("fixture: the cancel stops Confirm filing"); };
      await h.execute(queued); delete h.world.onRead;
      const source = h.fresh(queued);
      assert.ok(source.lifecycle.state === "terminal" && source.lifecycle.outcome === "cancelled", JSON.stringify(source.lifecycle));
      assert.equal(h.database.authority.writeIntents.listByRun(source.envelope.runId).filter(intent => intent.status === "committed").length, 1);
      const receipts = () => document.querySelector('[aria-label="Already submitted by this run"]')?.textContent ?? text();
      // A served write step is required, so the default selection runs it again.
      await mount(h, source);
      assert.equal(checkbox("Confirm filing").matches(":checked"), true);
      await press("Continue");
      assert.match(receipts(), /File transaction.*Runs again/u);
      await cleanup();
      // A workflow whose write step can be left off: the default selection leaves the completed filing off and still names its receipt.
      const omittable = { ...h, workflow: { ...h.workflow, steps: h.workflow.steps.map(step => step.key !== "filing" ? step
        : { ...step, control: { state: "omittable" as const, form: { fields: [] }, forces: [] } }) } };
      await mount(omittable, source);
      assert.equal(checkbox("File transaction").matches(":checked"), false);
      await press("Continue");
      assert.match(receipts(), /File transaction.*Not run again/u);
    } finally { await cleanup(); await h.dispose(); }
  });
  it("leaves a filing the source only found already present out of its receipts", async () => {
    const h = await launchHarness("reject-active", undefined, { descriptor: launchDescriptor("reject-active", { confirmAfterFiling: true }),
      protectedSecrets: protectedSecretSource() }, profileFixtures.create);
    try {
      const queued = h.start(h.proposal()); h.world.probeResults.push({ state: "present", proof: { transactionId: "T123456" } });
      let reads = 0;
      h.world.onRead = () => { reads += 1; if (reads !== 3) return;
        const run = h.fresh(queued); h.lifecycle.transition({ commandId: h.ids.uuid(), runId: run.envelope.runId, expectedVersion: run.version,
          lifecycle: { state: "terminal", outcome: "cancelled", endedAt: h.clock.now().toISOString() } });
        throw new Error("fixture: the cancel stops Confirm filing"); };
      await h.execute(queued); delete h.world.onRead;
      const source = h.fresh(queued);
      assert.ok(source.lifecycle.state === "terminal" && source.lifecycle.outcome === "cancelled", JSON.stringify(source.lifecycle));
      assert.deepEqual(h.database.authority.writeIntents.listByRun(source.envelope.runId).filter(intent => intent.status === "committed"), []);
      await mount(h, source);
      await press("Continue");
      assert.equal(document.querySelector('[aria-label="Already submitted by this run"]') === null, true);
    } finally { await cleanup(); await h.dispose(); }
  });
  it("submits an earlier source as a new current run with repeat consent and fresh evidence", async () => {
    const h = await setup(); const source = await h.completeSource(); const bytes = sourceBytes(h, source);
    h.registerDescriptor(launchDescriptor("reject-active", { version: 2, fingerprint: "b".repeat(64) }));
    await mount(h, source); await press("Continue");
    await pressOnce("Start live run");
    assert.match(text(), /already submitted/u); assert.equal(h.finalCommands.length, 0);
    await press("Start live run again");
    const submitted = StartPlanRequestSchema.parse(h.submissions.at(-1));
    assert.ok(submitted.warningAcknowledgment); assert.deepEqual(submitted.submissions, [{ eid: "10812345" }]);
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
    h.world.commitOutput = { transactionId: "T234567" };
    assert.equal((await h.execute(run)).state, "done");
    assert.ok(h.world.events.filter(event => event.startsWith("read:")).length > reads);
    assert.equal(sourceBytes(h, source), bytes);
  });

  it("Enter under the repeat warning consents and starts once", async () => {
    const h = await setup(); const source = await h.completeSource();
    h.registerDescriptor(launchDescriptor("reject-active", { version: 2, fingerprint: "b".repeat(64) }));
    await mount(h, source); await press("Continue");
    await pressOnce("Start live run");
    assert.match(text(), /already submitted/u); assert.equal(h.finalCommands.length, 0); assert.equal(h.submissions.length, 0);
    await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    await vi.waitFor(() => assert.equal(document.querySelector('[role="dialog"]') === null, true));
    assert.equal(h.finalCommands.length, 1); assert.equal(h.submissions.length, 1);
    assert.ok(StartPlanRequestSchema.parse(h.submissions.at(-1)).warningAcknowledgment);
  });

  it("submits Rerun without offering or retaining a worker choice", async () => {
    const h = await setup();
    const selectedStepKeys = h.descriptor.timeline.map(step => step.key);
    const plan = h.planner.plan({ workflowId: h.descriptor.id, submissions: [{ eid: "10812345" }],
      dryRun: false, selectedStepKeys });
    const queued = h.start(plan); h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    assert.equal((await h.execute(queued)).state, "done"); const source = h.fresh(queued);
    await mount(h, source); await press("Continue");
    assert.equal(document.querySelector('button[aria-label$=" Workers"]') === null, true);
    await press("Start live run");
    assert.equal(Object.hasOwn(StartPlanRequestSchema.parse(h.submissions.at(-1)), "workers"), false);
  });
  it("warns on Start without planning; Start again is the consent and executes fresh work", async () => {
    const h = await setup(); const source = await h.completeSource(); const bytes = sourceBytes(h, source);
    await mount(h, source);
    assert.equal(document.activeElement?.getAttribute("role"), "dialog", "the dialog opens with focus on its surface, no control ringed");
    const before = h.authoritySnapshot();
    for (const name of ["Read employee", "Check employee", "File transaction"]) assert.equal(checkbox(name).matches(":checked"), true);
    assert.match(text(), /Completed/u); assert.match(text(), /3 of 3 included/u);
    await press("Continue");
    assert.equal(h.authoritySnapshot(), before); assert.equal(h.submissions.length, 0);
    await pressOnce("Start live run");
    assert.match(text(), /already submitted/u); assert.match(text(), /UCPath/u); assert.equal(document.querySelector('[aria-label="Required"]') === null, true);
    assert.equal(h.authoritySnapshot(), before); assert.equal(h.submissions.length, 0); assert.equal(h.finalCommands.length, 0);
    assert.equal(h.queueRoots.length, 1); await press("Start live run again");
    const submitted = StartPlanRequestSchema.parse(h.submissions.at(-1));
    assert.ok(submitted.warningAcknowledgment); assert.deepEqual(submitted.submissions, [{ eid: "10812345" }]);
    assert.deepEqual(submitted.rerunSource?.copiedFrom, [{ nodeId: "read", fieldPath: "eid", targetFieldPath: "eid" }]);
    assert.equal(document.querySelector('[role="dialog"]') === null, true); assert.match(text(), /Rerun queued/u);
    const queued = h.queueRoots.at(-1); assert.ok(queued); assert.notEqual(queued.runId, source.envelope.runId);
    const run = h.database.authority.runs.get(queued.runId); assert.ok(run); assert.equal(run.envelope.dryRun, false);
    const reads = h.world.events.filter((event) => event.startsWith("read:")).length;
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    h.world.commitOutput = { transactionId: "T234567" };
    const executed = await h.execute(run); assert.equal(executed.state, "done", JSON.stringify(executed.state === "failed" ? h.database.authority.failures.get(executed.failureId) : executed));
    assert.ok(h.world.events.filter((event) => event.startsWith("read:")).length > reads); assert.equal(sourceBytes(h, source), bytes);
  });
  it("reruns a dry run as a dry run that commits nothing", async () => {
    const h = await setup(); const source = await h.completeSource(true); const bytes = sourceBytes(h, source);
    await mount(h, source); await press("Continue"); assert.doesNotMatch(text(), /Dry run/u);
    await press("Start dry run");
    const queued = h.queueRoots.at(-1); assert.ok(queued); const run = h.database.authority.runs.get(queued.runId); assert.ok(run);
    assert.notEqual(run.envelope.runId, source.envelope.runId); assert.equal(run.envelope.dryRun, true);
    const commits = h.world.events.filter((event) => event === "commit").length;
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    assert.equal((await h.execute(run)).state, "done");
    assert.equal(h.world.events.filter((event) => event === "commit").length, commits); assert.equal(sourceBytes(h, source), bytes);
  });
  it("copied omission facts can be cleared/edited without attribution", async () => {
    const h = await setup(); const source = await h.completeSource(); const bytes = sourceBytes(h, source); await mount(h, source);
    const before = h.authoritySnapshot();
    await act(async () => { checkbox("Check employee").click(); });
    assert.equal(field("Checked employee ID").value, "10812345"); assert.match(text(), /From the earlier run/u);
    await fill(field("Checked employee ID"), ""); assert.equal(button("Continue").disabled, true);
    await fill(field("Checked employee ID"), "10812346"); assert.doesNotMatch(text(), /From the earlier run/u);
    assert.equal(h.authoritySnapshot(), before); assert.equal(h.finalCommands.length, 0);
    await press("Continue");
    await press("Start live run");
    const request = StartPlanRequestSchema.parse(h.submissions.at(-1)); assert.deepEqual(request.submissions, [{ eid: "10812345" }]);
    assert.deepEqual(request.stepOmissions, [{ step: "checking", facts: { eid: "10812346" } }]);
    assert.deepEqual(request.rerunSource?.copiedFrom, [{ nodeId: "read", fieldPath: "eid", targetFieldPath: "eid" }]);
    const queued = h.queueRoots.at(-1); assert.ok(queued); const run = h.database.authority.runs.get(queued.runId); assert.ok(run);
    assert.notEqual(run.envelope.runId, source.envelope.runId); assert.equal(sourceBytes(h, source), bytes);
  });

});

describe("registered Person Lookup and Separations served launch", () => {
  const readiness = createPlSeparationsReadinessWorld(profileFixtures.create);
  afterEach(readiness.cleanup);
  const cases = [
    { workflowId: "person-lookup", text: "10000001", submission: { mode: "search", emplId: "10000001",
      crmCheck: true, keepNonHdh: false, includeCrmDates: true }, dryRun: false },
    { workflowId: "separations", text: "4510", submission: { documentNumber: "4510" }, dryRun: true },
  ] as const;

  const startName = (entry: typeof cases[number]) => entry.dryRun ? "Start dry run" : "Start run";

  async function prepare(entry: typeof cases[number]) {
    const input = document.querySelector("textarea"); assert.ok(input);
    await readiness.fill(input, entry.text);
    await readiness.press("Continue");
    if (entry.dryRun) {
      assert.equal(readiness.checkbox("Dry run").matches(":checked"), false);
      await act(async () => readiness.checkbox("Dry run").click());
    }
  }

  function assertPlanned(h: Awaited<ReturnType<typeof readiness.setup>>, entry: typeof cases[number]) {
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
    it(`enqueues ${entry.workflowId} only on Start with the real definition and exact input`, async () => {
      const h = await readiness.setup(entry.workflowId), view = await readiness.mount(h);
      await prepare(entry);
      assert.deepEqual(h.database.authority.runs.listByWorkflow(entry.workflowId), []);
      assert.deepEqual(h.finalCommands, []);
      assert.deepEqual(view.applied, []);
      await readiness.press(startName(entry));
      await vi.waitFor(() => assert.deepEqual(view.applied, [entry.workflowId]));
      assertPlanned(h, entry);
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
      await prepare(entry);
      h.loseResponse();
      await readiness.press(startName(entry));
      await vi.waitFor(() => assert.ok([...document.querySelectorAll("button")]
        .some(button => button.textContent?.trim() === "Replay exact submission")));
      assertPlanned(h, entry);
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
      assert.equal(h.submissions.length, 1);
      assert.deepEqual(h.finalCommands, []);
      await readiness.press(startName(entry));
      await vi.waitFor(() => assert.deepEqual(view.applied, [entry.workflowId]));
      const planned = StartPlanRequestSchema.parse(h.submissions.at(-1));
      assert.deepEqual(planned.submissions, [entry.submission]);
      assert.equal(planned.rerunSource?.runId, source.envelope.runId);
      assert.equal(planned.rerunSource?.expectedVersion, source.version);
      assert.deepEqual(planned.rerunSource?.copiedFrom, []);
      assert.deepEqual(h.retained(source), before);
      const run = assertQueued(h, entry, 2);
      assert.notEqual(run.envelope.runId, source.envelope.runId);
      assert.deepEqual(h.retained(source), before);
    });
  }

  it("plans the registered Person Lookup Match input without printing its identifiers", async () => {
    const h = await readiness.setup("person-lookup"), view = await readiness.mount(h);
    const match = document.querySelector<HTMLInputElement>('input[type="radio"][value="match"]'); assert.ok(match);
    await act(async () => match.click());
    const input = document.querySelector("textarea"); assert.ok(input);
    await readiness.fill(input, "Example, Person, x, 123456789");
    await readiness.press("Continue"); await readiness.press("Start run");
    await vi.waitFor(() => assert.deepEqual(view.applied, ["person-lookup"]));
    const plan = StartPlanRequestSchema.parse(h.submissions.at(-1));
    assert.deepEqual(plan.submissions, [{ mode: "match", lastName: "Example", firstName: "Person", ssn: "123456789",
      crmCheck: false, includeCrmDates: false }]);
    assert.deepEqual(plan.selectedStepKeys, ["searching", "active-status", "reference-check"]);
    // The harness keeps the dialog mounted after Start; the applied dialog returns to Input and echoes what was typed there.
    assert.equal(readiness.text().replace("Example, Person, x, 123456789", "").includes("123456789"), false);
  });
});
