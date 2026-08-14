/**
 * Ported from legacy hr-automation@1bffbd65,
 * src/dashboard/components/dev/rebuild-demo/demo-nav-history.ts.
 *
 * WHERE THE OPERATOR HAS BEEN.
 *
 * A queue row can send you somewhere else: a delegation chip, a back link, a
 * search hit, a notification. Every one of those changes the panel AND the
 * selected row, and without this the only way back is to remember which
 * workflow you came from and which of its rows you were on.
 *
 * This is that history, and it is a PURE value so the semantics can be pinned
 * by a test rather than driven through a shell. The rules are the browser's,
 * because the browser's are the ones the operator already knows:
 *
 *  - A **place** reproduces the view. Restoring part of it lands you on the
 *    right row with the wrong thing showing, which is the failure mode that
 *    makes a back button not worth pressing.
 *  - Going somewhere **truncates the forward branch**. There is no tree.
 *  - Landing on the place you are already standing on is **not a move**, so a
 *    re-render, a refetch, or re-selecting the same row cannot pad the history
 *    with entries that go nowhere.
 *  - Moving through the history does **not** push. That is the difference
 *    between a history and a log, and getting it wrong makes Back a loop of
 *    two entries.
 *  - The list is **capped**; the oldest end is dropped, and the index moves
 *    with it so the cap can never silently teleport the operator.
 *
 * ONE DELIBERATE WIDENING over the demo's triple, and it is the demo's own
 * requirement expressed in this app's state. The demo restores a row's DAY by
 * looking the row up in a constant corpus (`DEMO_ROWS`) — its comment: *"a
 * place restored into the wrong date partition lands on an empty queue and
 * reads as a broken button."* Here the day is served state and a run id alone
 * cannot name its partition without a fetch, so the day is part of the place
 * rather than derived from it. `runId` is nullable for the same honesty: a
 * panel with nothing selected is a real place to come back to, and the demo's
 * corpus simply never had one.
 */

/** the smallest tuple that reproduces a view exactly */
export interface NavPlace {
  /** the day partition the queue was reading */
  day: string;
  /** the Workflow Panel entry that owned the queue */
  workflow: string;
  /** the selected run; `null` = the panel with nothing open */
  runId: string | null;
  /** the detail tab the run was open on; `null` = the run's own default */
  tab: string | null;
}

export interface NavHistory {
  places: NavPlace[];
  /** which of them the operator is standing on */
  index: number;
}

/**
 * How far back the operator can go. Deep enough that a session of cross-panel
 * link-following never runs out, shallow enough that the array is not a leak.
 */
export const NAV_HISTORY_LIMIT = 50;

export function initNavHistory(place: NavPlace): NavHistory {
  return { places: [place], index: 0 };
}

export function samePlace(a: NavPlace | undefined, b: NavPlace | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return a.day === b.day && a.workflow === b.workflow && a.runId === b.runId && a.tab === b.tab;
}

export function currentPlace(history: NavHistory): NavPlace | undefined {
  return history.places[history.index];
}

export function canGoBack(history: NavHistory): boolean {
  return history.index > 0;
}

export function canGoForward(history: NavHistory): boolean {
  return history.index < history.places.length - 1;
}

/**
 * Arrive somewhere. Truncates whatever was ahead, ignores a no-op, and drops
 * the oldest entry once the cap is reached.
 */
export function pushPlace(history: NavHistory, place: NavPlace): NavHistory {
  if (samePlace(currentPlace(history), place)) return history;
  const kept = history.places.slice(0, history.index + 1);
  kept.push(place);
  // The oldest end goes, and the index goes with it — a cap that moved the
  // list without moving the cursor would silently change where "here" is.
  const overflow = Math.max(0, kept.length - NAV_HISTORY_LIMIT);
  const places = overflow > 0 ? kept.slice(overflow) : kept;
  return { places, index: places.length - 1 };
}

export function goBack(history: NavHistory): NavHistory {
  return canGoBack(history) ? { ...history, index: history.index - 1 } : history;
}

export function goForward(history: NavHistory): NavHistory {
  return canGoForward(history) ? { ...history, index: history.index + 1 } : history;
}

/**
 * What the control says it will do. A back button that only says "Back" makes
 * the operator press it to find out where it goes; naming the destination is
 * what turns two glyphs into a route they can plan with.
 *
 * `nameRun` answers `undefined` for a run this app cannot currently name — a
 * place on another day, whose rows this build has not fetched. The label then
 * falls back to the workflow alone, which is the demo's own fallback shape and
 * is still true; inventing a title for a row nobody read would not be.
 */
export function navDestinationLabel(
  history: NavHistory,
  direction: "back" | "forward",
  nameRun: (runId: string) => string | undefined,
  nameWorkflow: (workflowId: string) => string,
): string | undefined {
  const target = history.places[direction === "back" ? history.index - 1 : history.index + 1];
  if (target === undefined) return undefined;
  const workflow = nameWorkflow(target.workflow);
  if (target.runId === null) return workflow;
  const run = nameRun(target.runId);
  return run === undefined ? workflow : `${workflow} · ${run}`;
}
