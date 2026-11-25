import assert from "node:assert/strict";
import { it, vi } from "vitest";
import { createPersonPreferences } from "../../../src/dashboard/state/person-preferences-model.js";
import { NEUTRAL_PERSON_PREFERENCES } from "../../../src/models/config/person-preferences.js";
import { SettingsCommandRequestSchema, CommandResultSchema } from "../../../src/rules/commands/commands.js";
import { mergeSettingsPatch } from "../../../src/models/config/settings.js";
import type { SettingsOverride } from "../../../src/models/config/schema.js";
import { CommandExecutor, type CommandExecutionScope } from "../../../src/dashboard/app/commands/command-executor.js";
import { createDashboardClient, createRowStore, type RowStoreWriter } from "../../../src/dashboard/client/index.js";
import type { SubscriptionState } from "../../../src/dashboard/client/subscriptions/subscription.js";
import { LOADING } from "../../../src/dashboard/state/async-resource.js";
import { settingsReadResource } from "../../../src/dashboard/state/settings-read-model.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { PositiveIntSchema } from "../../../src/rules/identity/ids.js";
import type { EditableSettingsWire } from "../../../src/models/dashboard/settings-editor.js";
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
  /** With `streamed`, the binding carries the day stream's rows and the save's readback joins them. */
  function select(id: string, streamed = false) {
    person = id;
    const owner = createPersonPreferences("person");
    const epoch = { client, bootstrap: { ...FIXTURE_BOOTSTRAP } };
    const scope = { client, actorId: "local-operator", authority: epoch, dayRequest: {} };
    currentScope = scope;
    const stream: { rows: RowStoreWriter; connection: SubscriptionState } = { rows: createRowStore(), connection: { state: "live" } };
    const binding = () => ({ scope, executor, authority: { epoch, now: () => FIXTURE_BOOTSTRAP.serverClock.now,
      ...(streamed ? { dayState: { request: scope.dayRequest, day: LOADING, ...stream, subscribePublications: () => () => undefined, refresh: () => undefined } } : {}) } });
    const close = owner.connect(client, binding(), binding);
    const editor = settingsReadResource<EditableSettingsWire>(client, epoch, canonicalJsonStringify([scope.actorId, epoch.bootstrap.descriptorHash]), "editor");
    return { owner, close, stream, editor, unresolved: () => executor.retainedAttempts().some(attempt => attempt.state === "pending" || attempt.outcome?.kind === "uncertain") };
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
  assert.equal(await a.owner.change({ "preferences.theme": { set: "light" }, "preferences.animations": { set: false } }), true);
  assert.equal(a.owner.snapshot().value.theme, "light"); a.close(); a.owner.clear();
  const b = w.select("B"); await ready(b.owner);
  assert.deepEqual(b.owner.snapshot().value, NEUTRAL_PERSON_PREFERENCES);
  assert.equal(await b.owner.change({ "preferences.selectedWorkflowId": { set: "separations" } }), true); b.close();
  const restarted = w.select("A"); await ready(restarted.owner);
  assert.equal(restarted.owner.snapshot().value.theme, "light"); assert.equal(restarted.owner.snapshot().value.animations, false);
  assert.equal(restarted.owner.snapshot().value.selectedWorkflowId, ""); restarted.close();
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
it("cannot publish an in-flight A save into B and settles an unknown outcome by reading it back", async () => {
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
  assert.equal(again.owner.snapshot().state, "ready", "the served value settles it; the control is enabled again");
  assert.equal(again.owner.snapshot().value.animations, NEUTRAL_PERSON_PREFERENCES.animations, "the previous value is back");
  assert.equal(again.owner.snapshot().problem, "Settings weren't saved. The previous value is back.");
  assert.equal(w.writes(), 1); assert.equal(unknown.writes(), 1, "a lost reply is read back, never resent");
  unknown.write(undefined); await again.owner.change({ "preferences.animations": { set: false } });
  assert.equal(unknown.writes(), 2, "the read-back freed the lock: the next change reaches Relay"); again.close();
  const landed = world();
  const stored = landed.select("A"); await ready(stored.owner);
  landed.write(() => Promise.reject(new Error("connection lost after dispatch")));
  landed.read(() => Promise.resolve(fixtureSettingsDocument({ preferences: { animations: false } }, 2)));
  assert.equal(await stored.owner.change({ "preferences.animations": { set: false } }), "recovered", "a save found by reading back asks callers to show nothing");
  assert.equal(stored.owner.snapshot().state, "ready");
  assert.equal(stored.owner.snapshot().value.animations, false, "the read-back shows the new value");
  assert.equal(stored.owner.snapshot().problem, undefined, "with no message"); stored.close();
});
it("refuses malformed persisted preferences instead of publishing them as defaults", async () => {
  const w = world(); const malformed = fixtureSettingsDocument();
  const leaf = malformed.sections.flatMap(section => section.leaves).find(value => value.path === "preferences.theme"); assert.ok(leaf);
  leaf.effectiveValue = "invalid-theme";
  w.read(() => Promise.resolve(malformed)); const a = w.select("A");
  await assert.rejects(ready(a.owner)); assert.equal(a.owner.snapshot().state, "failed");
  assert.equal(await a.owner.change({ "preferences.theme": { set: "light" } }), false); assert.equal(w.writes(), 0); a.close();
});
it("stores the send shortcut per person and serves it back after a renderer restart", async () => {
  const w = world();
  const a = w.select("A"); await ready(a.owner);
  assert.equal(a.owner.snapshot().value.sendShortcut, "enter");
  assert.equal(await a.owner.change({ "preferences.sendShortcut": { set: "mod-enter" } }), true); a.close(); a.owner.clear();
  const b = w.select("B"); await ready(b.owner);
  assert.equal(b.owner.snapshot().value.sendShortcut, "enter"); b.close();
  const restarted = w.select("A"); await ready(restarted.owner);
  assert.equal(restarted.owner.snapshot().value.sendShortcut, "mod-enter"); restarted.close();
});

it("ends a save unresolved at once when the stream stops while it waits for its row", async () => {
  const w = world(); const a = w.select("A", true); await ready(a.owner);
  const saving = a.owner.change({ "preferences.animations": { set: false } });
  await vi.waitFor(() => assert.equal(w.people.get("A")?.revision, 2));
  assert.equal(a.owner.snapshot().state, "saving", "the reply landed and its row has not");
  a.stream.connection = { state: "stopped" };
  a.owner.streamChanged();
  assert.equal(await saving, false);
  assert.equal(a.owner.snapshot().state, "ready");
  assert.equal(a.owner.snapshot().value.animations, NEUTRAL_PERSON_PREFERENCES.animations);
  assert.equal(a.owner.snapshot().problem, "Settings weren't saved. The previous value is back.");
  assert.equal(a.unresolved(), false, "the next change is not locked out"); a.close();
});
it("frees the lock of a save whose stream was replaced, even after its connection closed", async () => {
  const w = world(); const a = w.select("A", true); await ready(a.owner);
  const saving = a.owner.change({ "preferences.animations": { set: false } });
  await vi.waitFor(() => assert.equal(w.people.get("A")?.revision, 2));
  a.stream.rows = createRowStore();
  a.close();
  a.owner.streamChanged();
  assert.equal(await saving, false);
  assert.equal(a.unresolved(), false);
});
it("ends a save's row wait and frees its lock at once when its connection closes, with no stream change", async () => {
  const w = world(); const a = w.select("A", true); await ready(a.owner);
  const saving = a.owner.change({ "preferences.animations": { set: false } });
  await vi.waitFor(() => assert.equal(w.people.get("A")?.revision, 2));
  assert.equal(a.unresolved(), true, "the save waits for its row");
  a.close();
  await vi.waitFor(() => assert.equal(a.unresolved(), false));
  assert.equal(await saving, false); assert.equal(a.owner.snapshot().state, "loading");
  const late = world(); const b = late.select("B", true); await ready(b.owner);
  const sent = Promise.withResolvers<void>(); const reply = Promise.withResolvers<void>();
  late.write(() => { sent.resolve(); return reply.promise; });
  const second = b.owner.change({ "preferences.animations": { set: false } }); await sent.promise;
  b.close(); reply.resolve();
  await vi.waitFor(() => assert.equal(b.unresolved(), false));
  assert.equal(await second, false);
});
it("keeps a newer protected snapshot when a delayed settings row carries an older one", async () => {
  const w = world(); const a = w.select("A", true); await ready(a.owner);
  const saving = a.owner.change({ "preferences.animations": { set: false } });
  await vi.waitFor(() => assert.equal(w.people.get("A")?.revision, 2));
  const shown = a.editor.snapshot().value; assert.ok(shown?.protectedSettings.state === "available");
  const readback = shown.protectedSettings.readback;
  const newer = { ...shown.protectedSettings, readback: { ...readback, revision: PositiveIntSchema.parse(readback.revision + 1) } };
  a.editor.accept({ ...shown, protectedSettings: newer });
  const row = fixtureSettingsDocument({ preferences: { animations: false } }, 2);
  a.stream.rows.apply([{ model: "settings", key: "editable", value: { state: "available", value: row } }]);
  assert.equal(await saving, true);
  assert.equal(a.owner.snapshot().value.animations, false);
  assert.deepEqual(a.editor.snapshot().value, { ...row, protectedSettings: newer }, "the ordinary row never moves protected settings back"); a.close();
});
