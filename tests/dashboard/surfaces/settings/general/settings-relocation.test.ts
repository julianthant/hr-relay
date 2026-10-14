import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../../../src/models/failures/error-catalog.js";
import { FixtureCommandBinding } from "../../../../support/helpers/dashboard/command-binding.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,it } from "vitest";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import type { SettingsSaveNotice } from "../../../../../src/dashboard/surfaces/settings/editor/settings-attempt-model.js";
import { planRelocationCommand,useStorageRelocation } from "../../../../../src/dashboard/surfaces/settings/general/settings-relocation-model.js";
import { StorageRelocationRows } from "../../../../../src/dashboard/surfaces/settings/general/settings-relocation.js";
import { StorageRelocationCommandRequestSchema,StorageRelocationPlanViewSchema,type StorageRelocationPlanView } from "../../../../../src/rules/commands/commands.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const SOURCE = { stateRoot: "/tmp/fixture-state", artifactRoot: "/tmp/fixture-artifacts" };
const INITIAL = StorageRelocationPlanViewSchema.parse({ revision: 0, installationId: "11111111-1111-4111-8111-111111111111",
  sourceGeneration: 0, sourcePair: SOURCE, pending: null });
let root: Root | undefined;
let host: HTMLElement | undefined;
let currentController: ReturnType<typeof useStorageRelocation> | undefined;
afterEach(() => { if (root !== undefined) act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; currentController = undefined; });

async function mount(client: DashboardClient) {
  const notices: SettingsSaveNotice[] = [];
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  let controller: ReturnType<typeof useStorageRelocation> | undefined;
  function Surface() { controller = useStorageRelocation({ actorId: "local-operator", onSaved: notice => notices.push(notice) }); currentController = controller; return createElement(StorageRelocationRows, { editor: controller }); }
  await act(async () => { root?.render(createElement(DashboardClientProvider, { client, children: createElement(FixtureCommandBinding, { actorId: "local-operator", children: createElement(Surface) }) })); });
  await act(async () => undefined);
  if (controller === undefined) throw new Error("relocation-controller-missing");
  return { notices, controller: () => { if (controller === undefined) throw new Error("relocation-controller-missing"); return controller; }, host };
}
async function edit(label: string, value: string) {
  if (currentController === undefined) throw new Error(`missing ${label} controller`);
  const field = label === "Runtime state folder" ? "stateRoot" : "artifactRoot";
  await act(async () => currentController?.update(field, value));
}
async function idle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 750)); }); }

describe("storage relocation Paths controls", () => {
  it("plans only a selected runtime folder and keeps cancellation local", async () => {
    let view: StorageRelocationPlanView = INITIAL;
    const commands: unknown[] = [];
    let selection: "selected" | "cancelled" = "cancelled";
    const client = { storageRelocationPlans: () => Promise.resolve(view),
      pickSettingsPath: () => Promise.resolve(selection === "selected"
        ? { state: "selected", field: "paths.stateRoot", path: "/tmp/picked-state" }
        : { state: "cancelled", field: "paths.stateRoot" }),
      executeCommand: (input: unknown) => {
        const command = StorageRelocationCommandRequestSchema.parse(input); commands.push(command);
        if (command.type !== "plan-storage-relocation") throw new Error("unexpected cancel");
        view = StorageRelocationPlanViewSchema.parse({ ...view, revision: 1, pending: {
          commandId: command.commandId, writeId: command.payload.writeId,
          desiredPair: command.payload.desiredPair, desiredDigest: command.payload.desiredDigest,
          requestFingerprint: command.payload.requestFingerprint,
        } });
        return Promise.resolve({ state: "applied", commandId: command.commandId,
          affectedTargets: [{ family: "storage-relocation", revision: 1 }] });
      },
    } as unknown as DashboardClient;
    const surface = await mount(client);
    const change = surface.host.querySelector('[data-settings-path="paths.stateRoot"] button[aria-label="Change Runtime state folder"]');
    if (!(change instanceof HTMLButtonElement)) throw new Error("state picker action missing");
    await act(async () => { change.click(); await Promise.resolve(); });
    await idle();
    assert.equal(commands.length, 0);
    assert.deepEqual(surface.notices, []);
    assert.equal(surface.controller().dirtyCount, 0);
    selection = "selected";
    await act(async () => { change.click(); await Promise.resolve(); });
    await idle();
    assert.equal(commands.length, 1);
    const planned = StorageRelocationCommandRequestSchema.parse(commands[0]);
    if (planned.type !== "plan-storage-relocation") throw new Error("expected plan");
    assert.deepEqual(planned.payload.desiredPair, { stateRoot: "/tmp/picked-state", artifactRoot: SOURCE.artifactRoot });
    assert.equal(view.sourcePair.stateRoot, SOURCE.stateRoot);
    assert.deepEqual(surface.notices, [{ title: "Saved location plan" }]);
  });

  it("shows the exact pending CLI command with selectable fallback and transient copy feedback", async () => {
    const planned = planRelocationCommand(INITIAL, { stateRoot: "/tmp/next-state", artifactRoot: SOURCE.artifactRoot }, "local-operator", "2026-08-03T12:00:00.000Z");
    if (planned.type !== "plan-storage-relocation") throw new Error("expected plan");
    const view = StorageRelocationPlanViewSchema.parse({ ...INITIAL, revision: 1, pending: {
      commandId: planned.commandId, writeId: planned.payload.writeId,
      desiredPair: planned.payload.desiredPair, desiredDigest: planned.payload.desiredDigest,
      requestFingerprint: planned.payload.requestFingerprint,
    } });
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const written: string[] = [];
    let unavailable = false;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => {
      if (unavailable) throw new Error("clipboard unavailable");
      written.push(value);
    } } });
    try {
      const surface = await mount({ storageRelocationPlans: () => Promise.resolve(view) } as unknown as DashboardClient);
      const command = `npm run cli -- storage relocate --plan ${planned.commandId}`;
      const input = surface.host.querySelector('input[aria-label="Relocation command"]');
      if (!(input instanceof HTMLInputElement)) throw new Error("command input missing");
      assert.equal(input.value, command);
      assert.equal(input.readOnly, true);
      assert.match(surface.host.textContent ?? "", /Stop the dashboard and workers/u);
      assert.match(surface.host.textContent ?? "", /Restart them after relocation completes/u);
      await act(async () => input.focus());
      assert.equal(input.selectionStart, 0);
      assert.equal(input.selectionEnd, command.length);
      const copy = surface.host.querySelector('button[aria-label="Copy relocation command"]');
      if (!(copy instanceof HTMLButtonElement)) throw new Error("copy action missing");
      await act(async () => { copy.click(); await Promise.resolve(); });
      assert.deepEqual(written, [command]);
      assert.match(surface.host.querySelector('[role="status"]')?.textContent ?? "", /Command copied/u);
      unavailable = true;
      await act(async () => { copy.click(); await Promise.resolve(); });
      assert.match(surface.host.querySelector('[role="alert"]')?.textContent ?? "", /Select and copy the command/u);
      assert.equal(input.value, command);
    } finally {
      if (originalClipboard === undefined) Reflect.deleteProperty(navigator, "clipboard");
      else Object.defineProperty(navigator, "clipboard", originalClipboard);
    }
  });

  it("couples one changed field with the other desired field, records a plan after idle, and keeps active paths distinct", async () => {
    let view: StorageRelocationPlanView = INITIAL;
    const commands: unknown[] = [];
    const client = { storageRelocationPlans: () => Promise.resolve(view), executeCommand: (input: unknown) => {
      const command = StorageRelocationCommandRequestSchema.parse(input); commands.push(command);
      if (command.type !== "plan-storage-relocation") throw new Error("unexpected cancel");
      view = StorageRelocationPlanViewSchema.parse({ ...view, revision: 1, pending: { commandId: command.commandId,
        writeId: command.payload.writeId, desiredPair: command.payload.desiredPair,
        desiredDigest: command.payload.desiredDigest, requestFingerprint: command.payload.requestFingerprint } });
      return Promise.resolve({ state: "applied", commandId: command.commandId, affectedTargets: [{ family: "storage-relocation", revision: 1 }] });
    } } as unknown as DashboardClient;
    const surface = await mount(client);
    assert.equal(surface.host.querySelectorAll(".settings-relocation-row .ds-path-control button").length, 2);
    await edit("Runtime state folder", "/tmp/new-state"); await idle();
    assert.equal(commands.length, 1);
    const request = StorageRelocationCommandRequestSchema.parse(commands[0]);
    if (request.type !== "plan-storage-relocation") throw new Error("expected plan");
    assert.deepEqual(request.payload.desiredPair, { stateRoot: "/tmp/new-state", artifactRoot: SOURCE.artifactRoot });
    assert.match(surface.host.textContent ?? "", /folders have not moved/u);
    assert.match(surface.host.textContent ?? "", /stopped, verified relocation/u);
    assert.equal(view.sourcePair.stateRoot, SOURCE.stateRoot);
    assert.equal(surface.controller().dirtyCount, 0);
  });

  it("retains invalid drafts without POST, then retries the exact uncertain command", async () => {
    let view: StorageRelocationPlanView = INITIAL;
    const commands: unknown[] = []; let fail = true;
    const client = { storageRelocationPlans: () => Promise.resolve(view), executeCommand: (input: unknown) => {
      const command = StorageRelocationCommandRequestSchema.parse(input); commands.push(command);
      if (fail) return Promise.reject(new Error("synthetic network uncertainty"));
      if (command.type !== "plan-storage-relocation") throw new Error("expected plan");
      view = StorageRelocationPlanViewSchema.parse({ ...view, revision: 1, pending: { commandId: command.commandId,
        writeId: command.payload.writeId, desiredPair: command.payload.desiredPair,
        desiredDigest: command.payload.desiredDigest, requestFingerprint: command.payload.requestFingerprint } });
      return Promise.resolve({ state: "already-applied", commandId: command.commandId, affectedTargets: [{ family: "storage-relocation", revision: 1 }] });
    } } as unknown as DashboardClient;
    const surface = await mount(client);
    await edit("Artifact folder", "relative"); await idle();
    assert.equal(commands.length, 0); assert.match(surface.host.textContent ?? "", /canonical absolute/u);
    await edit("Artifact folder", "/tmp/new-artifacts"); await idle();
    assert.equal(commands.length, 1); assert.equal(surface.controller().uncertain, true);
    assert.ok(surface.host.textContent?.includes(formatErrorCatalogFailure(createErrorCatalogFailure("STORAGE_RELOCATION_OUTCOME_UNCERTAIN", {})).text));
    fail = false;
    await act(async () => { surface.controller().retry(); await Promise.resolve(); });
    await act(async () => undefined);
    assert.deepEqual(commands[1], commands[0]);
    assert.equal(surface.controller().uncertain, false);
  });

  it("refuses divergent readback, keeps drafts on conflict, and leaves unavailable source read-only", async () => {
    let view: StorageRelocationPlanView = INITIAL;
    let mode: "conflict" | "divergent" = "conflict";
    const commands: unknown[] = [];
    const client = { storageRelocationPlans: () => Promise.resolve(view), executeCommand: (input: unknown) => {
      const command = StorageRelocationCommandRequestSchema.parse(input); commands.push(command);
      if (mode === "conflict") { view = StorageRelocationPlanViewSchema.parse({ ...view, revision: 1 }); return Promise.resolve({ state: "conflict", commandId: command.commandId, currentVersion: 1, message: "changed" }); }
      view = StorageRelocationPlanViewSchema.parse({ ...view, revision: 2, pending: null });
      return Promise.resolve({ state: "applied", commandId: command.commandId, affectedTargets: [{ family: "storage-relocation", revision: 2 }] });
    } } as unknown as DashboardClient;
    const surface = await mount(client);
    await edit("Artifact folder", "/tmp/other-artifacts"); await idle();
    assert.equal(surface.controller().save.state, "conflict"); assert.equal(surface.controller().dirtyCount, 1);
    assert.ok([...surface.host.querySelectorAll("button")].some(button => button.textContent === "Retry updated plan"));
    mode = "divergent";
    const retryUpdated = [...surface.host.querySelectorAll("button")].find(button => button.textContent === "Retry updated plan");
    if (retryUpdated === undefined) throw new Error("updated-plan retry missing");
    await act(async () => retryUpdated.click()); await act(async () => undefined);
    assert.equal(surface.controller().save.state, "unconfirmed"); assert.equal(surface.controller().dirtyCount, 1);
    assert.equal(commands.length, 2);
  });

  it("does not substitute ordinary settings values when the plan reader is unavailable", async () => {
    const client = { storageRelocationPlans: () => Promise.reject(new Error("no reader")), executeCommand: () => { throw new Error("unexpected write"); } } as unknown as DashboardClient;
    const surface = await mount(client);
    assert.equal(surface.host.querySelectorAll("input").length, 0);
    assert.match(surface.host.textContent ?? "", /active paths and relocation plan could not be verified/u);
  });
  it("cancels a settled plan through an audited command while active paths stay unchanged", async () => {
    const planned = planRelocationCommand(INITIAL, { stateRoot: "/tmp/next-state", artifactRoot: SOURCE.artifactRoot }, "local-operator", "2026-08-03T12:00:00.000Z");
    if (planned.type !== "plan-storage-relocation") throw new Error("expected plan");
    let view = StorageRelocationPlanViewSchema.parse({ ...INITIAL, revision: 1, pending: { commandId: planned.commandId,
      writeId: planned.payload.writeId, desiredPair: planned.payload.desiredPair,
      desiredDigest: planned.payload.desiredDigest, requestFingerprint: planned.payload.requestFingerprint } });
    const commands: unknown[] = [];
    const client = { storageRelocationPlans: () => Promise.resolve(view), executeCommand: (input: unknown) => {
      const command = StorageRelocationCommandRequestSchema.parse(input); commands.push(command);
      view = StorageRelocationPlanViewSchema.parse({ ...view, revision: 2, pending: null });
      return Promise.resolve({ state: "applied", commandId: command.commandId, affectedTargets: [{ family: "storage-relocation", revision: 2 }] });
    } } as unknown as DashboardClient;
    const surface = await mount(client);
    const cancel = [...surface.host.querySelectorAll("button")].find(button => button.textContent === "Cancel plan");
    if (cancel === undefined) throw new Error("cancel action missing");
    await act(async () => cancel.click()); await act(async () => undefined);
    assert.equal(commands.length, 1);
    const command = StorageRelocationCommandRequestSchema.parse(commands[0]);
    assert.equal(command.type, "cancel-storage-relocation");
    assert.equal(view.pending, null);
    assert.deepEqual(view.sourcePair, SOURCE);
    assert.doesNotMatch(surface.host.textContent ?? "", /Folder change planned/u);
  });
  it("keeps the last verified source visible but blocks edits on stale or divergent reads", async () => {
    let view: StorageRelocationPlanView = INITIAL;
    const client = { storageRelocationPlans: () => Promise.resolve(view) } as unknown as DashboardClient;
    const surface = await mount(client);
    view = StorageRelocationPlanViewSchema.parse({ ...INITIAL, sourcePair: { ...SOURCE, stateRoot: "/tmp/divergent" } });
    await act(async () => { surface.controller().reload(); await Promise.resolve(); });
    assert.equal(surface.controller().readProblem, true);
    assert.equal(surface.host.querySelector('[data-settings-path="paths.stateRoot"] .ds-path-value')?.getAttribute("aria-label"), SOURCE.stateRoot);
    assert.equal((surface.host.querySelector('[data-settings-path="paths.stateRoot"] .ds-path-control button') as HTMLButtonElement).disabled, true);
    assert.match(surface.host.textContent ?? "", /last verified paths remain shown/u);
  });
  it("rejects a global plan revision rewind even when source generation advances", async () => {
    const current = StorageRelocationPlanViewSchema.parse({ ...INITIAL, revision: 2 });
    let view: StorageRelocationPlanView = current;
    const client = { storageRelocationPlans: () => Promise.resolve(view) } as unknown as DashboardClient;
    const surface = await mount(client);
    view = StorageRelocationPlanViewSchema.parse({ ...current, sourceGeneration: 1, revision: 1,
      sourcePair: { stateRoot: "/tmp/moved-state", artifactRoot: "/tmp/moved-artifacts" } });
    await act(async () => { surface.controller().reload(); await Promise.resolve(); });
    assert.equal(surface.controller().readProblem, true);
    const read = surface.controller().read;
    assert.equal(read.state, "available");
    if (read.state !== "available") throw new Error("last verified view disappeared");
    assert.deepEqual(read.view, current);
    const change = surface.host.querySelector('[data-settings-path="paths.stateRoot"] button[aria-label="Change Runtime state folder"]');
    if (!(change instanceof HTMLButtonElement)) throw new Error("state picker action missing");
    assert.equal(change.disabled, true);
  });
  it("lets an invalid local field be undone without issuing a command", async () => {
    const commands: unknown[] = [];
    const client = { storageRelocationPlans: () => Promise.resolve(INITIAL), executeCommand: (input: unknown) => { commands.push(input); throw new Error("unexpected write"); } } as unknown as DashboardClient;
    const surface = await mount(client);
    await edit("Artifact folder", "relative");
    assert.equal(surface.host.querySelector('button[aria-label="Actions for Artifact folder"]'), null);
    await act(async () => surface.controller().reset("artifactRoot"));
    await idle();
    assert.equal(commands.length, 0);
    assert.equal(surface.controller().dirtyCount, 0);
    await act(async () => surface.controller().update("artifactRoot", SOURCE.artifactRoot)); await idle();
    assert.equal(commands.length, 0);
    assert.match(surface.host.textContent ?? "", /draft matches the current plan/u);
    await act(async () => surface.controller().reset("artifactRoot"));
    assert.equal(surface.controller().dirtyCount, 0);
  });
  it("keeps a typed uncertain rejection bound to the original command", async () => {
    const commands: unknown[] = [];
    const client = { storageRelocationPlans: () => Promise.resolve(INITIAL), executeCommand: (input: unknown) => {
      const command = StorageRelocationCommandRequestSchema.parse(input); commands.push(command);
      return Promise.resolve({ state: "rejected", commandId: command.commandId, code: "authority-uncertain", message: "synthetic unknown" });
    } } as unknown as DashboardClient;
    const surface = await mount(client);
    await edit("Artifact folder", "/tmp/other-artifacts"); await idle();
    assert.equal(surface.controller().uncertain, true);
    await act(async () => { surface.controller().retry(); await Promise.resolve(); });
    assert.deepEqual(commands[1], commands[0]);
  });
});
