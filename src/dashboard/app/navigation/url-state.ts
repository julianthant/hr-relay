import { parseViewRoute, ViewRouteSchema, type ViewRoute } from "./view-route-model.js";
import { parseArchiveFolderRoute, parseArchiveBrowse, type ArchiveBrowseState } from "./archive-route-model.js";
/** The app's visible state lives in the query string. */

export type ArchiveView = "runs" | "versions";
import type { ShellViewSelection } from "../../surfaces/shell/top-bar-model.js";
import { parseCatalogView, type CatalogView } from "../../surfaces/settings/catalog/row-catalog-model.js";
import { SETTINGS_UI_CATALOG_SECTION_ID } from "../../surfaces/settings/settings-model.js";

export interface AppRouteState {
  readonly view?: ViewRoute;
  readonly viewInvalid?: boolean;
  readonly day?: string;
  readonly run?: string;
  readonly section?: string;
  readonly start: boolean;
  readonly onboardingSetup?: "fast" | "duo";
  readonly onboarding?: "login" | "signup" | "duo" | "ready";
  /** The intake workspace — ALWAYS an intake session id, so a durable session an
 * operator half-mapped is a link they can come back to, which is the whole */
  readonly intake?: string;
  /** The read-only Workflow Explorer, addressed by workflow id.
 * It is its own key rather than a value of `intake` because the two takeovers */
  readonly explore?: string;
  /** The generated UI catalog's search term, SUBORDINATE to `settings`.
 * The catalog is a Settings section, so `?settings=ui-catalog` is what opens */
  readonly catalog?: string;
  /** The catalog's visible view. It travels with `catalog` for
 * the same reason `archiveView` travels with `archive` */
  readonly catalogView?: CatalogView;
  /** The read-only Archive. An empty value opens the index */
  readonly archive?: string;
  /** The Archive's visible view. */
  readonly archiveView?: ArchiveView;
  /** The open Archive folder. Both identities travel together so a reload
 * history traversal, or route-addressable bump can retain the exact saved */
  readonly archiveDashboard?: string;
  readonly archiveWorkflow?: string;
  readonly archiveBrowse?: ArchiveBrowseState;
  readonly archiveBrowseInvalid?: boolean;
  /** The Activity report as `from..to`. The RANGE is in the URL because a report
 * is a thing people cite: "the numbers I was looking at" has to survive being */
  readonly activity?: string;
  /** Settings: the FULL-PAGE takeover. The value is the open section's id, so
 * `?settings=keyboard` is the Help → Keyboard destination; an EMPTY value */
  readonly settings?: string;
  readonly settingsTarget?: string;
}

/** Preserve the raw date identity so the date boundary can explain and recover invalid links. */
export function parseRoute(search: string): AppRouteState {
  const params = new URLSearchParams(search);
  const onboarding = params.get("onboarding");
  const setup = params.get("onboardingSetup");
  const day = params.get("day");
  const run = params.get("run");
  const section = params.get("section");
  const intake = params.get("intake");
  const explore = params.get("explore");
  const catalog = params.get("catalog");
  const catalogView = params.get("catalogView");
  const archive = params.get("archive");
  const archiveView = params.get("archiveView");
  const archiveDashboard = params.get("archiveDashboard");
  const archiveWorkflow = params.get("archiveWorkflow");
  const activity = params.get("activity");
  const settings = params.get("settings");
  const route: { -readonly [Key in keyof AppRouteState]: AppRouteState[Key] } = { start: params.get("start") === "1" };
  if (setup === "fast" || setup === "duo") route.onboardingSetup = setup;
  else if (setup !== null) route.viewInvalid = true;
  if (onboarding === "login" || onboarding === "signup" || onboarding === "duo" || onboarding === "ready") route.onboarding = onboarding;
  else if (onboarding !== null) route.viewInvalid = true;
  const view = parseViewRoute(params.get("view"));
  if (view === null) route.viewInvalid = true;
  else if (Object.keys(view).length) route.view = view;
  const activityPreview = params.get('activityPreview');
  if (activityPreview !== null) {
    const preview = ViewRouteSchema.shape.activityPreview.safeParse(activityPreview);
    if (!preview.success) route.viewInvalid = true;
    else route.view = { ...route.view, activityPreview: preview.data };
  }
  if (day !== null) route.day = day;
  if (run !== null && run.length > 0) route.run = run;
  if (section !== null && section.length > 0) route.section = section;
  if (intake !== null && intake.length > 0) route.intake = intake;
  if (explore !== null && explore.length > 0) route.explore = explore;
  // The catalog keys are subordinate to `settings`: an empty VALUE still reads as an open section.
  // the section open with no term, but presence does not open anything.
  if (catalog !== null && settings === SETTINGS_UI_CATALOG_SECTION_ID) {
    route.catalog = catalog;
        // Follows `archiveView`: an unrecognised view is DROPPED rather than carried,
    // so a mistyped link lands on the catalog's default panel.
    const parsedCatalogView = parseCatalogView(catalogView);
    if (parsedCatalogView !== undefined) route.catalogView = parsedCatalogView;
  }
    // An EMPTY value is meaningful for both of these (the index, and the default
  // range), so presence is what opens the surface.
  if (archive !== null) {
    route.archive = archive;
    const browse = params.get("archiveBrowse");
    if (browse !== null) {
      const parsed = parseArchiveBrowse(browse);
      if (parsed === null) route.archiveBrowseInvalid = true;
      else route.archiveBrowse = parsed;
    }
    if (archiveView === "runs" || archiveView === "versions") route.archiveView = archiveView;
        // A half-folder cannot describe a screen. Drop it rather than falling back
    // to a different registered workflow.
    if (archiveDashboard !== null && archiveDashboard.length > 0 && archiveWorkflow !== null && archiveWorkflow.length > 0) {
      const folder = parseArchiveFolderRoute(archiveDashboard, archiveWorkflow);
      if (folder === null) route.archiveBrowseInvalid = true;
      else { route.archiveDashboard = folder.dashboardKey; route.archiveWorkflow = folder.workflow; }
    }
  }
  if (activity !== null) route.activity = activity;
    // Follows `archive` and `activity`: an EMPTY value is meaningful (the page's
  // first section), so presence opens the takeover; an unknown section id is NOT dropped.
  if (settings !== null) {
    route.settings = settings;
    const target = params.get("settingsTarget");
    if (target !== null && target.length > 0 && target.length <= 200) route.settingsTarget = target;
  }
  return route;
}

export function routeToSearch(route: AppRouteState): string {
  const params = new URLSearchParams();
  if (route.onboardingSetup !== undefined) params.set("onboardingSetup", route.onboardingSetup);
  if (route.onboarding !== undefined) params.set("onboarding", route.onboarding);
  if (route.day !== undefined) params.set("day", route.day);
  if (route.run !== undefined) params.set("run", route.run);
  if (route.section !== undefined) params.set("section", route.section);
  if (route.start) params.set("start", "1");
  if (route.intake !== undefined) params.set("intake", route.intake);
  if (route.explore !== undefined) params.set("explore", route.explore);
    // The other half of the catalog gate above, so the pair round-trips: a catalog
  // term is written only while the section that reads it is open.
  if (route.catalog !== undefined && route.settings === SETTINGS_UI_CATALOG_SECTION_ID) {
    params.set("catalog", route.catalog);
    if (route.catalogView !== undefined) params.set("catalogView", route.catalogView);
  }
  if (route.archive !== undefined) {
    params.set("archive", route.archive);
    if (route.archiveView !== undefined) params.set("archiveView", route.archiveView);
    if (route.archiveBrowse !== undefined) {
      const encoded = JSON.stringify(route.archiveBrowse);
      if (parseArchiveBrowse(encoded) === null) throw new Error("Archive browsing state exceeds its route bounds.");
      params.set("archiveBrowse", encoded);
    }
    if (route.archiveDashboard !== undefined && route.archiveWorkflow !== undefined) {
      if (parseArchiveFolderRoute(route.archiveDashboard, route.archiveWorkflow) === null) throw new Error("Archive folder route exceeds its bounds.");
      params.set("archiveDashboard", route.archiveDashboard);
      params.set("archiveWorkflow", route.archiveWorkflow);
    }
  }
  if (route.activity !== undefined) params.set("activity", route.activity);
  if (route.settings !== undefined) {
    params.set("settings", route.settings);
    if (route.settingsTarget !== undefined) params.set("settingsTarget", route.settingsTarget);
  }
  if (route.view !== undefined) {
    const encoded = JSON.stringify(route.view);
    if (parseViewRoute(encoded) === null) throw new Error("VIEW_ROUTE_INVALID");
    if (encoded !== "{}") params.set("view", encoded);
  }
  const query = params.toString();
  return query.length === 0 ? "" : `?${query}`;
}

/** Open corpus results in their exact day and workflow; clear takeovers hiding the queue. */
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
    archiveDashboard: undefined,
    archiveWorkflow: undefined, archiveBrowse: undefined, archiveBrowseInvalid: undefined,
    activity: undefined,
    settings: undefined, settingsTarget: undefined,
  };
}

/** Do not push identical routes; Back must leave the screen on its first press. */
export function routeAdvancesHistory(next: AppRouteState, currentSearch: string): boolean {
  return routeToSearch(next) !== currentSearch;
}

/** Resolve route precedence once; active work outranks reference views. */
export type ActiveTakeover =
  | "settings"
  | "intake"
  | "archive"
  | "activity"
  | "explore"
  | "none";

export function activeTakeover(route: AppRouteState): ActiveTakeover {
  // Settings must outrank takeovers so the global Storage checks door always changes views.
  if (route.settings !== undefined) return "settings";
  if (route.intake !== undefined) return "intake";
  // Destination pages outrank Explorer lookups; intake work still outranks reference pages.
  if (route.archive !== undefined) return "archive";
  if (route.activity !== undefined) return "activity";
  if (route.explore !== undefined) return "explore";
  return "none";
}

/** Switcher state follows the resolved view; unnamed takeovers must not falsely select Queue. */
export function shellViewOf(takeover: ActiveTakeover): ShellViewSelection {
  switch (takeover) {
    case "explore": return "explorer";
    case "activity": return "activity";
    case "none": return "queue";
    // The Archive removal route shows only its removal notice; the switcher has no segment for it.
    case "archive":
    case "settings":
    case "intake": return "none";
  }
}

/** A close leaves one queue surface, including links containing competing keys. */
export function routeWithoutTakeovers(route: AppRouteState): AppRouteState {
  return { ...route, intake: undefined, explore: undefined, archive: undefined, archiveView: undefined,
    archiveDashboard: undefined, archiveWorkflow: undefined, archiveBrowse: undefined, archiveBrowseInvalid: undefined,
    activity: undefined, settings: undefined, settingsTarget: undefined, catalog: undefined, catalogView: undefined };
}
