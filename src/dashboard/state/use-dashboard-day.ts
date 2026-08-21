/**
 * The selected day's server state, and nothing else.
 *
 * One subscription per day (ref frontend-backend-integration §7.4: one global stream, not a connection
 * per component). The hook OWNS no authority: it hands the client's snapshots
 * and patches to React verbatim. It never merges rows, recomputes a count,
 * removes a row after a command, or turns a status. When the stream stops with
 * an error that error becomes visible state — a dashboard that silently keeps
 * painting a stale day is the exact failure ref frontend-backend-integration §3.5 forbids.
 */
import { useEffect, useState } from "react";
import type { DashboardDayWire } from "../../domain/dashboard/projection.js";
import type { SubscriptionState } from "../client/index.js";
import { failed, loaded, LOADING, type AsyncResource } from "./async-resource.js";
import { useDashboardClient } from "./client-context.js";

export interface DashboardDayState {
  readonly day: AsyncResource<DashboardDayWire>;
  readonly connection: SubscriptionState;
}

export function useDashboardDay(day: string): DashboardDayState {
  const client = useDashboardClient();
  const [dayResource, setDayResource] = useState<AsyncResource<DashboardDayWire>>(LOADING);
  const [connection, setConnection] = useState<SubscriptionState>({ state: "connecting" });

  useEffect(() => {
    setDayResource(LOADING);
    setConnection({ state: "connecting" });
    const subscription = client.subscribeDay({
      day,
      onDay: (next) => setDayResource(loaded(next)),
      onState: (state) => {
        setConnection(state);
        // A subscription that stopped with an error has no path back to fresh
        // data; surface it instead of leaving the last snapshot on screen
        // pretending to be live.
        if (state.state === "stopped" && state.error !== undefined) {
          setDayResource(failed(state.error));
        }
      },
    });
    return () => subscription.close();
  }, [client, day]);

  return { day: dayResource, connection };
}
