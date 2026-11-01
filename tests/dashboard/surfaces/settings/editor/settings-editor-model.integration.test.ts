// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { SettingsCommandRequestSchema } from "../../../../../src/rules/commands/commands.js";
import { mountSettingsHarness,settingsAction,syntheticSettingsAuthority } from "../../../../support/helpers/dashboard/settings-harness.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function setup(section?: string) {
  const authority = await syntheticSettingsAuthority(); cleanups.push(authority.close);
  const mounted = await mountSettingsHarness(authority, section); cleanups.push(mounted.close); return { ...mounted, authority };
}
describe("typed Settings catalog controls", () => {
  it("retains cross-section edits and the unchanged conflict draft beside fresh current values", async () => {
    const h = await setup();
    await settingsAction(() => h.controller().update("actor.label", "Retained draft"));
    await h.render("display"); await settingsAction(() => h.controller().update("display.screenWidth", "1800"));
    const before = structuredClone(h.controller().draft);
    assert.equal(h.authority.apply({ "actor.label": { set: "Competing writer" }, "display.screenWidth": { set: 1600 }, "display.screenHeight": { set: 900 } }).state, "applied");
    await settingsAction(() => h.controller().submit());
    assert.equal(h.controller().save.state, "conflict"); assert.deepEqual(h.controller().draft, before);
    assert.equal(h.commands.length, 1);
    assert.match(h.host.textContent ?? "", /1600/u);
    assert.equal((h.host.querySelector('[data-settings-path="display.screenWidth"] input') as HTMLInputElement).value, "1800");
    await settingsAction(() => h.controller().submit());
    assert.equal(SettingsCommandRequestSchema.parse(h.commands[1]).target.expectedRevision, 2);
    assert.equal(h.controller().save.state, "applied");
    assert.equal(h.authority.read().sections.find(section => section.id === "display")?.leaves[1].settingsValue, 1080, "the original coupled height is retained, never auto-merged with the competitor");
  });
  for (const failure of ["lost-response", "failed-readback", "stale-readback", "intervening-writer", "foreign-result", "wrong-family"] as const) {
    it(`retains unconfirmed ordinary edits after ${failure}`, async () => {
      const h = await setup(); const original = h.authority.read();
      h.ports.execute = request => {
        const result = h.authority.execute(request);
        if (failure === "lost-response") throw new Error("synthetic-sensitive-server-message");
        if (failure === "failed-readback") h.ports.read = () => { throw new Error("synthetic-sensitive-server-message"); };
        if (failure === "stale-readback") h.ports.read = () => original;
        if (failure === "intervening-writer") h.authority.apply({ "actor.label": { set: "Later writer" } });
        if (failure === "foreign-result") return { ...result, commandId: "00000000-0000-4000-8000-000000000099" };
        if (failure === "wrong-family") return { state: "applied", commandId: SettingsCommandRequestSchema.parse(request).commandId, affectedTargets: [{ family: "protected-settings", revision: 2 }], restartRequired: false, revision: 2, entries: {} };
        return result;
      };
      await settingsAction(() => h.controller().update("actor.label", "Unconfirmed draft")); await settingsAction(() => h.controller().submit());
      assert.equal(h.controller().save.state, failure === "intervening-writer" ? "conflict" : "unconfirmed"); assert.equal(h.controller().dirtyCount, 1);
      if (failure === "intervening-writer") {
        assert.deepEqual(h.controller().draft["actor.label"], { kind: "set", raw: "Unconfirmed draft" });
        assert.equal(h.authority.read().revision, original.revision + 2);
        const editor = h.controller().editor; assert.equal(editor.state, "loaded");
        if (editor.state !== "loaded") throw new Error("current settings unavailable");
        assert.equal(editor.document.sections.flatMap(section => section.leaves).find(leaf => leaf.path === "actor.label")?.effectiveValue, "Later writer");
        assert.match(h.host.textContent ?? "", /Settings changed/u);
        h.ports.read = h.authority.read; h.ports.execute = h.authority.execute;
        await settingsAction(() => h.controller().submit());
        assert.equal(h.controller().save.state, "applied");
        assert.equal(SettingsCommandRequestSchema.parse(h.commands[1]).target.expectedRevision, original.revision + 2);
        return;
      }
      assert.doesNotMatch(h.host.textContent ?? "", /synthetic-sensitive-server-message/u);
      const exact = structuredClone(h.commands[0]);
      await settingsAction(() => h.controller().update("actor.label", "Divergent edit"));
      assert.deepEqual(h.controller().draft["actor.label"], { kind: "set", raw: "Unconfirmed draft" });
      h.ports.read = h.authority.read; h.ports.execute = h.authority.execute;
      await settingsAction(() => h.controller().retry()); assert.deepEqual(h.commands[1], exact);
      assert.equal(h.controller().save.state, "applied");
    });
  }
});

it("recovers the original unknown Settings envelope after the editor unmounts", async () => {
  const h = await setup();
  h.ports.execute = request => { h.authority.execute(request); throw new Error("lost response"); };
  await settingsAction(() => h.controller().update("actor.label", "Retained attempt"));
  await settingsAction(() => h.controller().submit());
  const original = structuredClone(h.commands[0]);
  assert.equal(h.controller().save.state, "unconfirmed");
  await h.render("general", false); await h.render("general");
  assert.equal(h.controller().save.state, "unconfirmed"); assert.equal(h.controller().locked, true);
  await settingsAction(() => { h.controller().update("actor.label", "Fresh command"); h.controller().submit(); });
  assert.equal(h.commands.length, 1);
  h.ports.execute = h.authority.execute;
  await settingsAction(() => h.controller().retry());
  assert.deepEqual(h.commands, [original, original]); assert.equal(h.controller().save.state, "applied");
});

for (const family of ["ordinary", "protected", "relocation"] as const) {
  it(`recovers ${family} after same-day scope refresh while its reply is pending`, async () => {
    const h = await setup();
    let settle: ((value: unknown) => void) | undefined;
    h.ports.execute = () => new Promise<unknown>(resolve => { settle = resolve; });
    const control = () => family === "ordinary" ? h.controller() : family === "protected" ? h.controller().protectedEditor : h.controller().relocationEditor;
    await settingsAction(() => {
      if (family === "ordinary") h.controller().update("actor.label", "retained");
      else if (family === "protected") h.controller().protectedEditor.update("ucpathUserId", "retained");
      else h.controller().relocationEditor.update("artifactRoot", "/tmp/retained-artifacts");
    });
    await settingsAction(() => control().submit());
    assert.equal(control().save.state, "saving"); const original = structuredClone(h.commands[0]);
    await h.render("general", true, 1);
    assert.equal(control().save.state, "unconfirmed");
    await settingsAction(() => control().retry());
    assert.equal(h.commands.length, 1, "retry cannot dispatch over the pending original attempt");
    const draft = structuredClone(control().draft);
    assert.ok(settle);
    await settingsAction(() => settle?.({ state: "rejected", commandId: (original as { commandId: string }).commandId, code: "authority-uncertain", message: "private" }));
    assert.equal(control().save.state, "unconfirmed"); assert.equal(control().locked, true);
    assert.deepEqual(control().draft, draft);
    assert.equal(h.notices.length, 0); assert.equal(h.problems.length, 0);
    h.ports.execute = request => ({ state: "rejected", commandId: (request as { commandId: string }).commandId, code: "authority-uncertain", message: "private" });
    await settingsAction(() => control().retry());
    assert.deepEqual(h.commands, [original, original]);
  });
}
