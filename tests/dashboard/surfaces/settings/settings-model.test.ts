// @vitest-environment jsdom
import { MeasurementFreeResizeObserver } from "../../../support/helpers/settings-storage-doctor-fixtures.js";
import { default as assert_m0, default as assert_m1 } from "node:assert/strict";
import { act as act_m0, createElement as createElement_m0 } from "react";
import { createRoot as createRoot_m0, type Root as Root_m0 } from "react-dom/client";
import { afterEach as afterEach_m0, describe as describe_m0, describe as describe_m1, it as it_m0, it as it_m1 } from "vitest";
import type { DashboardClient as DashboardClient_m0 } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider as DashboardClientProvider_m0 } from "../../../../src/dashboard/state/client-context.js";
import { buildSettingsNav as buildSettingsNav_m0, buildSettingsNav as buildSettingsNav_m1, resolveSettingsSection as resolveSettingsSection_m0, resolveSettingsSection as resolveSettingsSection_m1 } from "../../../../src/dashboard/surfaces/settings/settings-model.js";
import { SettingsPage as SettingsPage_m0 } from "../../../../src/dashboard/surfaces/settings/settings.js";
import { SettingsSectionPrimitiveSchema as SettingsSectionPrimitiveSchema_m0, SettingsSectionPrimitiveSchema as SettingsSectionPrimitiveSchema_m1, StorageHealthSummaryWireSchema as StorageHealthSummaryWireSchema_m0 } from "../../../../src/models/dashboard/bootstrap.js";
import { SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID as SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID_m1 } from '../../../../src/models/dashboard/settings.js';
import { fixtureSettingsDocument as fixtureSettingsDocument_m0 } from "../../../parity/helpers/fixture-settings.js";
import assert_m2 from "node:assert/strict";
import { createElement as createElement_m2 } from "react";
import { renderToStaticMarkup as renderToStaticMarkup_m2 } from "react-dom/server";
import { describe as describe_m2, it as it_m2 } from "vitest";
import type { DashboardClient as DashboardClient_m2 } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider as DashboardClientProvider_m2 } from "../../../../src/dashboard/state/client-context.js";
import { DASHBOARD_MAIN_REGION_ID as DASHBOARD_MAIN_REGION_ID_m2, SETTINGS_GEAR_ID as SETTINGS_GEAR_ID_m2, SETTINGS_KEYBOARD_SECTION_ID as SETTINGS_KEYBOARD_SECTION_ID_m2, buildSettingsNav as buildSettingsNav_m2, resolveSettingsSection as resolveSettingsSection_m2, settingsCloseFocusTargetId as settingsCloseFocusTargetId_m2, type SettingsSection as SettingsSection_m2 } from "../../../../src/dashboard/surfaces/settings/settings-model.js";
import { SettingsPage as SettingsPage_m2 } from "../../../../src/dashboard/surfaces/settings/settings.js";
import { SettingsSectionPrimitiveSchema as SettingsSectionPrimitiveSchema_m2, StorageHealthSummaryWireSchema as StorageHealthSummaryWireSchema_m2 } from "../../../../src/models/dashboard/bootstrap.js";


{


Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);


Reflect.set(globalThis, "ResizeObserver", MeasurementFreeResizeObserver);

const STORAGE = StorageHealthSummaryWireSchema_m0.parse({
  authority: "healthy",
  backup: "current",
  checkedAt: "2026-08-26T17:00:00.000Z",
});
const servedStatusSections = SettingsSectionPrimitiveSchema_m0.array().parse([
  { id: "storage", label: "Storage checks", revision: 1 },
  { id: "workflow-capabilities", label: "Workflow capabilities", revision: 1 },
]);

let root: Root_m0 | undefined;
let host: HTMLElement | undefined;

const _afterEachFixture0 = () => {
  if (root !== undefined) act_m0(() => { root?.unmount(); });
  host?.remove();
  root = undefined;
  host = undefined;
};

async function mountFailedRead(section: string): Promise<HTMLElement> {
  const container = document.createElement("div");
  host = container;
  document.body.append(container);
  const client = {
    editableSettings: () => Promise.reject(new Error("read failed")),
    settingsFacts: () => Promise.reject(new Error("facts unavailable")),
  } as unknown as DashboardClient_m0;
  const element = createElement_m0(DashboardClientProvider_m0, {
    client,
    children: createElement_m0(SettingsPage_m0, { onClose: () => undefined,
      storage: STORAGE,
      sections: servedStatusSections,
      workflowLabels: new Map(),
      section,
      actorId: "local-operator",
      descriptorFingerprint: "a".repeat(64),
      preflight: [],
      onSection: () => undefined,
    }),
  });
  await act_m0(async () => {
    root = createRoot_m0(container);
    root.render(element);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  return container;
}

describe_m0("canonical Settings navigation", () => {
afterEach_m0(_afterEachFixture0);

  const document = fixtureSettingsDocument_m0();
  const groups = buildSettingsNav_m0(servedStatusSections, document);

  it_m0("serves the approved 10 pages under the five shared groups", () => {
    assert_m0.deepEqual(groups.map(group => [group.heading, group.entries.map(entry => entry.id)]), [
      ["Personal", ["general", "credentials"]],
      ["Advanced", ["paths", "routes"]],
      ["Data", ["spreadsheets", "explorer", "activity"]],
      ["Status", ["storage", "preflight"]],
      ["Help", ["keyboard"]],
    ]);
    assert_m0.equal(groups.flatMap(group => group.entries).length, 10);
  });

  it_m0("keeps the approved navigation while the editable settings projection is unavailable", () => {
    const unavailableGroups = buildSettingsNav_m0(servedStatusSections);
    assert_m0.deepEqual(unavailableGroups.map(group => [group.heading, group.entries.map(entry => entry.id)]), [
      ["Personal", ["general", "credentials"]],
      ["Advanced", ["paths", "routes"]],
      ["Data", ["spreadsheets", "explorer", "activity"]],
      ["Status", ["storage", "preflight"]],
      ["Help", ["keyboard"]],
    ]);
    assert_m0.ok(unavailableGroups[0]?.entries.every(entry => entry.source === "client"));
    const credentials = resolveSettingsSection_m0(unavailableGroups, "credentials");
    assert_m0.equal(credentials.state, "open");
  });

  it_m0("folds legacy section URLs to their new page and keeps unknown requests explicit", () => {
    for (const [legacy, canonical] of [
      ["display", "general"], ["annual-dates", "general"], ["runtime-isolation", "paths"],
      ["providers", "general"], ["provider-env", "general"], ["protected-store", "credentials"],
    ] as const) {
      const resolved = resolveSettingsSection_m0(groups, legacy);
      assert_m0.equal(resolved.state, "open");
      if (resolved.state === "open") assert_m0.equal(resolved.entry.id, canonical);
    }
    assert_m0.deepEqual(resolveSettingsSection_m0(groups, "ui-catalog"), { state: "unknown", requested: "ui-catalog" });
    assert_m0.deepEqual(resolveSettingsSection_m0(groups, "observed-host"), { state: "unknown", requested: "observed-host" });
  });

  it_m0("shows the read refusal without hiding tabs while an independent page is open", async () => {
    const page = await mountFailedRead("keyboard");
    assert_m0.equal(page.querySelectorAll('a[href^="?settings="]').length, 10);
    assert_m0.ok(page.textContent?.includes("Editable settings unavailable"), page.textContent ?? "");
    assert_m0.ok(page.textContent?.includes("Settings could not be read."), page.textContent ?? "");
    assert_m0.ok([...page.querySelectorAll("button")].some(button => button.textContent?.includes("Try again")));
  });

  it_m0("reports a credential read failure instead of leaving its loading spinner", async () => {
    const page = await mountFailedRead("credentials");
    assert_m0.ok(page.textContent?.includes("Credentials unavailable"), page.textContent ?? "");
    assert_m0.ok(page.textContent?.includes("Settings could not be read."), page.textContent ?? "");
    assert_m0.ok([...page.querySelectorAll("button")].some(button => button.textContent?.includes("Try again")));
    assert_m0.ok(!page.textContent?.includes("Reading settings authorities"), page.textContent ?? "");
  });

  it_m0("names the retired Archive destination without hiding a stored-data failure or rendering Archive", async () => {
    const page = await mountFailedRead("archive");
    assert_m0.match(page.textContent ?? "", /Archive page removed/u);
    assert_m0.match(page.textContent ?? "", /Existing stored run data has not been deleted/u);
    assert_m0.match(page.textContent ?? "", /Editable settings unavailable/u);
    assert_m0.equal(page.querySelector('a[href="?settings=archive"]'), null);
    assert_m0.equal(page.querySelector('[aria-label="Archive"]'), null);
  });

  it_m0("reports unavailable field search when the catalog read fails instead of claiming no matches", async () => {
    const page = await mountFailedRead("keyboard");
    const search = page.querySelector<HTMLInputElement>('input[aria-label="Search settings"]');
    assert_m0.ok(search);
    await act_m0(async () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter === undefined) throw new Error("input setter unavailable");
      Reflect.apply(setter, search, ["backoff"]);
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert_m0.ok(page.textContent?.includes("Settings fields unavailable"));
    assert_m0.ok(!page.textContent?.includes("No settings found"));
  });
});
}

{


describe_m1('Relay presentation models', () => {
  it_m1('moves Spreadsheets into Data and resolves old capability links to Preflight', () => {
    const groups = buildSettingsNav_m1([SettingsSectionPrimitiveSchema_m1.parse({ id: SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID_m1, label: 'Workflow capabilities', revision: 1 })]);
    assert_m1(!groups.find(group => group.id === 'personal')?.entries.some(entry => entry.id === 'spreadsheets'));
    assert_m1(groups.find(group => group.id === 'data')?.entries.some(entry => entry.id === 'spreadsheets'));
    assert_m1(!groups.flatMap(group => group.entries).some(entry => entry.id === SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID_m1));
    const resolved = resolveSettingsSection_m1(groups, SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID_m1);
    assert_m1.equal(resolved.state, 'open'); if (resolved.state === 'open') assert_m1.equal(resolved.entry.id, 'preflight');
  });
});
}

{


/** Parsed, so a case cannot express a section the bootstrap would refuse. */
function section(id: string, label: string): SettingsSection_m2 {
  return SettingsSectionPrimitiveSchema_m2.parse({ id, label, revision: 1 });
}

const STORAGE = section("storage", "Storage checks");
const HEALTHY_STORAGE = StorageHealthSummaryWireSchema_m2.parse({
  authority: "healthy",
  backup: "current",
  checkedAt: "2026-08-26T16:00:00.000Z",
});
const STATIC_SETTINGS_CLIENT = {} as DashboardClient_m2;

describe_m2("the settings page's nav", () => {
  it_m2("puts every served section under Status and always offers the Help keyboard entry", () => {
    const groups = buildSettingsNav_m2([STORAGE]);
    assert_m2.deepEqual(groups.map((group) => group.heading), ["Personal", "Advanced", "Data", "Status", "Help"]);
    assert_m2.deepEqual(groups.find(group => group.id === "status")?.entries.map((entry) => entry.id), ["storage", "preflight"]);
    assert_m2.equal(groups.find(group => group.id === "status")?.entries[0]?.source, "served");
    assert_m2.equal(groups.find(group => group.id === "status")?.entries[1]?.source, "client");
    assert_m2.deepEqual(
      groups.find(group => group.id === "help")?.entries.map((entry) => entry.id),
      [SETTINGS_KEYBOARD_SECTION_ID_m2],
    );

    assert_m2.deepEqual(groups.find(group => group.id === "help")?.entries.map((entry) => entry.source), ["client"]);
  });

  it_m2("keeps Preflight available when no status section is served", () => {
    const groups = buildSettingsNav_m2([]);
    assert_m2.deepEqual(groups.map((group) => group.heading), ["Personal", "Advanced", "Data", "Status", "Help"]);
    assert_m2.deepEqual(groups.find(group => group.id === "status")?.entries.map((entry) => entry.id), ["preflight"]);
  });

  it_m2("gives a served section this build cannot render its own glyph", () => {
    const groups = buildSettingsNav_m2([STORAGE, section("budgets", "Budgets")]);
    assert_m2.deepEqual(groups.find(group => group.id === "status")?.entries.map((entry) => entry.icon), ["storage", "preflight", "unrendered"]);
  });
});

describe_m2("which section a link opens", () => {
  const groups = buildSettingsNav_m2([STORAGE]);

  it_m2("opens the first entry on the empty value", () => {
    const resolved = resolveSettingsSection_m2(groups, "");
    assert_m2.equal(resolved.state, "open");
    assert_m2.equal(resolved.state === "open" ? resolved.entry.id : undefined, "general");
  });

  it_m2("opens the named entry — this is the Help → Keyboard destination", () => {
    const resolved = resolveSettingsSection_m2(groups, SETTINGS_KEYBOARD_SECTION_ID_m2);
    assert_m2.equal(resolved.state, "open");
    assert_m2.equal(resolved.state === "open" ? resolved.entry.label : undefined, "Keyboard");
  });

  it_m2("REFUSES to fall back to the first entry for a section it does not have", () => {
    const resolved = resolveSettingsSection_m2(groups, "budgets");
    assert_m2.equal(resolved.state, "unknown");

    assert_m2.equal(resolved.state === "unknown" ? resolved.requested : undefined, "budgets");
  });

  it_m2("says so when there is nothing at all to open", () => {
    assert_m2.equal(resolveSettingsSection_m2([{ id: "status", heading: "Status", entries: [] }], "").state, "empty");
  });
});

describe_m2("focus on close (unit F4b finding 1)", () => {
  it_m2("prefers the gear that opened the page", () => {
    assert_m2.equal(settingsCloseFocusTargetId_m2(true), SETTINGS_GEAR_ID_m2);
  });

  it_m2("falls back to the main region the takeover was covering, when the gear is gone", () => {

    assert_m2.equal(settingsCloseFocusTargetId_m2(false), DASHBOARD_MAIN_REGION_ID_m2);
  });

  it_m2("the two targets are distinct ids — a collision would make this fold meaningless", () => {
    assert_m2.notEqual(SETTINGS_GEAR_ID_m2, DASHBOARD_MAIN_REGION_ID_m2);
  });
});

describe_m2("the settings nav renders real navigation, not buttons (unit F4b finding 4)", () => {
  const markup = renderToStaticMarkup_m2(createElement_m2(DashboardClientProvider_m2, {
    client: STATIC_SETTINGS_CLIENT,
    children: createElement_m2(SettingsPage_m2, { onClose: () => undefined,
      storage: HEALTHY_STORAGE,
      sections: [STORAGE],

    section: SETTINGS_KEYBOARD_SECTION_ID_m2,
    actorId: "local-operator",
    descriptorFingerprint: "a".repeat(64),
    preflight: [],
    // Capabilities is not the open section in any render here, so the join map
    // is empty rather than a fixture nothing reads.
    workflowLabels: new Map<string, string>(),
    onSection: () => undefined,
    }),
  }));

  it_m2("gives every nav entry a real, section-addressed href", () => {
    assert_m2.match(markup, /<a[^>]*href="\?settings=storage"[^>]*>/u);
    assert_m2.match(markup, new RegExp(`<a[^>]*href="\\?settings=${SETTINGS_KEYBOARD_SECTION_ID_m2}"[^>]*>`, "u"));
  });

  it_m2("keeps aria-current on the open entry and off the others", () => {
    const keyboardAnchor = new RegExp(
      `<a[^>]*href="\\?settings=${SETTINGS_KEYBOARD_SECTION_ID_m2}"[^>]*aria-current="page"[^>]*>`,
      "u",
    );
    assert_m2.match(markup, keyboardAnchor);
    const storageAnchor = /<a[^>]*href="\?settings=storage"[^>]*>/u.exec(markup)?.[0];
    assert_m2.ok(storageAnchor !== undefined, markup);
    assert_m2.ok(!storageAnchor.includes("aria-current"), storageAnchor);
  });
});
}
