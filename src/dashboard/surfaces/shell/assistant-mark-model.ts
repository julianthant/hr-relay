/** Design mock (logo brief): three original assistant marks, chosen from the URL (`assistantLogo=relay|nodes|orbit`). */
export const MARK_DIRECTIONS = ["relay", "nodes", "orbit"] as const;
export type MarkDirection = (typeof MARK_DIRECTIONS)[number];
export const MARK_STATES = ["idle", "thinking", "working", "done", "needs-you", "error"] as const;
export type MarkState = (typeof MARK_STATES)[number];

/** The launcher's state in a logo still (`assistantLogoState=needs-you`); idle otherwise. */
export function assistantLogoState(): MarkState {
  if (typeof window === "undefined") return "idle";
  const value = new URLSearchParams(window.location.search).get("assistantLogoState");
  return MARK_STATES.find(item => item === value) ?? "idle";
}

/** Launcher placement mock (`assistantLauncher=p1|p2|p3`): footer bar icon, Logs toolbar button, app header icon. */
export const LAUNCHER_PLACEMENTS = ["p1", "p2", "p3"] as const;
export type LauncherPlacement = (typeof LAUNCHER_PLACEMENTS)[number];
export function assistantLauncher(): LauncherPlacement | undefined {
  if (typeof window === "undefined") return undefined;
  const value = new URLSearchParams(window.location.search).get("assistantLauncher");
  return LAUNCHER_PLACEMENTS.find(item => item === value);
}

export function assistantLogo(): MarkDirection | undefined {
  if (typeof window === "undefined") return undefined;
  const value = new URLSearchParams(window.location.search).get("assistantLogo");
  return MARK_DIRECTIONS.find(item => item === value);
}
