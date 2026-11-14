import assert from "node:assert/strict";
import { it } from "vitest";
import { createPersonPreferences, sendShortcutLabel, sendsMessage } from "../../../src/dashboard/state/person-preferences-model.js";
import { NEUTRAL_PERSON_PREFERENCES } from "../../../src/models/config/person-preferences.js";
import { SettingsCommandRequestSchema, CommandResultSchema } from "../../../src/rules/commands/commands.js";
import { mergeSettingsPatch } from "../../../src/models/config/settings.js";
import type { SettingsOverride } from "../../../src/models/config/schema.js";
import { CommandExecutor, type CommandExecutionScope } from "../../../src/dashboard/app/commands/command-executor.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { FIXTURE_BOOTSTRAP } from "../../support/fixtures/dashboard/fixture-bootstrap.js";
import { fixtureSettingsDocument } from "../../support/fixtures/dashboard/fixture-settings.js";

function world() {
  const people = new Map<string, { settings: SettingsOverride; revision: number }>();
  let person = "A";
  let currentScope: CommandExecutionScope | undefined;
  let readOverride: (() => Promise<ReturnType<typeof fixtureSettingsDocument>>) | undefined;
  let writeOverride: (() => Promise<void>) | undefined;
  let writes = 0;
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
    const saved = people.get(person) ?? { settings: {}, revision: 1 };
    if (url.endsWith("/settings/editable")) return Response.json(await (readOverride?.() ?? Promise.resolve(fixtureSettingsDocument(saved.settings, saved.revision))));
    if (url.endsWith("/commands")) {
      writes++;
      assert.ok(typeof init?.body === "string");
      const command = SettingsCommandRequestSchema.parse(JSON.parse(init.body));
      assert.equal(command.source, "person-preferences");
      const target = person;
      await writeOverride?.();
      const settings = mergeSettingsPatch(saved.settings, command.payload.patch);
      const document = fixtureSettingsDocument(settings, saved.revision + 1);
      people.set(target, { settings, revision: document.revision });
      return Response.json(CommandResultSchema.parse({ state: "applied", commandId: command.commandId,
        affectedTargets: [{ family: "settings", revision: document.revision }], settingsRevision: document.revision,
        settingsFingerprint: document.settingsFingerprint, restartRequired: false }));
    }
    throw new Error("unexpected-preference-request");
  } });
  const executor = new CommandExecutor(() => currentScope);
  function select(id: string) {
    person = id;
    const owner = createPersonPreferences("person");
    const epoch = { client, bootstrap: { ...FIXTURE_BOOTSTRAP } };
    const scope = { client, actorId: "local-operator", authority: epoch, dayRequest: {} };
    currentScope = scope;
    const binding = { scope, executor, authority: { epoch, nowIso: FIXTURE_BOOTSTRAP.serverClock.now } };
    const close = owner.connect(client, binding, () => binding);
    return { owner, close };
  }
  return { select, people, writes: () => writes, read: (value: typeof readOverride) => { readOverride = value; }, write: (value: typeof writeOverride) => { writeOverride = value; } };
}
function ready(owner: ReturnType<typeof createPersonPreferences>): Promise<void> {
  if (owner.snapshot().state === "ready") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const close = owner.subscribe(() => { const state = owner.snapshot().state; if (state === "ready" || state === "failed") { close(); if (state === "failed") reject(new Error(owner.snapshot().problem)); else resolve(); } });
  });
}
it("isolates A/B, restores saved settings after renderer restart and keeps signed-out state neutral", async () => {
  const w = world();
  const a = w.select("A"); await ready(a.owner);
  assert.equal(await a.owner.change({ "preferences.theme": { set: "light" }, "preferences.animations": { set: false }, "preferences.workflowPanelMode": { set: "sidebar" } }), true);
  assert.equal(a.owner.snapshot().value.theme, "light"); a.close(); a.owner.clear();
  const b = w.select("B"); await ready(b.owner);
  assert.deepEqual(b.owner.snapshot().value, NEUTRAL_PERSON_PREFERENCES);
  assert.equal(await b.owner.change({ "preferences.selectedWorkflowId": { set: "separations" } }), true); b.close();
  const restarted = w.select("A"); await ready(restarted.owner);
  assert.equal(restarted.owner.snapshot().value.theme, "light"); assert.equal(restarted.owner.snapshot().value.animations, false);
  assert.equal(restarted.owner.snapshot().value.workflowPanelMode, "sidebar"); assert.equal(restarted.owner.snapshot().value.selectedWorkflowId, ""); restarted.close();
  const signedOut = createPersonPreferences("signed-out");
  assert.deepEqual(signedOut.snapshot().value, NEUTRAL_PERSON_PREFERENCES);
  assert.equal(await signedOut.change({ "preferences.theme": { set: "light" } }), false);
  assert.equal(w.writes(), 2);
});
it("ignores late A reads after A to B to A, with no reused renderer cache", async () => {
  const w = world(); const pending = Promise.withResolvers<ReturnType<typeof fixtureSettingsDocument>>();
  w.read(() => pending.promise); const a = w.select("A"); a.close(); a.owner.clear();
  w.read(undefined); const b = w.select("B"); await ready(b.owner); b.close();
  const nextA = w.select("A"); await ready(nextA.owner);
  pending.resolve(fixtureSettingsDocument({ preferences: { theme: "light" } }, 2)); await pending.promise; await Promise.resolve();
  assert.deepEqual(a.owner.snapshot().value, NEUTRAL_PERSON_PREFERENCES);
  assert.deepEqual(nextA.owner.snapshot().value, NEUTRAL_PERSON_PREFERENCES); nextA.close();
});
it("cannot publish an in-flight A save into B and never retries an unknown outcome", async () => {
  const w = world(); const a = w.select("A"); await ready(a.owner);
  const sent = Promise.withResolvers<void>(); const pending = Promise.withResolvers<void>();
  w.write(() => { sent.resolve(); return pending.promise; });
  const saving = a.owner.change({ "preferences.theme": { set: "light" } }); await sent.promise;
  a.close(); a.owner.clear(); w.write(undefined);
  const b = w.select("B"); await ready(b.owner); pending.resolve(); assert.equal(await saving, false);
  assert.deepEqual(b.owner.snapshot().value, NEUTRAL_PERSON_PREFERENCES); assert.equal(w.writes(), 1); b.close();
  const unknown = world();
  const again = unknown.select("A"); await ready(again.owner);
  unknown.write(() => Promise.reject(new Error("connection lost after dispatch")));
  assert.equal(await again.owner.change({ "preferences.animations": { set: false } }), false);
  assert.equal(again.owner.snapshot().state, "uncertain");
  assert.equal(await again.owner.change({ "preferences.animations": { set: false } }), false);
  assert.equal(w.writes(), 1); assert.equal(unknown.writes(), 1); again.close();
});
it("refuses malformed persisted preferences instead of publishing them as defaults", async () => {
  const w = world(); const malformed = fixtureSettingsDocument();
  const leaf = malformed.sections.flatMap(section => section.leaves).find(value => value.path === "preferences.theme"); assert.ok(leaf);
  leaf.effectiveValue = "invalid-theme";
  w.read(() => Promise.resolve(malformed)); const a = w.select("A");
  await assert.rejects(ready(a.owner)); assert.equal(a.owner.snapshot().state, "failed");
  assert.equal(await a.owner.change({ "preferences.theme": { set: "light" } }), false); assert.equal(w.writes(), 0); a.close();
});
it("stores the send shortcut per person and reads it back after a renderer restart", async () => {
  const w = world();
  const a = w.select("A"); await ready(a.owner);
  assert.equal(a.owner.snapshot().value.sendShortcut, "enter");
  assert.equal(await a.owner.change({ "preferences.sendShortcut": { set: "mod-enter" } }), true); a.close(); a.owner.clear();
  const b = w.select("B"); await ready(b.owner);
  assert.equal(b.owner.snapshot().value.sendShortcut, "enter"); b.close();
  const restarted = w.select("A"); await ready(restarted.owner);
  assert.equal(restarted.owner.snapshot().value.sendShortcut, "mod-enter"); restarted.close();
});
it("sends only on the chosen key: the other key is a new line and IME composition never sends", () => {
  const key = (init: Partial<Parameters<typeof sendsMessage>[1]> = {}) => ({ key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false, isComposing: false, ...init });
  assert.equal(sendsMessage("enter", key(), true), true);
  assert.equal(sendsMessage("enter", key({ shiftKey: true }), true), false);
  assert.equal(sendsMessage("enter", key({ isComposing: true }), true), false);
  assert.equal(sendsMessage("enter", key({ key: "a" }), true), false);
  assert.equal(sendsMessage("enter", key({ metaKey: true }), true), false);
  assert.equal(sendsMessage("enter", key({ ctrlKey: true }), false), false);
  assert.equal(sendsMessage("mod-enter", key(), true), false);
  assert.equal(sendsMessage("mod-enter", key({ metaKey: true }), true), true);
  assert.equal(sendsMessage("mod-enter", key({ ctrlKey: true }), true), false);
  assert.equal(sendsMessage("mod-enter", key({ ctrlKey: true }), false), true);
  assert.equal(sendsMessage("mod-enter", key({ metaKey: true }), false), false);
  assert.equal(sendsMessage("mod-enter", key({ metaKey: true, isComposing: true }), true), false);
  assert.deepEqual([sendShortcutLabel("enter", true), sendShortcutLabel("mod-enter", true), sendShortcutLabel("mod-enter", false)], ["Enter", "⌘Enter", "Ctrl+Enter"]);
});
