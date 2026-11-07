import { useEffect, useState } from "react";
import { AssistantMark, MARK_STATES, type MarkDirection, type MarkState } from "./assistant-mark.js";
import { AssistantReply } from "./assistant-panel.js";

const NAMES: Readonly<Record<MarkDirection, string>> = { relay: "Relay", nodes: "Nodes", orbit: "Orbit" };
const HINTS: Readonly<Record<MarkState, string>> = {
  idle: "Still", thinking: "While the model writes", working: "A session or run is going", done: "One settle, then still",
  "needs-you": "A decision waits (launcher)", error: "Still, danger tint",
};

/** Design mock: the direction's states at avatar, header and launcher size; the hero cycles the states unless motion is reduced. */
export function AssistantLogoSheet({ direction }: { direction: MarkDirection }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setIndex(value => (value + 1) % MARK_STATES.length), 1400);
    return () => window.clearInterval(timer);
  }, []);
  const hero = MARK_STATES[index];
  return <>
    <div className="flex items-center gap-4 rounded-xl border border-ui-stroke bg-ui-table px-5 py-4" data-logo-hero>
      <AssistantMark direction={direction} state={hero} size={64} label={`${NAMES[direction]} mark, ${hero}`} />
      <span className="flex flex-col"><strong className="text-ui-primary">{NAMES[direction]}</strong><span className="text-caption text-ui-muted">{hero} · {HINTS[hero]}</span></span>
    </div>
    <AssistantReply>Each state at avatar, header and launcher size.</AssistantReply>
    <div className="flex flex-col">{MARK_STATES.map((state, row) => <div key={state} className={`flex items-center gap-4 py-2.5 ${row > 0 ? "border-t border-ui-stroke" : ""}`}>
      <span className="flex min-w-0 flex-1 flex-col"><span className="font-medium">{state}</span><span className="truncate text-caption text-ui-muted">{HINTS[state]}</span></span>
      <span className="hub-avatar-sample"><AssistantMark direction={direction} state={state} size={14} /></span>
      <AssistantMark direction={direction} state={state} size={18} />
      <span className="grid size-12 place-items-center rounded-full border border-ui-stroke-control bg-ui-panel text-ui-primary shadow-md"><AssistantMark direction={direction} state={state} size={22} /></span>
    </div>)}</div>
  </>;
}
