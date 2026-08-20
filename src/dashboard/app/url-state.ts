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
   * The generated UI catalog (2i-G, D177). The value IS the search term, so a
   * link can carry a query: `?catalog=kuali%20save`. An empty string means the
   * surface is open with nothing typed, which is why presence is what opens it
   * and the term may legitimately be blank.
   */
  readonly catalog?: string;
  /**
   * The read-only Archive (2i-G, D179). An empty value opens the index; a run
   * id opens that archived run's detail beside it — the same
   * `?archive=<runId>` link an operator can send, which is the point of
   * addressing it rather than holding it in component state.
   */
  readonly archive?: string;
  /**
   * The Activity report (2i-G, D180) as `from..to`. The RANGE is in the URL
   * because a report is a thing people cite: "the numbers I was looking at"
   * has to survive being pasted into a message. An empty value means the
   * surface is open on its default range.
   */
  readonly activity?: string;
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
  const archive = params.get("archive");
  const activity = params.get("activity");
  const route: {
    day?: string;
    run?: string;
    section?: string;
    start: boolean;
    intake?: string;
    explore?: string;
    catalog?: string;
    archive?: string;
    activity?: string;
  } = { start: params.get("start") === "1" };
  if (day !== null && DAY_PATTERN.test(day)) route.day = day;
  if (run !== null && run.length > 0) route.run = run;
  if (section !== null && section.length > 0) route.section = section;
  if (intake !== null && intake.length > 0) route.intake = intake;
  if (explore !== null && explore.length > 0) route.explore = explore;
  // Unlike every key above, an EMPTY catalog value is meaningful: the surface
  // is open with no search term. Presence is what opens it.
  if (catalog !== null) route.catalog = catalog;
  // Both of these follow `catalog`: an EMPTY value is meaningful (the index,
  // and the default range), so presence is what opens the surface.
  if (archive !== null) route.archive = archive;
  if (activity !== null) route.activity = activity;
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
  if (route.catalog !== undefined) params.set("catalog", route.catalog);
  if (route.archive !== undefined) params.set("archive", route.archive);
  if (route.activity !== undefined) params.set("activity", route.activity);
  const query = params.toString();
  return query.length === 0 ? "" : `?${query}`;
}

/**
 * Which takeover owns the main region, resolved in ONE place.
 *
 * Three keys can be present at once (a link may carry any combination), so the
 * precedence is stated rather than left to whichever branch a JSX tree happens
 * to test first: the operator's in-progress WORK outranks either reference
 * view, and the workflow-scoped reference outranks the system-scoped one.
 */
export function activeTakeover(
  route: AppRouteState,
): "intake" | "archive" | "activity" | "explore" | "catalog" | "none" {
  if (route.intake !== undefined) return "intake";
  // Archive and Activity outrank the two reference views for the same reason
  // intake outranks all of them: they are places the operator navigates TO and
  // stays, while the explorer and the catalog are things they look UP. What
  // they are not is work — which is why intake still outranks both.
  if (route.archive !== undefined) return "archive";
  if (route.activity !== undefined) return "activity";
  if (route.explore !== undefined) return "explore";
  if (route.catalog !== undefined) return "catalog";
  return "none";
}
