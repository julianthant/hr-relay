import { buildWorkflowCatalog } from "../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { servedFixtureSources } from "../../parity/helpers/workflow-composition.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,it } from "vitest";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { ToastProvider } from "../../../src/dashboard/ds/ui.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { useRunLaunch } from "../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { RunLaunchHost } from "../../../src/dashboard/surfaces/run-start/run-launch.js";
import { StartPlanRequestSchema } from "../../../src/models/dashboard/start-plan.js";
import type { RunRecord } from "../../../src/models/run/record.js";
import { launchHarness } from "../../support/fixtures/run-launch-fixtures.js";
import { absentProbeEvidence } from "../../support/fixtures/write-sequencer-fixtures.js";

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
  if (name === "Continue" && [...document.querySelectorAll("button")].some(node => node.textContent?.trim() === "Preview plan")) name = "Preview plan";
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
    createElement(ToastProvider, { children: createElement(RunLaunchHost, { controller, catalog: buildWorkflowCatalog(workflows, false, servedFixtureSources(workflows)), panelWorkflowId: h.descriptor.id, actorId: "local-operator", onOpenIntake: () => { throw new Error("unexpected intake"); } }) })); }
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
