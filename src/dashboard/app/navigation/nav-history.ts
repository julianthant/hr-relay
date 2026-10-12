/** the smallest tuple that reproduces a view exactly */
export interface NavPlace {
  /** the day partition the queue was reading */
  day: string;
  followToday?: boolean;
  /** the Workflow Panel entry that owned the queue */
  workflow: string;
  /** the selected run; `null` = the panel with nothing open */
  runId: string | null;
  /** the detail tab the run was open on; `null` = the run's own default */
  tab: string | null;
}

export interface NavHistory {
  places: NavPlace[];
  /** which of them the operator is standing */
  index: number;
}

/** How far back the operator can go. Deep enough that a session of cross-panel
 * link-following never runs out, shallow enough that the array is not a leak. */
const NAV_HISTORY_LIMIT = 50;

export function initNavHistory(place: NavPlace): NavHistory {
  return { places: [place], index: 0 };
}

function samePlace(a: NavPlace | undefined, b: NavPlace | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return a.followToday === b.followToday && (a.followToday === true || a.day === b.day) && a.workflow === b.workflow && a.runId === b.runId && a.tab === b.tab;
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

/** Arrive somewhere. Truncates whatever was ahead, ignores a no-op, and drops
 * the oldest entry once the cap is reached. */
export function pushPlace(history: NavHistory, place: NavPlace): NavHistory {
  if (samePlace(currentPlace(history), place)) return history;
  const kept = history.places.slice(0, history.index + 1);
  kept.push(place);
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

/** What the control says it will do. A back button that only says
 * "Back" makes the operator press it to find out where it goes */
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
