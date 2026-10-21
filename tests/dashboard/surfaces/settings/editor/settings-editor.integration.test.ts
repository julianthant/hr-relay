// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { EditableSettingsWireSchema } from "../../../../../src/models/dashboard/settings-editor.js";
import { fixtureSettingsDocument } from "../../../../support/fixtures/dashboard/fixture-settings.js";
import { mountSettingsHarness,settingsAction,syntheticSettingsAuthority } from "../../../../support/helpers/dashboard/settings-harness.js";

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
  it("shows the approved General browser controls without observed host details", async () => {
    const authority = syntheticSettingsAuthority(); cleanups.push(authority.close);
    const mounted = await mountSettingsHarness(authority, "general"); cleanups.push(mounted.close);
    assert.ok(mounted.host.querySelector('[data-settings-path="browser.headless"] [role="switch"]'));
    assert.equal(mounted.host.querySelectorAll('input[name="display.screenWidth"], input[name="display.screenHeight"]').length, 2);
    assert.doesNotMatch(mounted.host.textContent ?? "", /Observed host/u);
  });
  it("saves Browser window dimensions through canonical Settings authority and matching readback", async () => {
    const h = await setup("general");
    const width = h.host.querySelector<HTMLInputElement>('input[name="display.screenWidth"]');
    const height = h.host.querySelector<HTMLInputElement>('input[name="display.screenHeight"]');
    assert.ok(width); assert.ok(height); assert.equal(width.disabled, false);
    assert.equal(width.value, "1920"); assert.equal(height.value, "1080");
    await settingsAction(() => { width.focus(); width.stepDown(120); width.dispatchEvent(new Event("input", { bubbles: true })); });
    await settingsAction(() => { height.focus(); height.stepDown(80); height.dispatchEvent(new Event("input", { bubbles: true })); });
    assert.deepEqual(h.controller().draft["display.screenWidth"], { kind: "set", raw: "1800" });
    assert.deepEqual(h.controller().draft["display.screenHeight"], { kind: "set", raw: "1000" });
    assert.equal(h.commands.length, 0, "moving within the dimensions field must not flush a partial pair");
    await settingsAction(() => height.blur());
    assert.equal(h.controller().save.state, "applied"); assert.equal(h.commands.length, 1);
    const leaves = h.authority.read().sections.flatMap(section => section.leaves);
    assert.equal(leaves.find(leaf => leaf.path === "display.screenWidth")?.effectiveValue, 1800);
    assert.equal(leaves.find(leaf => leaf.path === "display.screenHeight")?.effectiveValue, 1000);
    assert.equal(width.value, "1800"); assert.equal(height.value, "1000");
  });
  it("autosaves the approved General browser switch and omits retired controls", async () => {
    const h = await setup("general");
    for (const path of ["browser.headless"] as const) {
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
    assert.equal(h.commands.length, 1);
    assert.equal(h.host.querySelector('[data-settings-path="features.debugScreenshots"]'), null);
    assert.equal(h.host.querySelector('[data-settings-path="features.duoWebAuthn"]'), null);
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
  it("rejects mixed valid/invalid patch atomically and partial display changes", async () => {
    const h = await setup(); const before = h.authority.read();
    assert.equal(h.authority.apply({ "actor.label": { set: "Must not save" }, "display.screenWidth": { set: 1800 } }).state, "rejected");
    assert.deepEqual(h.authority.read(), before);
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
