import "./assistant-mark.css";

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

/**
 * Every state differs in shape or colour, so it reads with motion off; motion only adds a short, subtle loop
 * (thinking, working, needs you) or one settle (done). Error is always still.
 */
export function AssistantMark({ direction, state = "idle", size = 16, label }: { direction: MarkDirection; state?: MarkState; size?: number; label?: string }) {
  return <svg className="assistant-mark" data-direction={direction} data-state={state} width={size} height={size} viewBox="0 0 24 24" fill="none"
    role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    {direction === "relay" ? <Relay /> : direction === "nodes" ? <Nodes /> : <Orbit />}
  </svg>;
}

/** Two arcs passing a baton: the gaps close into a ring when done. */
function Relay() {
  return <>
    <circle className="mark-halo" cx="12" cy="12" r="10.5" />
    <g className="mark-spin">
      <path className="mark-arc" d="M4.6 14.6A8 8 0 0 1 14.6 4.6" />
      <path className="mark-arc mark-arc-b" d="M19.4 9.4A8 8 0 0 1 9.4 19.4" />
    </g>
    <circle className="mark-ring" cx="12" cy="12" r="8" />
    <circle className="mark-core" cx="12" cy="12" r="2.4" />
  </>;
}

/** Three nodes passing a message along two edges; the third edge closes when done. */
function Nodes() {
  return <>
    <circle className="mark-halo" cx="12" cy="5" r="4.2" />
    <path className="mark-edge" d="M12 5L5 18.5L19 18.5" />
    <path className="mark-close" d="M19 18.5L12 5" />
    <circle className="mark-node mark-node-a" cx="12" cy="5" r="2.6" />
    <circle className="mark-node mark-node-b" cx="5" cy="18.5" r="2.6" />
    <circle className="mark-node mark-node-c" cx="19" cy="18.5" r="2.6" />
    <circle className="mark-packet" cx="0" cy="0" r="1.6" />
  </>;
}

/** A core with a satellite on its orbit; the satellite docks at the top when done. */
function Orbit() {
  return <>
    <circle className="mark-halo" cx="12" cy="12" r="10.5" />
    <circle className="mark-orbit" cx="12" cy="12" r="8.2" />
    <circle className="mark-core" cx="12" cy="12" r="3.6" />
    <g className="mark-spin"><circle className="mark-satellite" cx="17.8" cy="6.2" r="2.1" /></g>
  </>;
}
