// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { TooltipProvider } from "../../../../src/dashboard/ds/ui.js";
import { resolveExplorer } from "../../../../src/dashboard/surfaces/explorer/explorer-spec.js";
import { ExplorerSpecView } from "../../../../src/dashboard/surfaces/explorer/explorer-spec-view.js";
import { FIXTURE_EXPLORER_WIRE } from "../../../mocks/helpers/fixture-explorer.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
class ResizeObserverStub { observe() {} disconnect() {} unobserve() {} }
Reflect.set(globalThis, "ResizeObserver", ResizeObserverStub);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });

const spec = FIXTURE_EXPLORER_WIRE.workflows.find(workflow => workflow.id === "person-lookup")!.reviewSpec;
const workflows = [{ id: "person-lookup", title: "Person Lookup" }];
async function mount() {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(createElement(TooltipProvider, null, createElement(ExplorerSpecView, { spec, workflowId: "person-lookup", workflows, onWorkflow: () => undefined }))));
  return host;
}
const click = async (node: Element | null) => { assert.ok(node instanceof HTMLElement); await act(async () => { node.focus(); node.click(); }); };
const titles = (host: HTMLElement) => [...host.querySelectorAll("h3")].map(title => title.textContent);
async function choose(host: HTMLElement, trigger: string, value: string) {
  await click(host.querySelector(trigger));
  await click(document.querySelector(`[role="option"][data-value="${value}"]`));
}

it("shows the served spec: heading, run options, the unlisted-failure line once, the sessions step and numbered steps", async () => {
  const host = await mount();
  assert.match(host.textContent ?? "", /ExplorerBrowse workflows, their steps and field sources\./u);
  assert.ok(host.querySelector('[aria-label="Explorer workflow"]'));
  assert.ok(host.querySelector("#run-options"));
  assert.equal((host.textContent ?? "").split(spec.unlistedFailure).length - 1, 1);
  assert.equal(titles(host)[0], "Open browser sessions");
  assert.deepEqual(titles(host).slice(1), resolveExplorer(spec, {}, {}).steps.map(step => step.title));
  assert.match(host.textContent ?? "", /Open browser sessions.*UCPath.*CRM/su);
  assert.deepEqual([...host.querySelectorAll("time")].map(time => time.textContent), titles(host).map((_, index) => String(index + 1)));
  assert.doesNotMatch(host.textContent ?? "", /Anything else/u);
});

it("changes and renumbers the steps when a run option changes", async () => {
  const host = await mount();
  const before = titles(host);
  await choose(host, '[aria-labelledby="option-crmCheck"]', "false");
  const after = titles(host);
  assert.equal(after.length, before.length - 1);
  assert.deepEqual([...host.querySelectorAll("time")].map(time => time.textContent), after.map((_, index) => String(index + 1)));
});

it("hides the later steps and states the stop once when an outcome stops the run", async () => {
  const host = await mount();
  const before = titles(host).length;
  const stop = spec.steps.flatMap(step => step.blocks).find(block => block.kind === "decision" && block.id === "search-result");
  assert.ok(stop?.kind === "decision");
  const failing = stop.outcomes.find(outcome => outcome.stops)!;
  await choose(host, '[aria-label="Search result"]', failing.value);
  assert.ok(titles(host).length < before);
  assert.equal((host.textContent ?? "").split(failing.then).length - 1, 1);
});

it("opens a fill value's source and returns focus to its arrow when Escape closes it", async () => {
  const host = await mount();
  const arrow = host.querySelector('button[aria-label^="Show source for"]');
  assert.ok(arrow instanceof HTMLButtonElement);
  await click(arrow);
  const dialog = document.querySelector('[role="dialog"]');
  assert.ok(dialog);
  const close = dialog.querySelector('button[aria-label="Close field source"]');
  assert.equal(document.activeElement, close);
  await act(async () => { close?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.activeElement, arrow);
});
