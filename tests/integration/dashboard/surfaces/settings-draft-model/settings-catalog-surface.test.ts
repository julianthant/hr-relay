// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { SettingsCommandRequestSchema } from "../../../../../src/rules/commands/commands.js";
import { mergeSettingsPatch, SettingsPatchSchema } from "../../../../../src/models/config/settings.js";
import { fixtureSettingsDocument } from "../../../../support/fixtures/dashboard/fixture-settings.js";
import { EditableSettingsWireSchema } from "../../../../../src/models/dashboard/settings-editor.js";
import { draftError, patchFromSettingsDraft, settingInput, settingsLeaves } from "../../../../../src/dashboard/surfaces/settings/editor/settings-draft-model.js";
import { differingSettingsValues, groupDeploymentFacts, groupSettingsLeaves, settingsFactLabel } from "../../../../../src/dashboard/surfaces/settings/editor/ui-settings-records-labels.js";
import { mountSettingsHarness, settingsAction, syntheticSettingsAuthority } from "../../../../support/helpers/dashboard/settings-harness.js";

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
    assert.deepEqual(groupSettingsLeaves("annual-dates", dateLeaves).map(group => group.label), ["Job end date"]);
    assert.deepEqual(groupDeploymentFacts(document.deployment).map(group => group.label), ["Operator", "Local paths"]);
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
  it("omits the actor label control while retaining the General settings", async () => {
    const authority = syntheticSettingsAuthority(); cleanups.push(authority.close);
    const mounted = await mountSettingsHarness(authority, "general", settingsWithDistinctRuntimeValues); cleanups.push(mounted.close);
    assert.equal(mounted.host.querySelector('[data-settings-path="actor.label"]'), null);
    assert.doesNotMatch(mounted.host.textContent ?? "", /Operator identity|Operator label/u);
    assert.doesNotMatch(mounted.host.textContent ?? "", /Setting identities|Using default|Revision 2/u);
    const annualRows = [...mounted.host.querySelectorAll('[data-settings-path^="annualDates."]')];
    assert.equal(annualRows.length, 1);
    assert.equal(annualRows[0]?.getAttribute("data-settings-path"), "annualDates.FY2027.jobEndDate");
    const dateSegments = [...(annualRows[0]?.querySelectorAll('[role="spinbutton"]') ?? [])];
    assert.equal(dateSegments.length, 3);
    assert.ok(dateSegments.every(segment => segment.getAttribute("aria-required") === "true"));
    assert.doesNotMatch(mounted.host.textContent ?? "", /Kronos|Add fiscal year|New fiscal year|FY202[0-9]/u);
  });
  it("folds Display into General and omits the observed-host page", async () => {
    const authority = syntheticSettingsAuthority(); cleanups.push(authority.close);
    const mounted = await mountSettingsHarness(authority, "general"); cleanups.push(mounted.close);
    const width = mounted.host.querySelector('[data-settings-path="display.screenWidth"]'); assert.ok(width);
    assert.equal(width.querySelector("input")?.value, "1920");
    const height = mounted.host.querySelector('[data-settings-path="display.screenHeight"]'); assert.ok(height);
    assert.equal(height.querySelector("input")?.value, "1080");
    assert.notEqual(width.querySelector("input")?.id, height.querySelector("input")?.id);
    assert.equal((width as HTMLLabelElement).htmlFor, width.querySelector("input")?.id);
    assert.equal((height as HTMLLabelElement).htmlFor, height.querySelector("input")?.id);
    assert.doesNotMatch(mounted.host.textContent ?? "", /Observed host/u);
  });
  it("toggles and autosaves each General browser switch", async () => {
    const h = await setup("general");
    for (const path of ["browser.headless", "features.debugScreenshots", "features.duoWebAuthn"] as const) {
      const row = h.host.querySelector(`[data-settings-path="${path}"]`);
      assert.ok(row);
      const control = row.querySelector<HTMLInputElement>('[role="switch"]');
      assert.ok(control);
      const before = control.checked;
      const pill = row.querySelector<HTMLElement>(".ds-switch-control");
      assert.ok(pill);
      await settingsAction(() => pill.click());
      assert.equal(row.querySelector<HTMLInputElement>('[role="switch"]')?.checked, !before);
      assert.deepEqual(h.controller().draft[path], { kind: "set", raw: String(!before) });
      assert.equal(row.querySelector("button"), null);
      await settingsAction(() => h.controller().submit());
      assert.equal(h.controller().save.state, "applied");
    }
    assert.equal(h.commands.length, 3);
  });
  it("shows deployment state locations and editable new-run browser locations", async () => {
    const { host } = await setup("paths");
    assert.deepEqual([...host.querySelectorAll("h1")].map(node => node.textContent), ["Paths"]);
    assert.deepEqual([...host.querySelectorAll("h2")].map(node => node.textContent), ["Runtime locations", "Generated files", "Workflow documents"]);
    assert.equal(host.querySelectorAll(".settings-relocation-row .ds-path-control button").length, 2);
    assert.equal(host.querySelectorAll(".settings-compact-row .ds-path-control button").length, 7);
    for (const path of ["paths.browserProfileRoot", "paths.duoCredential", "paths.duoExtensionDir",
      "paths.reportsDir", "paths.downloadsDir", "paths.onboardingDocsDir", "paths.i9CheckTrackerPath"]) {
      const row = host.querySelector(`[data-settings-path="${path}"]`);
      if (row === null) throw new Error(`missing ${path} row`);
      assert.ok(row.querySelector(".ds-path-value[aria-label]"));
      const label = row.querySelector("label");
      const change = row.querySelector(".ds-path-control button");
      assert.equal(label?.htmlFor, change?.id);
    }
    assert.doesNotMatch(host.textContent ?? "", /Code-owned paths for this process|Local operator ID/u);
  });
  it("groups each system's visible URL rows in one card with associated labels and descriptions", async () => {
    const { host } = await setup("routes");
    const systems = [...host.querySelectorAll(".routes-page-system")];
    assert.equal(systems.length, 9);
    assert.equal(host.querySelectorAll(".ds-disclosure, button[aria-expanded]").length, 0);
    for (const system of systems) {
      assert.equal(system.querySelectorAll(".ds-form-group").length, 1);
      assert.equal(system.querySelectorAll(".ds-form-group .ds-form-group").length, 0);
      assert.equal(system.querySelectorAll('[hidden], [data-state="closed"]').length, 0);
      const name = system.querySelector("h2 span span")?.textContent;
      assert.equal(system.querySelector('[role="group"]')?.getAttribute("aria-label"), name);
    }
    const crm = host.querySelector('[data-settings-path="urls.crm.prod"]'); assert.ok(crm);
    assert.equal(crm.closest(".routes-page-system")?.querySelector("h2")?.textContent, "CRM5 URLs");
    assert.equal(crm.querySelectorAll("button").length, 0);
    const rows = [...crm.querySelectorAll(".routes-page-field")];
    assert.equal(rows.length, 5);
    assert.deepEqual(rows.map(row => row.querySelector("label")?.textContent), ["Entry* (required)", "Onboarding search* (required)", "UCPath entry sheet* (required)", "Onboarding history* (required)", "iDocs viewer* (required)"]);
    for (const row of rows) {
      const label = row.querySelector("label");
      const input = row.querySelector("input");
      assert.ok(label); assert.ok(input);
      assert.equal(row.querySelectorAll("input").length, 1);
      assert.equal(label.htmlFor, input.id);
      assert.notEqual(input.id, "");
      assert.ok(input.getAttribute("aria-describedby")?.includes("description"));
      assert.equal(input.required, true);
      assert.equal(input.type, "url");
    }
    assert.equal(crm.closest(".ds-form-group")?.getAttribute("aria-label"), "CRM");
    assert.equal(host.querySelectorAll('.routes-page-field input[type="url"]').length, 18);
  });
  it("renders Performance timeouts as grouped, described controls with visible units", async () => {
    const { host } = await setup("performance");
    const groups = [...host.querySelectorAll('.settings-performance-page .ds-body-section-heading')].map(heading => heading.firstChild?.textContent);
    assert.deepEqual(groups, ["Navigation", "Work", "Sign-in & Duo", "Additional limits"]);
    assert.equal(host.querySelectorAll('.settings-performance-page .ds-body-section-meta').length, 0);
    assert.equal(host.querySelectorAll('.settings-performance-disclosure').length, 4);
    assert.equal(host.querySelectorAll('.settings-performance-disclosure .ds-disclosure-body-meta').length, 0);
    assert.equal(host.querySelectorAll('.settings-performance-disclosure[data-state="closed"]').length, 4);
    const navigation = host.querySelector('[data-settings-path="timeouts.navigationMs"]'); assert.ok(navigation);
    assert.match(navigation.textContent ?? "", /Standard navigation/u);
    assert.match(navigation.textContent ?? "", /Maximum wait for a regular page change/u);
    assert.equal(navigation.querySelector("input")?.value, "15");
    assert.equal(navigation.querySelector(".ds-unit-label")?.textContent, "seconds");
    const task = host.querySelector('[data-settings-path="timeouts.taskMs"]'); assert.ok(task);
    assert.equal(task.querySelector("input")?.value, "180");
    assert.equal(task.querySelector(".ds-unit-label")?.textContent, "seconds");
    const crm = host.querySelector('[data-settings-path="timeouts.duoApprovalCrmSeconds"]'); assert.ok(crm);
    assert.equal(crm.querySelector("input")?.value, "60");
    assert.equal(crm.querySelector(".ds-unit-label")?.textContent, "seconds");
    assert.equal(host.querySelector("select"), null);
    assert.equal([...host.querySelectorAll("button")].some(button => button.textContent === "Save changes"), false);
  });
  it("discards a pending Performance clear without an inline Undo control", async () => {
    const authority = syntheticSettingsAuthority(); cleanups.push(authority.close);
    const mounted = await mountSettingsHarness(authority, "performance", () => fixtureSettingsDocument({ timeouts: { navigationMs: 22_000 } }, 2)); cleanups.push(mounted.close);
    const row = mounted.host.querySelector('[data-settings-path="timeouts.navigationMs"]'); assert.ok(row);
    assert.equal(row.querySelector("input")?.value, "22");
    assert.equal(row.querySelector("button"), null);
    assert.equal(row.querySelectorAll(".ds-body-row").length, 1);
    assert.equal(row.querySelectorAll(".settings-row-actions").length, 0);
    await settingsAction(() => mounted.controller().clear("timeouts.navigationMs"));
    assert.deepEqual(mounted.controller().draft["timeouts.navigationMs"], { kind: "clear" });
    assert.equal([...row.querySelectorAll<HTMLButtonElement>("button")].some(button => button.textContent === "Undo"), false);
    await settingsAction(() => mounted.controller().reset("timeouts.navigationMs"));
    assert.equal(mounted.controller().draft["timeouts.navigationMs"], undefined);
    assert.equal(mounted.commands.length, 0);
  });
  it("reopens an additional limit with a retained invalid draft", async () => {
    const mounted = await setup("performance");
    await settingsAction(() => mounted.controller().update("ocr.pageConcurrency", ""));
    assert.ok(mounted.controller().errors["ocr.pageConcurrency"]);
    await mounted.render("general");
    await mounted.render("performance");
    const ocr = [...mounted.host.querySelectorAll(".settings-performance-disclosure")].find(group => group.textContent?.includes("OCR processing"));
    assert.ok(ocr);
    assert.equal(ocr.getAttribute("data-state"), "open");
    assert.match(ocr.textContent ?? "", /Enter a whole number of at least 0/u);
  });
  it("does not expose host observation as a served authority page", async () => {
    const authority = syntheticSettingsAuthority(); cleanups.push(authority.close);
    const mounted = await mountSettingsHarness(authority, "derived-host"); cleanups.push(mounted.close);
    assert.match(mounted.host.textContent ?? "", /did not include|unavailable/u);
  });
  it("preserves text, zero/nonzero integers, booleans, routes, complete budgets and ordered chains", () => {
    const document = fixtureSettingsDocument(); const leaves = settingsLeaves(document);
    for (const [path, raw, value] of [
      ["actor.label", "New label", "New label"], ["ocr.pageConcurrency", "0", 0], ["timeouts.taskMs", "42", 42_000], ["browser.headless", "false", false],
      ["paths.downloadsDir", "/tmp/new-downloads", "/tmp/new-downloads"], ["urls.kuali.prod", { entry: "https://test.example/entry" }, { entry: "https://test.example/entry" }],
      ["providers.gemini.models", "second\nfirst", ["second", "first"]],
      ["providers.ocrExtract", { timeoutMs: "100", concurrency: "2", requestsPerMinute: "3", dailyRequestLimit: "4", costLimitUsdMicros: "0" }, { timeoutMs: 100, concurrency: 2, requestsPerMinute: 3, dailyRequestLimit: 4, costLimitUsdMicros: 0 }],
    ] as const) {
      assert.deepEqual(patchFromSettingsDraft(leaves, { [path]: { kind: "set", raw } }), { [path]: { set: value } });
    }
    for (const [path, raw] of [["ocr.pageConcurrency", ""], ["ocr.pageConcurrency", "1.5"], ["timeouts.taskMs", "0"], ["paths.downloadsDir", "relative"], ["providers.gemini.models", "one\n\ntwo"], ["urls.kuali.prod", { entry: "not a URL" }]] as const) {
      const leaf = leaves.find(candidate => candidate.path === path); assert.ok(leaf);
      assert.ok(draftError(leaf, { kind: "set", raw }));
    }
    assert.equal(SettingsPatchSchema.safeParse({ "providers.ocrExtract": { set: { concurrency: 2 } } }).success, false);
  });
  it("binds one required job-end-date leaf to the current fiscal year and preserves older values", () => {
    const document = fixtureSettingsDocument();
    const year = `FY${String(document.currentFiscalYear)}`;
    const path = `annualDates.${year}.jobEndDate`;
    const leaves = settingsLeaves(document).filter(leaf => leaf.path.startsWith("annualDates."));
    assert.deepEqual(leaves.map(leaf => leaf.path), [path]);
    const patch = patchFromSettingsDraft(leaves, { [path]: { kind: "set", raw: "6/30/2027" } });
    assert.deepEqual(mergeSettingsPatch({ annualDates: { FY2024: { jobEndDate: "6/30/2024" } } }, patch), {
      annualDates: { FY2024: { jobEndDate: "6/30/2024" }, [year]: { jobEndDate: "6/30/2027" } },
    });
    assert.throws(() => mergeSettingsPatch({}, { [path]: { set: "not a date" } }));
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
  it("rejects mixed valid/invalid patch atomically and partial display changes", async () => {
    const h = await setup(); const before = h.authority.read();
    assert.equal(h.authority.apply({ "actor.label": { set: "Must not save" }, "display.screenWidth": { set: 1800 } }).state, "rejected");
    assert.deepEqual(h.authority.read(), before);
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
    assert.ok(h.host.querySelector('input[type="number"]'));
    assert.equal(h.host.querySelector('input[type="number"]')?.getAttribute("aria-label"), "OCR extraction: Request timeout");
    assert.ok(h.host.querySelector('ol[aria-label="Gemini model priority"]'));
    assert.equal(h.host.querySelector("textarea"), null);
    assert.doesNotMatch(h.host.textContent ?? "", /Environment:/u);
    const leaf = settingsLeaves(h.authority.read()).find(candidate => candidate.path === "providers.gemini.models"); assert.ok(leaf); assert.equal(settingInput(leaf), "");
  });
  it("keeps an unavailable provider file explicit on Credentials", async () => {
    const h = await setup("credentials");
    const text = h.host.textContent ?? "";
    assert.match(text, /Provider keys unavailable/u);
    assert.doesNotMatch(text, /0 saved keys/u);
  });
});

it("publishes failed reload, keeps its draft, and blocks new submissions", async () => {
  const h = await setup();
  await settingsAction(() => h.controller().update("actor.label", "Retained after reload"));
  h.ports.read = () => { throw new Error("unavailable"); };
  await settingsAction(() => h.controller().reload());
  assert.match(h.controller().readProblem ?? "", /could not be read/u);
  assert.deepEqual(h.controller().draft["actor.label"], { kind: "set", raw: "Retained after reload" });
  await settingsAction(() => h.controller().submit()); assert.equal(h.commands.length, 0);
});
