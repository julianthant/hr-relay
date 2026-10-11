import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { servedFixtureSources } from "../../../parity/helpers/workflow-composition.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,it } from "vitest";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { ToastProvider } from "../../../../src/dashboard/ds/ui.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { useRunLaunch } from "../../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { RunLaunchHost } from "../../../../src/dashboard/surfaces/run-start/run-launch.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { PositiveIntSchema } from "../../../../src/rules/identity/ids.js";
import { launchHarness } from "../../../support/fixtures/run-launch-fixtures.js";

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
async function mount(h: Harness, source: RunRecord, client: DashboardClient = h.client) {
  const workflows = [h.workflow]; const sourceRef = { runId: source.envelope.runId, expectedVersion: source.version };
  function Launcher() { const controller = useRunLaunch(false, "launch-main"); return createElement("main", { id: "launch-main", tabIndex: -1 },
    createElement("button", { onClick: () => controller.openRerun(sourceRef) }, "Rerun source"),
    createElement(ToastProvider, { children: createElement(RunLaunchHost, { controller, catalog: buildWorkflowCatalog(workflows, false, servedFixtureSources(workflows)), panelWorkflowId: h.descriptor.id, actorId: "local-operator", onOpenIntake: () => { throw new Error("unexpected intake"); } }) })); }
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(Launcher) })));
  button("Rerun source").focus(); await press("Rerun source");
}

describe("mounted Rerun uses source authority and the ordinary launch host", () => {
  it("lost response survives unmount and exact replay without a second run", async () => {
    const h = setup(); const source = await h.completeSource(); await mount(h, source); await press("Continue"); await press("Confirm");
    assert.equal(field("Employee ID").value, "10812345"); await press("Continue"); await act(async () => checkbox("Dry run").click()); await press("Continue");
    h.loseResponse(); await press("Start dry run"); assert.match(text(), /lost response/u); const roots = h.queueRoots;
    await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren();
    await mount(h, source); assert.match(text(), /needs readback/u); await press("Replay exact submission");
    assert.equal(document.querySelector('[role="dialog"]'), null); assert.match(text(), /Run submission confirmed/u); assert.deepEqual(h.queueRoots, roots);
  });
  it("rapid clicks share one envelope and a delayed response cannot overwrite a reopened launch", async () => {
    const h = setup(); const source = await h.completeSource(); let release: () => void = () => { throw new Error("release not initialized"); };
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const client = { ...h.client, executeCommand: async (input: unknown) => { const result = await h.client.executeCommand(input); await pending; return result; } };
    await mount(h, source, client); await press("Continue"); await press("Confirm"); assert.equal(field("Employee ID").value, "10812345");
    await press("Continue"); await act(async () => checkbox("Dry run").click()); await press("Continue");
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
    assert.match(text(), /source-stale/u); assert.equal(button("Continue").disabled, true); assert.equal(h.authoritySnapshot(), before);
  });

});
