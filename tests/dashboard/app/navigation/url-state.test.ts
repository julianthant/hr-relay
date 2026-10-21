import { vi } from "vitest";
// @vitest-environment jsdom
import assert_m0 from 'node:assert/strict';
import { afterEach as afterEach_m0,beforeEach as beforeEach_m0,describe as describe_m0,it as it_m0 } from 'vitest';
import { parseRoute as parseRoute_m0,routeToSearch as routeToSearch_m0 } from '../../../../src/dashboard/app/navigation/url-state.js';
import { parseViewRoute as parseViewRoute_m0 } from '../../../../src/dashboard/app/navigation/view-route-model.js';

import assert_m1 from "node:assert/strict";
import { describe as describe_m1,it as it_m1 } from "vitest";
import { routeForCrossDateSearchResult as routeForCrossDateSearchResult_m1,routeToSearch as routeToSearch_m1 } from "../../../../src/dashboard/app/navigation/url-state.js";

import assert_m2 from "node:assert/strict";
import { describe as describe_m2,it as it_m2 } from "vitest";
import { parseArchiveBrowse as parseArchiveBrowse_m2 } from "../../../../src/dashboard/app/navigation/archive-route-model.js";
import { activeTakeover as activeTakeover_m2,parseRoute as parseRoute_m2,routeToSearch as routeToSearch_m2,shellViewOf as shellViewOf_m2,type ActiveTakeover as ActiveTakeover_m2 } from "../../../../src/dashboard/app/navigation/url-state.js";
import { SHELL_VIEWS as SHELL_VIEWS_m2,type ShellViewSelection as ShellViewSelection_m2 } from "../../../../src/dashboard/surfaces/shell/top-bar-model.js";

import assert_m3 from "node:assert/strict";
import { describe as describe_m3,it as it_m3 } from "vitest";
import {
activeTakeover as activeTakeover_m3,
parseRoute as parseRoute_m3,
routeToSearch as routeToSearch_m3
} from "../../../../src/dashboard/app/navigation/url-state.js";
// @vitest-environment jsdom
import { default as assert_m4,default as assert_m5,default as assert_m6 } from "node:assert/strict";
import { act as act_m4 } from "react";
import { type Root as Root_m4 } from "react-dom/client";
import { afterEach as afterEach_m4,describe as describe_m4,describe as describe_m5,it as it_m4,it as it_m5,it as it_m6 } from "vitest";
import { resolveDateSelection as resolveDateSelection_m6,routeForDay as routeForDay_m6,routeForStartedRun as routeForStartedRun_m6 } from "../../../../src/dashboard/app/navigation/date-state-model.js";
import { parseRoute as parseRoute_m4,parseRoute as parseRoute_m5,parseRoute as parseRoute_m6,routeAdvancesHistory as routeAdvancesHistory_m6,routeToSearch as routeToSearch_m4,routeToSearch as routeToSearch_m5,routeToSearch as routeToSearch_m6,routeWithoutTakeovers as routeWithoutTakeovers_m4,routeWithoutTakeovers as routeWithoutTakeovers_m5 } from "../../../../src/dashboard/app/navigation/url-state.js";

import assert_m7 from "node:assert/strict";
import { createElement as createElement_m7 } from "react";
import { renderToStaticMarkup as renderToStaticMarkup_m7 } from "react-dom/server";
import { describe as describe_m7,it as it_m7 } from "vitest";
import {
activeTakeover as activeTakeover_m7,
parseRoute as parseRoute_m7,
routeAdvancesHistory as routeAdvancesHistory_m7,
routeToSearch as routeToSearch_m7,
type AppRouteState as AppRouteState_m7
} from "../../../../src/dashboard/app/navigation/url-state.js";
import type { DashboardClient as DashboardClient_m7 } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider as DashboardClientProvider_m7 } from "../../../../src/dashboard/state/client-context.js";
import {
SETTINGS_KEYBOARD_SECTION_ID as SETTINGS_KEYBOARD_SECTION_ID_m7,
type SettingsSection as SettingsSection_m7
} from "../../../../src/dashboard/surfaces/settings/settings-model.js";
import { SettingsPage as SettingsPage_m7 } from "../../../../src/dashboard/surfaces/settings/settings.js";
import {
SettingsSectionPrimitiveSchema as SettingsSectionPrimitiveSchema_m7,
StorageHealthSummaryWireSchema as StorageHealthSummaryWireSchema_m7
} from "../../../../src/models/dashboard/bootstrap.js";
// @vitest-environment jsdom
import assert_m8 from "node:assert/strict";
import { act as act_m8,createElement as createElement_m8,useRef as useRef_m8,useState as useState_m8 } from "react";
import { createRoot as createRoot_m8,type Root as Root_m8 } from "react-dom/client";
import { afterEach as afterEach_m8,describe as describe_m8,it as it_m8 } from "vitest";
import { useRoute as useRoute_m8,type PopstateRouteHandler as PopstateRouteHandler_m8 } from "../../../../src/dashboard/app/navigation/route-history-model.js";
import { parseRoute as parseRoute_m8,routeToSearch as routeToSearch_m8 } from "../../../../src/dashboard/app/navigation/url-state.js";
import { ViewNavigationProvider as ViewNavigationProvider_m8 } from "../../../../src/dashboard/app/navigation/view-navigation.js";
import { parseViewRoute as parseViewRoute_m8,useViewState as useViewState_m8,ViewRouteSchema as ViewRouteSchema_m8 } from "../../../../src/dashboard/app/navigation/view-route-model.js";


{


const _beforeEachFixture0 = () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
};
const _afterEachFixture1 = () => vi.unstubAllGlobals();

describe_m0('Activity drilldown records and navigation', () => {
beforeEach_m0(_beforeEachFixture0);
afterEach_m0(_afterEachFixture1);

  it_m0('bounds and validates public Activity coordinates in the existing history schema', () => {
    const browse = { metric: 'timed', workflow: 'sample-separations', page: 1, run: 'activity-sample-4', sort: { column: 'duration', direction: 'descending' }, query: 'Jordan' } as const;
    assert_m0.deepEqual(parseViewRoute_m0(JSON.stringify({ activityBrowse: browse })), { activityBrowse: browse });
    for (const invalid of [{ ...browse, metric: 'all' }, { ...browse, page: -1 }, { ...browse, subject: 'private draft' },
      { ...browse, sort: { column: 'status', direction: 'ascending' } }, { ...browse, sort: { column: 'name', direction: 'random' } },
      { ...browse, sort: { column: 'duration', direction: 'ascending', subject: 'private draft' } }, { ...browse, query: 'a'.repeat(501) }]) assert_m0.equal(parseViewRoute_m0(JSON.stringify({ activityBrowse: invalid })), null);
    const fixture = parseRoute_m0('?settings=activity&activityPreview=empty');
    assert_m0.equal(fixture.view?.activityPreview, 'empty');
    assert_m0.equal(parseRoute_m0(routeToSearch_m0({ ...fixture, view: { ...fixture.view, activityBrowse: browse } })).view?.activityPreview, 'empty');
    assert_m0.deepEqual(parseRoute_m0(routeToSearch_m0({ ...fixture, view: { ...fixture.view, activityBrowse: browse } })).view?.activityBrowse, browse);
    assert_m0.equal(parseRoute_m0('?settings=activity&activityPreview=missing').viewInvalid, true);
  });
});
}

{


describe_m1("a cross-date search result", () => {
  it_m1("opens its exact run in its partition rather than the current day", () => {
    const next = routeForCrossDateSearchResult_m1(
      {
        start: false,
        day: "2026-08-28",
        archive: "archive-run",
        archiveView: "runs",
        settings: "storage",
      },
      {
        runId: "3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b",
        partitionDay: "2026-08-21",
      },
    );

    assert_m1.equal(routeToSearch_m1(next), "?day=2026-08-21&run=3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b");
  });
});
}

{


const BASE = { start: false } as const;


const SEGMENT_OF = {
  settings: "none",
  intake: "none",
  archive: "none",
  explore: "explorer",
  activity: "activity",
  none: "queue",
} as const satisfies Record<ActiveTakeover_m2, ShellViewSelection_m2>;

describe_m2("the Top Bar switcher's pressed segment", () => {
  it_m2("presses nothing for every takeover the switcher does not name", () => {
    for (const [route, takeover] of [
      [{ ...BASE, settings: "storage" }, "settings"],
      [{ ...BASE, intake: "e1f2a3b4-0000-4000-8000-000000000001" }, "intake"],
    ] as const) {
      assert_m2.equal(activeTakeover_m2(route), takeover);
      assert_m2.equal(shellViewOf_m2(activeTakeover_m2(route)), "none", `${takeover} must press no segment`);
    }
  });

  it_m2("presses the segment that owns the main region for the three it does name", () => {
    assert_m2.equal(shellViewOf_m2(activeTakeover_m2({ ...BASE, archive: "index" })), "none", "the retired Archive notice has no switcher segment");
    assert_m2.equal(shellViewOf_m2(activeTakeover_m2({ ...BASE, explore: "separations" })), "explorer");
    assert_m2.equal(shellViewOf_m2(activeTakeover_m2({ ...BASE, activity: "" })), "activity");
  });

  it_m2("presses Dashboard only when no takeover owns the main region", () => {
    assert_m2.equal(shellViewOf_m2(activeTakeover_m2({ ...BASE, day: "2026-08-27" })), "queue");
  });

  it_m2("follows the route's own precedence rather than a second copy of it", () => {

    assert_m2.equal(shellViewOf_m2(activeTakeover_m2({ ...BASE, settings: "", archive: "index" })), "none");
    assert_m2.equal(shellViewOf_m2(activeTakeover_m2({ ...BASE, archive: "index", explore: "separations" })), "none");
  });


  it_m2("presses the segment its arm names, for every takeover in the union", () => {
    for (const [takeover, segment] of Object.entries(SEGMENT_OF) as readonly (readonly [
      ActiveTakeover_m2,
      ShellViewSelection_m2,
    ])[]) {
      assert_m2.equal(shellViewOf_m2(takeover), segment, `shellViewOf(${takeover}) pressed the wrong segment`);
      if (segment !== "none") {
        // The other half: a segment the switcher draws no button for would
        // press nothing on screen while reading as pressed here.
        assert_m2.ok(
          SHELL_VIEWS_m2.includes(segment),
          `${takeover} names ${segment}, which the switcher draws no button for`,
        );
      }
    }
  });
});

it_m2("keeps clean Archive routes and marks corrupt, invalid and oversized browsing input", () => {
  const browse = { filters: { workflow: "separations" }, columns: ["name"], section: 1 };
  assert_m2.deepEqual(parseArchiveBrowse_m2(JSON.stringify(browse)), browse);
  const route = { start: false, archive: "index", archiveBrowse: browse };
  assert_m2.deepEqual(parseRoute_m2(routeToSearch_m2(route)).archiveBrowse, browse);
  for (const encoded of ["{", JSON.stringify({ unexpected: true }), JSON.stringify({ filters: {}, columns: ["name", "name"] }), " ".repeat(24001)]) {
    assert_m2.equal(parseArchiveBrowse_m2(encoded), null);
    const parsed = parseRoute_m2(`?archive=index&archiveBrowse=${encodeURIComponent(encoded)}`);
    assert_m2.equal(parsed.archiveBrowseInvalid, true);
    assert_m2.equal(parsed.archiveBrowse, undefined);
  }
  assert_m2.throws(() => routeToSearch_m2({ ...route, archiveBrowse: { filters: {}, columns: ["x".repeat(24001)] } }), /Archive browsing state exceeds its route bounds/u);
});
}

{


/* ── route state ─────────────────────────────────────────────────────────── */

describe_m3("the explorer and catalog route keys", () => {
  it_m3("round-trips both keys through the query string", () => {
    const route = parseRoute_m3(
      "?day=2026-08-09&explore=person-lookup&settings=ui-catalog&catalog=kuali%20save",
    );
    assert_m3.equal(route.explore, "person-lookup");
    assert_m3.equal(
      routeToSearch_m3(route),
      "?day=2026-08-09&explore=person-lookup&catalog=kuali+save&settings=ui-catalog",
    );
  });

  it_m3("addresses Archive's real version registry as the Explorer's destination", () => {
    const route = parseRoute_m3("?archive=&archiveView=versions");
    assert_m3.equal(route.archive, "");
    assert_m3.equal(route.archiveView, "versions");
    assert_m3.equal(activeTakeover_m3(route), "archive");
    assert_m3.equal(routeToSearch_m3(route), "?archive=&archiveView=versions");

    // A view alone is not a second route. The Archive owns the actual
    // takeover, and the view only selects a real panel inside that takeover.
    assert_m3.deepEqual(parseRoute_m3("?archiveView=versions"), { start: false });
  });

  it_m3("round-trips a complete Archive folder context and drops a half-folder", () => {
    const route = parseRoute_m3("?archive=&archiveView=runs&archiveDashboard=2.0&archiveWorkflow=person-lookup");

    assert_m3.deepEqual(route, {
      start: false,
      archive: "",
      archiveView: "runs",
      archiveDashboard: "2.0",
      archiveWorkflow: "person-lookup",
    });
    assert_m3.equal(
      routeToSearch_m3(route),
      "?archive=&archiveView=runs&archiveDashboard=2.0&archiveWorkflow=person-lookup",
    );
    assert_m3.deepEqual(parseRoute_m3("?archive=&archiveDashboard=2.0"), { start: false, archive: "" });
    assert_m3.equal(
      routeToSearch_m3({ start: false, archive: "", archiveDashboard: "2.0" }),
      "?archive=",
    );
  });

  it_m3("drops an empty explore value, because a workflow id is never blank", () => {
    assert_m3.equal(parseRoute_m3("?explore=").explore, undefined);
    assert_m3.equal(activeTakeover_m3(parseRoute_m3("?explore=")), "none");
  });

  it_m3("resolves ONE takeover when a link carries several", () => {
    assert_m3.equal(activeTakeover_m3(parseRoute_m3("?intake=abc&explore=x&settings=ui-catalog")), "settings");
    assert_m3.equal(activeTakeover_m3(parseRoute_m3("?intake=abc&explore=x")), "intake");
    assert_m3.equal(activeTakeover_m3(parseRoute_m3("?explore=x&catalog=y")), "explore");
    assert_m3.equal(activeTakeover_m3(parseRoute_m3("?day=2026-08-09")), "none");
  });
});

it_m3("round-trips bounded public Archive browsing state and refuses malformed/private extras", () => {
  const browse = { filters: { search: "Snow 雪", capturedFrom: "2026-08-01T00:00:00.000Z", outcome: "failed" },
    after: { completedAt: "2026-08-02T00:00:00.000Z", runId: "00000000-0000-4000-8000-000000000081" },
    columns: ["kept-column", "duplicate-label-context"], section: 3 };
  const route = parseRoute_m3(`?archive=&archiveDashboard=2.0&archiveWorkflow=person-lookup&archiveBrowse=${encodeURIComponent(JSON.stringify(browse))}`);
  assert_m3.deepEqual(route.archiveBrowse, browse);
  assert_m3.deepEqual(parseRoute_m3(routeToSearch_m3(route)), route);
  for (const invalid of ["{", JSON.stringify({ ...browse, filters: { from: "2026-08-02T00:00:00.000Z", to: "2026-08-01T00:00:00.000Z" } }), JSON.stringify({ ...browse, filters: { outcome: "invented" } }), JSON.stringify({ ...browse, privatePayload: "secret" }),
    JSON.stringify({ ...browse, filters: { search: "x".repeat(121) } }),
    JSON.stringify({ ...browse, columns: ["same", "same"] }), JSON.stringify({ ...browse, section: -1 }),
    JSON.stringify({ ...browse, after: { completedAt: "bad-date", runId: "bad-id" } }), "x".repeat(24001)]) {
    const rejected = parseRoute_m3(`?archive=&archiveBrowse=${encodeURIComponent(invalid)}`);
    assert_m3.equal(rejected.archiveBrowse, undefined);
    assert_m3.equal(rejected.archiveBrowseInvalid, true);
  }
  assert_m3.deepEqual(parseRoute_m3(`?archiveBrowse=${encodeURIComponent(JSON.stringify(browse))}`), { start: false });
});

it_m3("rejects oversized or malformed paired Archive folder route identities with a reset notice", () => {
  for (const dashboard of ["not-version", "1".repeat(41)]) {
    const parsed = parseRoute_m3(`?archive=&archiveDashboard=${dashboard}&archiveWorkflow=person-lookup`);
    assert_m3.equal(parsed.archiveDashboard, undefined);
    assert_m3.equal(parsed.archiveBrowseInvalid, true);
  }
  const parsed = parseRoute_m3(`?archive=&archiveDashboard=1.0&archiveWorkflow=${"x".repeat(161)}`);
  assert_m3.equal(parsed.archiveWorkflow, undefined);
  assert_m3.equal(parsed.archiveBrowseInvalid, true);
});
}

{


describe_m4("approved Explorer presentation", () => {
afterEach_m4(_afterEachFixture0);

  it_m4("uses the canonical Explorer route and ignores the retired preview switch", () => {
    const route = parseRoute_m4("?explore=fixture");
    assert_m4.deepEqual(parseRoute_m4(routeToSearch_m4(route)), route);
    assert_m4.equal(routeWithoutTakeovers_m4(route).explore, undefined);
    assert_m4.deepEqual(parseRoute_m4("?explore=fixture&explorerPreview=1"), route);
    assert_m4.deepEqual(parseRoute_m4("?explore=fixture&explorerPreview=invalid"), route);
    assert_m4.equal(parseRoute_m4("?explorerPreview=1").explore, undefined);
    assert_m4.doesNotMatch(routeToSearch_m4(route), /explorerPreview/);
  });
});

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let mounted: Root_m4 | undefined;
const _afterEachFixture0 = async () => {
  if (mounted) await act_m4(async () => mounted?.unmount());
  mounted = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
};
}

{


describe_m5("Settings field search", () => {

  it_m5("keeps exact targets subordinate to Settings in links, reloads and exits", () => {
    const route = parseRoute_m5("?settings=performance&settingsTarget=ocr.backoffBaseMs");
    assert_m5.equal(route.settingsTarget, "ocr.backoffBaseMs");
    assert_m5.equal(routeToSearch_m5(route), "?settings=performance&settingsTarget=ocr.backoffBaseMs");
    assert_m5.equal(parseRoute_m5("?settingsTarget=ocr.backoffBaseMs").settingsTarget, undefined);
    assert_m5.equal(routeWithoutTakeovers_m5(route).settingsTarget, undefined);
    assert_m5.equal(parseRoute_m5(`?settings=general&settingsTarget=${"a".repeat(201)}`).settingsTarget, undefined);
    assert_m5.ok(!routeToSearch_m5({ start: false, settingsTarget: "ocr.backoffBaseMs" }).includes("settingsTarget"));
  });
});
}

{


it_m6("preserves raw invalid identities, refuses future links and accepts leap/empty historical dates", () => {
  for (const requested of ["2026-02-30", "2025-02-29", "tomorrow", ""]) {
    const route = parseRoute_m6(`?day=${requested}&run=exact-run&section=receipt`);
    assert_m6.equal(route.day, requested);
    assert_m6.equal(route.run, "exact-run");
    assert_m6.equal(resolveDateSelection_m6(route.day, "2026-09-18").state, "invalid");
    assert_m6.equal(parseRoute_m6(routeToSearch_m6(route)).day, requested);
    assert_m6.deepEqual(routeForDay_m6(route, undefined), { day: undefined, run: undefined, section: undefined, start: false });
  }
  assert_m6.deepEqual(resolveDateSelection_m6("2026-09-19", "2026-09-18"), { state: "invalid", requested: "2026-09-19", reason: "future" });
  for (const day of ["2024-02-29", "2025-12-31", "2026-01-01"]) {
    assert_m6.deepEqual(resolveDateSelection_m6(day, "2026-09-18"), { state: "valid", day, followToday: false });
  }
  const route = parseRoute_m6("?day=2024-02-29&run=a");
  assert_m6.equal(routeForDay_m6(route, "2024-02-29"), route);
  assert_m6.equal(routeAdvancesHistory_m6(route, routeToSearch_m6(route)), false);
});

it_m6("opens today's queue after a start, clearing an older run and takeover", () => {
  const route = parseRoute_m6("?day=2026-09-28&run=older-run&section=logs&archive=older-run&start=1");
  const next = routeForStartedRun_m6(route);
  assert_m6.equal(next.day, undefined);
  assert_m6.equal(next.run, undefined);
  assert_m6.equal(next.section, undefined);
  assert_m6.equal(next.archive, undefined);
  assert_m6.equal(next.start, true);
});
}

{


/** Parsed, so a case cannot express a section the bootstrap would refuse. */
function section(id: string, label: string): SettingsSection_m7 {
  return SettingsSectionPrimitiveSchema_m7.parse({ id, label, revision: 1 });
}

const STORAGE = section("storage", "Storage checks");
const HEALTHY_STORAGE = StorageHealthSummaryWireSchema_m7.parse({
  authority: "healthy",
  backup: "current",
  checkedAt: "2026-08-26T16:00:00.000Z",
});
const STATIC_SETTINGS_CLIENT = {} as DashboardClient_m7;

describe_m7("the settings route", () => {
  it_m7("carries an EMPTY value, because that is the page's first section", () => {
    const route = parseRoute_m7("?settings=");
    assert_m7.equal(route.settings, "");
    assert_m7.equal(activeTakeover_m7(route), "settings");
    // The round trip is the half that makes Back work: `?settings=` has to come
    // back out of `routeToSearch`, not be dropped as falsy.
    assert_m7.equal(routeToSearch_m7(route), "?settings=");
  });

  it_m7("carries a named section both ways", () => {
    const route = parseRoute_m7("?settings=keyboard");
    assert_m7.equal(route.settings, SETTINGS_KEYBOARD_SECTION_ID_m7);
    assert_m7.equal(routeToSearch_m7(route), "?settings=keyboard");
  });

  it_m7("is absent when the key is absent, and then owns nothing", () => {
    const route = parseRoute_m7("?day=2026-08-26");
    assert_m7.equal(route.settings, undefined);
    assert_m7.equal(activeTakeover_m7(route), "none");
    assert_m7.equal(routeToSearch_m7(route), "?day=2026-08-26");
  });

  it_m7("OUTRANKS every other takeover key", () => {

    const layered: AppRouteState_m7 = {
      start: false,
      settings: "",
      intake: "e1f2a3b4-0000-4000-8000-000000000001",
      archive: "",
      activity: "",
      explore: "person-lookup",
      catalog: "",
    };
    assert_m7.equal(activeTakeover_m7(layered), "settings");
    // and the ranking below it is unchanged
    const { settings: _dropped, ...withoutSettings } = layered;
    assert_m7.equal(activeTakeover_m7(withoutSettings), "intake");
  });
});

describe_m7("history push on re-press (unit F4b finding 2)", () => {
  const base: AppRouteState_m7 = {
    start: false,
    settings: "",
    intake: undefined,
    archive: undefined,
    activity: undefined,
    explore: undefined,
    catalog: undefined,
  };

  it_m7("does NOT advance history when the next route serialises to the current search", () => {

    assert_m7.equal(routeAdvancesHistory_m7(base, routeToSearch_m7(base)), false);
  });

  it_m7("DOES advance history when the next route is a different place", () => {
    const toKeyboard: AppRouteState_m7 = { ...base, settings: SETTINGS_KEYBOARD_SECTION_ID_m7 };
    assert_m7.equal(routeAdvancesHistory_m7(toKeyboard, routeToSearch_m7(base)), true);
  });

  it_m7("advances on the very first navigation, from an unrelated current search", () => {
    assert_m7.equal(routeAdvancesHistory_m7(base, "?day=2026-08-26"), true);
  });
});

describe_m7("the settings nav renders real navigation, not buttons (unit F4b finding 4)", () => {
  const markup = renderToStaticMarkup_m7(createElement_m7(DashboardClientProvider_m7, {
    client: STATIC_SETTINGS_CLIENT,
    children: createElement_m7(SettingsPage_m7, { onClose: () => undefined,
      storage: HEALTHY_STORAGE,
      sections: [STORAGE],

    section: SETTINGS_KEYBOARD_SECTION_ID_m7,
    actorId: "local-operator",
    descriptorFingerprint: "a".repeat(64),
    preflight: [],
    // Capabilities is not the open section in any render here, so the join map
    // is empty rather than a fixture nothing reads.
    workflowLabels: new Map<string, string>(),
    onSection: () => undefined,
    }),
  }));

  it_m7("renders no plain <button> for a nav entry any more", () => {
    // The defect this replaces: a `button` has no href, so middle-click,
    // Cmd/Ctrl-click and "open in new tab" all silently did nothing.
    assert_m7.ok(!/<button[^>]*aria-current/u.test(markup), markup);
  });
});
}

{


Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root_m8 | undefined;
const _afterEachFixture0 = async () => { await act_m8(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); };
function Controls() {
  const [tab, setTab] = useViewState_m8("spreadsheetTab", "registered");
  const [stage, setStage] = useViewState_m8("launchStage", "Input");
  const [query, setQuery] = useViewState_m8("searchQuery", "", "replace");
  const [draft, setDraft] = useState_m8("private employee draft");
  return createElement_m8("div", null,
    createElement_m8("output", null, `${tab}/${stage}/${query}/${draft}`),
    createElement_m8("button", { onClick: () => { setTab("types"); setStage("Options"); } }, "Next"),
    createElement_m8("button", { onClick: () => setQuery("exact run") }, "Find"),
    createElement_m8("button", { onClick: () => setDraft("edited private draft") }, "Edit"));
}
async function mount() {
  function Harness() {
    const handler = useRef_m8<PopstateRouteHandler_m8 | undefined>(undefined);
    const [route, setRoute] = useRoute_m8(handler);
    return createElement_m8(ViewNavigationProvider_m8, { route, setRoute, children: createElement_m8(Controls) });
  }
  const host = document.createElement("div"); document.body.append(host); root = createRoot_m8(host);
  await act_m8(async () => root?.render(createElement_m8(Harness)));
}
async function click(label: string) { const button = [...document.querySelectorAll("button")].find(node => node.textContent === label); assert_m8.ok(button); await act_m8(async () => button.click()); }
async function move(method: "back" | "forward") {
  await act_m8(async () => { const popped = new Promise<void>(resolve => window.addEventListener("popstate", () => resolve(), { once: true })); window.history[method](); await popped; });
}
describe_m8("view navigation", () => {
afterEach_m8(_afterEachFixture0);

  it_m8("round-trips only bounded navigation metadata and refuses corrupt/private payloads", () => {
    const route = { start: true, settings: "spreadsheets", view: ViewRouteSchema_m8.parse({ spreadsheetTab: "types", launchStage: "Confirm", notifications: true, reviewPages: { "record-1": 1 }, launchRerun: { runId: "00000000-0000-4000-8000-000000000001", expectedVersion: 1 }, queueOpen: ["batch-1"] }) };
    assert_m8.deepEqual(parseRoute_m8(routeToSearch_m8(route)), route);
    for (const raw of ['{"draft":"secret"}', '{"launchStage":"Unknown"}', '{"spreadsheetPage":-1}', "{", "x".repeat(16001)]) assert_m8.equal(parseViewRoute_m8(raw), null);
    assert_m8.equal(parseRoute_m8("?view=%7B").viewInvalid, true);
    assert_m8.deepEqual(parseViewRoute_m8(null), {});
  });
  it_m8("batches one gesture into one history entry, restores views, and retains private edits", async () => {
    await mount(); const push = vi.spyOn(window.history, "pushState");
    await click("Next"); assert_m8.equal(push.mock.calls.length, 1);
    assert_m8.match(document.querySelector("output")?.textContent ?? "", /types\/Options/);
    await click("Edit"); assert_m8.doesNotMatch(location.search, /private|employee|draft/);
    await move("back"); assert_m8.match(document.querySelector("output")?.textContent ?? "", /registered\/Input\/\/edited private draft/);
    await move("forward"); assert_m8.match(document.querySelector("output")?.textContent ?? "", /types\/Options\/\/edited private draft/);
    assert_m8.equal(push.mock.calls.length, 1, "traversal must not create another entry");
  });
  it_m8("replaces typed search state without adding a character-by-character history trail", async () => {
    await mount(); await click("Next"); const push = vi.spyOn(window.history, "pushState");
    await click("Find"); assert_m8.equal(push.mock.calls.length, 0);
    assert_m8.equal(parseRoute_m8(location.search).view?.searchQuery, "exact run");
    await move("back"); assert_m8.match(document.querySelector("output")?.textContent ?? "", /registered\/Input\/\//);
  });

});
}

it_m0("round trips HUB onboarding and mock setup through the one URL owner", () => {
  for (const onboarding of ["login", "signup", "duo", "ready"] as const) {
    const route = { start: false, onboarding };
    assert_m0.deepEqual(parseRoute_m0(routeToSearch_m0(route)), route);
  }
  for (const onboardingSetup of ["fast", "duo"] as const) {
    const route = { start: false, onboardingSetup };
    assert_m0.deepEqual(parseRoute_m0(routeToSearch_m0(route)), route);
  }
  assert_m0.equal(parseRoute_m0("?onboarding=unknown").viewInvalid, true);
  assert_m0.equal(parseRoute_m0("?onboardingSetup=unknown").viewInvalid, true);
});
