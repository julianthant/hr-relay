// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach,describe,it,vi } from "vitest";
import { SettingsCommandRequestSchema, DashboardCommandRequestSchema } from "../../../../../src/rules/commands/commands.js";
import { mountSettingsHarness,settingsAction,syntheticSettingsAuthority } from "../../../../support/helpers/dashboard/settings-harness.js";

import { CommandExecutor, type CommandOutcome } from "../../../../../src/dashboard/app/commands/command-executor.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../../../src/models/failures/error-catalog.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks(); });
async function setup(section?: string) {
  const authority = await syntheticSettingsAuthority(); cleanups.push(authority.close);
  const mounted = await mountSettingsHarness(authority, section); cleanups.push(mounted.close); return { ...mounted, authority };
}
const FAILURE = { tone: "danger", title: "Settings weren't saved. The previous value is back.", key: "settings-save" } as const;
const labelValue = (h: Awaited<ReturnType<typeof setup>>): unknown => {
  const editor = h.controller().editor; assert.equal(editor.state, "loaded");
  if (editor.state !== "loaded") throw new Error("current settings unavailable");
  return editor.document.sections.flatMap(section => section.leaves).find(leaf => leaf.path === "actor.label")?.effectiveValue;
};
describe("typed Settings catalog controls", () => {
  it("reverts a conflicting save to the competitor's current values with a failure toast", async () => {
    const h = await setup();
    await settingsAction(() => h.controller().update("actor.label", "Rejected draft"));
    assert.equal(h.authority.apply({ "actor.label": { set: "Competing writer" } }).state, "applied");
    await settingsAction(() => h.controller().submit());
    assert.equal(h.commands.length, 1); assert.equal(h.controller().dirtyCount, 0);
    assert.deepEqual(h.problems, [FAILURE]); assert.deepEqual(h.notices, []);
    assert.equal(labelValue(h), "Competing writer");
    assert.equal(h.controller().locked, false);
  });
  for (const failure of ["lost-response", "failed-readback", "intervening-writer", "foreign-result", "wrong-family"] as const) {
    it(`settles the edit from its read-back after ${failure}, never resending`, async () => {
      const h = await setup(); const original = h.authority.read();
      h.ports.execute = request => {
        const result = h.authority.execute(request);
        if (failure === "lost-response") throw new Error("synthetic-sensitive-server-message");
        if (failure === "failed-readback") h.ports.read = () => { throw new Error("synthetic-sensitive-server-message"); };
        if (failure === "intervening-writer") h.authority.apply({ "actor.label": { set: "Later writer" } });
        if (failure === "foreign-result") return { ...result, commandId: "00000000-0000-4000-8000-000000000099" };
        if (failure === "wrong-family") return { state: "applied", commandId: SettingsCommandRequestSchema.parse(request).commandId, affectedTargets: [{ family: "protected-settings", revision: 2 }], restartRequired: false, revision: 2, entries: {} };
        return result;
      };
      await settingsAction(() => h.controller().update("actor.label", "Unconfirmed draft")); await settingsAction(() => h.controller().submit());
      // The served value decides: the stored write shows silently; anything else is the previous value and one failure toast.
      const stored = failure === "lost-response" || failure === "foreign-result" || failure === "wrong-family";
      await vi.waitFor(async () => { await settingsAction(() => undefined); assert.ok(stored ? labelValue(h) === "Unconfirmed draft" && h.controller().dirtyCount === 0 : h.problems.length === 1); }, { timeout: 5000, interval: 50 });
      assert.equal(h.controller().dirtyCount, 0);
      if (stored) { assert.deepEqual(h.problems, []); assert.deepEqual(h.notices, [], "a save found by reading back shows no message"); }
      else { assert.deepEqual(h.problems, [FAILURE]); assert.deepEqual(h.notices, []); }
      assert.equal(h.commands.length, 1, "an unknown outcome is read back, never resent");
      if (failure !== "failed-readback") assert.equal(h.controller().locked, false, "the control works again without a reload");
      assert.doesNotMatch(h.host.textContent ?? "", /synthetic-sensitive-server-message|Retry|Saving|unconfirmed/u);
      if (failure === "intervening-writer") {
        assert.equal(h.authority.read().revision, original.revision + 2);
        assert.equal(labelValue(h), "Later writer");
      }
      if (failure !== "failed-readback") {
        // The read-back freed the command lock: the next edit reaches Relay.
        h.ports.execute = request => h.authority.execute(request);
        await settingsAction(() => h.controller().update("actor.label", "Next draft", true));
        await vi.waitFor(async () => { await settingsAction(() => undefined); assert.equal(h.commands.length, 2); }, { timeout: 5000, interval: 50 });
      }
    });
  }
});

describe("Settings autosave wait", () => {
  const patchOf = (command: unknown): unknown => (command as { payload: { patch: unknown } }).payload.patch;
  it("sends a toggle or choice save at once and keeps the wait for typed text", async () => {
    const h = await setup();
    await settingsAction(() => h.controller().update("actor.label", "typed"));
    assert.equal(h.commands.length, 0, "typed text still waits");
    await settingsAction(() => h.controller().update("actor.label", "chosen", true));
    await settingsAction(() => undefined);
    assert.equal(h.commands.length, 1, "an immediate change is sent without the 700 ms wait");
  });
  it("keeps the last of two quick immediate changes", async () => {
    const h = await setup();
    await settingsAction(() => { h.controller().update("actor.label", "first", true); h.controller().update("actor.label", "second", true); });
    await settingsAction(() => undefined);
    assert.equal(h.commands.length, 1);
    assert.deepEqual(patchOf(h.commands[0]), { "actor.label": { set: "second" } });
    assert.equal(labelValue(h), "second");
  });
});

for (const family of ["protected"] as const) {
  it(`recovers ${family} after same-day scope refresh while its reply is pending`, async () => {
    const h = await setup();
    let settle: ((value: unknown) => void) | undefined;
    h.ports.execute = () => new Promise<unknown>(resolve => { settle = resolve; });
    const control = () => h.controller().protectedEditor;
    const value = "https://example.test/retained-roster";
    await settingsAction(() => control().update("sharepointOnboardingRosterUrl", value));
    await settingsAction(() => control().submit());
    assert.equal(control().save.state, "saving"); const original = structuredClone(h.commands[0]);
    await h.render("general", true, 1);
    assert.equal(control().save.state, "unconfirmed");
    await settingsAction(() => control().submit());
    assert.equal(h.commands.length, 1, "the pending original attempt holds the write lock");
    const draft = structuredClone(control().draft);
    assert.ok(settle);
    await settingsAction(() => settle?.({ state: "pending", commandId: (original as { commandId: string }).commandId }));
    assert.equal(control().save.state, "unconfirmed"); assert.equal(control().locked, true);
    assert.deepEqual(control().draft, draft);
    assert.equal(h.notices.length, 0); assert.equal(h.problems.length, 0);
    assert.equal(h.authority.execute(original).state, "applied");
    await vi.waitFor(async () => { await settingsAction(() => undefined); assert.equal(control().locked, false); });
    assert.equal(control().save.state, "idle"); assert.equal(control().dirtyCount, 0);
    assert.equal(h.notices.length, 0); assert.equal(h.problems.length, 0);
    const editor = h.controller().editor; assert.ok(editor.state === "loaded");
    assert.ok(editor.document.protectedSettings.state === "available");
    assert.equal(editor.document.protectedSettings.entries.sharepointOnboardingRosterUrl?.value, value);
    assert.deepEqual(h.commands, [original]);
  });
}

const retentionCases: readonly { name: string; retained: boolean; outcome: (commandId: string) => CommandOutcome }[] = [
  { name: "uncertain", retained: true, outcome: commandId => ({ commandId, kind: "uncertain", feedback: formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_OUTCOME_UNCERTAIN", {})) }) },
  { name: "refused/locked", retained: true, outcome: commandId => ({ commandId, kind: "refused", reason: "locked", feedback: formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_REFUSED", {})) }) },
  { name: "refused", retained: false, outcome: commandId => ({ commandId, kind: "refused", feedback: formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_REFUSED", {})) }) },
  { name: "confirmed", retained: false, outcome: commandId => ({ commandId, kind: "confirmed", readback: {} }) },
  { name: "conflict", retained: false, outcome: commandId => ({ commandId, kind: "conflict", feedback: formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_CONFLICT", {})) }) },
  { name: "confirmation-required", retained: false, outcome: commandId => ({ commandId, kind: "confirmation-required", warningDigest: "a".repeat(64), feedback: formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_REFUSED", {})) }) },
  { name: "failed", retained: false, outcome: commandId => ({ commandId, kind: "failed", feedback: formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_DISPATCH_FAILED", {})) }) },
];

for (const family of ["ordinary", "protected"] as const) {
  for (const scenario of retentionCases) {
    const retained = family === "protected" && scenario.retained;
    it(`${family} pending draft is ${retained ? "kept" : "released"} after ${scenario.name}`, async () => {
      const h = await setup();
      vi.spyOn(CommandExecutor.prototype, "execute").mockImplementation(async (input, options) => {
        const command = DashboardCommandRequestSchema.parse(input);
        const outcome = scenario.outcome(command.commandId);
        options.publish?.(outcome);
        return outcome;
      });
      const control = () => family === "ordinary" ? h.controller() : h.controller().protectedEditor;
      const update = (value: string) => family === "ordinary" ? h.controller().update("actor.label", value) : h.controller().protectedEditor.update("ucpathUserId", value);
      const draft = () => family === "ordinary" ? h.controller().draft["actor.label"] : h.controller().protectedEditor.draft.ucpathUserId;
      await settingsAction(() => update("Original draft"));
      await settingsAction(() => control().submit());
      assert.equal(control().locked, retained);
      await settingsAction(() => update("Next draft"));
      assert.deepEqual(draft(), { kind: "set", raw: retained ? "Original draft" : "Next draft" });
    });
  }
}
