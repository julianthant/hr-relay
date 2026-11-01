// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import * as commandContext from "../../../../../src/dashboard/state/client-context.js";
import type { CommandOutcome } from "../../../../../src/dashboard/app/commands/command-executor.js";
import type { DashboardCommandBinding } from "../../../../../src/dashboard/app/dashboard-app-model.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { useProtectedSettings } from "../../../../../src/dashboard/surfaces/settings/providers/settings-protected-model.js";
import { checkedSettingsResult, protectedReadbackConfirms } from "../../../../../src/dashboard/surfaces/settings/editor/settings-attempt-model.js";
import { MarkedProtectedSettingsCommandRequestSchema, ProtectedSettingsCommandRequestSchema } from "../../../../../src/rules/commands/commands.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../../../src/models/failures/error-catalog.js";
import { FixtureCommandBinding } from "../../../../support/helpers/dashboard/command-binding.js";
import { syntheticSettingsAuthority } from "../../../../support/helpers/dashboard/settings-harness.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

async function mountRecovery() {
  const authority = await syntheticSettingsAuthority(); cleanups.push(authority.close);
  const sent: string[] = [];
  let loseReply = true;
  let available = true;
  let documentWire = authority.read();
  let binding: DashboardCommandBinding | undefined;
  let controller: ReturnType<typeof useProtectedSettings> | undefined;
  const originalBindingHook = commandContext.useDashboardCommandBinding;
  vi.spyOn(commandContext, "useDashboardCommandBinding").mockImplementation(() => {
    const current = originalBindingHook();
    return available ? current : undefined;
  });
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (_url, init) => {
    assert.equal(typeof init?.body, "string");
    if (typeof init?.body !== "string") throw new Error("command body missing");
    sent.push(init.body);
    const request = ProtectedSettingsCommandRequestSchema.safeParse(JSON.parse(init.body));
    if (!request.success) throw new Error("marked transport fixture lost reply");
    const result = authority.execute(request.data);
    if (loseReply) throw new Error("reply lost after effect");
    return Response.json(result);
  } });
  function Harness() {
    binding = originalBindingHook();
    controller = useProtectedSettings({ actorId: "local-operator", readReady: true, document: documentWire,
      refresh: async () => authority.read(), readCurrent: async () => authority.read(),
      acceptReadback: value => { documentWire = value; } });
    return createElement("div", null, controller.save.state);
  }
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  cleanups.push(() => { act(() => root.unmount()); host.remove(); });
  const render = async () => { await act(async () => root.render(createElement(commandContext.DashboardClientProvider, { client,
    children: createElement(FixtureCommandBinding, { actorId: "local-operator", children: createElement(Harness) }) }))); };
  await render();
  assert.ok(binding);
  const executor = binding.executor;
  const execute = executor.execute.bind(executor);
  const replay = executor.replay.bind(executor);
  const settlements: Promise<CommandOutcome>[] = [];
  vi.spyOn(executor, "execute").mockImplementation((input, options) => {
    const settlement = execute(input, options); settlements.push(settlement); return settlement;
  });
  vi.spyOn(executor, "replay").mockImplementation((commandId, options) => {
    const settlement = replay(commandId, options); settlements.push(settlement); return settlement;
  });
  const action = async (invoke: () => void): Promise<void> => {
    await act(async () => {
      const before = settlements.length;
      invoke();
      await Promise.all(settlements.slice(before));
    });
  };
  return { authority, sent, render, host, action,
    controller: () => { assert.ok(controller); return controller; },
    binding: () => { assert.ok(binding); return binding; },
    setAvailable(value: boolean) { available = value; },
    restoreReply() { loseReply = false; },
  };
}

it("retains marked-only pseudonym recovery without a render throw or a metadata replay", async () => {
  const entries = { activityPersonPseudonym: { set: "<set>" } };
  const h = await mountRecovery();
  const document = h.authority.read(); assert.equal(document.protectedSettings.state, "available");
  if (document.protectedSettings.state !== "available") assert.fail("protected authority unavailable");
  const request = MarkedProtectedSettingsCommandRequestSchema.parse({ family: "settings", type: "apply-protected-settings",
    commandId: "11111111-1111-4111-8111-111111111111", requestedAt: h.binding().authority.nowIso,
    requestedBy: "local-operator", source: "settings-surface", target: { expectedRevision: document.protectedSettings.readback.revision },
    payload: { protectedSchemaHash: document.protectedSettings.protectedSchemaHash, writeId: "22222222-2222-4222-8222-222222222222", entries } });
  const binding = h.binding();
  await act(async () => { await binding.executor.execute(request, { scope: binding.scope, readback: async (original, reply) => {
    const full = ProtectedSettingsCommandRequestSchema.parse(original);
    const result = checkedSettingsResult(full, reply); const readback = h.authority.read();
    return { state: protectedReadbackConfirms(full, result, readback) ? "matched" : "mismatch", evidence: readback };
  } }); });
  await h.render();
  assert.equal(h.controller().save.state, "unconfirmed"); assert.equal(h.controller().locked, true);
  const originalBody = binding.executor.retainedAttempts()[0].body;
  const before = h.sent.length;
  await h.action(() => h.controller().retry());
  await h.action(() => h.controller().retry());
  assert.equal(h.sent.length, before, "explicit metadata recovery never posts another envelope");
  const state = h.controller().save;
  assert.equal(state.state, "unconfirmed");
  assert.ok(state.state === "unconfirmed");
  assert.equal(state.message, formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_OUTCOME_UNCERTAIN", {})).text);
  assert.equal(binding.executor.retainedAttempts()[0].request.commandId, request.commandId);
  assert.equal(binding.executor.retainedAttempts()[0].body, originalBody);
  assert.equal(h.controller().locked, true);
});

it("preserves a schema-admitted literal marker credential through exact-byte recovery", async () => {
  const h = await mountRecovery();
  await act(async () => h.controller().update("ucpathPassword", "<set>"));
  await h.action(() => h.controller().submit());
  assert.equal(h.controller().save.state, "unconfirmed");
  const originalBody = h.sent[0];
  const originalId = h.binding().executor.retainedAttempts()[0].request.commandId;
  h.restoreReply();
  await h.action(() => h.controller().retry());
  assert.equal(h.sent.length, 2); assert.equal(h.sent[1], originalBody);
  assert.equal(h.binding().executor.retainedAttempts()[0].request.commandId, originalId);
  assert.equal(h.controller().save.state, "applied");
  assert.equal(h.authority.credentials.read().entries.ucpathPassword?.value, "<set>");
});

it("keeps the unknown original ID and draft while authority is absent, then replays exact bytes", async () => {
  const h = await mountRecovery();
  await act(async () => h.controller().update("timekeeperName", "Retained operator"));
  await h.action(() => h.controller().submit());
  assert.equal(h.controller().save.state, "unconfirmed");
  const draft = structuredClone(h.controller().draft);
  const firstBody = h.sent[0];
  const commandId = h.binding().executor.retainedAttempts()[0].request.commandId;
  h.setAvailable(false); await h.render();
  await h.action(() => h.controller().retry());
  await act(async () => h.controller().update("timekeeperName", "Divergent operator"));
  await h.action(() => h.controller().submit());
  assert.equal(h.sent.length, 1); assert.equal(h.controller().save.state, "unconfirmed");
  assert.equal(h.controller().locked, true); assert.deepEqual(h.controller().draft, draft);
  h.restoreReply(); h.setAvailable(true); await h.render();
  assert.equal(h.binding().executor.retainedAttempts()[0].request.commandId, commandId);
  await h.action(() => h.controller().retry());
  assert.equal(h.sent.length, 2); assert.equal(h.sent[1], firstBody);
  assert.equal(h.controller().save.state, "applied"); assert.equal(h.controller().dirtyCount, 0);
});
