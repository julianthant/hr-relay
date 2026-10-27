import { testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { servedFixtureSources } from "../../../parity/helpers/workflow-composition.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,it } from "vitest";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { ToastProvider } from "../../../../src/dashboard/ds/ui.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { useRunLaunch } from "../../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { RunLaunchHost } from "../../../../src/dashboard/surfaces/run-start/run-launch.js";
import { defaultRerunSteps } from "../../../../src/dashboard/surfaces/run-start/run-start-rerun-model.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { launchHarness } from "../../../support/fixtures/run-launch-fixtures.js";

class Measure { observe() {} unobserve() {} disconnect() {} }
Reflect.set(globalThis, "ResizeObserver", Measure);
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
const cleanup: (() => void)[] = [];
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); window.sessionStorage.clear();
  for (const dispose of cleanup.splice(0)) dispose(); });
async function setup() { const h = await launchHarness(); cleanup.push(h.dispose); return h; }
type Harness = Awaited<ReturnType<typeof setup>>;
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
  for (const outcome of ["failed", "interrupted"] as const) it(`${outcome} defaults preserve required completed work and select unfinished work`, async () => {
    const h = await setup(); const source = h.start(h.proposal(undefined, undefined, true));
    if (outcome === "failed") {
      h.world.onPrepare = () => { throw new Error("synthetic prepare failure"); };
      assert.equal((await h.execute(source)).state, "failed"); delete h.world.onPrepare;
    } else {
      const active = h.database.authority.runtimeConfig.get(); assert.ok(active);
      const { workerId, workerLifetime } = testWorkerLifetime(h.database, h.descriptor.id, 1);
      const claimed = requireLifecycleApplied(h.lifecycle.claimNext({ commandId: h.ids.uuid(), workflow: h.descriptor.id, workerId, workerLifetime,
        runtimeConfig: { generation: active.generation, settingsRevision: active.settingsRevision,
          settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint } }));
      const ended = h.database.authority.runs.transition({ now: h.clock.now().toISOString(), runId: claimed.envelope.runId, expectedVersion: claimed.version,
        claim: { workerId, claimGeneration: claimed.claimGeneration },
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
    await press("Continue"); assert.ok(document.querySelector('[aria-label="Values"]')); assert.match(text(), /Unavailable/u);
  });

});
