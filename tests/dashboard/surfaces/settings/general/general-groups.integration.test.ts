// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach,describe,it,vi } from "vitest";
import { SettingsSectionSkeleton } from "../../../../../src/dashboard/surfaces/settings/settings-loading.js";
import { searchSettings,settingsSearchIndex } from "../../../../../src/dashboard/surfaces/settings/navigation/settings-search-model.js";
import { buildSettingsNav } from "../../../../../src/dashboard/surfaces/settings/settings-model.js";
import { mountSettingsHarness,settingsAction,syntheticSettingsAuthority } from "../../../../support/helpers/dashboard/settings-harness.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function setup() {
  const authority = await syntheticSettingsAuthority(); cleanups.push(authority.close);
  const mounted = await mountSettingsHarness(authority, "general"); cleanups.push(mounted.close); return { ...mounted, authority };
}
const headings = (host: ParentNode) => [...host.querySelectorAll(".ds-body-section-heading")].map(heading => heading.firstChild?.textContent);
const ROWS = [
  ["preferences.preventSleepWhileRunning", "Prevent sleep while running", "Keep this Mac awake while a run is going."],
  ["preferences.confirmCloseDuringRun", "Confirm before closing during a run", "Warn before Relay closes while a run is going."],
  ["preferences.notifications.runFinished", "Run finished", "Set when Relay alerts you that a run has finished."],
  ["preferences.notifications.needsYou", "Needs you", "Alert when a run is waiting for you."],
  ["preferences.notifications.failures", "Failures", "Alert when a run fails."],
  ["preferences.notifications.sound", "Notification sound", "Sound for finished runs, failures and runs that need you."],
] as const;
const leafValue = (authority: Awaited<ReturnType<typeof syntheticSettingsAuthority>>, path: string) => authority.read().sections.flatMap(section => section.leaves).find(leaf => leaf.path === path)?.effectiveValue;
async function choose(trigger: Element, value: string): Promise<void> {
  await settingsAction(() => (trigger as HTMLElement).click());
  const option = [...document.querySelectorAll<HTMLElement>(`[role="option"][data-value="${value}"]`)].at(-1);
  assert.ok(option);
  await settingsAction(() => option.click());
}

describe("Settings > General groups", () => {
  it("draws General, Runs and Notifications with the six rows in the mock's order, labels and descriptions", async () => {
    const h = await setup();
    assert.deepEqual(headings(h.host), ["General", "Runs", "Notifications"]);
    const rows = [...h.host.querySelectorAll('[data-settings-path^="preferences."]')];
    assert.deepEqual(rows.map(row => row.getAttribute("data-settings-path")), ROWS.map(row => row[0]));
    rows.forEach((row, index) => { assert.ok(row.textContent?.includes(ROWS[index]![1]), ROWS[index]![1]); assert.ok(row.textContent?.includes(ROWS[index]![2]), ROWS[index]![2]); });
    const sectionOf = (row: Element) => { let node: Element | null = row; while (node !== null && node.querySelector(".ds-body-section-heading") === null) node = node.parentElement; return node?.querySelector(".ds-body-section-heading")?.firstChild?.textContent; };
    assert.deepEqual(rows.map(sectionOf), ["Runs", "Runs", "Notifications", "Notifications", "Notifications", "Notifications"]);
  });
  it("saves each switch through the served setting and shows the saved value after a reload of the data", async () => {
    const h = await setup();
    for (const path of ["preferences.preventSleepWhileRunning", "preferences.notifications.needsYou", "preferences.notifications.failures"]) {
      const input = h.host.querySelector<HTMLElement>(`[data-settings-path="${path}"] [role="switch"], [data-settings-path="${path}"] input[type="checkbox"]`);
      assert.ok(input, path);
      await settingsAction(() => input.click());
      await settingsAction(() => h.controller().submit());
      assert.equal(h.controller().save.state, "applied", path);
      assert.equal(leafValue(h.authority, path), false, path);
      await settingsAction(() => { void h.controller().reload(); });
      const reread = h.host.querySelector(`[data-settings-path="${path}"] [role="switch"], [data-settings-path="${path}"] input[type="checkbox"]`);
      assert.ok(reread?.getAttribute("aria-checked") === "false" || (reread as HTMLInputElement).checked === false, path);
    }
  });
  it("saves each choice row through the served setting", async () => {
    const h = await setup();
    for (const [path, value] of [["preferences.confirmCloseDuringRun", "never"], ["preferences.notifications.runFinished", "always"], ["preferences.notifications.sound", "none"]] as const) {
      const trigger = h.host.querySelector(`[data-settings-path="${path}"] button[aria-label]`);
      assert.ok(trigger, path);
      await choose(trigger, value);
      await settingsAction(() => h.controller().submit());
      assert.equal(h.controller().save.state, "applied", path);
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
    vi.useFakeTimers();
    const host = document.createElement("div"); const root = createRoot(host);
    try {
      act(() => root.render(createElement(SettingsSectionSkeleton, { section: "general" })));
      act(() => { vi.advanceTimersByTime(150); });
      assert.deepEqual(headings(host), loaded);
    } finally { act(() => root.unmount()); }
  });
});
