/** The ONE client, handed to the tree once (ref frontend-backend-integration §2).
 * Surfaces never construct a client, a transport, a `fetch`, or a stream */
import { createContext, useContext, type ReactNode } from "react";
import type { DashboardClient } from "../client/index.js";

const DashboardClientContext = createContext<DashboardClient | undefined>(undefined);

export function DashboardClientProvider({
  client,
  children,
}: {
  client: DashboardClient;
  children: ReactNode;
}) {
  return <DashboardClientContext.Provider value={client}>{children}</DashboardClientContext.Provider>;
}

/** Fails loud when the tree was mounted without a provider. */
export function useDashboardClient(): DashboardClient {
  const client = useContext(DashboardClientContext);
  if (client === undefined) {
    throw new Error("useDashboardClient requires a DashboardClientProvider above it");
  }
  return client;
}
