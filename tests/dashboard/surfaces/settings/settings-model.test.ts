// @vitest-environment jsdom
import { MeasurementFreeResizeObserver } from "../../../support/helpers/settings-storage-doctor-fixtures.js";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, it } from "vitest";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { DASHBOARD_MAIN_REGION_ID, SETTINGS_GEAR_ID, SETTINGS_KEYBOARD_SECTION_ID, buildSettingsNav, resolveSettingsSection, settingsCloseFocusTargetId } from "../../../../src/dashboard/surfaces/settings/settings-model.js";
import { SettingsPage } from "../../../../src/dashboard/surfaces/settings/settings.js";
import { SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID } from "../../../../src/models/dashboard/settings.js";
import { fixtureSettingsDocument } from "../../../mocks/helpers/fixture-settings.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", MeasurementFreeResizeObserver);

const APPROVED_NAV = [
  ["Personal", ["general", "account", "subscription"]],
  ["Data", ["spreadsheets", "explorer", "activity"]],
  ["Help", ["keyboard"]],
];
const navOf = (groups: ReturnType<typeof buildSettingsNav>) => groups.map(group => [group.heading, group.entries.map(entry => entry.id)]);

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  if (root !== undefined) act(() => { root?.unmount(); });
  host?.remove();
  root = undefined;
  host = undefined;
});

async function mountFailedRead(section: string): Promise<HTMLElement> {
  const container = document.createElement("div");
  host = container;
  document.body.append(container);
  const client = {
    editableSettings: () => Promise.reject(new Error("read failed")),
    settingsFacts: () => Promise.reject(new Error("facts unavailable")),
  } as unknown as DashboardClient;
  const element = createElement(DashboardClientProvider, {
    client,
    children: createElement(SettingsPage, { profileName: "Synthetic Operator", onClose: () => undefined,
      section,
      actorId: "local-operator",
      descriptorFingerprint: "a".repeat(64),
      onSection: () => undefined,
    }),
  });
  await act(async () => {
    root = createRoot(container);
    root.render(element);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  return container;
}

describe("canonical Settings navigation", () => {
  it("serves Personal, Data and Help while the editable settings projection is unavailable", () => {
    const groups = buildSettingsNav();
    assert.deepEqual(navOf(groups), APPROVED_NAV);
    assert.ok(groups.flatMap(group => group.entries).every(entry => entry.source === "client"));
  });

  it("keeps the same pages once the projection loads", () => {
    assert.deepEqual(navOf(buildSettingsNav(fixtureSettingsDocument())), APPROVED_NAV);
  });

  it("moves Spreadsheets into Data and has no Status group", () => {
    const groups = buildSettingsNav();
    assert.ok(!groups.find(group => group.id === "personal")?.entries.some(entry => entry.id === "spreadsheets"));
    assert.ok(groups.find(group => group.id === "data")?.entries.some(entry => entry.id === "spreadsheets"));
    assert.ok(!groups.some(group => group.id === "status"));
  });

  it("folds legacy section URLs to their new page and keeps unknown requests explicit", () => {
    const groups = buildSettingsNav();
    for (const [legacy, canonical] of [
      ["display", "general"], ["annual-dates", "general"], ["runtime-isolation", "general"],
      ["paths", "general"], ["routes", "general"], ["storage", "general"], ["preflight", "general"],
      [SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, "general"],
      ["providers", "general"], ["provider-env", "general"], ["protected-store", "account"], ["credentials", "account"],
    ] as const) {
      const resolved = resolveSettingsSection(groups, legacy);
      assert.equal(resolved.state, "open", legacy);
      if (resolved.state === "open") assert.equal(resolved.entry.id, canonical, legacy);
    }
    assert.deepEqual(resolveSettingsSection(groups, "ui-catalog"), { state: "unknown", requested: "ui-catalog" });
    assert.deepEqual(resolveSettingsSection(groups, "observed-host"), { state: "unknown", requested: "observed-host" });
  });

  it("opens the first entry on the empty value and the named entry otherwise", () => {
    const groups = buildSettingsNav();
    const first = resolveSettingsSection(groups, "");
    assert.equal(first.state === "open" ? first.entry.id : undefined, "general");
    const keyboard = resolveSettingsSection(groups, SETTINGS_KEYBOARD_SECTION_ID);
    assert.equal(keyboard.state === "open" ? keyboard.entry.label : undefined, "Keyboard");
  });

  it("refuses to fall back to the first entry for a section it does not have", () => {
    const resolved = resolveSettingsSection(buildSettingsNav(), "budgets");
    assert.deepEqual(resolved, { state: "unknown", requested: "budgets" });
  });

  it("says so when there is nothing at all to open", () => {
    assert.equal(resolveSettingsSection([{ id: "help", heading: "Help", entries: [] }], "").state, "empty");
  });

  it("shows the read refusal without hiding tabs while an independent page is open", async () => {
    const page = await mountFailedRead("keyboard");
    assert.equal(page.querySelectorAll('a[href^="?settings="]').length, 7);
    assert.ok(page.textContent?.includes("Settings unavailable"), page.textContent ?? "");
    assert.ok(page.textContent?.includes("Settings could not be read."), page.textContent ?? "");
    assert.ok(page.textContent?.includes("Reopen Settings to try again."), page.textContent ?? "");
    assert.ok(![...page.querySelectorAll("button")].some(button => button.textContent?.includes("Try again")));
  });

  it("reports a credential read failure instead of leaving its loading spinner", async () => {
    const page = await mountFailedRead("credentials");
    assert.ok(page.textContent?.includes("Credentials unavailable"), page.textContent ?? "");
    assert.ok(page.textContent?.includes("Settings could not be read."), page.textContent ?? "");
    assert.ok(page.textContent?.includes("Reopen Settings to try again."), page.textContent ?? "");
    assert.ok(![...page.querySelectorAll("button")].some(button => button.textContent?.includes("Try again")));
    assert.ok(!page.textContent?.includes("Reading settings authorities"), page.textContent ?? "");
  });

  it("names the retired Archive destination without hiding a stored-data failure or rendering Archive", async () => {
    const page = await mountFailedRead("archive");
    assert.match(page.textContent ?? "", /Archive page removed/u);
    assert.match(page.textContent ?? "", /Existing stored run data has not been deleted/u);
    assert.match(page.textContent ?? "", /Settings unavailable/u);
    assert.equal(page.querySelector('a[href="?settings=archive"]'), null);
    assert.equal(page.querySelector('[aria-label="Archive"]'), null);
  });

  it("reports unavailable field search when the catalog read fails instead of claiming no matches", async () => {
    const page = await mountFailedRead("keyboard");
    const search = page.querySelector<HTMLInputElement>('input[aria-label="Search settings"]');
    assert.ok(search);
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter === undefined) throw new Error("input setter unavailable");
      Reflect.apply(setter, search, ["backoff"]);
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.ok(page.textContent?.includes("Settings fields unavailable"));
    assert.ok(!page.textContent?.includes("No settings found"));
  });
});

describe("focus on close", () => {
  it("prefers the gear that opened the page", () => {
    assert.equal(settingsCloseFocusTargetId(true), SETTINGS_GEAR_ID);
  });

  it("falls back to the main region the takeover was covering, when the gear is gone", () => {
    assert.equal(settingsCloseFocusTargetId(false), DASHBOARD_MAIN_REGION_ID);
  });

  it("the two targets are distinct ids", () => {
    assert.notEqual(SETTINGS_GEAR_ID, DASHBOARD_MAIN_REGION_ID);
  });
});

describe("the settings nav renders real navigation, not buttons", () => {
  const markup = renderToStaticMarkup(createElement(DashboardClientProvider, {
    client: {} as DashboardClient,
    children: createElement(SettingsPage, { profileName: "Synthetic Operator", onClose: () => undefined,
      section: SETTINGS_KEYBOARD_SECTION_ID,
      actorId: "local-operator",
      descriptorFingerprint: "a".repeat(64),
      onSection: () => undefined,
    }),
  }));

  it("gives every nav entry a real, section-addressed href", () => {
    assert.match(markup, /<a[^>]*href="\?settings=general"[^>]*>/u);
    assert.match(markup, new RegExp(`<a[^>]*href="\\?settings=${SETTINGS_KEYBOARD_SECTION_ID}"[^>]*>`, "u"));
    assert.doesNotMatch(markup, /href="\?settings=(storage|preflight|paths|routes)"/u);
  });

  it("keeps aria-current on the open entry and off the others", () => {
    assert.match(markup, new RegExp(`<a[^>]*href="\\?settings=${SETTINGS_KEYBOARD_SECTION_ID}"[^>]*aria-current="page"[^>]*>`, "u"));
    const generalAnchor = /<a[^>]*href="\?settings=general"[^>]*>/u.exec(markup)?.[0];
    assert.ok(generalAnchor !== undefined, markup);
    assert.ok(!generalAnchor.includes("aria-current"), generalAnchor);
  });
});
