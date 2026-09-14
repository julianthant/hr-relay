// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { SettingsCommandRequestSchema } from "../../../src/domain/commands.js";
import { mergeSettingsPatch, SettingsPatchSchema } from "../../../src/domain/config/settings.js";
import { fixtureSettingsDocument } from "../../parity/helpers/fixture-settings.js";
import { draftError, fiscalYearLeaves, patchFromSettingsDraft, settingInput, settingsLeaves } from "../../../src/dashboard/surfaces/settings-draft-model.js";
import { mountSettingsHarness, settingsAction, syntheticSettingsAuthority } from "./helpers/settings-harness.js";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
async function setup(section?: string) {
  const authority = syntheticSettingsAuthority(); cleanups.push(authority.close);
  const mounted = await mountSettingsHarness(authority, section); cleanups.push(mounted.close); return { ...mounted, authority };
}
describe("typed Settings catalog controls", () => {
  it("preserves text, zero/nonzero integers, booleans, routes, complete budgets and ordered chains", () => {
    const document = fixtureSettingsDocument(); const leaves = settingsLeaves(document);
    for (const [path, raw, value] of [
      ["actor.label", "New label", "New label"], ["ocr.pageConcurrency", "0", 0], ["timeouts.taskMs", "42", 42], ["browser.headless", "false", false],
      ["paths.downloadsDir", "/tmp/new-downloads", "/tmp/new-downloads"], ["urls.kuali.test", { entry: "https://test.example/entry" }, { entry: "https://test.example/entry" }],
      ["providers.gemini.models", "second\nfirst", ["second", "first"]],
      ["providers.ocrExtract", { timeoutMs: "100", concurrency: "2", requestsPerMinute: "3", dailyRequestLimit: "4", costLimitUsdMicros: "0" }, { timeoutMs: 100, concurrency: 2, requestsPerMinute: 3, dailyRequestLimit: 4, costLimitUsdMicros: 0 }],
    ] as const) {
      assert.deepEqual(patchFromSettingsDraft(leaves, { [path]: { kind: "set", raw } }), { [path]: { set: value } });
    }
    for (const [path, raw] of [["ocr.pageConcurrency", ""], ["ocr.pageConcurrency", "1.5"], ["timeouts.taskMs", "0"], ["paths.downloadsDir", "relative"], ["providers.gemini.models", "one\n\ntwo"], ["urls.kuali.test", { entry: "not a URL" }]] as const) {
      const leaf = leaves.find(candidate => candidate.path === path); assert.ok(leaf);
      assert.ok(draftError(leaf, { kind: "set", raw }));
    }
    assert.equal(SettingsPatchSchema.safeParse({ "providers.ocrExtract": { set: { concurrency: 2 } } }).success, false);
  });
  it("derives new-year paths only from served templates and requires all three dates", () => {
    const document = fixtureSettingsDocument();
    assert.throws(() => fiscalYearLeaves(document, "2027"));
    const leaves = fiscalYearLeaves(document, "FY2027");
    assert.equal(leaves.length, 3);
    const patch = patchFromSettingsDraft(leaves, Object.fromEntries(leaves.map(leaf => [leaf.path, { kind: "set", raw: "6/30/2027" }])));
    assert.deepEqual(mergeSettingsPatch({}, patch), { annualDates: { FY2027: { jobEndDate: "6/30/2027", kronosDefaultEndDate: "6/30/2027", kronosDefaultStartDate: "6/30/2027" } } });
    assert.throws(() => mergeSettingsPatch({}, { [leaves[0].path]: { set: "6/30/2027" } }));
    assert.ok(draftError(leaves[0], { kind: "set", raw: "13/1/2027" }));
  });
  it("keeps set-to-default saved; Reset/Discard make no write, and Clear is explicit", async () => {
    const h = await setup();
    await settingsAction(() => h.controller().update("actor.label", "Local operator"));
    assert.equal(h.controller().dirtyCount, 1);
    await settingsAction(() => h.controller().submit()); assert.equal(h.controller().save.state, "applied");
    assert.equal(h.authority.read().sections[0].leaves[0].source, "settings");
    assert.equal(h.controller().dirtyCount, 0);
    await settingsAction(() => h.controller().update("actor.label", "Draft only"));
    await settingsAction(() => h.controller().reset("actor.label"));
    assert.equal(h.commands.length, 1);
    await settingsAction(() => h.controller().update("actor.label", "Discard only"));
    await settingsAction(() => h.controller().discard()); assert.equal(h.commands.length, 1);
    await settingsAction(() => h.controller().clear("actor.label"));
    await settingsAction(() => h.controller().submit());
    assert.equal(h.authority.read().sections[0].leaves[0].settingsValue, undefined);
    assert.equal(h.controller().save.state, "applied");
  });
  it("resets one coupled leaf without discarding the other deliberate edit", async () => {
    const h = await setup("display");
    await settingsAction(() => h.controller().update("display.screenWidth", "1800"));
    await settingsAction(() => h.controller().update("display.screenHeight", "1000"));
    await settingsAction(() => h.controller().reset("display.screenWidth"));
    assert.deepEqual(h.controller().draft["display.screenHeight"], { kind: "set", raw: "1000" });
    assert.deepEqual(h.controller().draft["display.screenWidth"], { kind: "set", raw: "1920", companion: true });
    assert.equal(h.commands.length, 0);
    await settingsAction(() => h.controller().reset("display.screenHeight"));
    assert.equal(h.controller().dirtyCount, 0);
  });
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
  it("rejects a mixed valid/invalid patch atomically and partial display/year changes", async () => {
    const h = await setup(); const before = h.authority.read();
    assert.equal(h.authority.apply({ "actor.label": { set: "Must not save" }, "display.screenWidth": { set: 1800 } }).state, "rejected");
    assert.deepEqual(h.authority.read(), before);
    await settingsAction(() => h.controller().addYear("FY2028"));
    for (const leaf of h.controller().leaves.filter(leaf => leaf.path.startsWith("annualDates.FY2028."))) await settingsAction(() => h.controller().update(leaf.path, "6/30/2028"));
    await settingsAction(() => h.controller().submit()); assert.equal(h.controller().save.state, "applied");
    assert.equal(h.authority.read().sections.find(section => section.id === "annual-dates")?.leaves.length, 3);
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
      assert.equal(h.controller().save.state, "unconfirmed"); assert.equal(h.controller().dirtyCount, 1);
      assert.doesNotMatch(h.host.textContent ?? "", /synthetic-sensitive-server-message/u);
      const exact = structuredClone(h.commands[0]);
      await settingsAction(() => h.controller().update("actor.label", "Divergent edit"));
      assert.deepEqual(h.controller().draft["actor.label"], { kind: "set", raw: "Unconfirmed draft" });
      h.ports.read = h.authority.read; h.ports.execute = h.authority.execute;
      await settingsAction(() => h.controller().retry()); assert.deepEqual(h.commands[1], exact);
      assert.equal(h.controller().save.state, failure === "intervening-writer" ? "unconfirmed" : "applied");
    });
  }
  it("renders the source's field type and safe defaults, without environment provenance", async () => {
    const h = await setup("providers");
    assert.ok(h.host.querySelector('input[type="number"]')); assert.ok(h.host.querySelector("textarea"));
    assert.doesNotMatch(h.host.textContent ?? "", /Environment:/u);
    const leaf = settingsLeaves(h.authority.read()).find(candidate => candidate.path === "providers.gemini.models"); assert.ok(leaf); assert.equal(settingInput(leaf), "");
  });
});
