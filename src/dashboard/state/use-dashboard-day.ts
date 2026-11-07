/** The selected day's server state, and nothing else.
 * One subscription per day (ref frontend-backend-integration: one global stream, not a connection */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NotificationPublicationWire } from "../../models/dashboard/subscription.js";
import type { DashboardDayWire } from "../../models/dashboard/projection.js";
import type { SubscriptionState } from "../client/index.js";
import { protocolError } from "../client/errors.js";
import { failed, loaded, LOADING, type AsyncResource } from "./async-resource.js";
import { useDashboardClient } from "./client-context.js";

export interface DashboardDayState {
  readonly request: object;
  readonly day: AsyncResource<DashboardDayWire>;
  readonly connection: SubscriptionState;
  readonly subscribePublications: (listener: (publication: NotificationPublicationWire) => void) => () => void;
  readonly refresh: () => void;
}

export function useDashboardDay(day: string | undefined, nowIso?: string, authorityEpoch?: object, actorId?: string): DashboardDayState {
  const client = useDashboardClient();
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const firedExpiries = useRef(new Set<string>());
  // A new object per request, including A → B → A; the render guard runs before effects.
  const request = useMemo(() => {
    const listeners = new Set<(publication: NotificationPublicationWire) => void>();
    return { client, day, revision, authorityEpoch, actorId,
      subscribePublications: (listener: (publication: NotificationPublicationWire) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      publishPublication: (publication: NotificationPublicationWire) => { for (const listener of listeners) listener(publication); },
    };
  }, [client, day, revision, authorityEpoch, actorId]);
  const activeRequest = useRef(request);
  activeRequest.current = request;
  const subscribePublications = request.subscribePublications;
  const [result, setResult] = useState<{ request: typeof request; value: DashboardDayState }>();
  useEffect(() => {
    let active = true;
    let value: DashboardDayState = { request, day: LOADING, connection: { state: "connecting" }, refresh, subscribePublications };
    const publish = (): void => { if (active) setResult({ request, value }); };
    publish();
    if (day === undefined) return () => { active = false; };
    const subscription = client.subscribeDay({
      day,
      ...(actorId === undefined ? {} : { publications: { actorId, onPublication: (publication: NotificationPublicationWire) => {
        if (!active || activeRequest.current !== request) return;
        request.publishPublication(publication);
      } } }),
      onDay: (next) => {
        if (!active) return;
        if (next.day !== day) {
          const error = protocolError("day-request-identity-mismatch");
          value = { request, day: failed(error), connection: { state: "stopped", error }, refresh, subscribePublications };
        } else value = { ...value, day: loaded(next) };
        publish();
      },
      onState: (connection) => {
        if (!active) return;
        value = { request, day: connection.state === "stopped" && connection.error !== undefined
          ? failed(connection.error) : connection.state === "connecting" ? LOADING : value.day, connection, refresh, subscribePublications };
        publish();
      },
    });
    return () => { active = false; subscription.close(); };
  }, [client, day, actorId, request, refresh, subscribePublications]);
  const current = result?.request === request ? result.value : { request, day: LOADING, connection: { state: "connecting" as const }, refresh, subscribePublications };
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
