// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { StorageRelocationRows } from "../../../src/dashboard/surfaces/settings-relocation.js";
import { SettingsPage } from "../../../src/dashboard/surfaces/settings.js";
import { DEFAULT_CATALOG_VIEW } from "../../../src/dashboard/surfaces/row-catalog-model.js";
import { FIXTURE_EDITABLE_SETTINGS } from "../../parity/helpers/fixture-settings.js";
import { StorageHealthSummaryWireSchema } from "../../../src/domain/dashboard/bootstrap.js";
import { useStorageRelocation, cancelRelocationCommand, desiredRelocationPair, planRelocationCommand } from "../../../src/dashboard/surfaces/settings-relocation-model.js";
import { StorageRelocationCommandRequestSchema, StorageRelocationPlanViewSchema, type StorageRelocationPlanView } from "../../../src/domain/commands.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const SOURCE = { stateRoot: "/tmp/fixture-state", artifactRoot: "/tmp/fixture-artifacts" };
const INITIAL = StorageRelocationPlanViewSchema.parse({ revision: 0, installationId: "11111111-1111-4111-8111-111111111111",
  sourceGeneration: 0, sourcePair: SOURCE, pending: null });
let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(() => { if (root !== undefined) act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; });

async function mount(client: DashboardClient) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  let controller: ReturnType<typeof useStorageRelocation> | undefined;
  function Surface() { controller = useStorageRelocation({ actorId: "local-operator" }); return createElement(StorageRelocationRows, { editor: controller }); }
  await act(async () => { root?.render(createElement(DashboardClientProvider, { client, children: createElement(Surface) })); });
  await act(async () => undefined);
  if (controller === undefined) throw new Error("relocation-controller-missing");
  return { controller: () => { if (controller === undefined) throw new Error("relocation-controller-missing"); return controller; }, host };
}
async function edit(label: string, value: string) {
  const field = label === "Runtime state folder" ? "paths.stateRoot" : "paths.artifactRoot";
  const input = host?.querySelector(`[data-settings-path="${field}"] input`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`missing ${label}`);
  await act(async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter === undefined) throw new Error("input setter unavailable");
    Reflect.apply(setter, input, [value]); input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function idle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 750)); }); }

describe("storage relocation Paths controls", () => {
  it("couples one changed field with the other desired field, records a plan after idle, and keeps active paths distinct", async () => {
    let view: StorageRelocationPlanView = INITIAL;
    const commands: unknown[] = [];
    const client = { storageRelocationPlans: () => Promise.resolve(view), applyStorageRelocation: (input: unknown) => {
      const command = StorageRelocationCommandRequestSchema.parse(input); commands.push(command);
      if (command.type !== "plan-storage-relocation") throw new Error("unexpected cancel");
      view = StorageRelocationPlanViewSchema.parse({ ...view, revision: 1, pending: { commandId: command.commandId,
        writeId: command.payload.writeId, desiredPair: command.payload.desiredPair,
        desiredDigest: command.payload.desiredDigest, requestFingerprint: command.payload.requestFingerprint } });
      return Promise.resolve({ state: "applied", commandId: command.commandId, affectedTargets: [{ family: "storage-relocation", revision: 1 }] });
    } } as unknown as DashboardClient;
    const surface = await mount(client);
    assert.equal(surface.host.querySelectorAll("input:not([readonly])").length, 2);
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
    const client = { storageRelocationPlans: () => Promise.resolve(view), applyStorageRelocation: (input: unknown) => {
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
    assert.match(surface.host.textContent ?? "", /may already be recorded/u);
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
    const client = { storageRelocationPlans: () => Promise.resolve(view), applyStorageRelocation: (input: unknown) => {
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
    const client = { storageRelocationPlans: () => Promise.reject(new Error("no reader")), applyStorageRelocation: () => { throw new Error("unexpected write"); } } as unknown as DashboardClient;
    const surface = await mount(client);
    assert.equal(surface.host.querySelectorAll("input").length, 0);
    assert.match(surface.host.textContent ?? "", /active paths and relocation plan could not be verified/u);
  });

  it("binds cancel to the pending plan and preserves the desired partner on later edits", () => {
    const planned = planRelocationCommand(INITIAL, { stateRoot: "/tmp/next-state", artifactRoot: SOURCE.artifactRoot }, "local-operator");
    if (planned.type !== "plan-storage-relocation") throw new Error("expected plan");
    const view = StorageRelocationPlanViewSchema.parse({ ...INITIAL, revision: 1, pending: { commandId: planned.commandId,
      writeId: planned.payload.writeId, desiredPair: planned.payload.desiredPair,
      desiredDigest: planned.payload.desiredDigest, requestFingerprint: planned.payload.requestFingerprint } });
    assert.deepEqual(desiredRelocationPair(view, { artifactRoot: "/tmp/next-artifacts" }), { stateRoot: "/tmp/next-state", artifactRoot: "/tmp/next-artifacts" });
    const cancel = cancelRelocationCommand(view, "local-operator");
    if (cancel.type !== "cancel-storage-relocation") throw new Error("expected cancellation");
    assert.equal(cancel.payload.cancelledPlanCommandId, planned.commandId);
    assert.equal(cancel.payload.cancelledPlanDigest, planned.payload.desiredDigest);
  });
  it("cancels a settled plan through an audited command while active paths stay unchanged", async () => {
    const planned = planRelocationCommand(INITIAL, { stateRoot: "/tmp/next-state", artifactRoot: SOURCE.artifactRoot }, "local-operator");
    if (planned.type !== "plan-storage-relocation") throw new Error("expected plan");
    let view = StorageRelocationPlanViewSchema.parse({ ...INITIAL, revision: 1, pending: { commandId: planned.commandId,
      writeId: planned.payload.writeId, desiredPair: planned.payload.desiredPair,
      desiredDigest: planned.payload.desiredDigest, requestFingerprint: planned.payload.requestFingerprint } });
    const commands: unknown[] = [];
    const client = { storageRelocationPlans: () => Promise.resolve(view), applyStorageRelocation: (input: unknown) => {
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
    assert.equal(surface.host.querySelector('[data-settings-path="paths.stateRoot"] input')?.getAttribute("value"), SOURCE.stateRoot);
    assert.equal((surface.host.querySelector('[data-settings-path="paths.stateRoot"] input') as HTMLInputElement).disabled, true);
    assert.match(surface.host.textContent ?? "", /last verified paths remain shown/u);
  });
  it("lets an invalid local field be undone without issuing a command", async () => {
    const commands: unknown[] = [];
    const client = { storageRelocationPlans: () => Promise.resolve(INITIAL), applyStorageRelocation: (input: unknown) => { commands.push(input); throw new Error("unexpected write"); } } as unknown as DashboardClient;
    const surface = await mount(client);
    await edit("Artifact folder", "relative");
    assert.ok(surface.host.querySelector('button[aria-label="Actions for Artifact folder"]'));
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
    const client = { storageRelocationPlans: () => Promise.resolve(INITIAL), applyStorageRelocation: (input: unknown) => {
      const command = StorageRelocationCommandRequestSchema.parse(input); commands.push(command);
      return Promise.resolve({ state: "rejected", commandId: command.commandId, code: "authority-uncertain", message: "synthetic unknown" });
    } } as unknown as DashboardClient;
    const surface = await mount(client);
    await edit("Artifact folder", "/tmp/other-artifacts"); await idle();
    assert.equal(surface.controller().uncertain, true);
    await act(async () => { surface.controller().retry(); await Promise.resolve(); });
    assert.deepEqual(commands[1], commands[0]);
  });
  it("guards an uncertain plan on exit without claiming cancellation or a moved folder", async () => {
    let guard: ((proceed: () => void) => void) | undefined;
    let exits = 0;
    const client = { editableSettings: () => Promise.resolve(FIXTURE_EDITABLE_SETTINGS),
      storageRelocationPlans: () => Promise.resolve(INITIAL),
      applyStorageRelocation: () => Promise.reject(new Error("synthetic lost response")),
    } as unknown as DashboardClient;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const storage = StorageHealthSummaryWireSchema.parse({ authority: "healthy", backup: "current", checkedAt: "2026-09-26T12:00:00.000Z" });
    await act(async () => { root?.render(createElement(DashboardClientProvider, { client, children: createElement(SettingsPage, {
      storage, sections: [], workflowLabels: new Map(), section: "paths", actorId: "local-operator", descriptorFingerprint: "d".repeat(64),
      preflight: [], catalogQuery: "", catalogView: DEFAULT_CATALOG_VIEW, onCatalogQuery: () => undefined,
      onCatalogView: () => undefined, onSection: () => undefined, onExitGuardChange: next => { guard = next; },
    }) })); });
    await act(async () => undefined);
    await edit("Artifact folder", "/tmp/new-artifacts"); await idle();
    assert.ok(guard);
    await act(async () => guard?.(() => { exits += 1; }));
    assert.equal(exits, 0);
    assert.match(document.body.textContent ?? "", /Leave with an unconfirmed plan\?/u);
    assert.match(document.body.textContent ?? "", /does not mean folders moved/u);
    const keep = [...document.querySelectorAll("button")].find(button => button.textContent === "Keep editing");
    if (keep === undefined) throw new Error("keep-editing action missing");
    await act(async () => keep.click());
    assert.equal(exits, 0);
    assert.ok(host.querySelector('[data-settings-path="paths.artifactRoot"] input'));
  });
});
