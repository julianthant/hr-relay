import { createContext, useSyncExternalStore } from "react";

export const HubPreferencesPreviewContext = createContext(false);

export const HUB_APPROVAL_MODES = [
  { label: "Ask before every action", description: "Confirm each proposed change." },
] as const;
export type HubApprovalMode = typeof HUB_APPROVAL_MODES[number]["label"];
export interface HubPreferencesPort {
  readonly source: "mock";
  read(this: void): { permission: HubApprovalMode; width: string; height: string };
  subscribe(this: void, listener: () => void): () => void;
  change(this: void, value: ReturnType<HubPreferencesPort["read"]>): void;
}
export function createMockHubPreferencesPort(): HubPreferencesPort {
  let value: ReturnType<HubPreferencesPort["read"]> = { permission: "Ask before every action", width: "1440", height: "1000" };
  const listeners = new Set<() => void>();
  return { source: "mock", read: () => value, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }, change(next) { value = next; listeners.forEach(listener => listener()); } };
}
const mockHubPreferencesPort = createMockHubPreferencesPort();
export function useHubPreferences(port = mockHubPreferencesPort) {
  const value = useSyncExternalStore(port.subscribe, port.read, port.read);
  return { value, source: port.source, change: port.change };
}
