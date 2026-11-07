import { fixtureSettingsDocument } from "../../support/fixtures/dashboard/fixture-settings.js";
import { ordinaryReadbackState } from "../../../src/dashboard/surfaces/settings/editor/settings-attempt-model.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, useMemo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { DashboardClientProvider, DashboardCommandBindingProvider, useDashboardCommandBinding, useDashboardCommandExecutor } from "../../../src/dashboard/state/client-context.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import type { DashboardCommandBinding } from "../../../src/dashboard/app/dashboard-app-model.js";
import { FIXTURE_BOOTSTRAP } from "../../support/fixtures/dashboard/fixture-bootstrap.js";
import { FIXTURE_DAY_WIRE } from "../../support/fixtures/dashboard/fixture-queue.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
it("retains an unknown envelope across loaded-tree unmount and client replacement, then explicitly replays it", async () => {
  const sent: string[] = [];
  const feedback: unknown[] = [];
  const stored = fixtureSettingsDocument({ actor: { label: "fixture" } }, 2);
  const client = (uncertain: boolean) => createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
    if (url.endsWith("/settings/editable")) return Response.json(stored);
    assert.equal(typeof init?.body, "string");
    if (typeof init?.body !== "string") assert.fail("missing body");
    sent.push(init.body); const request = CommandRequestSchema.parse(JSON.parse(init.body));
    return Response.json(uncertain ? { state: "rejected", commandId: request.commandId, code: "authority-uncertain", message: "private" }
      : { state: "applied", commandId: request.commandId, affectedTargets: [{ family: "settings", revision: 2 }], settingsRevision: 2, settingsFingerprint: stored.settingsFingerprint, restartRequired: false });
  } });
  const first = client(true), second = client(false);
  const root = createRoot(document.createElement("div"));
  let binding: DashboardCommandBinding | undefined;
  function Probe() { binding = useDashboardCommandBinding(); return null; }
  function Loaded({ current, children }: { current: typeof first; children: ReactNode }) {
    const executor = useDashboardCommandExecutor();
    const value = useMemo<DashboardCommandBinding>(() => {
      const epoch = { client: current, bootstrap: FIXTURE_BOOTSTRAP }, dayRequest = {};
      const authority = { epoch, catalog: [], nowIso: FIXTURE_BOOTSTRAP.serverClock.now, today: FIXTURE_DAY_WIRE.day, day: FIXTURE_DAY_WIRE.day,
        dayState: { subscribePublications: () => { throw new Error("fixture publications are not served"); }, request: dayRequest, day: { state: "loaded" as const, value: FIXTURE_DAY_WIRE }, connection: { state: "connecting" as const }, refresh: () => undefined }, selection: { route: { start: false }, workflowId: "" } };
      return { authority, executor, scope: { actorId: "local-operator", client: current, authority: epoch, dayRequest }, feedback: outcome => feedback.push(outcome) };
    }, [current, executor]);
    return createElement(DashboardCommandBindingProvider, { binding: value, children });
  }
  const render = async (current: typeof first, loaded: boolean) => { await act(async () => root.render(createElement(DashboardClientProvider, { client: current,
    children: loaded ? createElement(Loaded, { current, children: createElement(Probe) }) : null }))); };
  try {
    await render(first, true); assert.ok(binding); const original = binding;
    const request = CommandRequestSchema.parse({ family: "settings", type: "apply-settings", commandId: "11111111-1111-4111-8111-111111111111",
      requestedAt: FIXTURE_BOOTSTRAP.serverClock.now, requestedBy: "local-operator", source: "settings-surface", target: { expectedRevision: 1 },
      payload: { settingsSchemaHash: "d".repeat(64), patchFingerprint: "d".repeat(64), patch: { "actor.label": { set: "fixture" } } } });
    const options = { scope: original.scope, publish: original.feedback, readback: async (command: import("../../../src/rules/commands/commands.js").CommandRequest, reply: import("../../../src/rules/commands/commands.js").CommandResult | import("../../../src/rules/commands/commands.js").BulkRunCommandOutcome, scope: import("../../../src/dashboard/app/commands/command-executor.js").CommandExecutionScope) => {
      const currentClient = scope.client === first ? first : second;
      const document = await currentClient.editableSettings();
      return { state: command.family === "settings" && command.type === "apply-settings" && !("outcome" in reply) && ordinaryReadbackState(command, reply, document) === "confirmed" ? "matched" as const : "mismatch" as const, evidence: document };
    } };
    assert.equal((await original.executor.execute(request, options)).kind, "uncertain");
    assert.equal(feedback.length, 1);
    await render(first, false);
    assert.equal((await original.executor.replay(request.commandId, options)).kind, "refused");
    assert.equal(feedback.length, 1, "unmounted scope cannot publish");
    await render(second, true); assert.ok(binding); assert.equal(binding.executor, original.executor);
    assert.equal((await binding.executor.execute({ ...request, commandId: "22222222-2222-4222-8222-222222222222" }, { ...options, scope: binding.scope, publish: binding.feedback })).kind, "refused");
    const replay = await binding.executor.replay(request.commandId, { ...options, scope: binding.scope, publish: binding.feedback });
    assert.equal(replay.kind, "confirmed"); assert.deepEqual(sent, [JSON.stringify(request), JSON.stringify(request)]);
  } finally { await act(async () => root.unmount()); }
});
