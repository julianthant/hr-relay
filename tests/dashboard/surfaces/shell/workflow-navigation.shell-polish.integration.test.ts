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
  { id: "person-lookup", label: "Person Lookup", categoryId: "search", role: standalone, icon: "Search" as const },
  { id: "onbase", label: "OnBase", categoryId: "operations", role: standalone, icon: "Upload" as const },
  { id: "ocr", label: "OCR", categoryId: "operations", role: standalone, icon: "FileScan" as const },
];

it("names the lookup category Lookup, not Search", () => {
  const labels = workflowNavigationGroups(entries).map(group => group.label);
  assert.ok(labels.includes("Lookup")); assert.ok(!labels.includes("Search"));
});

it("renders the collapsed rail as the initials of each workflow with the full name as accessible name, keyboard-focusable", async () => {
  const groups = workflowNavigationGroups(entries);
  const host = await mount(createElement(TooltipProvider, null, createElement(WorkflowNavigation, { groups, active: "ocr", onSelect: () => undefined, label: "Workflows", collapsed: true })));
  for (const entry of entries) {
    const tile = host.querySelector<HTMLButtonElement>(`button[aria-label="${entry.label}"]`); assert.ok(tile, entry.label);
    assert.equal(tile.textContent, workflowInitials(entry.label)); assert.ok(!tile.querySelector("svg")); assert.ok(tile.tabIndex >= 0);
  }
  assert.equal(host.querySelector<HTMLButtonElement>('button[aria-current="page"]')?.getAttribute("aria-label"), "OCR");
});

it("renders the expanded rail under category headings: one plain text row per workflow, an icon on each category heading, selected row announced", async () => {
  const groups = workflowNavigationGroups(entries);
  const host = await mount(createElement(TooltipProvider, null, createElement(WorkflowNavigation, { groups, active: "ocr", onSelect: () => undefined, label: "Workflows" })));
  assert.deepEqual([...host.querySelectorAll("h3")].map(heading => heading.textContent), groups.map(group => group.label));
  const rows = [...host.querySelectorAll<HTMLButtonElement>("li > button")];
  assert.equal(rows.length, entries.length);
  for (const row of rows) { assert.ok(!row.querySelector("svg")); assert.ok(!row.querySelector(".workflow-rail-initials")); }
  for (const heading of host.querySelectorAll("h3")) assert.ok(heading.querySelector("svg"));
  assert.equal(host.querySelector('button[aria-current="page"] .truncate')?.textContent, "OCR");
});

it("offers the details step from the deep-link page that asks for the details", async () => {
  let step = "";
  const host = await mount(createElement(Onboarding, { step: "ready", port: createServedOnboardingPort(createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async () => { throw new Error("not called"); } }), () => {}), onStep: next => { step = next; }, onDashboard() {} }));
  assert.equal(host.querySelector("h1")?.textContent, "Start with your details");
  const button = host.querySelector<HTMLButtonElement>("main button"); assert.ok(button);
  assert.equal(button.textContent, "Start with your details");
  await act(async () => button.click()); assert.equal(step, "signup");
});

it("keeps three worker cards in one row that scrolls sideways from the keyboard", async () => {
  const worker = (id: string, workflow: string) => ({ id, label: id, workflow, state: "running", action: "Working", browsers: [] }) as unknown as SessionWorker;
  const host = await mount(createElement(TooltipProvider, null, createElement(SessionsView, { data: { state: "ready", workers: [worker("w1", "Separations"), worker("w2", "Person Lookup"), worker("w3", "OnBase")] },
    open: true, onOpenChange: () => undefined, workflows: [], onControl: () => undefined, onAdd: () => undefined })));
  const strip = host.querySelector("[data-session-strip]"); assert.ok(strip);
  assert.ok(strip.classList.contains("overflow-x-auto")); assert.ok(!strip.classList.contains("flex-wrap"));
  assert.equal(strip.getAttribute("tabindex"), "0"); assert.equal(strip.getAttribute("aria-label"), "Workers");
  assert.equal(strip.querySelectorAll("article").length, 3);
});

it("takes initials from the first two words, or the first two letters of one word", () => {
  assert.equal(workflowInitials("Person Lookup"), "PL");
  assert.equal(workflowInitials("Work-Study Intake Form"), "WS");
  assert.equal(workflowInitials("OnBase"), "ON");
});
