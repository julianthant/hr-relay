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
import { useEffect, useMemo, useState } from "react";
import type { DashboardDayWire } from "../../models/dashboard/projection.js";
import type { SubscriptionState } from "../client/index.js";
import { protocolError } from "../client/errors.js";
import { failed, loaded, LOADING, type AsyncResource } from "./async-resource.js";
import { useDashboardClient } from "./client-context.js";

export interface DashboardDayState {
  readonly day: AsyncResource<DashboardDayWire>;
  readonly connection: SubscriptionState;
}

export function useDashboardDay(day: string | undefined): DashboardDayState {
  const client = useDashboardClient();
  // A new object per request, including A → B → A; the render guard runs before effects.
  const request = useMemo(() => ({ client, day }), [client, day]);
  const [result, setResult] = useState<{ request: typeof request; value: DashboardDayState }>();
  useEffect(() => {
    let active = true;
    let value: DashboardDayState = { day: LOADING, connection: { state: "connecting" } };
    const publish = (): void => { if (active) setResult({ request, value }); };
    publish();
    if (day === undefined) return () => { active = false; };
    const subscription = client.subscribeDay({
      day,
      onDay: (next) => {
        if (!active) return;
        if (next.day !== day) {
          const error = protocolError("day-request-identity-mismatch");
          value = { day: failed(error), connection: { state: "stopped", error } };
        } else value = { ...value, day: loaded(next) };
        publish();
      },
      onState: (connection) => {
        if (!active) return;
        value = { day: connection.state === "stopped" && connection.error !== undefined
          ? failed(connection.error) : connection.state === "connecting" ? LOADING : value.day, connection };
        publish();
      },
    });
    return () => { active = false; subscription.close(); };
  }, [client, day, request]);
  return result?.request === request ? result.value : { day: LOADING, connection: { state: "connecting" } };
}
