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
  { keys: ["r"], what: "start a run — any workflow, from any view", where: "Anywhere" },
  { keys: ["j", "k"], what: "move down / up the queue", where: "The queue" },
  { keys: ["n"], what: "jump to the next row waiting on you", where: "The queue" },
  // The keyboard route to the row context menu. Right-click and the platform's
  // own Menu / Shift+F10 key open the same menu; this one does not depend on
  // the operator's keyboard having that key, and it works from the SELECTION
  // rather than from focus.
  { keys: ["m"], what: "every command on the selected row", where: "The queue" },
  { keys: ["1", "4"], join: "–", what: "switch the detail panel's tab", where: "The detail panel" },
  { keys: ["w"], what: "cycle the Workflow Panel — floating, icon, sidebar", where: "Anywhere" },
  { keys: ["Esc"], what: "minimise the Workflow Panel", where: "Anywhere" },
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
