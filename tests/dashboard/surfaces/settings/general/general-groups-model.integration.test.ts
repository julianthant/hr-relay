// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach,describe,it,vi } from "vitest";
import { SettingsSectionSkeleton } from "../../../../../src/dashboard/surfaces/settings/settings-loading.js";
import { searchSettings,settingsSearchIndex } from "../../../../../src/dashboard/surfaces/settings/navigation/settings-search-model.js";
import { buildSettingsNav,resolveSettingsSection } from "../../../../../src/dashboard/surfaces/settings/settings-model.js";
import { mountSettingsHarness,settingsAction,syntheticSettingsAuthority } from "../../../../support/helpers/dashboard/settings-harness.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function setup(withPersonPreferences = false) {
  const authority = await syntheticSettingsAuthority(); cleanups.push(authority.close);
  const mounted = await mountSettingsHarness(authority, "general", undefined, withPersonPreferences); cleanups.push(mounted.close); return { ...mounted, authority };
}
const headings = (host: ParentNode) => [...host.querySelectorAll(".ds-body-section-heading")].map(heading => heading.firstChild?.textContent);
const ROWS = [
  ["preferences.preventSleepWhileRunning", "Prevent sleep while running", ""],
  ["preferences.confirmCloseDuringRun", "Confirm before closing during a run", ""],
  ["preferences.notifications.runFinished", "Run finished", ""],
  ["preferences.notifications.needsYou", "Needs you", ""],
  ["preferences.notifications.failures", "Failures", ""],
  ["preferences.notifications.sound", "Notification sound", ""],
] as const;
const leafValue = (authority: Awaited<ReturnType<typeof syntheticSettingsAuthority>>, path: string) => authority.read().sections.flatMap(section => section.leaves).find(leaf => leaf.path === path)?.effectiveValue;
async function choose(trigger: Element, value: string): Promise<void> {
  await settingsAction(() => (trigger as HTMLElement).click());
  const option = [...document.querySelectorAll<HTMLElement>(`[role="option"][data-value="${value}"]`)].at(-1);
  assert.ok(option);
  await settingsAction(() => option.click());
}

describe("Settings > General groups", () => {
  it("draws the Assistant group first, above App, Runs and Notifications with the six rows in the mock's order and labels, and no sentence under a row", async () => {
    const h = await setup();
    assert.deepEqual(headings(h.host), ["Assistant", "App", "Runs", "Notifications"]);
    const rows = [...h.host.querySelectorAll('[data-settings-path^="preferences."]')];
    assert.deepEqual(rows.map(row => row.getAttribute("data-settings-path")), ROWS.map(row => row[0]));
    rows.forEach((row, index) => { assert.ok(row.textContent?.includes(ROWS[index][1]), ROWS[index][1]); assert.ok(row.textContent?.includes(ROWS[index][2]), ROWS[index][2]); });
    for (const row of rows) assert.equal(row.querySelector(".ds-switch-content .ds-text-meta, .ds-field-description") === null, true, row.textContent ?? "");
    const sectionOf = (row: Element) => { let node: Element | null = row; while (node !== null && node.querySelector(".ds-body-section-heading") === null) node = node.parentElement; return node?.querySelector(".ds-body-section-heading")?.firstChild?.textContent; };
    assert.deepEqual(rows.map(sectionOf), ["Runs", "Runs", "Notifications", "Notifications", "Notifications", "Notifications"]);
  });
  it("puts the ChatGPT status row before the Full access switch and no Subscription page in the nav", async () => {
    const h = await setup(true);
    const card = h.host.querySelector('[data-settings-path="chatgpt.account"]');
    const permission = h.host.querySelector('[data-settings-path="assistant.fullAccess"]');
    assert.ok(card && permission);
    assert.ok(card.compareDocumentPosition(permission) & Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(permission.textContent?.includes("Full access"));
    const document = h.authority.read();
    const ids = buildSettingsNav(document).flatMap(group => group.entries.map(entry => entry.id));
    assert.equal(ids.includes("subscription"), false);
    assert.equal(resolveSettingsSection(buildSettingsNav(document), "subscription").state === "open" && (resolveSettingsSection(buildSettingsNav(document), "subscription") as { entry: { id: string } }).entry.id, "general");
  });
  it("shows a Full access change immediately and saves and restores it through Settings", async () => {
    const h = await setup(true);
    const path = "preferences.assistantFullAccess";
    const findSwitch = (host: HTMLElement) => host.querySelector<HTMLInputElement>('[data-settings-path="assistant.fullAccess"] input[type="checkbox"]');
    const input = findSwitch(h.host);
    assert.ok(input);
    assert.equal(input.checked, false);
    const pending = Promise.withResolvers<void>();
    h.ports.execute = async request => { await pending.promise; return h.authority.execute(request); };
    await settingsAction(() => input.click());
    assert.equal(input.checked, true);
    assert.equal(leafValue(h.authority, path), false);
    await settingsAction(() => pending.resolve());
    assert.equal(leafValue(h.authority, path), true);
    const reopened = await mountSettingsHarness(h.authority, "general", undefined, true);
    cleanups.push(reopened.close);
    const saved = findSwitch(reopened.host);
    assert.equal(saved?.checked, true);
    await settingsAction(() => saved?.click());
    assert.equal(leafValue(h.authority, path), false);
  });
  it("finds the ChatGPT card and Full access through the page's search", async () => {
    const h = await setup();
    const document = h.authority.read();
    const index = settingsSearchIndex(buildSettingsNav(document), document);
    assert.ok(searchSettings(index, "ChatGPT").some(result => result.entry.id === "general" && result.target === "chatgpt.account"));
    assert.ok(searchSettings(index, "Full access").some(result => result.entry.id === "general" && result.target === "assistant.fullAccess"));
  });
  it("saves each switch through the served setting and shows the saved value after a reload of the data", async () => {
    const h = await setup();
    let saved = 0;
    for (const path of ["preferences.preventSleepWhileRunning", "preferences.notifications.needsYou", "preferences.notifications.failures"]) {
      const input = h.host.querySelector<HTMLElement>(`[data-settings-path="${path}"] [role="switch"], [data-settings-path="${path}"] input[type="checkbox"]`);
      assert.ok(input, path);
      await settingsAction(() => input.click());
      await settingsAction(() => h.controller().submit());
      assert.equal(h.controller().save.state, "idle", path);
      assert.equal(h.notices.length, ++saved, path);
      assert.match(h.notices.at(-1)?.title ?? "", /^Saved /u, path);
      assert.deepEqual(h.problems, [], path);
      assert.equal(leafValue(h.authority, path), false, path);
      await settingsAction(() => { void h.controller().reload(); });
      const reread = h.host.querySelector(`[data-settings-path="${path}"] [role="switch"], [data-settings-path="${path}"] input[type="checkbox"]`);
      assert.ok(reread?.getAttribute("aria-checked") === "false" || (reread as HTMLInputElement).checked === false, path);
    }
  });
  it("saves each choice row through the served setting", async () => {
    const h = await setup();
    let saved = 0;
    for (const [path, value] of [["preferences.confirmCloseDuringRun", "never"], ["preferences.notifications.runFinished", "always"], ["preferences.notifications.sound", "none"]] as const) {
      const trigger = h.host.querySelector(`[data-settings-path="${path}"] button[aria-label]`);
      assert.ok(trigger, path);
      await choose(trigger, value);
      await settingsAction(() => h.controller().submit());
      assert.equal(h.controller().save.state, "idle", path);
      assert.equal(h.notices.length, ++saved, path);
      assert.match(h.notices.at(-1)?.title ?? "", /^Saved /u, path);
      assert.deepEqual(h.problems, [], path);
      assert.equal(leafValue(h.authority, path), value, path);
      assert.equal(h.host.querySelector(`[data-settings-path="${path}"] button[aria-label]`)?.getAttribute("data-value"), value);
    }
  });
  it("carries no required marker on Job end date", async () => {
    const h = await setup();
    const row = h.host.querySelector('[data-settings-path^="annualDates."]');
    assert.ok(row);
    assert.doesNotMatch(row.textContent ?? "", /\(required\)|\*/u);
    assert.equal(row.querySelectorAll('[aria-required="true"], [required]').length, 0);
  });
  it("lets the page's search find the six rows", async () => {
    const h = await setup();
    const document = h.authority.read();
    const index = settingsSearchIndex(buildSettingsNav(document), document);
    for (const [path, label] of ROWS) {
      assert.ok(searchSettings(index, label).some(result => result.entry.id === "general" && result.target === path), label);
    }
  });
  it("shows a loading skeleton with exactly the headings the loaded page has", async () => {
    const h = await setup();
    const loaded = headings(h.host);
    const host = document.createElement("div"); const root = createRoot(host);
    try {
      act(() => root.render(createElement(SettingsSectionSkeleton, { section: "general" })));
      assert.deepEqual(headings(host), loaded);
    } finally { act(() => root.unmount()); }
  });
});
