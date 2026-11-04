import { ClearRunHistoryRequestSchema } from "../../../../../src/models/dashboard/run-history.js";
import { IsoInstantSchema } from "../../../../../src/rules/identity/ids.js";
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { StorageSection } from "../../../../../src/dashboard/surfaces/settings/storage/storage-settings.js";
import { MeasurementFreeResizeObserver } from "../../../../support/helpers/settings-storage-doctor-fixtures.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", MeasurementFreeResizeObserver);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });

function button(name: string) {
  const element = [...document.querySelectorAll("button")].find(node => node.textContent === name);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`missing ${name}`);
  return element;
}
async function confirm() {
  const element = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(node => node.textContent === "Clear run history");
  if (!element) throw new Error("missing confirmation");
  await act(async () => element.click());
}
async function click(name: string) { await act(async () => { button(name).focus(); button(name).click(); }); }
async function mount(options: { activeRuns?: number; finishedRuns?: number; unavailable?: boolean; reject?: boolean; mismatch?: boolean } = {}) {
  let cleared = 0, fail = false;
  const commands: unknown[] = [];
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:3938", fetchImpl: async (url, init) => {
    if (url.endsWith("/storage/doctor/latest")) return Response.json({ state: "never-run" });
    if (url.endsWith("/storage/run-history")) return Response.json(options.unavailable ? { state: "unavailable" } : { state: "available", finishedRuns: options.finishedRuns ?? 2, activeRuns: options.activeRuns ?? 0 });
    if (!url.endsWith("/storage/run-history/clear")) throw new Error(`unexpected request ${url}`);
    if (typeof init?.body !== "string") throw new Error("expected a JSON request body");
    const command = ClearRunHistoryRequestSchema.parse(JSON.parse(init.body)); commands.push(command);
    if (fail) throw new Error("synthetic lost response");
    const { commandId } = command;
    return Response.json(options.reject ? { state: "refused", commandId, reason: "active-runs" }
      : { state: "cleared", commandId: options.mismatch ? crypto.randomUUID() : commandId, deletedRuns: 2 });
  } });
  const render = async () => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(StorageSection, {
      storage: { authority: "healthy", checkedAt: IsoInstantSchema.parse("2026-11-04T12:00:00.000Z"), backup: "current", automaticRepair: { state: "none" } }, onHistoryCleared() { cleared++; },
    }) })));
  };
  await render();
  return { commands, get cleared() { return cleared; }, fail(value: boolean) { fail = value; }, render };
}

it("requires destructive confirmation, defaults focus to Cancel, and acknowledges the exact command", async () => {
  const f = await mount(); expect(button("Clear run history").disabled).toBe(false);
  await click("Clear run history");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("write-safety records are kept");
  expect(document.activeElement?.textContent).toBe("Cancel");
  await click("Cancel"); expect(f.commands).toEqual([]); await vi.waitFor(() => expect(document.activeElement).toBe(button("Clear run history")));
  await click("Clear run history");
  await confirm();
  expect(f.commands).toHaveLength(1); expect(f.cleared).toBe(1);
  expect(document.body.textContent).toContain("2 finished runs cleared.");
});

it.each([{ activeRuns: 1 }, { finishedRuns: 0 }, { unavailable: true }])("disables clearing when status does not permit it: %j", async options => {
  const f = await mount(options); expect(button("Clear run history").disabled).toBe(true); expect(f.commands).toEqual([]);
});

it("shows a server refusal after a run starts while confirmation is open", async () => {
  const f = await mount({ reject: true }); await click("Clear run history");
  await confirm();
  expect(f.cleared).toBe(0); expect(document.body.textContent).toContain("Finish or cancel all active runs");
});

it("retains an uncertain request across remount and checks the same command identity", async () => {
  const f = await mount(); f.fail(true); await click("Clear run history");
  await confirm();
  expect(f.cleared).toBe(0); expect(button("Check clear result").disabled).toBe(false);
  await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren();
  await f.render(); expect(button("Check clear result").disabled).toBe(false);
  f.fail(false); await click("Check clear result");
  expect(f.commands).toHaveLength(2); expect(f.commands[1]).toEqual(f.commands[0]); expect(f.cleared).toBe(1);
});

it("treats a mismatched command response as uncertain and never announces completion", async () => {
  const f = await mount({ mismatch: true }); await click("Clear run history");
  await confirm();
  expect(f.cleared).toBe(0); expect(button("Check clear result")).toBeDefined();
  expect(document.body.textContent).not.toContain("finished runs cleared.");
});
