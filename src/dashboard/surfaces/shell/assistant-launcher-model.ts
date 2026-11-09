import { useSyncExternalStore } from "react";

function param(name: string): string | null {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(name);
}

/** Decisions waiting on the operator (`assistantNeeds=<n>`); a served count is a backend gap. */
export function assistantNeedsYou(): number {
  const value = Number(param("assistantNeeds"));
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

let opened: boolean | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const emit = () => { for (const listener of listeners) listener(); };

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
