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
import { deriveIdempotencyKeyDigest } from "../../../src/rules/write-safety/write-safety.js";
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

describe("mounted Rerun uses source authority and the ordinary launch host", () => {
  it("a changed business key renews the exact warning while an edited memo preserves it", async () => {
    const h = setup(); const source = await h.completeSource();
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
