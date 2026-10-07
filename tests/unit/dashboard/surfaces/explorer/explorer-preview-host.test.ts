// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { WorkflowExplorerPreview } from "../../../../../src/dashboard/surfaces/explorer-preview.js";
import { buildWorkflowExplorer } from "../../../../../src/backend/runs/queries/explorer.js";
import { FingerprintSchema } from "../../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { explorerQueryDeps } from "../../../../support/fixtures/explorer-seams.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const wire = buildWorkflowExplorer(explorerQueryDeps(
  manualClock(new Date("2026-08-09T12:00:00.000Z")), FingerprintSchema.parse("e".repeat(64)),
));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
let root: Root | undefined;
afterEach(() => { if (root) act(() => root?.unmount()); root = undefined; });

it("serves the full fictional preview, source link, typed choice, and navigation callbacks", async () => {
  const onWorkflow = vi.fn();
  const onVersionRegistry = vi.fn();
  const client = { workflowExplorer: async () => wire } as unknown as DashboardClient;
  const host = document.createElement("div"); document.body.append(host);
  try {
    await act(async () => { root = createRoot(host); root.render(createElement(DashboardClientProvider, { client,
      children: createElement(WorkflowExplorerPreview, { workflowId: "fixture-onboarding", onWorkflow, onVersionRegistry }),
    })); });
    assert.equal(host.querySelectorAll("li[data-step-number]").length, 11);
    assert.match(host.textContent ?? "", /Mock data/u);
    assert.match(host.textContent ?? "", /Fictional workflow · UI preview/u);
    assert.match(host.textContent ?? "", /No workflow was run/u);
    const source = host.querySelector<HTMLButtonElement>('[aria-label="Show source for Legal name"]');
    assert.ok(source);
    await act(async () => { source.click(); });
    assert.match(host.textContent ?? "", /UCPath Entry Sheet/u);
    const hireMode = host.querySelector<HTMLSelectElement>("#preview-fixture-hire-mode");
    assert.ok(hireMode);
    await act(async () => { hireMode.value = "rehire"; hireMode.dispatchEvent(new Event("change", { bubbles: true })); });
    assert.equal(host.querySelectorAll('[title="Declared system: I-9"]').length, 0);
    assert.match(host.textContent ?? "", /UC_CONC_HIRE/u);
    const emergency = [...host.querySelectorAll<HTMLButtonElement>('nav[aria-label="Preview workflows"] button')]
      .find((button) => button.textContent?.includes("Emergency Contact"));
    assert.ok(emergency);
    await act(async () => { emergency.click(); });
    assert.deepEqual(onWorkflow.mock.calls, [["fixture-emergency-contact"]]);
    const versions = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Version registry"));
    assert.ok(versions);
    await act(async () => { versions.click(); });
    assert.equal(onVersionRegistry.mock.calls.length, 1);
  } finally { host.remove(); }
});

it("ignores an earlier Explorer response after the client changes", async () => {
  const old = deferred<typeof wire>();
  const newer = deferred<typeof wire>();
  const oldClient = { workflowExplorer: () => old.promise } as unknown as DashboardClient;
  const newClient = { workflowExplorer: () => newer.promise } as unknown as DashboardClient;
  const host = document.createElement("div"); document.body.append(host);
  const render = async (client: DashboardClient) => act(async () => {
    if (!root) root = createRoot(host);
    root.render(createElement(DashboardClientProvider, { client,
      children: createElement(WorkflowExplorerPreview, { workflowId: "person-lookup", onWorkflow: () => {}, onVersionRegistry: () => {} }),
    }));
  });
  try {
    await render(oldClient);
    await render(newClient);
    await act(async () => { newer.resolve({ ...wire, workflows: wire.workflows.map((item) => item.id === "person-lookup"
      ? { ...item, label: "New client definition" } : item) }); });
    assert.match(host.textContent ?? "", /New client definition/u);
    await act(async () => { old.resolve(wire); });
    assert.match(host.textContent ?? "", /New client definition/u);
  } finally { host.remove(); }
});

it("clears local fictional choices across Onboarding to Emergency Contact to Onboarding", async () => {
  const client = { workflowExplorer: async () => wire } as unknown as DashboardClient;
  const host = document.createElement("div"); document.body.append(host);
  const render = async (workflowId: string) => act(async () => {
    if (!root) root = createRoot(host);
    root.render(createElement(DashboardClientProvider, { client,
      children: createElement(WorkflowExplorerPreview, { workflowId, onWorkflow: () => {}, onVersionRegistry: () => {} }),
    }));
  });
  try {
    await render("fixture-onboarding");
    const hireMode = host.querySelector<HTMLSelectElement>("#preview-fixture-hire-mode");
    assert.ok(hireMode);
    await act(async () => { hireMode.value = "rehire"; hireMode.dispatchEvent(new Event("change", { bubbles: true })); });
    assert.equal(host.querySelectorAll('[title="Declared system: I-9"]').length, 0);
    await render("fixture-emergency-contact");
    assert.ok(host.querySelector("#preview-fixture-contact-review"));
    await render("fixture-onboarding");
    assert.equal(host.querySelector<HTMLSelectElement>("#preview-fixture-hire-mode")?.value, "new");
    assert.equal(host.querySelectorAll('[title="Declared system: I-9"]').length, 1);
  } finally { host.remove(); }
});
