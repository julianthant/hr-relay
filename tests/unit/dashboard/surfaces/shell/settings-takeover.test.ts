
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import {
  SettingsSectionPrimitiveSchema,
  StorageHealthSummaryWireSchema,
} from "../../../../../src/models/dashboard/bootstrap.js";
import { SettingsPage } from "../../../../../src/dashboard/surfaces/settings/settings.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { appVersionTag, fmtAppVersion } from "../../../../../src/dashboard/surfaces/shared/status/format.js";
import {
  activeTakeover,
  parseRoute,
  routeAdvancesHistory,
  routeToSearch,
  type AppRouteState,
} from "../../../../../src/dashboard/app/navigation/url-state.js";
import {
  DASHBOARD_MAIN_REGION_ID,
  SETTINGS_GEAR_ID,
  SETTINGS_KEYBOARD_SECTION_ID,
  buildSettingsNav,
  resolveSettingsSection,
  settingsCloseFocusTargetId,
  type SettingsSection,
} from "../../../../../src/dashboard/surfaces/settings/settings-model.js";

/** Parsed, so a case cannot express a section the bootstrap would refuse. */
function section(id: string, label: string): SettingsSection {
  return SettingsSectionPrimitiveSchema.parse({ id, label, revision: 1 });
}

const STORAGE = section("storage", "Storage checks");
const HEALTHY_STORAGE = StorageHealthSummaryWireSchema.parse({
  authority: "healthy",
  backup: "current",
  checkedAt: "2026-08-26T16:00:00.000Z",
});
const STATIC_SETTINGS_CLIENT = {} as DashboardClient;

describe("the settings route", () => {
  it("carries an EMPTY value, because that is the page's first section", () => {
    const route = parseRoute("?settings=");
    assert.equal(route.settings, "");
    assert.equal(activeTakeover(route), "settings");
    // The round trip is the half that makes Back work: `?settings=` has to come
    // back out of `routeToSearch`, not be dropped as falsy.
    assert.equal(routeToSearch(route), "?settings=");
  });

  it("carries a named section both ways", () => {
    const route = parseRoute("?settings=keyboard");
    assert.equal(route.settings, SETTINGS_KEYBOARD_SECTION_ID);
    assert.equal(routeToSearch(route), "?settings=keyboard");
  });

  it("is absent when the key is absent, and then owns nothing", () => {
    const route = parseRoute("?day=2026-08-26");
    assert.equal(route.settings, undefined);
    assert.equal(activeTakeover(route), "none");
    assert.equal(routeToSearch(route), "?day=2026-08-26");
  });

  it("OUTRANKS every other takeover key", () => {

    const layered: AppRouteState = {
      start: false,
      settings: "",
      intake: "e1f2a3b4-0000-4000-8000-000000000001",
      archive: "",
      activity: "",
      explore: "person-lookup",
      catalog: "",
    };
    assert.equal(activeTakeover(layered), "settings");
    // and the ranking below it is unchanged
    const { settings: _dropped, ...withoutSettings } = layered;
    assert.equal(activeTakeover(withoutSettings), "intake");
  });
});

describe("the settings page's nav", () => {
  it("puts every served section under Status and always offers the Help keyboard entry", () => {
    const groups = buildSettingsNav([STORAGE]);
    assert.deepEqual(groups.map((group) => group.heading), ["Personal", "Advanced", "Data", "Status", "Help"]);
    assert.deepEqual(groups.find(group => group.id === "status")?.entries.map((entry) => entry.id), ["storage", "preflight"]);
    assert.equal(groups.find(group => group.id === "status")?.entries[0]?.source, "served");
    assert.equal(groups.find(group => group.id === "status")?.entries[1]?.source, "client");
    assert.deepEqual(
      groups.find(group => group.id === "help")?.entries.map((entry) => entry.id),
      [SETTINGS_KEYBOARD_SECTION_ID],
    );

    assert.deepEqual(groups.find(group => group.id === "help")?.entries.map((entry) => entry.source), ["client"]);
  });

  it("keeps Preflight available when no status section is served", () => {
    const groups = buildSettingsNav([]);
    assert.deepEqual(groups.map((group) => group.heading), ["Personal", "Advanced", "Data", "Status", "Help"]);
    assert.deepEqual(groups.find(group => group.id === "status")?.entries.map((entry) => entry.id), ["preflight"]);
  });

  it("gives a served section this build cannot render its own glyph", () => {
    const groups = buildSettingsNav([STORAGE, section("budgets", "Budgets")]);
    assert.deepEqual(groups.find(group => group.id === "status")?.entries.map((entry) => entry.icon), ["storage", "preflight", "unrendered"]);
  });
});

describe("which section a link opens", () => {
  const groups = buildSettingsNav([STORAGE]);

  it("opens the first entry on the empty value", () => {
    const resolved = resolveSettingsSection(groups, "");
    assert.equal(resolved.state, "open");
    assert.equal(resolved.state === "open" ? resolved.entry.id : undefined, "general");
  });

  it("opens the named entry — this is the Help → Keyboard destination", () => {
    const resolved = resolveSettingsSection(groups, SETTINGS_KEYBOARD_SECTION_ID);
    assert.equal(resolved.state, "open");
    assert.equal(resolved.state === "open" ? resolved.entry.label : undefined, "Keyboard");
  });

  it("REFUSES to fall back to the first entry for a section it does not have", () => {
    const resolved = resolveSettingsSection(groups, "budgets");
    assert.equal(resolved.state, "unknown");

    assert.equal(resolved.state === "unknown" ? resolved.requested : undefined, "budgets");
  });

  it("says so when there is nothing at all to open", () => {
    assert.equal(resolveSettingsSection([{ id: "status", heading: "Status", entries: [] }], "").state, "empty");
  });
});

describe("focus on close (unit F4b finding 1)", () => {
  it("prefers the gear that opened the page", () => {
    assert.equal(settingsCloseFocusTargetId(true), SETTINGS_GEAR_ID);
  });

  it("falls back to the main region the takeover was covering, when the gear is gone", () => {

    assert.equal(settingsCloseFocusTargetId(false), DASHBOARD_MAIN_REGION_ID);
  });

  it("the two targets are distinct ids — a collision would make this fold meaningless", () => {
    assert.notEqual(SETTINGS_GEAR_ID, DASHBOARD_MAIN_REGION_ID);
  });
});

describe("history push on re-press (unit F4b finding 2)", () => {
  const base: AppRouteState = {
    start: false,
    settings: "",
    intake: undefined,
    archive: undefined,
    activity: undefined,
    explore: undefined,
    catalog: undefined,
  };

  it("does NOT advance history when the next route serialises to the current search", () => {

    assert.equal(routeAdvancesHistory(base, routeToSearch(base)), false);
  });

  it("DOES advance history when the next route is a different place", () => {
    const toKeyboard: AppRouteState = { ...base, settings: SETTINGS_KEYBOARD_SECTION_ID };
    assert.equal(routeAdvancesHistory(toKeyboard, routeToSearch(base)), true);
  });

  it("advances on the very first navigation, from an unrelated current search", () => {
    assert.equal(routeAdvancesHistory(base, "?day=2026-08-26"), true);
  });
});

describe("the settings nav renders real navigation, not buttons (unit F4b finding 4)", () => {
  const markup = renderToStaticMarkup(createElement(DashboardClientProvider, {
    client: STATIC_SETTINGS_CLIENT,
    children: createElement(SettingsPage, { onClose: () => undefined,
      storage: HEALTHY_STORAGE,
      sections: [STORAGE],

    section: SETTINGS_KEYBOARD_SECTION_ID,
    actorId: "local-operator",
    descriptorFingerprint: "a".repeat(64),
    preflight: [],
    // Capabilities is not the open section in any render here, so the join map
    // is empty rather than a fixture nothing reads.
    workflowLabels: new Map<string, string>(),
    onSection: () => undefined,
    }),
  }));

  it("gives every nav entry a real, section-addressed href", () => {
    assert.match(markup, /<a[^>]*href="\?settings=storage"[^>]*>/u);
    assert.match(markup, new RegExp(`<a[^>]*href="\\?settings=${SETTINGS_KEYBOARD_SECTION_ID}"[^>]*>`, "u"));
  });

  it("keeps aria-current on the open entry and off the others", () => {
    const keyboardAnchor = new RegExp(
      `<a[^>]*href="\\?settings=${SETTINGS_KEYBOARD_SECTION_ID}"[^>]*aria-current="page"[^>]*>`,
      "u",
    );
    assert.match(markup, keyboardAnchor);
    const storageAnchor = /<a[^>]*href="\?settings=storage"[^>]*>/u.exec(markup)?.[0];
    assert.ok(storageAnchor !== undefined, markup);
    assert.ok(!storageAnchor.includes("aria-current"), storageAnchor);
  });

  it("renders no plain <button> for a nav entry any more", () => {
    // The defect this replaces: a `button` has no href, so middle-click,
    // Cmd/Ctrl-click and "open in new tab" all silently did nothing.
    assert.ok(!/<button[^>]*aria-current/u.test(markup), markup);
  });
});

describe("curly quotes around a section name (unit F4b finding 3)", () => {
  it("quotes the requested-but-unknown section name with curly quotes, not &quot;", () => {
    const groups = buildSettingsNav([STORAGE]);
    const resolution = resolveSettingsSection(groups, "budgets");
    assert.equal(resolution.state, "unknown");
    const markup = renderToStaticMarkup(createElement(DashboardClientProvider, {
      client: STATIC_SETTINGS_CLIENT,
      children: createElement(SettingsPage, { onClose: () => undefined,
        storage: HEALTHY_STORAGE,
        sections: [STORAGE],
      section: "budgets",
      actorId: "local-operator",
      descriptorFingerprint: "a".repeat(64),
      preflight: [],
      workflowLabels: new Map<string, string>(),
      onSection: () => undefined,
      }),
    }));
    assert.match(markup, /called “budgets”\./u);
    assert.ok(!markup.includes("&quot;budgets&quot;"), markup);
  });

  it("quotes an unrendered served section's id with curly quotes, not &quot;", () => {
    const markup = renderToStaticMarkup(createElement(DashboardClientProvider, {
      client: STATIC_SETTINGS_CLIENT,
      children: createElement(SettingsPage, { onClose: () => undefined,
        storage: HEALTHY_STORAGE,
        sections: [STORAGE, section("budgets", "Budgets")],
      section: "budgets",
      actorId: "local-operator",
      descriptorFingerprint: "a".repeat(64),
      preflight: [],
      workflowLabels: new Map<string, string>(),
      onSection: () => undefined,
      }),
    }));
    assert.match(markup, /“budgets”/u);
    assert.ok(!markup.includes("&quot;budgets&quot;"), markup);
  });
});

describe("app version tag", () => {
  it("prints the two components the tooltip beside it explains", () => {
    assert.equal(fmtAppVersion("0.1.0"), "0.1");
    assert.equal(appVersionTag("0.1.0"), "app 0.1");
    assert.equal(appVersionTag("12.34.56-rc.1"), "app 12.34");
    // A served two-part version is already the tag.
    assert.equal(appVersionTag("3.1"), "app 3.1");
  });

  it("THROWS on a shape it does not recognise rather than printing the raw string", () => {
    // The arm a `?? appVersion` fallback would delete: a wrong version drawn
    // beside a right-sounding sentence is worse than a loud failure.
    for (const bad of ["", "1", "v1.2", "1.x", "one.two", ".1"]) {
      assert.throws(() => fmtAppVersion(bad), /is not MAJOR\.MINOR/u, `expected "${bad}" to be refused`);
    }
  });
});
