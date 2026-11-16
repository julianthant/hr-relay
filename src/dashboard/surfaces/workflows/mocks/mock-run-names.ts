import { useSyncExternalStore } from "react";

// shortcut: run names live in this page only; persisting a rename is a later backend part.
let names: ReadonlyMap<string, string> = new Map();
const listeners = new Set<() => void>();

/** One name per mock run, shared by its queue row and its Logs header; an empty name restores the default. */
export function renameMockRun(runId: string, name: string): void {
  const next = new Map(names);
  if (name) next.set(runId, name); else next.delete(runId);
  names = next;
  for (const listener of listeners) listener();
}

export function useMockRunNames(): ReadonlyMap<string, string> {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => names);
}
