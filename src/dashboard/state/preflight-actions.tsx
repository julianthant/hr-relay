import { createContext, useContext, type ReactNode } from "react";
export interface PreflightActions {
  readonly actorId: string;
  readonly descriptorFingerprint: string;
  showSettings(section?: "storage"): void;
  showSessions(): void;
}
const Context = createContext<PreflightActions | undefined>(undefined);
/** Presentation owns remedy links; the shell owns navigation and the existing session drawer. */
export function PreflightActionsProvider({ actions, children }: { actions: PreflightActions; children: ReactNode }) {
  return <Context.Provider value={actions}>{children}</Context.Provider>;
}
export function usePreflightActions(): PreflightActions {
  const actions = useContext(Context);
  if (actions === undefined) throw new Error("Preflight actions require the dashboard shell provider.");
  return actions;
}
