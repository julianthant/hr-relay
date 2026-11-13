import { FixtureCommandBinding } from "./command-binding.js";
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { runStartRefusalToast } from "../../../../src/dashboard/app/commands/command-result.js";
import { ToastProvider, useToasts } from "../../../../src/dashboard/ds/ui.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { useRunLaunch } from "../../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { RunLaunchHost } from "../../../../src/dashboard/surfaces/run-start/run-launch.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { servedFixtureSources } from "../../../mocks/helpers/workflow-composition.js";
import { launchHarness } from "../../fixtures/run-launch-fixtures.js";


export function createMountedRerunWorld(profileFixture?: Parameters<typeof launchHarness>[3]) {
class Measure { observe() {} unobserve() {} disconnect() {} }
Reflect.set(globalThis, "ResizeObserver", Measure);
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
const disposers: (() => void | Promise<void>)[] = [];
async function unmount() { await act(async () => root?.unmount()); root = undefined; }
async function cleanup() { await unmount(); document.body.replaceChildren(); window.sessionStorage.clear();
  for (const dispose of disposers.splice(0)) await dispose(); }
async function setup(createPreflight?: Parameters<typeof launchHarness>[4]) { const h = await launchHarness(undefined, undefined, undefined, profileFixture, createPreflight); disposers.push(h.dispose); return h; }
type Harness = Awaited<ReturnType<typeof setup>>;
const text = () => document.body.textContent ?? "";
function button(name: string): HTMLButtonElement {
  if (name === "Continue" && [...document.querySelectorAll("button")].some(node => node.textContent?.trim() === "Preview plan")) name = "Preview plan";
  const matches = [...document.querySelectorAll("button")].filter((node) => (node.textContent?.trim() === name || node.getAttribute("aria-label") === name));
  assert.equal(matches.length, 1, `one button ${name}: ${text()}`); return matches[0];
}
async function press(name: string) { const node = button(name); assert.equal(node.disabled, false, `${name}: ${text()}`); await act(async () => node.click()); }
function checkbox(label: string): HTMLButtonElement | HTMLInputElement {
  const nodes = [...document.querySelectorAll<HTMLButtonElement | HTMLInputElement>('[role="checkbox"], [role="switch"]')];
  const node = nodes.find((entry) => [label, `Include ${label}`, `${label} (required)`].includes(entry.closest("label")?.querySelector(".ds-switch-copy > span")?.textContent ?? "")
    || entry.getAttribute("aria-label") === label
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
async function mount(h: Harness, source: RunRecord | undefined, client: DashboardClient = h.client, workersStopped?: (workflowId: string) => boolean) {
  const workflows = [h.workflow]; const sourceRef = source === undefined ? undefined : { runId: source.envelope.runId, expectedVersion: source.version };
  function Launcher({ actorId, requestKey, nowIso, bound }: { actorId: string; requestKey: number; nowIso: string; bound: boolean }) { const { toast } = useToasts(); const controller = useRunLaunch(false, "launch-main"); return createElement("main", { id: "launch-main", tabIndex: -1 },
    createElement("button", { onClick: () => sourceRef === undefined ? controller.openStart() : controller.openRerun(sourceRef) }, sourceRef === undefined ? "Run workflow" : "Rerun source"),
    bound ? createElement(FixtureCommandBinding, { actorId, requestKey, nowIso, feedback: outcome => {
      if (outcome.kind === "refused" || outcome.kind === "conflict") toast(runStartRefusalToast(outcome.feedback.text));
    }, children: createElement(RunLaunchHost, { controller, catalog: buildWorkflowCatalog(workflows, false, servedFixtureSources(workflows)), panelWorkflowId: h.descriptor.id, actorId, workersStopped, onOpenIntake: () => { throw new Error("unexpected intake"); } }) }) : createElement(RunLaunchHost, { controller, catalog: buildWorkflowCatalog(workflows, false, servedFixtureSources(workflows)), panelWorkflowId: h.descriptor.id, actorId, onOpenIntake: () => { throw new Error("unexpected intake"); } })); }
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  async function replaceBinding(nextClient: DashboardClient, { actorId = "local-operator", requestKey = 0, nowIso = h.clock.now().toISOString(), bound = true } = {}) {
    const launcher = createElement(Launcher, { actorId, requestKey, nowIso, bound });
    await act(async () => root?.render(createElement(DashboardClientProvider, { client: nextClient,
      children: createElement(ToastProvider, { children: launcher }) })));
  }
  await replaceBinding(client);
  button(source === undefined ? "Run workflow" : "Rerun source").focus(); await press(source === undefined ? "Run workflow" : "Rerun source");
  return replaceBinding;
}
return { setup, text, button, press, checkbox, field, fill, mount, cleanup, unmount };
}
