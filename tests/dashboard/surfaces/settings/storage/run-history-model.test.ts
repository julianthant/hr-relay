import type { DashboardCommandBinding } from "../../../../../src/dashboard/app/dashboard-app-model.js";
import { CommandExecutor } from "../../../../../src/dashboard/app/commands/command-executor.js";
import { FrontendBootstrapWireSchema } from "../../../../../src/models/dashboard/bootstrap.js";
import { DashboardDayWireSchema } from "../../../../../src/models/dashboard/projection.js";
import { FIXTURE_BOOTSTRAP } from "../../../../support/fixtures/dashboard/fixture-bootstrap.js";
import { FIXTURE_DAY_WIRE } from "../../../../support/fixtures/dashboard/fixture-queue.js";
import { ERROR_CATALOG } from "../../../../../src/models/failures/error-catalog.js";
import { clearSettingsReads } from "../../../../../src/dashboard/state/settings-read-model.js";
import { ClearRunHistoryRequestSchema, type RunHistoryTarget } from "../../../../../src/models/dashboard/run-history.js";
import { IsoInstantSchema } from "../../../../../src/rules/identity/ids.js";
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider, DashboardCommandBindingProvider } from "../../../../../src/dashboard/state/client-context.js";
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
const TARGET = { profileId: "00000000-0000-4000-8000-000000000001", epoch: 1 };
async function mount(options: { target?: RunHistoryTarget | null; activeRuns?: number; finishedRuns?: number; unavailable?: boolean; reject?: boolean; mismatch?: boolean; unreceived?: boolean; statusResponse?: () => Promise<Response> } = {}) {
  let cleared = 0, fail = false;
  let observed = TARGET;
  const commands: unknown[] = [], checks: unknown[] = [];
  const recorded = new Map<string, {state: "cleared"; commandId: string; deletedRuns: number}>();
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:3938", fetchImpl: async (url, init) => {
    if (url.endsWith("/profile/state")) return Response.json({ state: "active", ...observed, duoState: "ready" });
    if (url.endsWith("/storage/doctor/latest")) return Response.json({ state: "never-run" });
    if (url.endsWith("/storage/run-history")) return options.statusResponse?.() ?? Response.json(options.unavailable ? { state: "unavailable" } : { state: "available", finishedRuns: options.finishedRuns ?? 2, activeRuns: options.activeRuns ?? 0 });
    const checking = url.endsWith("/storage/run-history/result");
    if (!checking && !url.endsWith("/storage/run-history/clear")) throw new Error(`unexpected request ${url}`);
    if (typeof init?.body !== "string") throw new Error("expected a JSON request body");
    const command = ClearRunHistoryRequestSchema.parse(JSON.parse(init.body));
    const { commandId } = command;
    if (checking) { checks.push(command); return Response.json(recorded.get(commandId) ?? { state: "not-recorded", commandId }); }
    commands.push(command);
    if (fail && options.unreceived) throw new Error("synthetic request never received");
    if (options.reject) return Response.json({ state: "refused", commandId, reason: "active-runs" });
    const result = recorded.get(commandId) ?? { state: "cleared" as const, commandId: options.mismatch ? crypto.randomUUID() : commandId, deletedRuns: 2 };
    recorded.set(commandId, result);
    if (fail) throw new Error("synthetic committed response lost");
    return Response.json(result);
  } });
  const epoch = { client, bootstrap: FrontendBootstrapWireSchema.parse(FIXTURE_BOOTSTRAP) };
  const day = DashboardDayWireSchema.parse(FIXTURE_DAY_WIRE);
  const dayRequest = {};
  const scope = { actorId: epoch.bootstrap.actor.id, client, authority: epoch, dayRequest };
  const binding: DashboardCommandBinding = {
    authority: { epoch, profileTarget: options.target === null ? undefined : options.target ?? TARGET, catalog: [],
      nowIso: epoch.bootstrap.serverClock.now, today: day.day, day: day.day,
      dayState: { request: dayRequest, day: { state: "loaded", value: day }, connection: { state: "connecting" }, refresh() {},
        subscribePublications() { throw new Error("history fixture does not serve publications"); } },
      selection: { route: { start: false }, workflowId: "" } },
    executor: new CommandExecutor(() => scope), scope, feedback() {},
  };
  const render = async () => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardCommandBindingProvider, { binding, children: createElement(StorageSection, {
      storage: { authority: "healthy", checkedAt: IsoInstantSchema.parse("2026-11-04T12:00:00.000Z"), backup: "current", lastBackupAt: null, backupCheckedAt: null }, onHistoryCleared() { cleared++; },
    }) }) })));
  };
  await render();
  return { client, commands, checks, get cleared() { return cleared; }, observe(target: RunHistoryTarget) { observed = target; return client.readProfileSession(); }, fail(value: boolean) { fail = value; }, render };
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
  expect(f.commands).toHaveLength(1); expect(f.checks).toEqual([f.commands[0]]); expect(f.cleared).toBe(1);
});

it("treats a mismatched command response as uncertain and never announces completion", async () => {
  const f = await mount({ mismatch: true }); await click("Clear run history");
  await confirm();
  expect(f.cleared).toBe(0); expect(button("Check clear result")).toBeDefined();
  expect(document.body.textContent).not.toContain("finished runs cleared.");
});

it("does not dispatch a fresh deletion when checking an unreceived request and requires another confirmation", async () => {
  const f = await mount({ unreceived: true }); f.fail(true);
  await click("Clear run history"); await confirm();
  expect(f.commands).toHaveLength(1);
  f.fail(false); await click("Check clear result");
  expect(f.commands).toHaveLength(1);
  expect(f.checks).toEqual([f.commands[0]]);
  expect(f.cleared).toBe(0);
  expect(document.body.textContent).toContain("not recorded");
  await click("Clear run history");
  expect(f.commands).toHaveLength(1);
  await confirm(); expect(f.commands).toHaveLength(2); expect(f.commands[1]).not.toEqual(f.commands[0]);
});

it("keeps a failed status read visible and refuses clearing", async () => {
  const f = await mount({statusResponse: async () => { throw new Error("synthetic history read failure"); }});
  expect(button("Clear run history").disabled).toBe(true);
  expect(document.body.textContent).toContain(ERROR_CATALOG.STORAGE_AUTHORITY_READ_FAILED.text);
  expect(f.commands).toEqual([]);
});

it("ignores a superseded status read after a replacement read has loaded", async () => {
  let rejectFirst: ((reason: unknown) => void) | undefined, reads = 0;
  const first = new Promise<Response>((_resolve, reject) => { rejectFirst = reject; });
  const f = await mount({statusResponse: () => ++reads === 1 ? first : Promise.resolve(Response.json({state: "available", finishedRuns: 2, activeRuns: 0}))});
  expect(button("Clear run history").disabled).toBe(true);
  await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren();
  clearSettingsReads(f.client); await f.render();
  expect(button("Clear run history").disabled).toBe(false);
  await act(async () => { if (rejectFirst === undefined) throw new Error("missing deferred read"); rejectFirst(new Error("superseded history read")); });
  expect(button("Clear run history").disabled).toBe(false);
  expect(document.body.textContent).not.toContain(ERROR_CATALOG.STORAGE_AUTHORITY_READ_FAILED.text);
});


it("retains the displayed A confirmation when the client subsequently observes B", async () => {
  const f = await mount();
  await click("Clear run history");
  await f.observe({ profileId: "00000000-0000-4000-8000-000000000002", epoch: 2 });
  await confirm();
  expect(f.commands).toEqual([expect.objectContaining({ target: TARGET })]);
});

it("retains the original profile and epoch for uncertain result lookup after a newer observation", async () => {
  const f = await mount(); f.fail(true);
  await click("Clear run history"); await confirm();
  await f.observe({ ...TARGET, epoch: 2 });
  f.fail(false); await click("Check clear result");
  expect(f.commands).toHaveLength(1);
  expect(f.checks).toEqual(f.commands);
  expect(ClearRunHistoryRequestSchema.parse(f.checks[0]).target).toEqual(TARGET);
});

it("refuses to offer a confirmation without an observed profile and epoch", async () => {
  const f = await mount({ target: null });
  expect(button("Clear run history").disabled).toBe(true);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(f.commands).toEqual([]);
});
