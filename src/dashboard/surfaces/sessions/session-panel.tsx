import { createContext, useContext, type ReactNode } from "react";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import type { SessionCommandBinding } from "./session-preview-command-model.js";
import { SessionsView } from "./sessions-view.js";
import { useSessions, type Sessions, type SessionsHarness } from "./use-sessions.js";

const SessionsContext = createContext<Sessions | undefined>(undefined);

/** Reads the workers once; the sidebar controls and the docked console share this one state. */
export function SessionsProvider({ catalog, harness, binding, children }: { catalog: readonly WorkflowCatalogEntry[]; harness?: SessionsHarness; binding?: SessionCommandBinding; children: ReactNode }) {
  const sessions = useSessions({ catalog, ...(harness === undefined ? {} : { harness }), ...(binding === undefined ? {} : { binding }) });
  return <SessionsContext.Provider value={sessions}>{children}</SessionsContext.Provider>;
}

export function useSessionsState(): Sessions {
  const sessions = useContext(SessionsContext);
  if (sessions === undefined) throw new Error("SESSIONS_PROVIDER_MISSING");
  return sessions;
}

export function SessionPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data, addable, commands } = useSessionsState();
  return <SessionsView data={data} open={open} onOpenChange={onOpenChange} workflows={addable} idleCountdowns={commands.idleCountdowns} onControl={commands.control} operations={commands.operations} />;
}
