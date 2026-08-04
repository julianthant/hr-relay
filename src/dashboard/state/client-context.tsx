/**
 * The ONE client, handed to the tree once (doc 13 §2).
 *
 * Surfaces never construct a client, a transport, a `fetch`, or a stream —
 * they read this context. Tests (and the dual-adapter parity harness, doc 13
 * §7.2) swap the whole adapter here by providing a client built against a
 * different base URL, which is why the provider takes a client rather than a
 * URL: the fixture adapter and the real HTTP/SSE adapter differ at exactly one
 * seam and nowhere else.
 */
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

/**
 * Fails loud when the tree was mounted without a provider. A default no-op
 * client here would turn "the app was composed wrong" into "the dashboard is
 * mysteriously empty" — exactly the silent substitution this repo forbids.
 */
export function useDashboardClient(): DashboardClient {
  const client = useContext(DashboardClientContext);
  if (client === undefined) {
    throw new Error("useDashboardClient requires a DashboardClientProvider above it");
  }
  return client;
}
