import { useEffect, useRef } from "react";
import "./assistant-mark.css";

import type { MarkDirection, MarkState } from "./assistant-mark-model.js";

/**
 * Every state differs in shape or colour, so it reads with motion off; motion only adds a short, subtle loop
 * (thinking, working, needs you) or one settle (done). Error is always still.
 */
export function AssistantMark({ direction, state = "idle", size = 16, label }: { direction: MarkDirection; state?: MarkState; size?: number; label?: string }) {
  const svg = useRef<SVGSVGElement>(null);
  useIdleOrbit(svg, direction === "orbit" && state === "idle");
  return <svg ref={svg} className="assistant-mark" data-direction={direction} data-state={state} width={size} height={size} viewBox="0 0 24 24" fill="none"
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

const IDLE_DEGREES_PER_SECOND = 45, HOVER_DEGREES_PER_SECOND = 260;

/** The Orbit satellite circles slowly at idle and speeds up smoothly while the pointer is over its button; it stays still under reduced motion. */
function useIdleOrbit(svg: React.RefObject<SVGSVGElement | null>, active: boolean) {
  useEffect(() => {
    const element = svg.current, satellite = element?.querySelector<SVGGElement>(".mark-spin");
    if (!active || !element || !satellite || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "off") return;
    const host = element.closest("button") ?? element;
    let angle = 0, speed = IDLE_DEGREES_PER_SECOND, target = IDLE_DEGREES_PER_SECOND, last = -1, frame = 0;
    const tick = (now: number) => {
      const seconds = last < 0 ? 0 : (now - last) / 1000; last = now;
      speed += (target - speed) * Math.min(1, seconds * 6); angle = (angle + speed * seconds) % 360;
      satellite.style.transform = `rotate(${angle.toFixed(1)}deg)`; frame = requestAnimationFrame(tick);
    };
    const faster = () => { target = HOVER_DEGREES_PER_SECOND; }, slower = () => { target = IDLE_DEGREES_PER_SECOND; };
    host.addEventListener("pointerenter", faster); host.addEventListener("pointerleave", slower);
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); host.removeEventListener("pointerenter", faster); host.removeEventListener("pointerleave", slower); satellite.style.transform = ""; };
  }, [svg, active]);
}
