/**
 * The app's visible state lives in the query string.
 *
 * Day, open run, open section and the start dialog are all addressable, which
 * is what lets an operator send someone a link to the exact screen they are
 * looking at — and, not incidentally, what lets the parity lane ask two
 * different backends for the same screen (ref frontend-backend-integration §7.2).
 *
 * Nothing here reads or writes server state; this is pure client UI state
 * (ref frontend-backend-integration §4) held in the one place the browser already persists for us.
 */

import type { ArchiveView } from "../surfaces/archive-model.js";
import type { ShellViewSelection } from "../surfaces/top-bar-model.js";
import { parseCatalogView, type CatalogView } from "../surfaces/row-catalog-model.js";
import { SETTINGS_UI_CATALOG_SECTION_ID } from "../surfaces/settings-model.js";

export interface AppRouteState {
  readonly day?: string;
  readonly run?: string;
  readonly section?: string;
  readonly start: boolean;
  /**
   * The intake workspace (2i-E3). `new` opens it at the dropzone; any other
   * value is an intake session id, so a durable session an operator half-mapped
   * is a link they can come back to — which is the whole reason the session is
   * a row rather than component state.
   */
  readonly intake?: string;
  /**
   * The read-only Workflow Explorer (2i-G, D176), addressed by workflow id.
   *
   * It is its own key rather than a value of `intake` because the two takeovers
   * are different tasks with different scopes — one is a durable session an
   * operator is working, the other is a reference view of registration state —
   * and a shared key would make "which of them is open" ambiguous the moment
   * both were reachable.
   */
  readonly explore?: string;
  /**
   * The generated UI catalog's search term (2i-G, D177), SUBORDINATE to
   * `settings` since D295.
   *
   * It used to be a takeover key in its own right — presence opened the
   * catalog, and an empty value meant "open, nothing typed". The catalog is a
   * Settings section now, so `?settings=ui-catalog` is what opens it and this
   * carries only the term, which may still legitimately be blank. It is NOT
   * folded into the `settings` value because a section id and a free-text
   * search are two different things, and one key holding both would have to
   * escape one inside the other.
   *
   * Both this and `catalogView` are read and written ONLY while `settings`
   * names the catalog section — enforced in `parseRoute`/`routeToSearch` rather
   * than at each call site, so a URL can never carry a search term for a page
   * that is not open.
   */
  readonly catalog?: string;
  /**
   * The catalog's visible view (D274 item 4). It travels with `catalog` for the
   * same reason `archiveView` travels with `archive`: the section has two
   * panels — the generated selector catalog and the row-and-panel vocabulary —
   * and a door from elsewhere has to be able to land on the right one in a
   * single navigation rather than asking the operator to take a second action.
   */
  readonly catalogView?: CatalogView;
  /**
   * The read-only Archive (2i-G, D179). An empty value opens the index; a run
   * id opens that archived run's detail beside it — the same
   * `?archive=<runId>` link an operator can send, which is the point of
   * addressing it rather than holding it in component state.
   */
  readonly archive?: string;
  /**
   * The Archive's visible view. It travels with `archive` so a door from
   * another takeover can land on the actual Version registry rather than on
   * the Archive ledger and asking the operator to take a second action.
   */
  readonly archiveView?: ArchiveView;
  /**
   * The Activity report (2i-G, D180) as `from..to`. The RANGE is in the URL
   * because a report is a thing people cite: "the numbers I was looking at"
   * has to survive being pasted into a message. An empty value means the
   * surface is open on its default range.
   */
  readonly activity?: string;
  /**
   * Settings (D272 item 1 / D274 item 5): the demo's FULL-PAGE takeover, not
   * the dialog this used to be. The value is the open section's id, so
   * `?settings=keyboard` is the Help → Keyboard destination the top bar's
   * deleted glyph was traded for; an EMPTY value opens the page on its first
   * section, which is why presence is what opens it.
   *
   * A takeover rather than a dialog is what puts Settings in history: the
   * browser's own Back returns the operator to the view they left, which is
   * the whole difference between "a place" and "a layer".
   */
  readonly settings?: string;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Parses a query string into route state. A malformed day is DROPPED rather
 * than passed to the server: `?day=yesterday` should fall back to the server's
 * today, not produce a wire error the operator cannot act on. A malformed run
 * id is likewise dropped — the projection would refuse it anyway, and an empty
 * panel with a legible day beats an error page.
 */
export function parseRoute(search: string): AppRouteState {
  const params = new URLSearchParams(search);
  const day = params.get("day");
  const run = params.get("run");
  const section = params.get("section");
  const intake = params.get("intake");
  const explore = params.get("explore");
  const catalog = params.get("catalog");
  const catalogView = params.get("catalogView");
  const archive = params.get("archive");
  const archiveView = params.get("archiveView");
  const activity = params.get("activity");
  const settings = params.get("settings");
  const route: {
    day?: string;
    run?: string;
    section?: string;
    start: boolean;
    intake?: string;
    explore?: string;
    catalog?: string;
    catalogView?: CatalogView;
    archive?: string;
    archiveView?: ArchiveView;
    activity?: string;
    settings?: string;
  } = { start: params.get("start") === "1" };
  if (day !== null && DAY_PATTERN.test(day)) route.day = day;
  if (run !== null && run.length > 0) route.run = run;
  if (section !== null && section.length > 0) route.section = section;
  if (intake !== null && intake.length > 0) route.intake = intake;
  if (explore !== null && explore.length > 0) route.explore = explore;
  // D295: the catalog keys are subordinate to `settings`. An empty VALUE is
  // still meaningful — the section open with no search term — but presence no
  // longer opens anything, so a bare `?catalog=kuali` is dropped rather than
  // silently carried beside a page it does not describe.
  if (catalog !== null && settings === SETTINGS_UI_CATALOG_SECTION_ID) {
    route.catalog = catalog;
    // Follows `archiveView`: an unrecognised view is DROPPED rather than
    // carried, so a mistyped link lands on the catalog's default panel instead
    // of on a blank region naming a view this build does not render.
    const parsedCatalogView = parseCatalogView(catalogView);
    if (parsedCatalogView !== undefined) route.catalogView = parsedCatalogView;
  }
  // An EMPTY value is meaningful for both of these (the index, and the default
  // range), so presence is what opens the surface.
  if (archive !== null) {
    route.archive = archive;
    if (archiveView === "runs" || archiveView === "versions") route.archiveView = archiveView;
  }
  if (activity !== null) route.activity = activity;
  // Follows `archive` and `activity`: an EMPTY value is meaningful (the page's
  // first section), so presence is what opens the takeover. A section id this
  // build does not render is NOT dropped here — the page says the name it was
  // given rather than silently landing somewhere else.
  if (settings !== null) route.settings = settings;
  return route;
}

/** The sentinel `?intake=` value that means "opened, no session yet". */
export const INTAKE_NEW = "new";

export function routeToSearch(route: AppRouteState): string {
  const params = new URLSearchParams();
  if (route.day !== undefined) params.set("day", route.day);
  if (route.run !== undefined) params.set("run", route.run);
  if (route.section !== undefined) params.set("section", route.section);
  if (route.start) params.set("start", "1");
  if (route.intake !== undefined) params.set("intake", route.intake);
  if (route.explore !== undefined) params.set("explore", route.explore);
  // The other half of `parseRoute`'s D295 gate, so the pair round-trips: a
  // catalog term is written only while the section that reads it is open.
  if (route.catalog !== undefined && route.settings === SETTINGS_UI_CATALOG_SECTION_ID) {
    params.set("catalog", route.catalog);
    if (route.catalogView !== undefined) params.set("catalogView", route.catalogView);
  }
  if (route.archive !== undefined) {
    params.set("archive", route.archive);
    if (route.archiveView !== undefined) params.set("archiveView", route.archiveView);
  }
  if (route.activity !== undefined) params.set("activity", route.activity);
  if (route.settings !== undefined) params.set("settings", route.settings);
  const query = params.toString();
  return query.length === 0 ? "" : `?${query}`;
}

/**
 * A corpus result belongs to a durable run in one exact day partition. Opening
 * it must move BOTH route coordinates and leave the queue visible; keeping an
 * Archive or Settings takeover in the URL would change the address without
 * exposing the selected run.
 */
export function routeForCrossDateSearchResult(
  route: AppRouteState,
  result: { readonly runId: string; readonly partitionDay: string },
): AppRouteState {
  return {
    ...route,
    day: result.partitionDay,
    run: result.runId,
    section: undefined,
    start: false,
    intake: undefined,
    explore: undefined,
    catalog: undefined,
    catalogView: undefined,
    archive: undefined,
    archiveView: undefined,
    activity: undefined,
    settings: undefined,
  };
}

/**
 * Whether pushing `next` would land on a DIFFERENT search string than the one
 * already showing (unit F4b finding 2). `setRoute` used to push unconditionally,
 * so re-pressing a door already open — the gear, the active nav entry, the
 * Storage door — pushed an identical entry on top of the one already there:
 * the URL never changed, but History gained a row, and the operator's first
 * Back press landed them right back on the screen they were trying to leave.
 */
export function routeAdvancesHistory(next: AppRouteState, currentSearch: string): boolean {
  return routeToSearch(next) !== currentSearch;
}

/**
 * Which takeover owns the main region, resolved in ONE place.
 *
 * Three keys can be present at once (a link may carry any combination), so the
 * precedence is stated rather than left to whichever branch a JSX tree happens
 * to test first: the operator's in-progress WORK outranks either reference
 * view, and the workflow-scoped reference outranks the system-scoped one.
 */
export type ActiveTakeover =
  | "settings"
  | "intake"
  | "archive"
  | "activity"
  | "explore"
  | "none";

export function activeTakeover(route: AppRouteState): ActiveTakeover {
  // Settings outranks every other key, and the reason is functional rather
  // than a preference about importance: the storage band's `Storage health`
  // door is mounted ABOVE the takeover switch, so it is pressed from inside
  // whatever is already open. If any of the keys below outranked `settings`,
  // that door would change the URL and leave the screen where it was.
  if (route.settings !== undefined) return "settings";
  if (route.intake !== undefined) return "intake";
  // Archive and Activity outrank the Explorer for the same reason intake
  // outranks all of them: they are places the operator navigates TO and stays,
  // while the explorer is something they look UP. What it is not is work —
  // which is why intake still outranks it. The UI catalog was the other
  // reference view here until D295 moved it inside Settings, which already
  // outranks everything.
  if (route.archive !== undefined) return "archive";
  if (route.activity !== undefined) return "activity";
  if (route.explore !== undefined) return "explore";
  return "none";
}

/**
 * Which Top Bar switcher segment the resolved takeover presses.
 *
 * The switcher is a VIEW of the route and never a second copy of it, so this is
 * a fold of `activeTakeover`'s ONE answer — a link carrying both `?archive=`
 * and `?explore=` lights the segment the region actually renders, because both
 * read the same resolution.
 *
 * `settings` and `intake` press NOTHING (`"none"`). They used to
 * fall through to `queue` on the reasoning that "lighting nothing would be the
 * switcher claiming the operator is nowhere" — but the operator is not nowhere,
 * they are in a takeover the switcher does not name, and the gear (or the
 * takeover's own header) says where. Pressing `Dashboard` while a takeover
 * covers the dashboard is two simultaneous "you are here" claims, one of them
 * false (UF-SET-2). The demo has always done it this way
 * (legacy `1ec1d870` `src/dashboard/components/dev/rebuild-demo/DemoShell.tsx:560-573`).
 *
 * Exhaustive over `ActiveTakeover` on purpose: a sixth takeover added to the
 * union above fails to compile here rather than quietly acquiring one of the
 * arms below.
 */
export function shellViewOf(takeover: ActiveTakeover): ShellViewSelection {
  switch (takeover) {
    case "archive": return "archive";
    case "explore": return "explorer";
    case "activity": return "activity";
    case "none": return "queue";
    case "settings":
    case "intake": return "none";
  }
}
