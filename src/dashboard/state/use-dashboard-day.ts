/** The selected day's server state, and nothing else.
 * One subscription per day (ref frontend-backend-integration: one global stream, not a connection */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DashboardDayWire } from "../../models/dashboard/projection.js";
import type { SubscriptionState } from "../client/index.js";
import { protocolError } from "../client/errors.js";
import { failed, loaded, LOADING, type AsyncResource } from "./async-resource.js";
import { useDashboardClient } from "./client-context.js";

export interface DashboardDayState {
  readonly day: AsyncResource<DashboardDayWire>;
  readonly connection: SubscriptionState;
  readonly refresh: () => void;
}

export function useDashboardDay(day: string | undefined, nowIso?: string): DashboardDayState {
  const client = useDashboardClient();
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const firedExpiries = useRef(new Set<string>());
  // A new object per request, including A → B → A; the render guard runs before effects.
  const request = useMemo(() => ({ client, day, revision }), [client, day, revision]);
  const [result, setResult] = useState<{ request: typeof request; value: DashboardDayState }>();
  useEffect(() => {
    let active = true;
    let value: DashboardDayState = { day: LOADING, connection: { state: "connecting" }, refresh };
    const publish = (): void => { if (active) setResult({ request, value }); };
    publish();
    if (day === undefined) return () => { active = false; };
    const subscription = client.subscribeDay({
      day,
      onDay: (next) => {
        if (!active) return;
        if (next.day !== day) {
          const error = protocolError("day-request-identity-mismatch");
          value = { day: failed(error), connection: { state: "stopped", error }, refresh };
        } else value = { ...value, day: loaded(next) };
        publish();
      },
      onState: (connection) => {
        if (!active) return;
        value = { day: connection.state === "stopped" && connection.error !== undefined
          ? failed(connection.error) : connection.state === "connecting" ? LOADING : value.day, connection, refresh };
        publish();
      },
    });
    return () => { active = false; subscription.close(); };
  }, [client, day, request, refresh]);
  const current = result?.request === request ? result.value : { day: LOADING, connection: { state: "connecting" as const }, refresh };
  useEffect(() => {
    if (current.day.state !== "loaded" || nowIso === undefined) return;
    const pending = current.day.value.notifications
      .flatMap(row => row.kind === "notification" && row.state === "snoozed" && row.snoozedUntil !== undefined
        ? [{ key: `${row.notificationId}:${row.snoozedUntil}`, until: Date.parse(row.snoozedUntil) }] : [])
      .filter(entry => !firedExpiries.current.has(entry.key))
      .sort((a, b) => a.until - b.until)[0];
    if (pending === undefined) return;
    const timer = setTimeout(() => { firedExpiries.current.add(pending.key); refresh(); }, Math.max(0, pending.until - Date.parse(nowIso)));
    return () => clearTimeout(timer);
  }, [current.day, nowIso, refresh]);
  return current;
}
