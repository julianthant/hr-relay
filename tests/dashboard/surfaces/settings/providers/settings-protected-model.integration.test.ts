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
import { attemptUnresolved } from "../../../../../src/dashboard/app/commands/command-outcome.js";
import { FixtureCommandBinding } from "../../../../support/helpers/dashboard/command-binding.js";
import { syntheticSettingsAuthority } from "../../../../support/helpers/dashboard/settings-harness.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

/** Waits for the hook's own read-back of an unknown save to finish (at most about 2.5 s). */
async function unlocked(h: Awaited<ReturnType<typeof mountRecovery>>) {
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); assert.equal(h.controller().locked, false); }, { timeout: 5000, interval: 50 });
}

async function mountRecovery() {
  const authority = await syntheticSettingsAuthority(); cleanups.push(authority.close);
  const sent: string[] = [];
  let loseReply = true;
  let available = true;
  let key = 0;
  let beforeEffect: ((body: string) => Promise<void> | void) | undefined;
  const problems: string[] = [];
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
    await beforeEffect?.(init.body);
    const result = authority.execute(request.data);
    if (loseReply) throw new Error("reply lost after effect");
    return Response.json(result);
  } });
  function Harness() {
    binding = originalBindingHook();
    controller = useProtectedSettings({ actorId: "local-operator", readReady: true, editable: true, document: documentWire,
      refresh: async () => authority.read(), readCurrent: async () => authority.read(),
      acceptReadback: value => { documentWire = value; }, onSaveProblem: problem => { problems.push(problem.title); } });
    return createElement("div", null, controller.save.state);
  }
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  cleanups.push(() => { act(() => root.unmount()); host.remove(); });
  const render = async () => { await act(async () => root.render(createElement(commandContext.DashboardClientProvider, { client,
    children: createElement(FixtureCommandBinding, { actorId: "local-operator", children: createElement(Harness, { key }) }) }))); };
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
  return { authority, sent, render, host, action, problems,
    /** A new editor instance, as when Settings is closed and opened again. */
    remount: async () => { key += 1; await render(); },
    /** Runs before the fixture store applies a POST; throwing drops the request before any effect. */
    beforeEffect(next: typeof beforeEffect) { beforeEffect = next; },
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
    commandId: "11111111-1111-4111-8111-111111111111", requestedAt: h.binding().authority.now(),
    requestedBy: "local-operator", source: "settings-surface", target: { expectedRevision: document.protectedSettings.readback.revision },
    payload: { protectedSchemaHash: document.protectedSettings.protectedSchemaHash, writeId: "22222222-2222-4222-8222-222222222222", entries } });
  const binding = h.binding();
  await act(async () => { await binding.executor.execute(request, { scope: binding.scope, readback: async (original, reply) => {
    const full = ProtectedSettingsCommandRequestSchema.parse(original);
    const result = checkedSettingsResult(full, reply); const readback = h.authority.read();
    return { state: protectedReadbackConfirms(full, result, readback) ? "matched" : "mismatch", evidence: readback };
  } }); });
  await h.render();
  assert.equal(h.controller().locked, true, "the adopted unknown attempt holds the control while it is read back");
  const before = h.sent.length;
  await unlocked(h);
  assert.equal(h.sent.length, before, "a marked-only recovery is read back, never posted again");
  assert.equal(h.controller().save.state, "idle");
  assert.equal(binding.executor.retainedAttempts().some(attemptUnresolved), false, "the read-back settled the attempt");
  await h.render();
  assert.equal(h.controller().locked, false, "a later render does not adopt the settled attempt again");
  await act(async () => h.controller().update("sharepointOnboardingRosterUrl", "https://example.test/after-recovery"));
  await h.action(() => h.controller().submit());
  assert.equal(h.sent.length, before + 1, "the next save reaches Relay");
});

it("writes a literal marker UCPath password once and reports the lost reply as unconfirmed", async () => {
  const h = await mountRecovery();
  const before = h.authority.credentials.read();
  await act(async () => h.controller().update("ucpathPassword", "<set>"));
  await h.action(() => h.controller().submit());
  await unlocked(h);
  assert.equal(h.controller().save.state, "idle");
  assert.equal(h.sent.length, 1, "the lost reply is read back without resending the password");
  assert.equal(h.authority.credentials.read().revision, before.revision + 1);
  assert.equal(h.authority.credentials.read().entries.ucpathPassword?.value, "<set>");
  assert.deepEqual(h.problems, ["Credentials weren't saved"], "the marker cannot confirm the original value");
});

it("reads a stored write with a lost reply back once, across losing and regaining authority, and never resends it", async () => {
  const h = await mountRecovery();
  const before = h.authority.credentials.read().revision;
  await act(async () => h.controller().update("sharepointOnboardingRosterUrl", "https://example.test/retained-operator"));
  await h.action(() => h.controller().submit());
  h.setAvailable(false); await h.render();
  h.setAvailable(true); await h.render();
  await unlocked(h);
  assert.equal(h.sent.length, 1, "the lost reply is read back, never resent");
  assert.equal(h.authority.credentials.read().revision, before + 1);
  assert.equal(h.controller().save.state, "idle"); assert.equal(h.controller().dirtyCount, 0);
  assert.equal(h.binding().executor.retainedAttempts().some(attemptUnresolved), false);
  h.restoreReply();
  await act(async () => h.controller().update("sharepointOnboardingRosterUrl", "https://example.test/next-operator"));
  await h.action(() => h.controller().submit());
  assert.equal(h.sent.length, 2); assert.equal(h.controller().save.state, "applied");
});

it("writes a dialog-held credential only on explicit submit, never on the autosave timer or after reset", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); cleanups.push(() => { vi.useRealTimers(); });
  const h = await mountRecovery();
  await act(async () => { h.controller().setExplicitSave(true); });
  await act(async () => h.controller().update("sharepointOnboardingRosterUrl", "https://example.test/held-operator"));
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  assert.equal(h.sent.length, 0, "no dispatch past the autosave timer while the dialog holds the draft");
  await act(async () => h.controller().reset("sharepointOnboardingRosterUrl"));
  await act(async () => { h.controller().setExplicitSave(false); await vi.advanceTimersByTimeAsync(5000); });
  assert.equal(h.sent.length, 0, "no dispatch after Cancel");
  await act(async () => { h.controller().setExplicitSave(true); });
  await act(async () => h.controller().update("sharepointOnboardingRosterUrl", "https://example.test/confirmed-operator"));
  await h.action(() => h.controller().submit());
  assert.equal(h.sent.length, 1, "one dispatch for the confirmed Save");
});

it("ends with one failure when the save never arrived and another save set a different value", async () => {
  const h = await mountRecovery();
  const before = h.authority.credentials.read().revision;
  h.beforeEffect(body => {
    h.beforeEffect(undefined);
    const lost = ProtectedSettingsCommandRequestSchema.parse(JSON.parse(body));
    h.authority.execute(ProtectedSettingsCommandRequestSchema.parse({ ...lost, commandId: crypto.randomUUID(),
      payload: { ...lost.payload, writeId: crypto.randomUUID(), entries: { sharepointOnboardingRosterUrl: { set: "https://example.test/someone-else" } } } }));
    throw new Error("request dropped before Relay");
  });
  await act(async () => h.controller().update("sharepointOnboardingRosterUrl", "https://example.test/mine"));
  await h.action(() => h.controller().submit());
  await unlocked(h);
  assert.equal(h.authority.credentials.read().revision, before + 1, "only the other save landed");
  assert.equal(h.authority.credentials.read().entries.sharepointOnboardingRosterUrl?.value, "https://example.test/someone-else");
  assert.deepEqual(h.problems, ["Credentials weren't saved"], "a newer revision with another value is no proof of this save");
  assert.equal(h.sent.length, 1, "read back, never resent");
});

it("follows a save still in flight across a remount and unlocks the new editor when it confirms", async () => {
  const h = await mountRecovery();
  h.restoreReply();
  let release!: () => void;
  h.beforeEffect(() => new Promise<void>(resolve => { release = resolve; }));
  await act(async () => h.controller().update("sharepointOnboardingRosterUrl", "https://example.test/in-flight"));
  await act(async () => { h.controller().submit(); await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.equal(h.sent.length, 1);
  await h.remount();
  assert.equal(h.controller().locked, true, "the new editor holds the control while the save is outstanding");
  h.beforeEffect(undefined);
  await act(async () => { release(); });
  await unlocked(h);
  assert.deepEqual(h.problems, [], "a confirmed save ends silently");
  assert.equal(h.authority.credentials.read().entries.sharepointOnboardingRosterUrl?.value, "https://example.test/in-flight");
  await act(async () => h.controller().update("sharepointOnboardingRosterUrl", "https://example.test/after-remount"));
  await h.action(() => h.controller().submit());
  assert.equal(h.sent.length, 2, "the next save reaches Relay");
});
