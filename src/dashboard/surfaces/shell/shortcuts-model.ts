/**
 * The keyboard registry and its scope fold.
 *
 * It lives beside `shortcuts.tsx` rather than inside it because a module that
 * exports a component may export nothing else if React Fast Refresh is to treat
 * it as a refresh boundary: one non-component export makes every edit to the
 * surface invalidate upward into `dashboard-app.tsx` and remount the app
 * instead of hot-swapping the component.
 */

export type DemoShortcutScope = "Anywhere" | "The queue" | "The detail panel";

export interface DemoShortcut {
  keys: string[];
  /** the separator drawn between two keys that are a RANGE, not a pair */
  join?: string;
  what: string;
  where: DemoShortcutScope;
}

export const DEMO_SHORTCUTS: DemoShortcut[] = [
  { keys: ["r"], what: "start a run — any served workflow, from Dashboard", where: "The queue" },
  // `/` was bound in `surfaces/day-search.tsx` and missing from this array,
  // under a doc comment there claiming the legend already carried it. Nothing
  // could fail while the legend was reachable from nowhere; D274 item 5 gave it
  // a destination, so the omission became a bound key an operator reading Help
  // is told does not exist. The registry's own rule is the fix: a binding that
  // is not here is unreachable from Help.
  { keys: ["/"], what: "search runs — name, subject, trace id, run id or workflow", where: "Anywhere" },
  { keys: ["j", "k"], what: "move down / up the queue", where: "The queue" },
  { keys: ["n"], what: "jump to the next row waiting on you", where: "The queue" },
];

/** the registry, in scope order, with empty scopes dropped */
export function shortcutsByScope(
  shortcuts: readonly DemoShortcut[] = DEMO_SHORTCUTS,
): { scope: DemoShortcutScope; shortcuts: DemoShortcut[] }[] {
  const order: DemoShortcutScope[] = ["Anywhere", "The queue", "The detail panel"];
  return order
    .map((scope) => ({ scope, shortcuts: shortcuts.filter((s) => s.where === scope) }))
    .filter((group) => group.shortcuts.length > 0);
}
