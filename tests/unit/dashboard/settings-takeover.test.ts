/**
 * SETTINGS AS A PLACE, and the two shell strings D272 item 4 corrected.
 *
 * D272 item 1 / D274 item 5 turned Settings from a `Dialog` into a routed
 * full-page takeover. Three claims are worth pinning, and none of them can fail
 * by accident:
 *
 *  - the route SURVIVES the query string in both directions, including the
 *    empty value that means "the page's first section" — a key that parsed but
 *    did not serialise would make the browser's Back button return to a URL the
 *    app cannot re-open;
 *  - `settings` OUTRANKS every other takeover key, because the storage band's
 *    door is mounted above the takeover switch and would otherwise change the
 *    URL without changing the screen;
 *  - a `?settings=` value this build has no section for resolves to `unknown`
 *    rather than to the first entry. That is the fail-loud half: a silent
 *    fallback here shows the operator Storage under a link that says something
 *    else, and nothing on the page would say so.
 *
 * The two copy fixes are pinned at their two levels. `fmtAppVersion` is a pure
 * fold, so it is called directly — including the throw, which is the arm a
 * "helpful" `?? appVersion` would delete. The worker sentence is JSX across
 * three text nodes with no fold to test, so the real `SessionPanel` is rendered
 * to static markup at a count of ONE — the exact count the old `plural` got
 * wrong and the only one that can tell the two spellings apart.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { SettingsSectionPrimitiveSchema } from "../../../src/domain/dashboard/bootstrap.js";
import { WorkerCardWireSchema } from "../../../src/domain/dashboard/projection.js";
import { SessionPanel } from "../../../src/dashboard/surfaces/shell.js";
import { appVersionTag, fmtAppVersion } from "../../../src/dashboard/surfaces/format.js";
import {
  activeTakeover,
  parseRoute,
  routeToSearch,
  type AppRouteState,
} from "../../../src/dashboard/app/url-state.js";
import {
  SETTINGS_KEYBOARD_SECTION_ID,
  buildSettingsNav,
  resolveSettingsSection,
  type SettingsSection,
} from "../../../src/dashboard/surfaces/settings-model.js";

/** Parsed, so a case cannot express a section the bootstrap would refuse. */
function section(id: string, label: string): SettingsSection {
  return SettingsSectionPrimitiveSchema.parse({ id, label, revision: 1 });
}

const STORAGE = section("storage", "Storage");

describe("the settings route (D272 item 1)", () => {
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
    // The storage band's `Storage health` is mounted above the takeover switch,
    // so it is pressed from inside whatever is already open. If any key below
    // won, that door would move the URL and leave the screen where it was.
    const layered: AppRouteState = {
      start: false,
      settings: "",
      intake: "new",
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

describe("the settings page's nav (D274 item 5)", () => {
  it("puts every served section under Status and always offers Help → Keyboard", () => {
    const groups = buildSettingsNav([STORAGE]);
    assert.deepEqual(groups.map((group) => group.heading), ["Status", "Help"]);
    assert.deepEqual(groups[0]?.entries.map((entry) => entry.id), ["storage"]);
    assert.equal(groups[0]?.entries[0]?.source, "served");
    assert.deepEqual(groups[1]?.entries.map((entry) => entry.id), [SETTINGS_KEYBOARD_SECTION_ID]);
    // The keyboard legend is a fact about THIS bundle's bindings, so it is not
    // a served section and must never be counted as one.
    assert.equal(groups[1]?.entries[0]?.source, "client");
  });

  it("draws no Status heading over an empty list, and Help still stands", () => {
    const groups = buildSettingsNav([]);
    assert.deepEqual(groups.map((group) => group.heading), ["Help"]);
  });

  it("gives a served section this build cannot render its own glyph", () => {
    const groups = buildSettingsNav([STORAGE, section("budgets", "Budgets")]);
    assert.deepEqual(groups[0]?.entries.map((entry) => entry.icon), ["storage", "unrendered"]);
  });
});

describe("which section a link opens (D274 item 5)", () => {
  const groups = buildSettingsNav([STORAGE]);

  it("opens the first entry on the empty value", () => {
    const resolved = resolveSettingsSection(groups, "");
    assert.equal(resolved.state, "open");
    assert.equal(resolved.state === "open" ? resolved.entry.id : undefined, "storage");
  });

  it("opens the named entry — this is the Help → Keyboard destination", () => {
    const resolved = resolveSettingsSection(groups, SETTINGS_KEYBOARD_SECTION_ID);
    assert.equal(resolved.state, "open");
    assert.equal(resolved.state === "open" ? resolved.entry.label : undefined, "Keyboard");
  });

  it("REFUSES to fall back to the first entry for a section it does not have", () => {
    const resolved = resolveSettingsSection(groups, "budgets");
    assert.equal(resolved.state, "unknown");
    // The requested name survives, because the page says it back. Resolving to
    // `storage` here would show the operator a page their link did not ask for
    // with nothing on screen admitting the substitution.
    assert.equal(resolved.state === "unknown" ? resolved.requested : undefined, "budgets");
  });

  it("says so when there is nothing at all to open", () => {
    assert.equal(resolveSettingsSection([{ heading: "Status", entries: [] }], "").state, "empty");
  });
});

describe("the app version tag (D272 item 4, ledger row A126)", () => {
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

/** One `failed` card — the only state that lights the attention chip (D248). */
function failedCard(seed: number): ReturnType<typeof WorkerCardWireSchema.parse> {
  return WorkerCardWireSchema.parse({
    workerId: `person-lookup-worker-${String(seed)}`,
    workflowId: "person-lookup",
    state: "failed",
    directive: "run",
    startedAt: "2026-08-26T16:00:00.000Z",
    endedAt: "2026-08-26T16:05:00.000Z",
    stopReason: "crashed",
    currentRun: { state: "absent", reason: "the lease settled with no run claimed" },
    browsers: [],
    leaseVersion: 1,
    revision: 1,
  });
}

function sessionBarText(cards: readonly ReturnType<typeof WorkerCardWireSchema.parse>[]): string {
  const markup = renderToStaticMarkup(createElement(SessionPanel, {
    workerCards: cards,
    queueSurfaces: [],
    workerPools: [],
    // Empty on purpose: the chip's SENTENCE is what is pinned here, and
    // `labelOf` names an unlisted workflow by its id rather than throwing, so
    // a bootstrap fixture would add eight fields the assertion never reads.
    workflows: [],
    counts: [],
    nowIso: "2026-08-26T16:10:00.000Z",
    connection: { state: "live" },
    appVersion: "0.1.0",
  }));
  return markup.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim();
}

describe("the session bar's attention chip (D272 item 4, ledger row A122)", () => {
  it("keeps the noun and the verb agreeing at a count of ONE", () => {
    const text = sessionBarText([failedCard(1)]);
    // The defect this replaces, spelled out so a regression cannot pass by
    // matching a looser pattern.
    assert.ok(!text.includes("1 worker need attention"), text);
    assert.ok(text.includes("1 workers need attention"), text);
  });

  it("reads the same way above one", () => {
    assert.ok(sessionBarText([failedCard(1), failedCard(2)]).includes("2 workers need attention"));
  });

  it("draws no chip when nothing is failed — honest absence", () => {
    assert.ok(!sessionBarText([]).includes("need attention"));
  });

  it("prints the app version as MAJOR.MINOR beside the tooltip that explains two", () => {
    const text = sessionBarText([]);
    assert.ok(text.includes("app 0.1"), text);
    assert.ok(!text.includes("app 0.1.0"), text);
  });
});
