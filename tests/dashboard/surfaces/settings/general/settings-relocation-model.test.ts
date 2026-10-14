// @vitest-environment jsdom
import { createDashboardClient, type DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider, useDashboardCommandExecutor } from "../../../../../src/dashboard/state/client-context.js";
import { FixtureCommandBinding } from "../../../../support/helpers/dashboard/command-binding.js";
import type { CommandExecutor, CommandOutcome } from "../../../../../src/dashboard/app/commands/command-executor.js";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach,describe,it,vi } from "vitest";
import { cancelRelocationCommand,desiredRelocationPair,planRelocationCommand,useStorageRelocation } from "../../../../../src/dashboard/surfaces/settings/general/settings-relocation-model.js";
import { StorageRelocationPlanViewSchema, StorageRelocationCommandRequestSchema, CommandResultSchema, type StorageRelocationPlanView } from "../../../../../src/rules/commands/commands.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const SOURCE = { stateRoot: "/tmp/fixture-state", artifactRoot: "/tmp/fixture-artifacts" };
const INITIAL = StorageRelocationPlanViewSchema.parse({ revision: 0, installationId: "11111111-1111-4111-8111-111111111111",
  sourceGeneration: 0, sourcePair: SOURCE, pending: null });
let root: Root | undefined;
let host: HTMLElement | undefined;
let _currentController: ReturnType<typeof useStorageRelocation> | undefined;
afterEach(() => { if (root !== undefined) act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; _currentController = undefined; vi.restoreAllMocks(); });

describe("storage relocation Paths controls", () => {

  it("binds cancel to the pending plan and preserves the desired partner on later edits", () => {
    const planned = planRelocationCommand(INITIAL, { stateRoot: "/tmp/next-state", artifactRoot: SOURCE.artifactRoot }, "local-operator", "2026-08-03T12:00:00.000Z");
    if (planned.type !== "plan-storage-relocation") throw new Error("expected plan");
    const view = StorageRelocationPlanViewSchema.parse({ ...INITIAL, revision: 1, pending: { commandId: planned.commandId,
      writeId: planned.payload.writeId, desiredPair: planned.payload.desiredPair,
      desiredDigest: planned.payload.desiredDigest, requestFingerprint: planned.payload.requestFingerprint } });
    assert.deepEqual(desiredRelocationPair(view, { artifactRoot: "/tmp/next-artifacts" }), { stateRoot: "/tmp/next-state", artifactRoot: "/tmp/next-artifacts" });
    const cancel = cancelRelocationCommand(view, "local-operator", "2026-08-03T12:00:00.000Z");
    if (cancel.type !== "cancel-storage-relocation") throw new Error("expected cancellation");
    assert.equal(cancel.payload.cancelledPlanCommandId, planned.commandId);
    assert.equal(cancel.payload.cancelledPlanDigest, planned.payload.desiredDigest);
  });
});

for (const path of ["reload", "conflict-refresh"] as const) {
  it(`ignores an older failed ${path} after a newer day-request scope loads successfully`, async () => {
    const currentView = StorageRelocationPlanViewSchema.parse({ ...INITIAL, revision: 1 });
    const reads: Promise<StorageRelocationPlanView>[] = [];
    const commands: string[] = [];
    const settlements: Promise<CommandOutcome>[] = [];
    let readCount = 0;
    let failOldRead: (() => void) | undefined;
    const transportClient = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
      if (url.endsWith("/settings/storage-relocation")) {
        readCount++;
        if (readCount === 2) return new Promise<Response>((_resolve, reject) => {
          failOldRead = () => reject(new Error("old scope read failed"));
        });
        return Response.json(readCount === 1 ? INITIAL : currentView);
      }
      assert.equal(url, "http://fixture.test/api/v1/commands");
      if (typeof init?.body !== "string") throw new Error("relocation body missing");
      commands.push(init.body);
      const command = StorageRelocationCommandRequestSchema.parse(JSON.parse(init.body));
      return Response.json(CommandResultSchema.parse({ state: "conflict", commandId: command.commandId,
        currentVersion: currentView.revision, message: "fixture revision changed" }));
    } });
    const client: DashboardClient = { ...transportClient, storageRelocationPlans: () => {
      const promise = transportClient.storageRelocationPlans(); reads.push(promise); return promise;
    } };
    let executor: CommandExecutor | undefined;
    function Surface() {
      executor = useDashboardCommandExecutor();
      _currentController = useStorageRelocation({ actorId: "local-operator" });
      return createElement("div", null, _currentController.read.state);
    }
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const render = async (requestKey: number) => {
      await act(async () => root?.render(createElement(DashboardClientProvider, { client,
        children: createElement(FixtureCommandBinding, { actorId: "local-operator", requestKey, children: createElement(Surface) }) })));
    };
    const controller = () => { assert.ok(_currentController); return _currentController; };
    await render(0);
    assert.ok(executor);
    const execute = executor.execute.bind(executor);
    vi.spyOn(executor, "execute").mockImplementation((input, options) => {
      const promise = execute(input, options); settlements.push(promise); return promise;
    });
    await act(async () => { await reads[0]; });
    assert.equal(controller().readProblem, false); assert.equal(controller().locked, false);
    if (path === "reload") await act(async () => controller().reload());
    else {
      await act(async () => controller().update("artifactRoot", "/tmp/draft-artifacts"));
      await act(async () => { controller().submit(); await Promise.all(settlements); });
      assert.equal(controller().save.state, "conflict");
    }
    assert.equal(readCount, 2); assert.ok(failOldRead);
    await render(1);
    await act(async () => { await reads[2]; });
    const newRead = controller().read;
    assert.ok(newRead.state === "available"); assert.deepEqual(newRead.view, currentView);
    assert.equal(controller().readProblem, false); assert.equal(controller().locked, false);
    await act(async () => {
      assert.ok(failOldRead); failOldRead();
      await assert.rejects(reads[1]);
    });
    const finalRead = controller().read;
    assert.ok(finalRead.state === "available"); assert.deepEqual(finalRead.view, currentView);
    assert.equal(controller().readProblem, false, "old failure cannot poison the newer verified read");
    assert.equal(controller().locked, false, "current scope remains editable");
    await act(async () => controller().update("artifactRoot", "/tmp/current-artifacts"));
    assert.equal(controller().draft.artifactRoot, "/tmp/current-artifacts");
    assert.equal(commands.length, path === "reload" ? 0 : 1);
  });
}

it("maps transport uncertainty to relocation guidance while retaining the exact replay lock", async () => {
  let view = INITIAL;
  const reads: Promise<StorageRelocationPlanView>[] = [];
  const commands: string[] = [];
  let failFirstCommand = true;
  const transportClient = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
    if (url.endsWith("/settings/storage-relocation")) return Response.json(view);
    assert.equal(url, "http://fixture.test/api/v1/commands");
    if (typeof init?.body !== "string") throw new Error("relocation body missing");
    commands.push(init.body);
    if (failFirstCommand) { failFirstCommand = false; throw new Error("fixture response lost after dispatch"); }
    const command = StorageRelocationCommandRequestSchema.parse(JSON.parse(init.body));
    if (command.type !== "plan-storage-relocation") throw new Error("expected plan");
    view = StorageRelocationPlanViewSchema.parse({ ...view, revision: 1, pending: { commandId: command.commandId,
      writeId: command.payload.writeId, desiredPair: command.payload.desiredPair,
      desiredDigest: command.payload.desiredDigest, requestFingerprint: command.payload.requestFingerprint } });
    return Response.json(CommandResultSchema.parse({ state: "applied", commandId: command.commandId,
      affectedTargets: [{ family: "storage-relocation", revision: 1 }] }));
  } });
  const client: DashboardClient = { ...transportClient, storageRelocationPlans: () => {
    const promise = transportClient.storageRelocationPlans(); reads.push(promise); return promise;
  } };
  let executor: CommandExecutor | undefined;
  function Surface() {
    executor = useDashboardCommandExecutor();
    _currentController = useStorageRelocation({ actorId: "local-operator" });
    return createElement("div", null, _currentController.save.state);
  }
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(DashboardClientProvider, { client,
    children: createElement(FixtureCommandBinding, { actorId: "local-operator", children: createElement(Surface) }) })));
  assert.ok(executor);
  const execute = executor.execute.bind(executor);
  const replay = executor.replay.bind(executor);
  const settlements: Promise<CommandOutcome>[] = [];
  vi.spyOn(executor, "execute").mockImplementation((input, options) => {
    const settlement = execute(input, options); settlements.push(settlement); return settlement;
  });
  vi.spyOn(executor, "replay").mockImplementation((commandId, options) => {
    const settlement = replay(commandId, options); settlements.push(settlement); return settlement;
  });
  const controller = () => { assert.ok(_currentController); return _currentController; };
  await act(async () => { await reads[0]; });
  await act(async () => controller().update("artifactRoot", "/tmp/next-artifacts"));
  await act(async () => { controller().submit(); await Promise.all(settlements); });
  const uncertainSave = controller().save;
  assert.ok(uncertainSave.state === "unconfirmed");
  assert.equal(uncertainSave.code, "STORAGE_RELOCATION_OUTCOME_UNCERTAIN");
  assert.equal(uncertainSave.message, "The plan write could not be confirmed. It may already be recorded. Retry the exact attempt; your draft is retained.");
  assert.equal(controller().dirtyCount, 1); assert.equal(controller().locked, true);
  const retained = executor.retainedAttempts()[0];
  assert.ok(retained); assert.equal(retained.state, "settled"); assert.equal(retained.outcome?.kind, "uncertain");
  const commandId = retained.request.commandId;
  const originalBody = retained.body;
  assert.equal(commands[0], originalBody);
  await act(async () => { controller().update("artifactRoot", "/tmp/changed-artifacts"); });
  assert.equal(controller().draft.artifactRoot, "/tmp/next-artifacts");
  await act(async () => { controller().retry(); await Promise.all(settlements.slice(1)); });
  assert.deepEqual(commands, [originalBody, originalBody]);
  assert.equal(executor.retainedAttempts()[0]?.request.commandId, commandId);
  assert.equal(controller().save.state, "applied"); assert.equal(controller().dirtyCount, 0); assert.equal(controller().locked, false);
});
