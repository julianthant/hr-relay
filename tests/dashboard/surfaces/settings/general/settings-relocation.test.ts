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
import { FixedStorageRows } from "../../../../../src/dashboard/surfaces/settings/general/settings-relocation.js";
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
  function Surface() { controller = useStorageRelocation({ actorId: "local-operator", onSaved: notice => notices.push(notice) }); currentController = controller; return createElement(FixedStorageRows, { editor: controller }); }
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
  it("keeps runtime folders read-only without picker or command effects", async () => {
    const commands: unknown[] = [];
    const picks: unknown[] = [];
    const client = { storageRelocationPlans: () => Promise.resolve(INITIAL),
      pickSettingsPath: (input: unknown) => { picks.push(input); throw new Error("unexpected picker"); },
      executeCommand: (input: unknown) => { commands.push(input); throw new Error("unexpected command"); },
    } as unknown as DashboardClient;
    const surface = await mount(client);
    const fields = [...surface.host.querySelectorAll("input")];
    assert.equal(fields.length, 2);
    assert.deepEqual(fields.map(input => input.value), [SOURCE.stateRoot, SOURCE.artifactRoot]);
    assert.ok(fields.every(input => input.readOnly));
    assert.deepEqual([...surface.host.querySelectorAll("button")].map(button => button.getAttribute("aria-label") ?? button.textContent), ["Copy data path", "Copy evidence path"]);
    await idle();
    assert.deepEqual(commands, []); assert.deepEqual(picks, []);
    assert.deepEqual(surface.notices, []); assert.equal(surface.controller().dirtyCount, 0);
  });

  it("shows a pending plan as unapplied without a CLI command or relocation action", async () => {
    const planned = planRelocationCommand(INITIAL, { stateRoot: "/tmp/next-state", artifactRoot: SOURCE.artifactRoot }, "local-operator", "2026-08-03T12:00:00.000Z");
    if (planned.type !== "plan-storage-relocation") throw new Error("expected plan");
    const view = StorageRelocationPlanViewSchema.parse({ ...INITIAL, revision: 1, pending: {
      commandId: planned.commandId, writeId: planned.payload.writeId,
      desiredPair: planned.payload.desiredPair, desiredDigest: planned.payload.desiredDigest,
      requestFingerprint: planned.payload.requestFingerprint,
    } });
    const surface = await mount({ storageRelocationPlans: () => Promise.resolve(view) } as unknown as DashboardClient);
    assert.match(surface.host.textContent ?? "", /The folder plan is not applied\. These locations are unchanged\./u);
    assert.equal(surface.host.querySelector('input[aria-label="Relocation command"]'), null);
    assert.equal(surface.host.querySelector('button[aria-label="Copy relocation command"]'), null);
    assert.deepEqual([...surface.host.querySelectorAll("input")].map(input => input.value), [SOURCE.stateRoot, SOURCE.artifactRoot]);
    assert.doesNotMatch(surface.host.textContent ?? "", /storage relocate --plan|Cancel plan/u);
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
    assert.deepEqual([...surface.host.querySelectorAll("button")].map(button => button.getAttribute("aria-label") ?? button.textContent), ["Copy data path", "Copy evidence path"]);
    assert.equal(surface.host.querySelectorAll("input[readonly]").length, 2);
    await edit("Runtime state folder", "/tmp/new-state"); await idle();
    assert.equal(commands.length, 1);
    const request = StorageRelocationCommandRequestSchema.parse(commands[0]);
    if (request.type !== "plan-storage-relocation") throw new Error("expected plan");
    assert.deepEqual(request.payload.desiredPair, { stateRoot: "/tmp/new-state", artifactRoot: SOURCE.artifactRoot });
    assert.match(surface.host.textContent ?? "", /The folder plan is not applied\. These locations are unchanged\./u);
    assert.deepEqual([...surface.host.querySelectorAll("input")].map(input => input.value), [SOURCE.stateRoot, SOURCE.artifactRoot]);
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
    assert.equal(commands.length, 0); assert.match(surface.controller().errors.artifactRoot ?? "", /canonical absolute/u);
    await edit("Artifact folder", "/tmp/new-artifacts"); await idle();
    assert.equal(commands.length, 1); assert.equal(surface.controller().uncertain, true);
    const uncertainSave = surface.controller().save;
    assert.ok(uncertainSave.state === "unconfirmed" && uncertainSave.message === formatErrorCatalogFailure(createErrorCatalogFailure("STORAGE_RELOCATION_OUTCOME_UNCERTAIN", {})).text);
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
    assert.deepEqual([...surface.host.querySelectorAll("button")].map(button => button.getAttribute("aria-label") ?? button.textContent), ["Copy data path", "Copy evidence path"]);
    mode = "divergent";
    await act(async () => surface.controller().submit()); await act(async () => undefined);
    assert.equal(surface.controller().save.state, "unconfirmed"); assert.equal(surface.controller().dirtyCount, 1);
    assert.equal(commands.length, 2);
  });

  it("does not substitute ordinary settings values when the plan reader is unavailable", async () => {
    const client = { storageRelocationPlans: () => Promise.reject(new Error("no reader")), executeCommand: () => { throw new Error("unexpected write"); } } as unknown as DashboardClient;
    const surface = await mount(client);
    assert.equal(surface.host.querySelectorAll("input").length, 0);
    assert.match(surface.host.textContent ?? "", /App-data locations couldn’t be read\./u);
    assert.equal(surface.controller().read.state, "unavailable");
    assert.equal(surface.host.querySelectorAll("button").length, 1);
    assert.equal(surface.host.querySelector("button")?.textContent, "Try again");
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
    assert.deepEqual([...surface.host.querySelectorAll("button")].map(button => button.getAttribute("aria-label") ?? button.textContent), ["Copy data path", "Copy evidence path"]);
    await act(async () => surface.controller().cancel()); await act(async () => undefined);
    assert.equal(commands.length, 1);
    const command = StorageRelocationCommandRequestSchema.parse(commands[0]);
    assert.equal(command.type, "cancel-storage-relocation");
    assert.equal(view.pending, null);
    assert.deepEqual(view.sourcePair, SOURCE);
    assert.doesNotMatch(surface.host.textContent ?? "", /The folder plan is not applied/u);
  });
  it("keeps the last verified source visible but blocks edits on stale or divergent reads", async () => {
    let view: StorageRelocationPlanView = INITIAL;
    const client = { storageRelocationPlans: () => Promise.resolve(view) } as unknown as DashboardClient;
    const surface = await mount(client);
    view = StorageRelocationPlanViewSchema.parse({ ...INITIAL, sourcePair: { ...SOURCE, stateRoot: "/tmp/divergent" } });
    await act(async () => { surface.controller().reload(); await Promise.resolve(); });
    assert.equal(surface.controller().readProblem, true);
    assert.equal((surface.host.querySelector('[data-settings-path="paths.stateRoot"] input') as HTMLInputElement).value, SOURCE.stateRoot);
    assert.equal((surface.host.querySelector('[data-settings-path="paths.stateRoot"] input') as HTMLInputElement).readOnly, true);
    assert.match(surface.host.textContent ?? "", /Current app-data locations couldn’t be read\./u);
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
    assert.equal((surface.host.querySelector('[data-settings-path="paths.stateRoot"] input') as HTMLInputElement).value, SOURCE.stateRoot);
    assert.deepEqual([...surface.host.querySelectorAll("button")].map(button => button.getAttribute("aria-label") ?? button.textContent), ["Copy data path", "Copy evidence path", "Try again"]);
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
    assert.equal(surface.controller().save.state, "refused");
    const save = surface.controller().save; assert.equal(save.state, "refused");
    if (save.state !== "refused") throw new Error("expected refusal");
    assert.equal(save.code, "STORAGE_RELOCATION_DRAFT_UNCHANGED");
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
