import { useSyncExternalStore } from "react";

/** Settings > General > Assistant > Allow full access: when on, the composer's approval menu offers Full access. `assistantFullAccess=1` starts it on. */
let allowed = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("assistantFullAccess") === "1";
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function setFullAccessAllowed(next: boolean): void {
  allowed = next;
  for (const listener of listeners) listener();
}

export function useFullAccessAllowed(): boolean {
  return useSyncExternalStore(subscribe, () => allowed, () => false);
}
