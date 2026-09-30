// @vitest-environment jsdom
import { requireLifecycleApplied } from "../../../src/core/run-record-service.js";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { RunLaunchHost } from "../../../src/dashboard/app/run-launch.js";
import { defaultRerunSteps } from "../../../src/dashboard/surfaces/run-start-rerun-model.js";
import { useRunLaunch } from "../../../src/dashboard/app/run-launch-model.js";
import { deriveIdempotencyKeyDigest } from "../../../src/domain/write-safety.js";
import { PositiveIntSchema } from "../../../src/domain/ids.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { absentProbeEvidence } from "../../fixtures/write-sequencer-fixtures.js";
import { launchHarness } from "../../fixtures/run-launch-fixtures.js";
import type { RunRecord } from "../../../src/domain/run/record.js";
import { StartPlanRequestSchema } from "../../../src/domain/dashboard/start-plan.js";

class Measure { observe() {} unobserve() {} disconnect() {} }
Reflect.set(globalThis, "ResizeObserver", Measure);
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
const cleanup: (() => void)[] = [];
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); window.sessionStorage.clear();
  for (const dispose of cleanup.splice(0)) dispose(); });
function setup() { const h = launchHarness(); cleanup.push(h.dispose); return h; }
type Harness = ReturnType<typeof setup>;
const text = () => document.body.textContent ?? "";
function button(name: string): HTMLButtonElement {
  const matches = [...document.querySelectorAll("button")].filter((node) => (node.textContent?.trim() === name || node.getAttribute("aria-label") === name));
  assert.equal(matches.length, 1, `one button ${name}: ${text()}`); return matches[0];
}
async function press(name: string) { const node = button(name); assert.equal(node.disabled, false, `${name}: ${text()}`); await act(async () => node.click()); }
function checkbox(label: string): HTMLButtonElement {
  const nodes = [...document.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')];
  const node = nodes.find((entry) => entry.getAttribute("aria-label") === label
    || entry.getAttribute("aria-labelledby")?.split(" ").map((id) => document.getElementById(id)?.textContent).join(" ") === label);
  assert.ok(node, `${label}: ${text()}`); return node;
}
function field(label: string): HTMLInputElement | HTMLTextAreaElement {
  const node = [...document.querySelectorAll("label")].find((entry) => entry.textContent?.trim() === label);
  assert.ok(node, `${label}: ${text()}`); const control = document.getElementById(node.htmlFor);
  assert.ok(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement); return control;
}
async function fill(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter: { set?: (this: unknown, value: string) => void } | undefined = Object.getOwnPropertyDescriptor(node instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, "value");
  assert.ok(setter?.set); await act(async () => { setter.set?.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function mount(h: Harness, source: RunRecord, client: DashboardClient = h.client) {
  const workflows = [h.workflow]; const sourceRef = { runId: source.envelope.runId, expectedVersion: source.version };
  function Launcher() { const controller = useRunLaunch(false, "launch-main"); return createElement("main", { id: "launch-main", tabIndex: -1 },
    createElement("button", { onClick: () => controller.openRerun(sourceRef) }, "Rerun source"),
    createElement(RunLaunchHost, { controller, workflows, panelWorkflowId: h.descriptor.id, actorId: "local-operator", onOpenIntake: () => { throw new Error("unexpected intake"); } })); }
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(Launcher) })));
  button("Rerun source").focus(); await press("Rerun source");
}
function sourceBytes(h: Harness, source: RunRecord) { return JSON.stringify({ run: h.fresh(source),
  checkpoints: h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId).filter((row) => row.runId === source.envelope.runId),
  intents: h.database.authority.writeIntents.listByRun(source.envelope.runId) }); }

describe("mounted Rerun uses source authority and the ordinary launch host", () => {
  it("warns before Values exist, Cancel returns to Steps and Confirm only advances; final dry run executes fresh work", async () => {
    const h = setup(); const source = await h.completeSource(); const bytes = sourceBytes(h, source);
    await mount(h, source);
    for (const name of ["Read employee", "Check employee", "File transaction"]) assert.equal(checkbox(name).getAttribute("aria-checked"), "true");
    assert.equal(checkbox("Read employee").disabled, true); assert.match(text(), /Completed in the source; this workflow requires it to run again/u);
    const before = h.authoritySnapshot(); await press("Next");
    assert.match(text(), /already submitted/u); assert.equal(h.authoritySnapshot(), before); assert.equal(h.submissions.length, 0);
    await press("Cancel"); assert.match(text(), /3 of 3 included/u); assert.equal(h.authoritySnapshot(), before);
    await press("Next"); await press("Confirm"); assert.ok(document.querySelector('[aria-label="Values"]'));
    assert.equal(h.authoritySnapshot(), before); assert.equal(h.submissions.length, 0);
    await press("Copy Employee ID"); await press("Copy Previous transaction");
    await fill(field("New Previous transaction"), "edited memo");
    await press("Next"); await act(async () => checkbox("Dry run").click()); await press("Next");
    assert.match(text(), /Confirm/u); const submitted = StartPlanRequestSchema.parse(h.submissions.at(-1));
    assert.deepEqual(submitted.submissions, [{ eid: "10812345", memo: "edited memo" }]);
    assert.deepEqual(submitted.rerunSource?.copiedFrom, [{ nodeId: "read", fieldPath: "eid", targetFieldPath: "eid" }]);
    assert.equal(h.queueRoots.length, 1); await press("Start dry run"); assert.match(text(), /Start applied/u);
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
    const before = h.authoritySnapshot(); await press("Next"); assert.ok(document.querySelector('[aria-label="Values"]'));
    assert.equal(h.authoritySnapshot(), before);
    await press("Copy Employee ID"); await press("Clear Employee ID"); assert.equal(field("New Employee ID").value, "");
    await fill(field("New Employee ID"), "10812346"); await press("Copy Check employee · Checked employee ID");
    await fill(field("Checked employee ID"), ""); await press("Next"); assert.ok(document.querySelector('[aria-label="Values"]'));
    await fill(field("Checked employee ID"), "10812346"); await press("Next"); await act(async () => checkbox("Dry run").click()); await press("Next");
    const request = StartPlanRequestSchema.parse(h.submissions.at(-1)); assert.deepEqual(request.submissions, [{ eid: "10812346" }]);
    assert.deepEqual(request.stepOmissions, [{ step: "checking", facts: { eid: "10812346" } }, { step: "filing", facts: {} }]);
    assert.deepEqual(request.rerunSource?.copiedFrom, []); await press("Start dry run");
    const queued = h.queueRoots.at(-1); assert.ok(queued); const run = h.database.authority.runs.get(queued.runId); assert.ok(run);
    assert.notEqual(run.envelope.itemId, source.envelope.itemId); assert.equal((await h.execute(run)).state, "done");
    assert.equal(h.database.authority.writeIntents.listByRun(run.envelope.runId).length, 0); assert.equal(sourceBytes(h, source), bytes);
  });
  for (const outcome of ["failed", "interrupted"] as const) it(`${outcome} defaults preserve required completed work and select unfinished work`, async () => {
    const h = setup(); const source = h.start(h.proposal(undefined, undefined, true));
    if (outcome === "failed") {
      h.world.onPrepare = () => { throw new Error("synthetic prepare failure"); };
      assert.equal((await h.execute(source)).state, "failed"); delete h.world.onPrepare;
    } else {
      const active = h.database.authority.runtimeConfig.get(); assert.ok(active);
      const claimed = requireLifecycleApplied(h.lifecycle.claimNext({ commandId: h.ids.uuid(), workflow: h.descriptor.id, workerId: "source-fixture",
        runtimeConfig: { generation: active.generation, settingsRevision: active.settingsRevision,
          settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint } }));
      const ended = h.database.authority.runs.transition({ now: h.clock.now().toISOString(), runId: claimed.envelope.runId, expectedVersion: claimed.version,
        claim: { workerId: "source-fixture", claimGeneration: claimed.claimGeneration },
        lifecycle: { state: "terminal", outcome, endedAt: h.clock.now().toISOString() } }); assert.equal(ended.state, "applied");
    }
    if (outcome === "failed") {
      const fresh = h.fresh(source); const response = await h.client.rerunValues({ runId: fresh.envelope.runId, expectedVersion: fresh.version });
      assert.ok(response.state === "available");
      const dependent = { ...h.workflow, steps: h.workflow.steps.map((step) => step.key === "checking" && step.control.state === "omittable"
        ? { ...step, control: { ...step.control, forces: ["filing"] } } : step) };
      assert.deepEqual(defaultRerunSteps(response.snapshot, dependent), ["reading", "checking", "filing"]);
    }
    await mount(h, h.fresh(source)); assert.equal(checkbox("Read employee").getAttribute("aria-checked"), "true");
    assert.equal(checkbox("File transaction").getAttribute("aria-checked"), "true");
    assert.equal(checkbox("Check employee").getAttribute("aria-checked"), outcome === "failed" ? "false" : "true");
    await act(async () => checkbox("File transaction").click()); assert.equal(checkbox("File transaction").getAttribute("aria-checked"), "false");
    await press("Next"); assert.ok(document.querySelector('[aria-label="Values"]')); assert.match(text(), /Unavailable/u);
  });
  it("lost response survives unmount and exact replay without a second run", async () => {
    const h = setup(); const source = await h.completeSource(); await mount(h, source); await press("Next"); await press("Confirm");
    await press("Copy Employee ID"); await press("Next"); await act(async () => checkbox("Dry run").click()); await press("Next");
    h.loseResponse(); await press("Start dry run"); assert.match(text(), /lost response/u); const roots = h.queueRoots;
    await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren();
    await mount(h, source); assert.match(text(), /needs readback/u); await press("Replay exact submission");
    assert.match(text(), /already applied/iu); assert.deepEqual(h.queueRoots, roots);
  });
  it("a changed business key renews the exact warning while an edited memo preserves it", async () => {
    const h = setup(); const source = await h.completeSource();
    const other = h.start(h.proposal(undefined, undefined, false, "10812346"));
    const absence = absentProbeEvidence(h.clock.now().toISOString()); h.world.subjectEid = "10812346";
    h.world.probeResults.push({ ...absence, evidence: { ...absence.evidence,
      idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", "10812346|fixture-termination") } });
    assert.equal((await h.execute(other)).state, "done");
    await mount(h, source); await press("Next"); await press("Confirm"); await press("Copy Employee ID");
    await fill(field("New Employee ID"), "10812346"); await press("Next"); await act(async () => checkbox("Dry run").click()); await press("Next");
    assert.ok(document.querySelector('[aria-label="Repeat transaction warning"]'));
    assert.equal(h.finalCommands.length, 0); assert.equal(h.queueRoots.length, 2);
    const first = StartPlanRequestSchema.parse(h.submissions.at(-1)); await press("Confirm");
    assert.ok(document.querySelector('[aria-label="Values"]')); await press("Next"); await press("Next");
    const second = StartPlanRequestSchema.parse(h.submissions.at(-1));
    assert.notEqual(first.warningAcknowledgment, second.warningAcknowledgment); assert.deepEqual(second.submissions[0], { eid: "10812346" });
    assert.ok(button("Start dry run")); assert.equal(h.finalCommands.length, 0);
  });
  it("rapid clicks share one envelope and a delayed response cannot overwrite a reopened launch", async () => {
    const h = setup(); const source = await h.completeSource(); let release: () => void = () => { throw new Error("release not initialized"); };
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const client = { ...h.client, executeCommand: async (input: unknown) => { const result = await h.client.executeCommand(input); await pending; return result; } };
    await mount(h, source, client); await press("Next"); await press("Confirm"); await press("Copy Employee ID");
    await press("Next"); await act(async () => checkbox("Dry run").click()); await press("Next");
    await act(async () => { button("Start dry run").click(); button("Start dry run").click(); });
    assert.equal(h.finalCommands.length, 1); assert.equal(h.queueRoots.length, 2);
    await press("Cancel"); await press("Rerun source"); await act(async () => release());
    assert.ok(!text().includes("Start applied")); assert.match(text(), /needs readback/u);
    await press("Replay exact submission"); assert.equal(h.finalCommands.length, 2);
    assert.deepEqual(h.finalCommands[1], h.finalCommands[0]); assert.equal(h.queueRoots.length, 2);
  });
  it("a stale source refuses in the mounted launcher before warning navigation or plan allocation", async () => {
    const h = setup(); const source = await h.completeSource();
    const before = h.authoritySnapshot(); await mount(h, { ...source, version: PositiveIntSchema.parse(source.version - 1) });
    assert.match(text(), /source-stale/u); assert.equal(button("Next").disabled, true); assert.equal(h.authoritySnapshot(), before);
  });

});
