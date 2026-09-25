// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { SettingsCommandRequestSchema } from "../../../src/domain/commands.js";
import { mergeSettingsPatch, SettingsPatchSchema } from "../../../src/domain/config/settings.js";
import { fixtureSettingsDocument } from "../../parity/helpers/fixture-settings.js";
import { EditableSettingsWireSchema } from "../../../src/domain/dashboard/settings-editor.js";
import { draftError, fiscalYearLeaves, patchFromSettingsDraft, settingInput, settingsLeaves } from "../../../src/dashboard/surfaces/settings-draft-model.js";
import { differingSettingsValues, groupDeploymentFacts, groupSettingsLeaves, settingsFactLabel } from "../../../src/dashboard/surfaces/ui-settings-records-labels.js";
import { mountSettingsHarness, settingsAction, syntheticSettingsAuthority } from "./helpers/settings-harness.js";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
async function setup(section?: string) {
  const authority = syntheticSettingsAuthority(); cleanups.push(authority.close);
  const mounted = await mountSettingsHarness(authority, section); cleanups.push(mounted.close); return { ...mounted, authority };
}
function settingsWithDistinctRuntimeValues() {
  const saved = fixtureSettingsDocument({ actor: { label: "Saved operator" } }, 2);
  const active = fixtureSettingsDocument({ actor: { label: "Running operator" } }, 2);
  const defaultSettings = fixtureSettingsDocument();
  assert.equal(saved.runtimeStatus.state, "current");
  assert.equal(active.runtimeStatus.state, "current");
  const activeIdentity = active.runtimeStatus.state === "current" ? active.runtimeStatus.identity : undefined;
  const persistedIdentity = saved.runtimeStatus.state === "current" ? saved.runtimeStatus.identity : undefined;
  assert.ok(activeIdentity); assert.ok(persistedIdentity);
  const activeValue = active.sections.flatMap(section => section.leaves).find(leaf => leaf.path === "actor.label")?.activeValue;
  assert.ok(activeValue);
  const document = EditableSettingsWireSchema.parse({
    ...saved,
    runtimeStatus: { state: "restart-required", persisted: persistedIdentity, active: activeIdentity },
    activeConfigFingerprint: activeIdentity.configFingerprint,
    sections: saved.sections.map(section => ({ ...section, leaves: section.leaves.map(leaf => leaf.path === "actor.label" ? { ...leaf, activeValue } : leaf) })),
  });
  const defaultValue = defaultSettings.sections.flatMap(section => section.leaves).find(leaf => leaf.path === "actor.label")?.defaultValue;
  const actor = document.sections.flatMap(section => section.leaves).find(leaf => leaf.path === "actor.label");
  assert.ok(actor); assert.equal(actor.settingsValue, "Saved operator"); assert.equal(actor.activeValue, "Running operator"); assert.equal(actor.defaultValue, defaultValue);
  return document;
}
describe("typed Settings catalog controls", () => {
  it("groups related settings and surfaces only distinct served values", () => {
    const document = fixtureSettingsDocument({ annualDates: { FY2027: { jobEndDate: "6/30/2027", kronosDefaultEndDate: "6/30/2027", kronosDefaultStartDate: "7/1/2026" } } }, 2);
    const providerLeaves = document.sections.find(section => section.id === "providers")?.leaves;
    const pathLeaves = document.sections.find(section => section.id === "paths")?.leaves;
    const dateLeaves = document.sections.find(section => section.id === "annual-dates")?.leaves;
    assert.ok(providerLeaves); assert.ok(pathLeaves); assert.ok(dateLeaves);
    assert.deepEqual(groupSettingsLeaves("providers", providerLeaves).map(group => group.label), ["OCR extraction", "Census geocoding", "Nominatim geocoding", "AI advisory", "Gemini", "Groq", "Mistral", "OpenRouter", "SambaNova"]);
    assert.ok(groupSettingsLeaves("paths", pathLeaves).some(group => group.label === "Reports and documents"));
    assert.deepEqual(groupSettingsLeaves("annual-dates", dateLeaves).map(group => group.label), ["Fiscal year 2027"]);
    assert.deepEqual(groupDeploymentFacts(document.deployment).map(group => group.label), ["Operator", "Production routes", "Runtime paths"]);
    assert.equal(settingsFactLabel("paths.stateRoot"), "Runtime state folder");
    assert.equal(settingsFactLabel("urls.ucpath.prod"), "UCPath production routes");
    assert.equal(settingsFactLabel("smartHr"), "SmartHR URL");
    const leaf = settingsLeaves(document).find(candidate => candidate.path === "actor.label"); assert.ok(leaf);
    assert.deepEqual(differingSettingsValues({ ...leaf, settingsValue: "Saved", activeValue: "Running", defaultValue: "Default" }), [
      { label: "Saved", value: "Saved" }, { label: "Active", value: "Running" }, { label: "Default", value: "Default" },
    ]);
    assert.deepEqual(differingSettingsValues({ ...leaf, settingsValue: "Same", activeValue: "Same", defaultValue: "Same" }), []);
    assert.deepEqual(differingSettingsValues({ ...leaf, settingsValue: "Saved", activeValue: "Default", defaultValue: "Default" }), [
      { label: "Saved", value: "Saved" }, { label: "Active and Default", value: "Default" },
    ]);
    assert.deepEqual(differingSettingsValues({ ...leaf, settingsValue: "Saved", activeValue: undefined, defaultValue: undefined }), [
      { label: "Saved", value: "Saved" }, { label: "Active and Default", value: undefined },
    ]);
    assert.deepEqual(differingSettingsValues({ ...leaf, settingsValue: "Saved", activeValue: "Saved", defaultValue: undefined }), [
      { label: "Saved and Active", value: "Saved" }, { label: "Default", value: undefined },
    ]);
  });
  it("renders the current setting without redundant source or identity labels", async () => {
    const authority = syntheticSettingsAuthority(); cleanups.push(authority.close);
    const mounted = await mountSettingsHarness(authority, "general", settingsWithDistinctRuntimeValues); cleanups.push(mounted.close);
    const field = mounted.host.querySelector('[data-settings-path="actor.label"]'); assert.ok(field);
    assert.equal(field.querySelector("input")?.value, "Saved operator");
    assert.doesNotMatch(mounted.host.textContent ?? "", /Setting identities|Using default|Revision 2/u);
    assert.equal(field.querySelectorAll("details").length, 0);
  });
  it("shows current host values without source comparisons", async () => {
    const authority = syntheticSettingsAuthority(); cleanups.push(authority.close);
    const applied = authority.apply({
      "display.screenWidth": { set: 1800 },
      "display.screenHeight": { set: 1000 },
    });
    assert.equal(applied.state, "applied");
    const mounted = await mountSettingsHarness(authority, "derived-host"); cleanups.push(mounted.close);
    const width = mounted.host.querySelector('[data-settings-path="display.screenWidth"]'); assert.ok(width);
    assert.match(width.textContent ?? "", /1800/u);
    assert.doesNotMatch(width.textContent ?? "", /Saved|Active|Default|1920/u);
    const height = mounted.host.querySelector('[data-settings-path="display.screenHeight"]'); assert.ok(height);
    assert.match(height.textContent ?? "", /1000/u);
    assert.doesNotMatch(height.textContent ?? "", /Saved|Active|Default|1080/u);
  });
  it("shows the effective host value when no override exists", async () => {
    const authority = syntheticSettingsAuthority(); cleanups.push(authority.close);
    const mounted = await mountSettingsHarness(authority, "derived-host"); cleanups.push(mounted.close);
    const width = mounted.host.querySelector('[data-settings-path="display.screenWidth"]'); assert.ok(width);
    assert.match(width.textContent ?? "", /1920/u);
    assert.doesNotMatch(width.textContent ?? "", /Using default|Active/u);
  });
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
    assert.equal(h.host.querySelector('input[type="number"]')?.getAttribute("aria-label"), "OCR Extract budget: Timeout (ms)");
    assert.doesNotMatch(h.host.textContent ?? "", /Environment:/u);
    const leaf = settingsLeaves(h.authority.read()).find(candidate => candidate.path === "providers.gemini.models"); assert.ok(leaf); assert.equal(settingInput(leaf), "");
  });
  it("keeps provider environment source and process-start activation visible", async () => {
    const h = await setup("provider-env");
    const text = h.host.textContent ?? "";
    assert.match(text, /Source: \.env\.providers/u);
    assert.match(text, /Read-only at process start/u);
    assert.match(text, /restart after changing a provider key/u);
    assert.match(text, /Provider keys/u);
  });
});
