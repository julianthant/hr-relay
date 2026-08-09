/**
 * The app's visible state lives in the query string.
 *
 * Day, open run, open section and the start dialog are all addressable, which
 * is what lets an operator send someone a link to the exact screen they are
 * looking at — and, not incidentally, what lets the parity lane ask two
 * different backends for the same screen (doc 13 §7.2).
 *
 * Nothing here reads or writes server state; this is pure client UI state
 * (doc 13 §4) held in the one place the browser already persists for us.
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
  const route: {
    day?: string;
    run?: string;
    section?: string;
    start: boolean;
    intake?: string;
  } = { start: params.get("start") === "1" };
  if (day !== null && DAY_PATTERN.test(day)) route.day = day;
  if (run !== null && run.length > 0) route.run = run;
  if (section !== null && section.length > 0) route.section = section;
  if (intake !== null && intake.length > 0) route.intake = intake;
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
  const query = params.toString();
  return query.length === 0 ? "" : `?${query}`;
}
