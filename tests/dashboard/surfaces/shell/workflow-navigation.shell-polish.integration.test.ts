// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { TooltipProvider } from "../../../../src/dashboard/ds/ui.js";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { Onboarding } from "../../../../src/dashboard/surfaces/shell/onboarding.js";
import { createServedOnboardingPort } from "../../../../src/dashboard/surfaces/shell/onboarding-model.js";
import { workflowInitials, workflowNavigationGroups } from "../../../../src/dashboard/surfaces/shell/workflow-rail-model.js";
import { WorkflowNavigation } from "../../../../src/dashboard/surfaces/shell/workflow-navigation.js";
import { SessionsView } from "../../../../src/dashboard/surfaces/sessions/sessions-view.js";
import type { SessionWorker } from "../../../../src/dashboard/surfaces/sessions/sessions-view-model.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });
async function mount(node: ReturnType<typeof createElement>): Promise<HTMLElement> {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(node)); return host;
}

const standalone = { kind: "standalone" } as const;
const entries = [
  { id: "person-lookup", label: "Person Lookup", categoryId: "search", role: standalone },
  { id: "onbase", label: "OnBase", categoryId: "operations", role: standalone },
  { id: "ocr", label: "OCR", categoryId: "operations", role: standalone },
];

it("names the lookup category Lookup, not Search", () => {
  const labels = workflowNavigationGroups(entries).map(group => group.label);
  assert.ok(labels.includes("Lookup")); assert.ok(!labels.includes("Search"));
});

it("gives every collapsed code the full workflow name as accessible name and keeps it keyboard-focusable", async () => {
  const groups = workflowNavigationGroups(entries);
  const host = await mount(createElement(TooltipProvider, null, createElement(WorkflowNavigation, { groups, active: "ocr", onSelect: () => undefined, label: "Workflows", collapsed: true })));
  const codes = workflowInitials(entries.map(entry => entry.label));
  for (const entry of entries) {
    const tile = host.querySelector<HTMLButtonElement>(`button[aria-label="${entry.label}"]`); assert.ok(tile, entry.label);
    assert.equal(tile.textContent, codes.get(entry.label)); assert.ok(tile.tabIndex >= 0);
  }
});

it("offers the details step from the deep-link page that asks for the details", async () => {
  let step = "";
  const host = await mount(createElement(Onboarding, { step: "ready", port: createServedOnboardingPort(createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async () => { throw new Error("not called"); } }), () => {}), onStep: next => { step = next; }, onDashboard() {} }));
  assert.equal(host.querySelector("h1")?.textContent, "Start with your details");
  const button = host.querySelector<HTMLButtonElement>("button.btn.primary"); assert.ok(button);
  assert.equal(button.textContent, "Start with your details");
  await act(async () => button.click()); assert.equal(step, "signup");
});

it("wraps three worker cards instead of clipping them", async () => {
  const worker = (id: string, workflow: string) => ({ id, label: id, workflow, state: "idle", browsers: [] }) as unknown as SessionWorker;
  const host = await mount(createElement(TooltipProvider, null, createElement(SessionsView, { data: { state: "ready", workers: [worker("w1", "Separations"), worker("w2", "Person Lookup"), worker("w3", "OnBase")] },
    open: true, onOpenChange: () => undefined, workflows: [], onControl: () => undefined, onAdd: () => undefined })));
  const strip = host.querySelector("[data-session-strip]"); assert.ok(strip);
  assert.ok(strip.classList.contains("flex-wrap")); assert.ok(!strip.classList.contains("overflow-x-auto"));
  assert.equal(strip.querySelectorAll("article").length, 3);
});
