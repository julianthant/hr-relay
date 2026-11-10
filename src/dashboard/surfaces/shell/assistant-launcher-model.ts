import { useSyncExternalStore } from "react";
import { MARK_STATES, type MarkState } from "./assistant-mark-model.js";
import { mockParam } from "../../app/mock-surfaces.js";

function param(name: string): string | null {
  return mockParam(name);
}

let opened: boolean | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const emit = () => { for (const listener of listeners) listener(); };

/** Decisions waiting on the operator: the served inbox's unread priority count, or `assistantNeeds=<n>` in the design frames. */
let servedNeeds = 0;
export const assistantNeeds = {
  report(count: number) { if (count !== servedNeeds) { servedNeeds = count; emit(); } },
  get(): number {
    const value = Number(param("assistantNeeds"));
    return Number.isSafeInteger(value) && value > 0 ? value : servedNeeds;
  },
};
export function useAssistantNeedsYou(): number {
  return useSyncExternalStore(subscribe, () => assistantNeeds.get(), () => 0);
}

/** The panel's open state, shared by the shell panel and whichever launcher is on screen. `assistantOpen=0|1` overrides the first value. */
export const assistantOpen = {
  init(initial: boolean) { if (opened === undefined) opened = param("assistantOpen") === "1" ? true : param("assistantOpen") === "0" ? false : initial; },
  get: () => opened ?? false,
  set(next: boolean) { opened = next; emit(); },
  toggle() { opened = !(opened ?? false); emit(); },
};

export function useAssistantOpen(): boolean {
  return useSyncExternalStore(subscribe, assistantOpen.get, () => false);
}

/** Returns focus to whichever launcher is on screen (the panel closed from inside). */
export function focusAssistantLauncher(): void {
  document.querySelector<HTMLElement>("[data-assistant-launcher]")?.focus();
}

/** What the assistant is doing, for the launcher mark: replying, confirming, or the short done / error that follows. `assistantMark=<state>` pins a state in stills. */
export type AssistantTurnPhase = "waiting" | "confirming" | "failed" | "settled";
let activity: MarkState | undefined, lastPhase: AssistantTurnPhase = "settled", settle: ReturnType<typeof setTimeout> | undefined;
const setActivity = (next: MarkState | undefined) => { activity = next; emit(); };
export const assistantActivity = {
  report(phase: AssistantTurnPhase) {
    const was = lastPhase; lastPhase = phase; clearTimeout(settle);
    if (phase === "waiting") return setActivity("thinking");
    if (phase === "confirming") return setActivity("working");
    if (was !== "waiting" && was !== "confirming") return setActivity(undefined);
    setActivity(phase === "failed" ? "error" : "done"); settle = setTimeout(() => { setActivity(undefined); }, 2400);
  },
  get: () => activity,
};

/** The launcher mark's state: the turn's activity, else needs-you, else idle. */
export function useAssistantMarkState(): MarkState {
  const live = useSyncExternalStore(subscribe, assistantActivity.get, () => undefined);
  const pinned = MARK_STATES.find(state => state === param("assistantMark"));
  const needs = useAssistantNeedsYou();
  return pinned ?? live ?? (needs > 0 ? "needs-you" : "idle");
}
