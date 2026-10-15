import { createContext, useContext, useEffect, useMemo, useRef } from "react";
export interface PreflightActions {
  readonly actorId: string;
  readonly descriptorFingerprint: string;
  showSettings(section?: "storage" | "credentials" | "routes"): void;
  showSessions(): void;
}
export const PreflightActionsContext = createContext<PreflightActions | undefined>(undefined);
export function usePreflightActions(): PreflightActions {
  const actions = useContext(PreflightActionsContext);
  const request = useMemo(() => ({ actions }), [actions]);
  const current = useRef<typeof request | undefined>(request);
  current.current = request;
  useEffect(() => { current.current = request; return () => { if (current.current === request) current.current = undefined; }; }, [request]);
  const bound = useMemo(() => actions === undefined ? undefined : { ...actions,
    showSettings: (section?: "storage" | "credentials" | "routes") => { if (current.current === request) actions.showSettings(section); },
    showSessions: () => { if (current.current === request) actions.showSessions(); },
  }, [actions, request]);
  if (bound === undefined) throw new Error("Preflight actions require the dashboard shell provider.");
  return bound;
}
