import { createContext, useContext } from "react";
import type { Sessions } from "./use-sessions.js";

export const SESSIONS_CONSOLE_ID = "sessions-console";

export const SessionsContext = createContext<Sessions | undefined>(undefined);

export function useSessionsState(): Sessions {
  const sessions = useContext(SessionsContext);
  if (sessions === undefined) throw new Error("SESSIONS_PROVIDER_MISSING");
  return sessions;
}
