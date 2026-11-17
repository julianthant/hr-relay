// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, vi } from "vitest";
import { AssistantLauncher } from "../../../../src/dashboard/surfaces/shell/assistant-launcher.js";
import { ToastProvider, TooltipProvider } from "../../../../src/dashboard/ds/ui.js";
import { HubShell } from "../../../../src/dashboard/surfaces/shell/hub-shell.js";
import { MeasurementFreeResizeObserver } from "../../../support/helpers/settings-storage-doctor-fixtures.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import type { AssistantActivityWire } from "../../../../src/models/dashboard/assistant.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const at = (hour: number, minute: number) => new Date(2026, 10, 16, hour, minute).toISOString();
const ROWS = [
  { id: "00000000-0000-4000-8000-000000000001", label: "Approved: Start Person Lookup", at: at(9, 47) },
  { id: "00000000-0000-4000-8000-000000000002", label: "Marked notification read", at: at(9, 12) },
];

async function mount(read: () => Promise<AssistantActivityWire>) {
  vi.stubGlobal("ResizeObserver", MeasurementFreeResizeObserver);
  const base = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async () => new Response("{}", { status: 503 }) });
  const assistantActivity = vi.fn(read);
  const client = { ...base, assistantActivity };
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(TooltipProvider, null, createElement(ToastProvider, null,
    createElement(HubShell, { source: "served", settingsOpen: false, logoutOpen: false, onLogoutOpenChange() {}, onLogout() {}, onRunWorkflow: async () => ({ state: "failed" as const, message: "Unused" }) }),
    createElement(AssistantLauncher))) })));
  const button = (label: string) => { const found = document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`); assert.ok(found, label); return found; };
  const openHistory = async () => {
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Assistant"]')?.click());
    await act(async () => button("History").click());
  };
  const openActivity = async () => {
    await openHistory();
    await chooseActivity();
  };
  const chooseActivity = async () => {
    const radio = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(input => input.value === "activity"); assert.ok(radio);
    await act(async () => radio.click());
  };
  const search = async (value: string) => {
    const field = document.querySelector<HTMLInputElement>('[aria-label="Search activity"]'); assert.ok(field);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  const rows = () => [...document.querySelectorAll<HTMLElement>(".hub-transcript .flex.flex-col > div")].map(row => row.textContent ?? "");
  return { assistantActivity, openHistory, chooseActivity, openActivity, search, rows, text: () => document.body.textContent ?? "", cleanup: async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); } };
}
const time = (hour: number, minute: number) => new Date(2026, 10, 16, hour, minute).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

it("reads the served activity only when Activity opens and draws its rows in served order with name and time", async () => {
  const view = await mount(async () => ({ day: "2026-11-16", rows: ROWS }));
  try {
    await view.openHistory();
    assert.equal(view.assistantActivity.mock.calls.length, 0, "Chats tab does not read");
    await view.chooseActivity();
    assert.equal(view.assistantActivity.mock.calls.length, 1);
    const shown = view.rows();
    assert.equal(shown.length, 2);
    assert.ok(shown[0]?.includes("Approved: Start Person Lookup") && shown[0].includes(time(9, 47)), shown[0]);
    assert.ok(shown[1]?.includes("Marked notification read") && shown[1].includes(time(9, 12)), shown[1]);
    assert.equal(view.text().includes("No activity today"), false);
  } finally { await view.cleanup(); }
});

it("filters the served rows by the search text and states when nothing matches", async () => {
  const view = await mount(async () => ({ day: "2026-11-16", rows: ROWS }));
  try {
    await view.openActivity();
    await view.search("notification");
    assert.equal(view.rows().length, 1); assert.ok(view.rows()[0]?.includes("Marked notification read"));
    await view.search("zzz");
    assert.equal(view.rows().length, 0); assert.ok(view.text().includes("No matching activity."));
    assert.equal(view.assistantActivity.mock.calls.length, 1, "typing does not read again");
  } finally { await view.cleanup(); }
});

it("shows No activity today for an empty day", async () => {
  const view = await mount(async () => ({ day: "2026-11-16", rows: [] }));
  try {
    await view.openActivity();
    assert.ok(view.text().includes("No activity today")); assert.equal(view.rows().length, 0);
  } finally { await view.cleanup(); }
});

it("shows a short toast and the empty state when the read fails, never a panel", async () => {
  const view = await mount(async () => { throw new Error("down"); });
  try {
    await view.openActivity();
    assert.ok(view.text().includes("No activity today"));
    assert.ok(view.text().includes("Activity unavailable"), "toast title");
    assert.equal(document.querySelector('[role="alert"]'), null);
  } finally { await view.cleanup(); }
});
