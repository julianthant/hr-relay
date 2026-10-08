import { createContext, useContext } from "react";
export interface PreflightActions {
  readonly actorId: string;
  readonly descriptorFingerprint: string;
  showSettings(section?: "storage" | "credentials" | "routes"): void;
  showSessions(): void;
}
export const PreflightActionsContext = createContext<PreflightActions | undefined>(undefined);
export function usePreflightActions(): PreflightActions {
  const actions = useContext(PreflightActionsContext);
  if (actions === undefined) throw new Error("Preflight actions require the dashboard shell provider.");
  return actions;
}
